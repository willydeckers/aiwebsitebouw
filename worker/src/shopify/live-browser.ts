import { chromium, type BrowserContext, type Page } from "playwright";
import { mkdirSync } from "node:fs";
import type { SupabaseClient } from "@supabase/supabase-js";

// A watchable, persistent browser for UI automation, plus the plumbing that
// streams what it sees into the dashboard.
//
// Deliberately generic: nothing in here knows about Shopify. The store-creation
// job is the first user, but the same pattern (drive a third-party UI, let a
// human take over when it gets stuck) is the reason this is a module rather
// than part of that job.
//
// Three decisions worth knowing about:
//
// 1. PERSISTENT CONTEXT, not a fresh browser per run. The session — cookies,
//    local storage — lives on disk, so the automation stays logged in across
//    runs. This is also what makes the login problem tractable: a human logs
//    in once, by hand, in this same browser, and every later run inherits it.
//    The automation must never type credentials itself.
//
// 2. NOT HEADLESS. A human has to be able to take over mid-run, and you cannot
//    hand someone a headless browser. That also means this needs a machine
//    with a real display — see the note in the README about hosting.
//
// 3. STREAMING IS PERIODIC SCREENSHOTS, not video. A JPEG every few hundred ms
//    through Storage + Realtime is unglamorous but has no extra infrastructure
//    (no WebSocket server, no WebRTC), reuses transport the app already
//    subscribes to, and is plenty for "watch it work, spot when it's stuck".

export type LiveBrowserOpties = {
  supabase: SupabaseClient;
  /** Groups the stream and the log; the UI subscribes on this. */
  jobId: string;
  /** Where the persistent session lives. One per purpose, not per run. */
  sessieMap: string;
  intervalMs?: number;
};

const STANDAARD_INTERVAL_MS = 700;
/** JPEG at modest quality: this is a progress view, not a design review. */
const KWALITEIT = 55;

export class LiveBrowser {
  private context: BrowserContext | null = null;
  private streamTimer: NodeJS.Timeout | null = null;
  private bezigMetStream = false;

  constructor(private readonly opties: LiveBrowserOpties) {}

  async start(): Promise<Page> {
    mkdirSync(this.opties.sessieMap, { recursive: true });

    this.context = await chromium.launchPersistentContext(this.opties.sessieMap, {
      headless: false,
      viewport: { width: 1280, height: 800 },
      // A default-Playwright browser is trivially fingerprintable, which here
      // just means more challenge screens and more interruptions for the
      // human. A normal locale/timezone/UA is about behaving like the ordinary
      // browser session this is standing in for — not about defeating a
      // challenge, which this code never attempts.
      locale: "nl-BE",
      timezoneId: "Europe/Brussels",
      args: ["--disable-blink-features=AutomationControlled"],
    });

    const page = this.context.pages()[0] ?? (await this.context.newPage());
    this.startStream(page);
    return page;
  }

  /** Pushes a frame every interval. Failures are swallowed: losing the picture
   *  must never take down the automation it is only observing. */
  private startStream(page: Page) {
    const interval = this.opties.intervalMs ?? STANDAARD_INTERVAL_MS;
    this.streamTimer = setInterval(async () => {
      if (this.bezigMetStream || page.isClosed()) return;
      this.bezigMetStream = true;
      try {
        const frame = await page.screenshot({ type: "jpeg", quality: KWALITEIT });
        // Overwritten in place: the UI wants "what is on screen now", and
        // keeping history would grow without bound for no benefit. Remove
        // first — an upsert here has been observed serving stale bytes.
        const pad = `automatisering/${this.opties.jobId}/live.jpg`;
        await this.opties.supabase.storage.from("demos").remove([pad]);
        await this.opties.supabase.storage
          .from("demos")
          .upload(pad, frame, { contentType: "image/jpeg" });
      } catch {
        // Page navigating mid-screenshot is normal and self-correcting.
      } finally {
        this.bezigMetStream = false;
      }
    }, interval);
  }

  /** A frame kept on purpose, e.g. at the moment a step failed. */
  async bewaarSchermafbeelding(page: Page, naam: string): Promise<string | null> {
    try {
      const frame = await page.screenshot({ type: "jpeg", quality: 70, fullPage: false });
      const pad = `automatisering/${this.opties.jobId}/${naam}.jpg`;
      await this.opties.supabase.storage
        .from("demos")
        .upload(pad, frame, { contentType: "image/jpeg", upsert: true });
      return pad;
    } catch {
      return null;
    }
  }

  async stop() {
    if (this.streamTimer) clearInterval(this.streamTimer);
    this.streamTimer = null;
    await this.context?.close().catch(() => {});
    this.context = null;
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Step logging
// ─────────────────────────────────────────────────────────────────────────

export type StapResultaat = "ok" | "overgeslagen" | "mislukt" | "wacht_op_mens";

/**
 * One row per step. The point is that a failed run is readable afterwards
 * without rewatching a session that has already ended — which selector was
 * tried, what happened, and a frame from the moment it went wrong.
 */
export async function logStap(
  supabase: SupabaseClient,
  gegevens: {
    jobId: string;
    leadId: string;
    stap: string;
    resultaat: StapResultaat;
    selector?: string | null;
    detail?: string | null;
    schermafbeeldingPad?: string | null;
  },
) {
  const { error } = await supabase.from("shopify_automatisering_log").insert({
    job_id: gegevens.jobId,
    lead_id: gegevens.leadId,
    stap: gegevens.stap,
    selector: gegevens.selector ?? null,
    resultaat: gegevens.resultaat,
    detail: gegevens.detail ?? null,
    schermafbeelding_pad: gegevens.schermafbeeldingPad ?? null,
  });
  if (error) console.error("Kon automatiseringsstap niet loggen:", error.message);
  console.log(`[${gegevens.stap}] ${gegevens.resultaat}${gegevens.detail ? " — " + gegevens.detail : ""}`);
}

// ─────────────────────────────────────────────────────────────────────────
// Selector resolution
// ─────────────────────────────────────────────────────────────────────────

/**
 * Tries each candidate in order and returns the first that actually appears.
 * Returns null instead of throwing: "not found" is a normal branch here (an
 * optional step, a screen that didn't appear this time), and the caller knows
 * which of those it is.
 */
export async function vindEerste(
  page: Page,
  kandidaten: readonly string[],
  timeoutMs: number,
): Promise<{ selector: string } | null> {
  // Split the budget: five candidates each waiting the full timeout would turn
  // a 20s step into 100s of dead waiting.
  const perKandidaat = Math.max(1500, Math.floor(timeoutMs / Math.max(1, kandidaten.length)));
  for (const selector of kandidaten) {
    try {
      await page.locator(selector).first().waitFor({ state: "visible", timeout: perKandidaat });
      return { selector };
    } catch {
      // Next candidate.
    }
  }
  return null;
}

/** Is anything on screen that only a human can clear? */
export async function detecteerBlokkade(
  page: Page,
  blokkades: readonly { kandidaten: readonly string[]; omschrijving: string }[],
): Promise<string | null> {
  for (const blokkade of blokkades) {
    for (const selector of blokkade.kandidaten) {
      try {
        if (await page.locator(selector).first().isVisible({ timeout: 500 })) {
          return blokkade.omschrijving;
        }
      } catch {
        // Not present; keep looking.
      }
    }
  }
  return null;
}

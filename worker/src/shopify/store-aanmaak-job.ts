import type { SupabaseClient } from "@supabase/supabase-js";
import type { Page } from "playwright";
import {
  LiveBrowser,
  detecteerBlokkade,
  logStap,
  vindEerste,
} from "./live-browser.js";
import type { StapSelector } from "./store-flow-config.js";
import {
  DOMEIN_PATROON,
  STORE_FLOW,
  STORE_URL_PATROON,
  domeinVoorHandle,
  storeNaamVoorLead,
} from "./store-flow-config.js";

// Creating a Shopify development store by driving the Partner Dashboard.
//
// This is UI automation because there is no alternative: the Partner API has
// exactly one mutation (appCreditCreate) and nothing that returns or creates a
// store. That was verified against the live schema — see
// worker/scripts/partner-api-status.ts, which re-checks it in ten seconds.
//
// Treat this differently from the rest of the pipeline. The Admin API side is
// versioned and stable for a year at a time; this can break on any Tuesday
// because someone shipped a redesign. Hence: every selector in
// store-flow-config.ts, a log row per step, and a screenshot at the point of
// failure.
//
// What this deliberately does NOT do:
//   - type credentials. If the session is logged out, it stops and asks for a
//     human. Passwords are not this program's business.
//   - solve or evade a CAPTCHA. A challenge means pause and hand the live view
//     to a person. That is the only legitimate way past a bot check, and it is
//     also the only one that keeps working.

const SESSIE_MAP = process.env.SHOPIFY_BROWSER_SESSIE_MAP ?? ".shopify-sessie";

/** Poll interval while a paused job waits for someone to press resume. */
const HERVAT_POLL_MS = 3000;

type Uitkomst =
  | { soort: "klaar"; shopDomein: string }
  | { soort: "mislukt"; reden: string };

/**
 * Blocks until a human sets the job back to 'bezig' via the UI, or the wait
 * times out. Polling a column rather than anything fancier: the app already
 * writes job status, and this needs no new channel in the other direction.
 */
async function wachtOpMens(
  supabase: SupabaseClient,
  jobId: string,
  reden: string,
): Promise<boolean> {
  await supabase
    .from("jobs")
    .update({ status: "wacht_op_mens", error_message: `Actie vereist: ${reden}` })
    .eq("id", jobId);

  const deadline = Date.now() + STORE_FLOW.menselijkeTussenkomstTimeoutMs;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, HERVAT_POLL_MS));
    const { data } = await supabase.from("jobs").select("status").eq("id", jobId).maybeSingle();
    if (data?.status === "bezig") return true;
    if (data?.status === "geannuleerd" || data?.status === "mislukt") return false;
  }
  return false;
}

/**
 * Runs one step: find the element, act on it, log the outcome. A challenge
 * found at any point short-circuits to the human — never to a retry, because
 * retrying a bot check is both useless and exactly the behaviour that gets an
 * account flagged.
 */
async function stap(
  ctx: {
    supabase: SupabaseClient;
    live: LiveBrowser;
    page: Page;
    jobId: string;
    leadId: string;
  },
  naam: string,
  selector: StapSelector,
  actie: (selector: string) => Promise<void>,
  opties: { optioneel?: boolean } = {},
): Promise<boolean> {
  for (let poging = 1; poging <= STORE_FLOW.maxPogingen; poging++) {
    const blokkade = await detecteerBlokkade(ctx.page, STORE_FLOW.menselijkeTussenkomst);
    if (blokkade) {
      const pad = await ctx.live.bewaarSchermafbeelding(ctx.page, `blokkade-${naam}`);
      await logStap(ctx.supabase, {
        jobId: ctx.jobId,
        leadId: ctx.leadId,
        stap: naam,
        resultaat: "wacht_op_mens",
        detail: blokkade,
        schermafbeeldingPad: pad,
      });
      const hervat = await wachtOpMens(ctx.supabase, ctx.jobId, blokkade);
      if (!hervat) return false;
      await ctx.supabase.from("jobs").update({ error_message: null }).eq("id", ctx.jobId);
      continue;
    }

    const gevonden = await vindEerste(
      ctx.page,
      selector.kandidaten,
      STORE_FLOW.stapTimeoutMs,
      selector.wachtOp ?? "visible",
    );
    if (!gevonden) {
      if (opties.optioneel) {
        await logStap(ctx.supabase, {
          jobId: ctx.jobId,
          leadId: ctx.leadId,
          stap: naam,
          resultaat: "overgeslagen",
          detail: `${selector.omschrijving} niet aanwezig — stap niet nodig`,
        });
        return true;
      }
      if (poging < STORE_FLOW.maxPogingen) continue;

      const pad = await ctx.live.bewaarSchermafbeelding(ctx.page, `mislukt-${naam}`);
      await logStap(ctx.supabase, {
        jobId: ctx.jobId,
        leadId: ctx.leadId,
        stap: naam,
        resultaat: "mislukt",
        selector: selector.kandidaten.join(" | "),
        detail:
          `${selector.omschrijving} niet gevonden na ${STORE_FLOW.maxPogingen} pogingen. ` +
          `Waarschijnlijk heeft Shopify dit scherm gewijzigd — pas de selector aan in ` +
          `worker/src/shopify/store-flow-config.ts.`,
        schermafbeeldingPad: pad,
      });
      return false;
    }

    try {
      await actie(gevonden.selector);
      await logStap(ctx.supabase, {
        jobId: ctx.jobId,
        leadId: ctx.leadId,
        stap: naam,
        resultaat: "ok",
        selector: gevonden.selector,
      });
      return true;
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      if (poging < STORE_FLOW.maxPogingen) {
        await logStap(ctx.supabase, {
          jobId: ctx.jobId,
          leadId: ctx.leadId,
          stap: naam,
          resultaat: "overgeslagen",
          detail: `Poging ${poging} mislukt (${detail.slice(0, 120)}) — opnieuw`,
        });
        continue;
      }
      const pad = await ctx.live.bewaarSchermafbeelding(ctx.page, `fout-${naam}`);
      await logStap(ctx.supabase, {
        jobId: ctx.jobId,
        leadId: ctx.leadId,
        stap: naam,
        resultaat: "mislukt",
        selector: gevonden.selector,
        detail,
        schermafbeeldingPad: pad,
      });
      return false;
    }
  }
  return false;
}

export async function processShopifyStoreAanmaakJob(
  supabase: SupabaseClient,
  jobId: string,
  leadId: string,
) {
  const organisatieId = process.env.SHOPIFY_PARTNER_ORGANIZATION_ID;
  if (!organisatieId) throw new Error("SHOPIFY_PARTNER_ORGANIZATION_ID ontbreekt.");

  const { data: lead, error: leadError } = await supabase
    .from("leads")
    .select("id, bedrijfsnaam")
    .eq("id", leadId)
    .single();
  if (leadError || !lead) throw new Error(`Lead niet gevonden: ${leadError?.message}`);

  const live = new LiveBrowser({ supabase, jobId, sessieMap: SESSIE_MAP });
  let uitkomst: Uitkomst = { soort: "mislukt", reden: "Niet gestart." };

  try {
    const page = await live.start();
    const ctx = { supabase, live, page, jobId, leadId };

    await page.goto(STORE_FLOW.partnerStoresUrl(organisatieId), {
      waitUntil: "domcontentloaded",
      timeout: STORE_FLOW.stapTimeoutMs,
    });

    // Session check before anything else. A logged-out run would otherwise
    // fail three steps later with a confusing "button not found".
    const login = await vindEerste(page, STORE_FLOW.loginIndicator.kandidaten, 3000);
    if (login) {
      await logStap(supabase, {
        jobId,
        leadId,
        stap: "sessiecontrole",
        resultaat: "wacht_op_mens",
        detail:
          "Niet ingelogd op het Partner Dashboard. Log in het zichtbare venster zelf in — " +
          "de automatisering vult nooit wachtwoorden in — en hervat daarna.",
        schermafbeeldingPad: await live.bewaarSchermafbeelding(page, "login"),
      });
      if (!(await wachtOpMens(supabase, jobId, "inloggen op het Partner Dashboard"))) {
        uitkomst = { soort: "mislukt", reden: "Niet ingelogd en geen tussenkomst gekregen." };
        return await afronden(supabase, live, jobId, leadId, uitkomst);
      }
      await supabase.from("jobs").update({ error_message: null }).eq("id", jobId);
      await page.goto(STORE_FLOW.partnerStoresUrl(organisatieId), { waitUntil: "domcontentloaded" });
    }

    const storeNaam = storeNaamVoorLead(lead.bedrijfsnaam, leadId);
    const s = STORE_FLOW.stappen;

    const gelukt =
      // The "Create store" link goes to admin.shopify.com — a different origin
      // — and its href carries the dashboard id every later URL needs. Reading
      // it and navigating is both more reliable than clicking a cross-origin
      // link and the reason no second id has to be configured.
      (await stap(ctx, "naar-store-formulier", s.nieuweStoreLink, async (sel) => {
        const href = await page.locator(sel).first().getAttribute("href");
        if (!href) throw new Error("De 'Create store'-link heeft geen href.");
        await page.goto(href, { waitUntil: "domcontentloaded" });
      })) &&
      (await stap(ctx, "type-development-store", s.typeDevelopmentStore, (sel) =>
        page.locator(sel).first().click({ force: true }),
      )) &&
      (await stap(ctx, "store-naam", s.storeNaamVeld, async (sel) => {
        await page.locator(sel).first().fill(storeNaam);
      })) &&
      // Required, even though the submit button renders as enabled without it.
      (await stap(ctx, "plan-kiezen", s.planKeuze, async (sel) => {
        await page.locator(sel).first().selectOption(STORE_FLOW.planWaarde);
      })) &&
      (await stap(ctx, "aanmaken", s.aanmakenKnop, (sel) => page.click(sel)));

    if (!gelukt) {
      uitkomst = {
        soort: "mislukt",
        reden: "De signup-flow liep vast — zie het stappenlog voor welke stap en welke selector.",
      };
      return await afronden(supabase, live, jobId, leadId, uitkomst);
    }

    // The domain is the only thing that proves the store exists, and it's what
    // every later step keys on. Creation ends on the new store's admin at
    // admin.shopify.com/store/<handle>; the myshopify domain is derived from
    // that handle and appears nowhere on the page itself.
    let domein: string | null = null;
    try {
      await page.waitForURL(STORE_URL_PATROON, { timeout: 90_000 });
      const handle = STORE_URL_PATROON.exec(page.url())?.[1];
      if (handle) domein = domeinVoorHandle(handle);
    } catch {
      // Fall back to anything on the page that does spell a domain out — a
      // confirmation screen instead of a redirect would still be a success.
      domein = DOMEIN_PATROON.exec(await page.content())?.[1] ?? null;
    }

    if (!domein) {
      await logStap(supabase, {
        jobId,
        leadId,
        stap: "domein-uitlezen",
        resultaat: "mislukt",
        detail: "Winkel lijkt aangemaakt maar het myshopify-domein was niet af te lezen.",
        schermafbeeldingPad: await live.bewaarSchermafbeelding(page, "geen-domein"),
      });
      uitkomst = {
        soort: "mislukt",
        reden:
          "Winkel mogelijk aangemaakt, maar het domein kon niet gelezen worden. Controleer het " +
          "Partner Dashboard voor je opnieuw probeert — anders maak je een tweede winkel.",
      };
      return await afronden(supabase, live, jobId, leadId, uitkomst);
    }

    await logStap(supabase, {
      jobId,
      leadId,
      stap: "domein-uitlezen",
      resultaat: "ok",
      detail: domein,
      schermafbeeldingPad: await live.bewaarSchermafbeelding(page, "gelukt"),
    });

    // app_geinstalleerd stays false: creating the store does not install the
    // agency app on it, and pretending otherwise would make the token service
    // fail with a confusing 401 instead of a clear "install it first".
    const { error: storeError } = await supabase.from("shopify_stores").upsert(
      {
        lead_id: leadId,
        shop_domein: domein,
        store_naam: storeNaam,
        app_geinstalleerd: false,
        status: "aangemaakt",
      },
      { onConflict: "shop_domein" },
    );
    if (storeError) throw new Error(`Kon winkel niet opslaan: ${storeError.message}`);

    uitkomst = { soort: "klaar", shopDomein: domein };
    return await afronden(supabase, live, jobId, leadId, uitkomst);
  } catch (err) {
    uitkomst = { soort: "mislukt", reden: err instanceof Error ? err.message : String(err) };
    return await afronden(supabase, live, jobId, leadId, uitkomst);
  }
}

/**
 * Always closes the browser and always leaves a status behind. A blocked run
 * must not hold the rest of the pipeline: the lead gets a readable failure and
 * everything else about it stays usable.
 */
async function afronden(
  supabase: SupabaseClient,
  live: LiveBrowser,
  jobId: string,
  leadId: string,
  uitkomst: Uitkomst,
) {
  await live.stop();

  if (uitkomst.soort === "mislukt") {
    await supabase
      .from("shopify_stores")
      .update({ status: "mislukt", fout_melding: uitkomst.reden })
      .eq("lead_id", leadId)
      .eq("status", "aangemaakt");
    // Thrown so the worker's own handler marks the job mislukt with this text,
    // rather than duplicating that bookkeeping here.
    throw new Error(`${uitkomst.reden} Maak de winkel desnoods manueel aan in het Partner Dashboard.`);
  }

  await logStap(supabase, {
    jobId,
    leadId,
    stap: "afgerond",
    resultaat: "ok",
    detail:
      `Winkel ${uitkomst.shopDomein} aangemaakt. Installeer nu eenmalig de agency-app op deze ` +
      `winkel; daarna haalt de pipeline zelf tokens op.`,
  });
}

import { chromium, type Browser } from "playwright";

// PNG dimensions live at a fixed offset: 8-byte signature, then the IHDR
// chunk's 4-byte length + 4-byte type, then 4-byte width, 4-byte height.
function pngDimensions(png: Buffer): { width: number; height: number } {
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}

// Chromium's process launch is occasionally flaky on this host (an
// intermittent Windows DLL-init crash unrelated to the page content — see
// git history), so a launch failure gets a couple of quick retries before
// failing the whole review iteration over it.
async function launchWithRetry(attempts = 3) {
  let lastError: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await chromium.launch();
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError;
}

// Anthropic's vision API hard-rejects any image over 8000px on either edge.
// A genuinely complete generated page (the actual goal — spec 3.3's "don't
// leave out what the client already publishes") can comfortably exceed
// that, especially at the 375px mobile width where the same content stacks
// much taller.
//
// Two render-time approaches were tried and both proved unreliable:
// CSS `zoom` shrinks the page but also rescales the browser's own notion of
// the CSS viewport, so a "narrower" zoomed-out mobile page starts matching
// desktop responsive breakpoints instead (observed producing a screenshot
// reported as ~2275px wide instead of 375px — the layout itself changed).
// `deviceScaleFactor` avoided that specific problem, but computing the
// right scale from the DOM's scrollHeight (or even from a first
// screenshot's measured height, re-corrected iteratively) never reliably
// converged under this project's real content — regenerateWithFeedback
// content varies run to run, and something about Chromium's actual DSF
// floor or how it rounds very small DSF values kept shipping oversized
// images regardless of how conservative the margin was.
//
// This resizes the *rasterized PNG itself* via a <canvas>, after capture,
// at whatever DSF the page naturally rendered at (1). That's exact pixel
// math with no layout or scale-factor guessing involved — the one approach
// here that can't have this class of bug.
async function resizePng(
  browser: Browser,
  png: Buffer,
  maxDimension: number,
): Promise<Buffer> {
  const { width, height } = pngDimensions(png);
  const longest = Math.max(width, height);
  if (longest <= maxDimension) return png;

  const scale = maxDimension / longest;
  const newWidth = Math.max(1, Math.round(width * scale));
  const newHeight = Math.max(1, Math.round(height * scale));

  const page = await browser.newPage();
  try {
    await page.setContent("<canvas></canvas>");
    const resizedBase64 = await page.evaluate(
      ({ base64, newWidth, newHeight }) => {
        return new Promise<string>((resolve, reject) => {
          const img = new Image();
          img.onload = () => {
            const canvas = document.querySelector("canvas") as HTMLCanvasElement;
            canvas.width = newWidth;
            canvas.height = newHeight;
            const ctx = canvas.getContext("2d")!;
            ctx.drawImage(img, 0, 0, newWidth, newHeight);
            resolve(canvas.toDataURL("image/png").split(",")[1]);
          };
          img.onerror = () => reject(new Error("Kon screenshot niet herladen voor resize."));
          img.src = `data:image/png;base64,${base64}`;
        });
      },
      { base64: png.toString("base64"), newWidth, newHeight },
    );
    return Buffer.from(resizedBase64, "base64");
  } finally {
    await page.close();
  }
}

export async function takeScreenshot(
  html: string,
  viewport: { width: number; height: number } = { width: 1280, height: 800 },
): Promise<Buffer> {
  const browser = await launchWithRetry();
  try {
    const page = await browser.newPage({ viewport });
    // Takes `html` directly rather than a Storage URL: Supabase Storage
    // always serves objects as `text/plain` with a locked-down sandbox CSP
    // (it refuses to serve arbitrary stored content as live text/html — a
    // deliberate anti-XSS measure on their shared *.supabase.co domain, not
    // something a signed URL or a public bucket opts out of). Navigating
    // there with Playwright renders the page as plain source text, not the
    // actual site. page.setContent() loads the markup into the page
    // directly, sidestepping that entirely — the generated HTML only ever
    // references the Tailwind CDN script and public image URLs (both
    // absolute, per the generatie prompt), so it has no relative-asset
    // dependency on a real origin.
    await page.setContent(html, { waitUntil: "networkidle" });

    // networkidle isn't a hard guarantee every <img> has actually finished
    // loading/decoding (seen in practice under load: images come back
    // blank/alt-text in the screenshot despite the network request having
    // completed) — wait explicitly, with a bounded timeout so one stuck
    // image can't hang a review iteration forever.
    await page
      .waitForFunction(
        () => [...document.images].every((img) => img.complete && img.naturalWidth > 0),
        { timeout: 5000 },
      )
      .catch(() => {
        // Best-effort — screenshot whatever state we're in rather than
        // failing the whole iteration over one slow image.
      });

    // Generated sites often use scroll-triggered reveal animations
    // (IntersectionObserver toggling an "opacity:0 -> visible" class as
    // each section enters the viewport — a real, fine feature for an
    // actual visitor). A single jump straight to the bottom only gives two
    // scroll positions, so everything between them never intersects the
    // viewport and never reveals — the reviewer then sees mostly blank
    // sections and rejects a page that's actually fine. Step through the
    // full page height so every section gets its turn in the viewport
    // before the final (fullPage, so scroll position doesn't matter after
    // this) screenshot.
    await page.evaluate(async () => {
      const step = window.innerHeight;
      const total = document.body.scrollHeight;
      for (let y = 0; y < total; y += step) {
        window.scrollTo(0, y);
        await new Promise((resolve) => setTimeout(resolve, 150));
      }
      window.scrollTo(0, total);
      await new Promise((resolve) => setTimeout(resolve, 150));
      window.scrollTo(0, 0);
    });
    // CSS reveal transitions are typically ~0.3-0.7s — give the last one
    // triggered above time to finish before capturing.
    await page.waitForTimeout(800);

    // Without fullPage, screenshot() only captures the viewport — the AI
    // reviewer then only ever sees the hero section and rejects every
    // version for "can't verify the rest of the page", regardless of
    // whether the rest of the page is actually fine.
    const shot = await page.screenshot({ fullPage: true });
    await page.close();

    // Target well below the API's hard 8000px cap, not just-under-it —
    // deliberate headroom given how this class of bug keeps resurfacing.
    return await resizePng(browser, shot, 6000);
  } finally {
    await browser.close();
  }
}

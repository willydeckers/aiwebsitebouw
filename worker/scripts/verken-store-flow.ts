// Walks the real store-creation screens and reports what is actually on them,
// so store-flow-config.ts can be written against the live UI instead of
// against what it is assumed to look like.
//
//   VERKEN_URL=<url> npx tsx --env-file=.env scripts/verken-store-flow.ts [actie...]
//
// Actions, applied in order, so a whole wizard can be walked without editing
// this file each time:
//   click:<naam>            click a button or link by its accessible name
//   radio:<value>           click the input with that value attribute
//   vul:<selector>=<tekst>  fill a field
//
// It stops wherever the actions run out, and reports plus screenshots every
// screen along the way. Uses the same persistent browser profile as the
// automation, so it sees exactly what the job sees, login state included.
//
// The page script is a string on purpose. tsx compiles with esbuild's
// keepNames, which rewrites named functions to call a __name helper -- fine in
// Node, but page.evaluate ships that source into the browser, where the helper
// does not exist and every call fails with "__name is not defined".

import { chromium } from "playwright";
import type { Page } from "playwright";

const SESSIE_MAP = process.env.SHOPIFY_BROWSER_SESSIE_MAP ?? ".shopify-sessie";
const ORG = process.env.SHOPIFY_PARTNER_ORGANIZATION_ID!;
const acties = process.argv.slice(2);

type Element = {
  tag: string;
  tekst: string;
  naam?: string;
  type?: string;
  waarde?: string;
  href?: string;
  ariaLabel?: string;
  data: Record<string, string>;
};
type Rapport = { koppen: string[]; klikbaar: Element[]; velden: Element[] };

const PAGINA_SCRIPT = String.raw`(() => {
  var zichtbaar = function (el) {
    var r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  var beschrijf = function (el) {
    var data = {};
    for (var i = 0; i < el.attributes.length; i++) {
      var a = el.attributes[i];
      if (a.name.indexOf("data-") === 0) data[a.name] = a.value.slice(0, 40);
    }
    return {
      tag: el.tagName.toLowerCase(),
      tekst: (el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 70),
      naam: el.getAttribute("name") || undefined,
      type: el.getAttribute("type") || undefined,
      waarde: (el.getAttribute("value") || "").slice(0, 40) || undefined,
      href: (el.getAttribute("href") || "").slice(0, 90) || undefined,
      ariaLabel: el.getAttribute("aria-label") || undefined,
      data: data
    };
  };
  var lijst = function (sel, max) {
    return Array.prototype.slice.call(document.querySelectorAll(sel)).filter(zichtbaar).map(beschrijf).slice(0, max);
  };
  return {
    koppen: Array.prototype.slice
      .call(document.querySelectorAll("h1, h2, h3, legend, label"))
      .filter(zichtbaar)
      .map(function (el) { return (el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 90); })
      .filter(function (t) { return t.length > 0; })
      .slice(0, 20),
    klikbaar: lijst("button, a[href], [role=button]", 40),
    velden: lijst("input, select, textarea", 30)
  };
})()`;

let beeldTeller = 0;

async function rapporteer(page: Page, titel: string) {
  console.log("\n" + "=".repeat(70));
  console.log(titel);
  console.log("  URL: " + page.url());
  console.log("=".repeat(70));

  const beeld = `verkenning-${++beeldTeller}.jpg`;
  await page.screenshot({ path: beeld, type: "jpeg", quality: 70 });
  console.log("  beeld: " + beeld);

  const r = (await page.evaluate(PAGINA_SCRIPT)) as Rapport;

  console.log("\nTeksten:");
  for (const k of r.koppen) console.log("  " + k);

  console.log("\nKlikbaar:");
  for (const b of r.klikbaar) {
    const data = Object.keys(b.data).length ? "  " + JSON.stringify(b.data) : "";
    const href = b.href ? "  href=" + b.href : "";
    const aria = b.ariaLabel ? '  aria-label="' + b.ariaLabel + '"' : "";
    console.log(`  <${b.tag}> "${b.tekst}"${href}${aria}${data}`);
  }

  console.log("\nVelden:");
  for (const v of r.velden) {
    const data = Object.keys(v.data).length ? "  " + JSON.stringify(v.data) : "";
    const aria = v.ariaLabel ? ' aria-label="' + v.ariaLabel + '"' : "";
    console.log(
      `  <${v.tag} type=${v.type ?? "-"}> name=${v.naam ?? "-"} value=${v.waarde ?? "-"}${aria}${data}`,
    );
  }
}

const context = await chromium.launchPersistentContext(SESSIE_MAP, {
  headless: false,
  viewport: { width: 1280, height: 900 },
});
const page = context.pages()[0] ?? (await context.newPage());

const START = process.env.VERKEN_URL ?? `https://partners.shopify.com/${ORG}/stores`;
await page.goto(START, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(4000);
await rapporteer(page, "Startscherm");

for (const actie of acties) {
  console.log("\n\n>>> " + actie);
  try {
    if (actie.startsWith("radio:")) {
      // force: these are visually replaced by styled cards, so the real input
      // is often zero-sized and Playwright's actionability check refuses it.
      await page.locator(`input[value="${actie.slice(6)}"]`).first().click({ force: true, timeout: 15_000 });
    } else if (actie.startsWith("vul:")) {
      const [selector, ...rest] = actie.slice(4).split("=");
      await page.locator(selector).first().fill(rest.join("="), { timeout: 15_000 });
    } else {
      const naam = actie.replace(/^click:/, "");
      await page
        .getByRole("button", { name: naam })
        .or(page.getByRole("link", { name: naam }))
        .first()
        .click({ timeout: 15_000 });
    }
  } catch (err) {
    console.log("  MISLUKT: " + (err instanceof Error ? err.message.split("\n")[0] : String(err)));
  }
  await page.waitForTimeout(4000);
  await rapporteer(page, "Na " + actie);
}

await context.close();

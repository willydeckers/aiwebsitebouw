// Probes the Create-store form with Playwright locators rather than
// document.querySelectorAll.
//
//   npx tsx --env-file=.env scripts/probeer-store-formulier.ts [--maak "<naam>"]
//
// Shopify's new admin builds these fields as web components with a shadow
// root, so a page.evaluate over document.querySelectorAll("input") sees the
// radios and checkboxes but not the text field or the plan select -- they
// simply are not in the light DOM. Playwright's CSS and role locators pierce
// shadow roots, which is why the automation can use them and a DOM dump
// cannot.
//
// Without --maak this only looks. With it, it fills the name and submits,
// which creates a real development store.

import { chromium } from "playwright";

const SESSIE_MAP = process.env.SHOPIFY_BROWSER_SESSIE_MAP ?? ".shopify-sessie";
const ORG = process.env.SHOPIFY_PARTNER_ORGANIZATION_ID!;

const maakIndex = process.argv.indexOf("--maak");
const storeNaam = maakIndex === -1 ? null : process.argv[maakIndex + 1];

const context = await chromium.launchPersistentContext(SESSIE_MAP, {
  headless: false,
  viewport: { width: 1280, height: 900 },
});
const page = context.pages()[0] ?? (await context.newPage());

// The dashboard id in the URL is NOT the partner organisation id. Rather than
// configure a second id that can drift, follow the link the stores page itself
// renders -- it always carries the right one.
await page.goto(`https://partners.shopify.com/${ORG}/stores`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(3000);

const createHref = await page
  .getByRole("link", { name: /create store/i })
  .first()
  .getAttribute("href");
console.log("Create store-link:", createHref);
if (!createHref) throw new Error("Geen 'Create store'-link op het stores-overzicht.");

await page.goto(createHref, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(3000);

await page.locator('input[value="development"]').first().click({ force: true });
await page.waitForTimeout(1500);

const naamVeld = page.getByLabel(/store name/i);
console.log("Store name-veld zichtbaar:", await naamVeld.isVisible().catch(() => false));

const planKeuze = page.getByLabel(/shopify plan/i);
const planZichtbaar = await planKeuze.isVisible().catch(() => false);
console.log("Plan-keuze zichtbaar:", planZichtbaar);
if (planZichtbaar) {
  const opties = await planKeuze.locator("option").allTextContents().catch(() => []);
  console.log("Plan-opties:", opties.length ? opties : "(geen <option>, dus geen native select)");
}

const knop = page.getByRole("button", { name: /^create store$/i });
console.log("Create store-knop actief:", await knop.isEnabled().catch(() => false));

if (!storeNaam) {
  console.log("\nAlleen gekeken — geef --maak \"<naam>\" om echt een winkel aan te maken.");
  await page.screenshot({ path: "store-formulier.jpg", type: "jpeg", quality: 70 });
  await context.close();
  process.exit(0);
}

console.log(`\nWinkel aanmaken: ${storeNaam}`);
await naamVeld.fill(storeNaam);

// The plan is required even though the submit button renders as enabled --
// submitting without one just paints "Shopify plan is required" under the
// select and goes nowhere. Basic is what every existing dev store on this
// organisation uses, and a dev store is free on any plan.
await planKeuze.selectOption({ label: "Basic" });
await page.waitForTimeout(500);
await knop.click();

// The redirect to the new store is the only reliable success signal; the
// creation itself takes a few seconds server-side.
await page.waitForTimeout(15_000);
console.log("URL na aanmaken:", page.url());
await page.screenshot({ path: "store-aangemaakt.jpg", type: "jpeg", quality: 70 });

const domein = page.url().match(/([a-z0-9][a-z0-9-]*\.myshopify\.com)/i)?.[1];
console.log("Winkeldomein:", domein ?? "(niet in de URL gevonden — zie store-aangemaakt.jpg)");

await context.close();

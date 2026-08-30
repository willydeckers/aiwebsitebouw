// Every CSS selector, URL and form field the store-creation automation
// touches. Nothing selector-shaped belongs anywhere else in this feature.
//
// Why this file is isolated, and why it is the file to open first when things
// break: this is UI automation against a product Shopify changes whenever it
// likes. Unlike the Admin API — which is versioned, dated and stable for a
// year at a time — a renamed input or an extra consent step here breaks the
// run with no warning and no deprecation notice. When that happens the fix
// should be a selector edit in this file, not a hunt through control flow.
//
// Each step therefore carries SEVERAL candidate selectors, tried in order.
// Prefer, in order:
//   1. data-* / name attributes  (most stable)
//   2. accessible role + name    (stable while the UI means the same thing)
//   3. visible text              (breaks on copy changes and translation)
// Never a generated class name — those change on every deploy.
//
// ── Rewritten 2026-08-29, against the live UI ────────────────────────────
// The first version was written from what the Partner Dashboard was assumed
// to look like and had never been run. Every step below is now taken from an
// actual walk-through (worker/scripts/verken-store-flow.ts). What was wrong:
//
//   * The dashboard moved to dev.shopify.com and the button is "Create store",
//     not "Add store".
//   * That button is an <a> to admin.shopify.com — a different origin — so the
//     automation reads its href and navigates, rather than clicking it.
//   * The dashboard id in those URLs is NOT the partner organisation id. It is
//     only ever read off that link, never configured, so it cannot drift.
//   * "Test and develop" as a purpose is gone. The choice is now a two-card
//     Dev / Client transfer radio.
//   * A Shopify plan is now required. The submit button renders as enabled
//     without one and simply refuses on click — found by submitting, not by
//     reading the page.
//   * The form fields live in a shadow root, so document.querySelectorAll does
//     not see them at all. Playwright's locators pierce shadow DOM, which is
//     why these selectors work and a DOM dump showed an empty form.
//   * Success is a redirect to admin.shopify.com/store/<handle>. The
//     myshopify domain appears nowhere on the page — it is derived from the
//     handle.

export type StapSelector = {
  /** Tried in order; the first one that resolves wins. */
  kandidaten: string[];
  /** Shown in the log and the UI when this step is what stalled. */
  omschrijving: string;
  /**
   * "attached" for controls that exist but are visually replaced — the dev/
   * client radios are real inputs behind styled cards and never render, so
   * waiting for visibility would time out on a working page.
   */
  wachtOp?: "visible" | "attached";
  /** Click past the actionability check, for those same replaced controls. */
  forceerKlik?: boolean;
};

export const STORE_FLOW = {
  /**
   * Where the automation starts. partners.shopify.com still redirects to the
   * dev dashboard, so this keeps working and needs only the organisation id
   * we already have.
   */
  partnerStoresUrl: (organisatieId: string) =>
    `https://partners.shopify.com/${organisatieId}/stores`,

  ingelogdIndicator: {
    kandidaten: ['a[href*="/stores"]', "text=Stores"],
    omschrijving: "Ingelogd op het dev dashboard",
  } satisfies StapSelector,

  loginIndicator: {
    kandidaten: [
      'input[name="account[email]"]',
      'input[type="password"]',
      'form[action*="login"]',
      "text=Log in to your Shopify account",
    ],
    omschrijving: "Loginscherm — sessie verlopen",
  } satisfies StapSelector,

  stappen: {
    /**
     * Not clicked — its href is read and navigated to. It points at another
     * origin and carries the dashboard id the rest of the flow needs, so
     * following it deliberately beats clicking it and hoping.
     */
    nieuweStoreLink: {
      kandidaten: [
        'a[href*="/store-create/organization/"]',
        "role=link[name=/create store/i]",
      ],
      omschrijving: "Link 'Create store'",
    } satisfies StapSelector,

    typeDevelopmentStore: {
      kandidaten: [
        'input[name="storeType"][value="development"]',
        "input#development",
      ],
      omschrijving: "Keuze 'Dev'",
      wachtOp: "attached",
      forceerKlik: true,
    } satisfies StapSelector,

    storeNaamVeld: {
      kandidaten: ['input[name="storeName"]', "role=textbox[name=/store name/i]"],
      omschrijving: "Veld 'Store name'",
    } satisfies StapSelector,

    /**
     * Required, despite the submit button looking enabled without it. A dev
     * store is free on every plan, so this picks the cheapest — which is also
     * what every existing store on this organisation runs.
     */
    planKeuze: {
      kandidaten: ['select[name="Shopify plan"]', "role=combobox[name=/shopify plan/i]"],
      omschrijving: "Keuze 'Shopify plan'",
    } satisfies StapSelector,

    aanmakenKnop: {
      kandidaten: ["role=button[name=/^create store$/i]", 'button:has-text("Create store")'],
      omschrijving: "Knop 'Create store'",
    } satisfies StapSelector,
  },

  /** The plan option value behind the "Basic" label. */
  planWaarde: "BASIC_APP_DEVELOPMENT",

  /**
   * Anything here means a human is needed. These are never retried and never
   * "solved" — the run pauses and the live view is handed over, which is the
   * only acceptable way to pass a bot check.
   */
  menselijkeTussenkomst: [
    {
      kandidaten: [
        'iframe[src*="recaptcha"]',
        'iframe[title*="recaptcha" i]',
        'iframe[src*="hcaptcha"]',
        "#px-captcha",
        '[data-testid="challenge"]',
      ],
      omschrijving: "CAPTCHA",
    },
    {
      kandidaten: [
        'input[name="account[totp]"]',
        'input[autocomplete="one-time-code"]',
        "text=/two-step|verification code|authenticatiecode/i",
      ],
      omschrijving: "Tweestapsverificatie",
    },
    {
      kandidaten: ["text=/unusual activity|verify it's you|bevestig dat jij/i"],
      omschrijving: "Bot-detectie / accountverificatie",
    },
  ] satisfies StapSelector[],

  /** How long a step may take before it counts as stalled. */
  stapTimeoutMs: 20_000,
  /** Transient failures only (slow page, network). Never for a challenge. */
  maxPogingen: 2,
  /** How long the run waits for a human before giving up. */
  menselijkeTussenkomstTimeoutMs: 10 * 60_000,
} as const;

/**
 * The store's admin URL after creation: admin.shopify.com/store/<handle>.
 * This is the only success signal — the page never shows a myshopify domain.
 */
export const STORE_URL_PATROON = /admin\.shopify\.com\/store\/([a-z0-9][a-z0-9-]*)/i;

/** Kept for reading a domain out of anything that does spell one out. */
export const DOMEIN_PATROON = /\b([a-z0-9][a-z0-9-]*\.myshopify\.com)\b/i;

/** Shopify derives the myshopify subdomain from the store handle. */
export function domeinVoorHandle(handle: string): string {
  return `${handle}.myshopify.com`;
}

/**
 * Shopify derives the subdomain from the store name and rejects a lot of what
 * a Belgian company name contains. Normalising here keeps the failure out of
 * the browser, where it would surface as an inline validation message the
 * automation would have to parse.
 */
export function storeNaamVoorLead(bedrijfsnaam: string, leadId: string): string {
  const basis = bedrijfsnaam
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .slice(0, 40)
    .trim();
  // The id suffix keeps two clients with the same trading name apart, and
  // makes the store traceable back to a lead from the dashboard.
  return `${basis || "Nieuwe winkel"} ${leadId.slice(0, 8)}`;
}

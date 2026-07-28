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
// Shopify's dashboard tends to keep either the accessible name or the data
// attribute across a redesign even when class names churn, so listing a few
// buys a lot of resilience for very little effort. Prefer, in order:
//   1. data-* / name attributes  (most stable)
//   2. accessible role + name    (stable while the UI means the same thing)
//   3. visible text              (breaks on copy changes and translation)
// Never a generated class name — those change on every deploy.

export type StapSelector = {
  /** Tried in order; the first one that resolves wins. */
  kandidaten: string[];
  /** Shown in the log and the UI when this step is what stalled. */
  omschrijving: string;
};

export const STORE_FLOW = {
  /** Where the automation starts. The organisation id is filled in at runtime. */
  partnerStoresUrl: (organisatieId: string) =>
    `https://partners.shopify.com/${organisatieId}/stores`,

  /**
   * How we know the persistent session is still logged in. If the run lands on
   * a login form instead, the automation must stop and hand over — it must
   * never type credentials itself.
   */
  ingelogdIndicator: {
    kandidaten: ['[data-testid="stores-index"]', 'a[href*="/stores/new"]', 'text=Stores'],
    omschrijving: "Ingelogd op het Partner Dashboard",
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
    nieuweStoreKnop: {
      kandidaten: [
        'a[href$="/stores/new"]',
        '[data-testid="add-store-button"]',
        'role=button[name=/add store/i]',
        "text=Add store",
      ],
      omschrijving: "Knop 'Add store'",
    } satisfies StapSelector,

    typeDevelopmentStore: {
      kandidaten: [
        'input[value="development_store"]',
        '[data-testid="development-store-option"]',
        'role=radio[name=/development store/i]',
        "text=Development store",
      ],
      omschrijving: "Keuze 'Development store'",
    } satisfies StapSelector,

    storeNaamVeld: {
      kandidaten: [
        'input[name="store[name]"]',
        'input[name="name"]',
        '[data-testid="store-name-input"]',
        'role=textbox[name=/store name/i]',
      ],
      omschrijving: "Veld 'Store name'",
    } satisfies StapSelector,

    /**
     * Shopify has offered "build for a client" vs "test/develop" here. Which
     * one matters: the former starts a trial clock and can require a real
     * merchant handover, the latter stays free indefinitely.
     */
    doelTestEnDevelop: {
      kandidaten: [
        'input[value="test_and_develop"]',
        '[data-testid="purpose-test-and-develop"]',
        'role=radio[name=/test and develop|create a store to test/i]',
      ],
      omschrijving: "Doel 'Test en ontwikkel'",
    } satisfies StapSelector,

    aanmakenKnop: {
      kandidaten: [
        'button[type="submit"]',
        '[data-testid="create-store-submit"]',
        'role=button[name=/create (development )?store|save/i]',
      ],
      omschrijving: "Knop 'Create development store'",
    } satisfies StapSelector,

    /** Success: the new store's myshopify domain appears somewhere on screen. */
    gelukIndicator: {
      kandidaten: [
        'text=/[a-z0-9-]+\\.myshopify\\.com/',
        '[data-testid="store-domain"]',
        'a[href*=".myshopify.com"]',
      ],
      omschrijving: "Winkeldomein zichtbaar",
    } satisfies StapSelector,
  },

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

/** The myshopify domain, read off whatever the success page shows. */
export const DOMEIN_PATROON = /\b([a-z0-9][a-z0-9-]*\.myshopify\.com)\b/i;

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
  // makes the store traceable back to a lead from the Partner Dashboard.
  return `${basis || "Nieuwe winkel"} ${leadId.slice(0, 8)}`;
}

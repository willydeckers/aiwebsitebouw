import { withShopifyRateLimit } from "./shopify-rate-limiter.js";

// Verified live on 2026-07-28: 2025-01 (and everything before 2025-10) now
// answers "Invalid API version" with a 404. Any call through this client was
// therefore already dead. Re-check with worker/scripts/partner-api-status.ts
// rather than bumping this on a hunch.
const PARTNER_API_VERSION = "2026-01";

export async function partnerGraphQL<T>(
  query: string,
  variables: Record<string, unknown>,
): Promise<T> {
  const organizationId = process.env.SHOPIFY_PARTNER_ORGANIZATION_ID;
  const accessToken = process.env.SHOPIFY_PARTNER_ACCESS_TOKEN;

  const response = await withShopifyRateLimit(() =>
    fetch(
      `https://partners.shopify.com/${organizationId}/api/${PARTNER_API_VERSION}/graphql.json`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Access-Token": accessToken ?? "",
        },
        body: JSON.stringify({ query, variables }),
      },
    ),
  );

  const json = await response.json();

  if (!response.ok || json.errors) {
    throw new Error(
      `Shopify Partner API-fout: ${response.status} ${JSON.stringify(json.errors ?? json)}`,
    );
  }

  return json.data as T;
}

/**
 * Spec 3.8 asks for "Development store via Shopify Partner API". That is not
 * possible, and it is not a limitation of our credentials or our API version.
 *
 * This has now been checked against the live schema twice, on two different
 * mutation names that were each proposed from recollection:
 *   2026-07-27  developmentStoreCreate  — doesn't exist
 *   2026-07-28  devStoreCreate          — doesn't exist
 * Both come back as "Field '<naam>' doesn't exist on type 'MutationRoot'",
 * which is the schema talking, not a permission error.
 *
 * What the API actually offers for organisation 4987287 on 2026-01:
 *   mutations : appCreditCreate                     (unstable adds
 *               appSubscriptionCancel, eventsinkCreate, eventsinkDelete)
 *   queries   : app, publicApiVersions, transaction, transactions
 *
 * Note what's missing from the query side: there is no field that returns
 * shops or stores at all. So even if a store were created some other way,
 * this API could not list it, let alone hand back an Admin API token. Token
 * retrieval is a separate mechanism entirely (an app install / OAuth grant
 * against that specific shop).
 *
 * Creating a development store is a manual action in the Partner Dashboard.
 * The flow is therefore: create it there, then hand its domain to the
 * shopify_opbouw job, which wires up klanten/leads/site_versions from it (see
 * shopify-build-job.ts). This function remains only so that a future caller
 * assuming the automated path fails with the reason instead of a confusing
 * GraphQL error.
 *
 * Re-check with `worker/scripts/partner-api-status.ts` before assuming this
 * is still true — Shopify may add it later, and that script answers it with
 * facts in ten seconds.
 */
export function createDevelopmentStore(): Promise<never> {
  return Promise.reject(
    new Error(
      "De Shopify Partner API kan geen development store aanmaken — die mutation bestaat niet " +
        "(op 2026-01 is appCreditCreate de enige mutation, en geen enkele query geeft winkels " +
        "terug). Maak de store manueel aan in het Partner Dashboard en geef het domein mee bij " +
        "het omzetten naar Shopify-klant. Controleer met worker/scripts/partner-api-status.ts.",
    ),
  );
}

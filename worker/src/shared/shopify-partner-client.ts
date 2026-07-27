import { withShopifyRateLimit } from "./shopify-rate-limiter.js";

const PARTNER_API_VERSION = "2025-01";

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
 * possible, and it is not a limitation of our credentials.
 *
 * A `developmentStoreCreate` mutation used to live here, written from
 * recollection and flagged as unverified. It was validated against the real
 * Partner API schema on 2026-07-27: both the mutation and its input type do
 * not exist. The Partner API exposes exactly two mutations — appCreditCreate
 * and appSubscriptionCancel — and is otherwise a read API over apps, themes,
 * events and financials. There is no store-creation endpoint to call, so no
 * amount of fixing the query shape would have made this work.
 *
 * Creating a development store is a manual action in the Partner Dashboard.
 * The flow is therefore: create it there, then hand its domain to the
 * shopify_opbouw job, which wires up klanten/leads/site_versions from it (see
 * shopify-build-job.ts). This function remains only so that a future caller
 * assuming the automated path fails with the reason instead of a confusing
 * GraphQL error.
 */
export function createDevelopmentStore(): Promise<never> {
  return Promise.reject(
    new Error(
      "De Shopify Partner API kan geen development store aanmaken — die mutation bestaat niet " +
        "(enkel appCreditCreate en appSubscriptionCancel zijn beschikbaar). Maak de store manueel " +
        "aan in het Partner Dashboard en geef het domein mee bij het omzetten naar Shopify-klant.",
    ),
  );
}

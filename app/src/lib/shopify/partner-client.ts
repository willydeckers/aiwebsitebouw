import { withShopifyRateLimit } from "./rate-limiter";

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

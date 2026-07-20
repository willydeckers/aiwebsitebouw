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

// NOTE: same caveat as before — the exact developmentStoreCreate mutation
// shape is written from best-effort recollection, not verified against
// live Shopify Partner API docs. Confirm before relying on this.
const CREATE_DEV_STORE_MUTATION = `
  mutation DevelopmentStoreCreate($input: DevelopmentStoreCreateInput!) {
    developmentStoreCreate(input: $input) {
      store { id name primaryDomain }
      userErrors { field message }
    }
  }
`;

type DevelopmentStoreCreateResponse = {
  developmentStoreCreate: {
    store: { id: string; name: string; primaryDomain: string } | null;
    userErrors: { field: string[]; message: string }[];
  };
};

export async function createDevelopmentStore(
  storeName: string,
): Promise<{ storeId: string; domain: string }> {
  const data = await partnerGraphQL<DevelopmentStoreCreateResponse>(
    CREATE_DEV_STORE_MUTATION,
    { input: { name: storeName, storeType: "DAWN" } },
  );

  const { store, userErrors } = data.developmentStoreCreate;

  if (userErrors.length > 0) {
    throw new Error(
      `Kon development store niet aanmaken: ${userErrors.map((e) => e.message).join("; ")}`,
    );
  }
  if (!store) {
    throw new Error("Geen store teruggekregen van de Partner API.");
  }

  return { storeId: store.id, domain: store.primaryDomain };
}

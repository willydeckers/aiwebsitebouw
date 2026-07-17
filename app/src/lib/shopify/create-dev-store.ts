import { partnerGraphQL } from "./partner-client";

// NOTE: The exact `developmentStoreCreate` mutation shape (field/argument
// names, required inputs) is written from best-effort recollection of the
// Shopify Partner API and has NOT been verified against live Shopify
// documentation or a real Partner organization — there was no Shopify
// Partner API reference available while building this, unlike the bundled
// Anthropic API docs used elsewhere in this project. Confirm the current
// mutation shape in the Shopify Partner API GraphQL schema
// (https://shopify.dev/docs/api/partner) before relying on this in
// production; adjust the query/variables below to match.
const CREATE_DEV_STORE_MUTATION = `
  mutation DevelopmentStoreCreate($input: DevelopmentStoreCreateInput!) {
    developmentStoreCreate(input: $input) {
      store {
        id
        name
        primaryDomain
      }
      userErrors {
        field
        message
      }
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

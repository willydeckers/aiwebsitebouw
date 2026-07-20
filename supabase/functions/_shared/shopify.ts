// Duplicated from app/src/lib/shopify/* — see the note in sector-styles.ts
// on why these can't be imported across the app/supabase boundary.

const MAX_RETRIES = 5;
const BASE_DELAY_MS = 500;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseBucketUsage(header: string | null): { used: number; limit: number } | null {
  if (!header) return null;
  const match = header.match(/^(\d+)\/(\d+)$/);
  if (!match) return null;
  return { used: Number(match[1]), limit: Number(match[2]) };
}

/**
 * Rate limiter carried over from Wouter (spec section 3.8): bucket-tracking
 * via X-Shopify-Shop-Api-Call-Limit, exponential backoff on 429.
 */
export async function withShopifyRateLimit(execute: () => Promise<Response>): Promise<Response> {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const response = await execute();

    if (response.status !== 429) {
      const bucket = parseBucketUsage(response.headers.get("x-shopify-shop-api-call-limit"));
      if (bucket && bucket.used / bucket.limit > 0.9) {
        await sleep(BASE_DELAY_MS);
      }
      return response;
    }

    if (attempt === MAX_RETRIES) return response;

    const retryAfterHeader = response.headers.get("retry-after");
    const delayMs = retryAfterHeader ? Number(retryAfterHeader) * 1000 : BASE_DELAY_MS * 2 ** attempt;
    await sleep(delayMs);
  }

  throw new Error("Onbereikbare code — rate limiter loop moet altijd retourneren of gooien.");
}

const ADMIN_API_VERSION = "2025-01";

export async function shopifyAdminGraphQL<T>(
  shopDomain: string,
  accessToken: string,
  query: string,
  variables: Record<string, unknown>,
): Promise<T> {
  const response = await withShopifyRateLimit(() =>
    fetch(`https://${shopDomain}/admin/api/${ADMIN_API_VERSION}/graphql.json`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": accessToken },
      body: JSON.stringify({ query, variables }),
    }),
  );

  const json = await response.json();
  if (!response.ok || json.errors) {
    throw new Error(`Shopify Admin API-fout: ${response.status} ${JSON.stringify(json.errors ?? json)}`);
  }
  return json.data as T;
}

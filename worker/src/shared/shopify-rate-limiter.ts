// Rate limiter for Shopify GraphQL calls, carried over from Wouter (spec
// section 3.8): bucket-tracking via the X-Shopify-Shop-Api-Call-Limit
// header, exponential backoff on 429. Race-condition-safe per spec section
// 6/7: this worker processes one shopify_opbouw job at a time (claimed via
// the jobs table's one-active-job constraint), so there's no concurrent
// caller within this process to serialize against.

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

export async function withShopifyRateLimit(
  execute: () => Promise<Response>,
): Promise<Response> {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const response = await execute();

    if (response.status !== 429) {
      const bucket = parseBucketUsage(response.headers.get("x-shopify-shop-api-call-limit"));
      if (bucket && bucket.used / bucket.limit > 0.9) {
        await sleep(BASE_DELAY_MS);
      }
      return response;
    }

    if (attempt === MAX_RETRIES) {
      return response;
    }

    const retryAfterHeader = response.headers.get("retry-after");
    const delayMs = retryAfterHeader
      ? Number(retryAfterHeader) * 1000
      : BASE_DELAY_MS * 2 ** attempt;
    await sleep(delayMs);
  }

  throw new Error("Onbereikbare code — rate limiter loop moet altijd retourneren of gooien.");
}

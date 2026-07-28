import { decryptToken, encryptToken } from "./crypto.ts";

// Getting an Admin API token for a store, the only way that still exists.
//
// The obvious route — create a custom app on the store and copy its token —
// is gone: Shopify stopped allowing new custom apps in the admin, and as of
// 2026-01-01 legacy custom apps can't be created at all. It was never an API
// call either; it was always clicking through Settings > Apps.
//
// What replaces it is the client credentials grant: one app owned by the
// agency in the Dev Dashboard, installed on each store, exchanging its own
// client id + secret for a per-store token. Shopify restricts this to "apps
// developed by your own organization and installed in stores that you own",
// which is exactly this situation.
//
// The important consequence for storage: these tokens expire after 24 hours
// (`expires_in` is always 86399). So the durable secret is the app's
// client_secret — one value, in the environment — and what lives in the
// database per store is a short-lived cache. That's a better posture than a
// permanent per-store credential: a leaked row is worthless within a day.
//
// Docs: shopify.dev/docs/apps/build/authentication-authorization/access-tokens/client-credentials-grant

/** Refresh this long before expiry rather than at it — a token that dies
 *  halfway through a theme upload costs a whole rebuild. */
const MARGE_SECONDEN = 15 * 60;

export type ShopifyStore = {
  id: string;
  lead_id: string;
  shop_domein: string;
  app_geinstalleerd: boolean;
  toegang_token: number[] | null;
  toegang_token_verloopt_op: string | null;
  toegang_scopes: string | null;
};

export class ShopifyTokenError extends Error {}

async function vraagNieuwToken(
  shopDomein: string,
): Promise<{ token: string; scopes: string; verlooptOp: Date }> {
  const clientId = Deno.env.get("SHOPIFY_APP_CLIENT_ID");
  const clientSecret = Deno.env.get("SHOPIFY_APP_CLIENT_SECRET");
  if (!clientId || !clientSecret) {
    throw new ShopifyTokenError(
      "SHOPIFY_APP_CLIENT_ID/SHOPIFY_APP_CLIENT_SECRET ontbreken. Maak één app aan in het " +
        "Shopify Dev Dashboard, installeer die op de winkel, en zet de client-gegevens als secret.",
    );
  }

  const response = await fetch(`https://${shopDomein}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });

  const tekst = await response.text();
  if (!response.ok) {
    // The most common cause by far is the app not being installed on this
    // particular store — say so, instead of echoing a bare 401.
    throw new ShopifyTokenError(
      `Kon geen token krijgen voor ${shopDomein} (${response.status}). Is de app geïnstalleerd op ` +
        `deze winkel? Antwoord: ${tekst.slice(0, 200)}`,
    );
  }

  let json: { access_token?: string; scope?: string; expires_in?: number };
  try {
    json = JSON.parse(tekst);
  } catch {
    throw new ShopifyTokenError(`Onleesbaar antwoord van Shopify: ${tekst.slice(0, 200)}`);
  }
  if (!json.access_token) {
    throw new ShopifyTokenError(`Geen access_token in het antwoord: ${tekst.slice(0, 200)}`);
  }

  return {
    token: json.access_token,
    scopes: json.scope ?? "",
    verlooptOp: new Date(Date.now() + (json.expires_in ?? 86399) * 1000),
  };
}

/**
 * A usable Admin API token for this lead's store, minting and caching one when
 * the cached copy is missing or close to expiry.
 *
 * deno-lint-ignore no-explicit-any — the Supabase client type differs between
 * the caller/service variants and isn't worth threading through here.
 */
// deno-lint-ignore no-explicit-any
export async function getShopifyToken(supabase: any, leadId: string): Promise<{
  shopDomein: string;
  token: string;
}> {
  const { data: store } = await supabase
    .from("shopify_stores")
    .select("id, lead_id, shop_domein, app_geinstalleerd, toegang_token, toegang_token_verloopt_op, toegang_scopes")
    .eq("lead_id", leadId)
    .maybeSingle();

  if (!store) {
    throw new ShopifyTokenError(
      "Deze lead heeft nog geen Shopify-winkel. Maak er een aan via de store-aanmaakjob.",
    );
  }
  if (!store.app_geinstalleerd) {
    throw new ShopifyTokenError(
      `De agency-app is nog niet geïnstalleerd op ${store.shop_domein}. Zonder installatie geeft ` +
        "Shopify geen token uit; installeer de app één keer op deze winkel.",
    );
  }

  const geldigTot = store.toegang_token_verloopt_op
    ? new Date(store.toegang_token_verloopt_op).getTime()
    : 0;
  if (store.toegang_token && geldigTot - Date.now() > MARGE_SECONDEN * 1000) {
    return {
      shopDomein: store.shop_domein,
      token: await decryptToken(new Uint8Array(store.toegang_token)),
    };
  }

  const vers = await vraagNieuwToken(store.shop_domein);
  await supabase
    .from("shopify_stores")
    .update({
      toegang_token: Array.from(await encryptToken(vers.token)),
      toegang_token_verloopt_op: vers.verlooptOp.toISOString(),
      toegang_scopes: vers.scopes,
      status: "klaar",
      fout_melding: null,
    })
    .eq("id", store.id);

  return { shopDomein: store.shop_domein, token: vers.token };
}

/**
 * The scopes this pipeline needs, and no more. Configure exactly these on the
 * Dev Dashboard app — the client credentials grant returns whatever the app
 * was configured with, so over-scoping there silently over-scopes every store.
 *
 * - write_themes                    : spec 3.8 publishes each version as a theme
 * - write_products                  : the klant manages products (spec section 4)
 * - write_content                   : pageCreate, for the ported site pages
 * - write_online_store_navigation   : menuCreate/menuUpdate. Separate from
 *   write_content, which is easy to miss — the docs state it explicitly on
 *   menuCreate, and without it the pages port fine and the navigation silently
 *   doesn't, leaving a store whose pages exist but are unreachable.
 *
 * Deliberately absent: orders, customers, payouts. This pipeline never reads a
 * customer record, and a token that can't do it is one that can't leak it.
 */
export const VEREISTE_SCOPES = [
  "write_themes",
  "write_products",
  "write_content",
  "write_online_store_navigation",
] as const;

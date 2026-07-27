import type { SupabaseClient } from "@supabase/supabase-js";
import { createDevelopmentStore } from "../shared/shopify-partner-client.js";

// Spec 3.8: "Development store via Shopify Partner API, Dawn-basistheme."
//
// The store-creation half of that is not achievable: the Partner API has no
// mutation for it (verified against the live schema — see
// shopify-partner-client.ts). So this job now takes the domain of a store
// that was created by hand in the Partner Dashboard and does everything after
// that point: klant record, lead status, first site_versions row.
//
// The Admin API access token is still a separate manual step (a custom-app
// install or OAuth grant against the new store), same as before —
// chat-edit-shopify refuses to run until klanten.shopify_access_token is
// populated.
//
// Multi-page and Shopify — a deliberate split, not an oversight:
// site-builder.ts assembles standalone HTML files, and none of that applies
// here. Shopify owns its own page system: pages are `Page` records, the
// navigation is a `Menu` the theme renders, the footer is a theme section,
// and Dawn already marks the current menu item with aria-current. Generating
// our own nav/footer markup into a Shopify store would fight the theme
// instead of using it, so the static builder deliberately stops at the
// `statisch`/`demo` site types (track-and-serve already 404s for
// klant_type = shopify, spec section 2).
//
// What DOES carry over is the decomposition. A `SiteBron` splits a site into
// exactly the parts Shopify wants separately:
//   bron.paginas   -> one `pageCreate` per entry (titel -> title, bestand
//                     minus .html -> handle), plus `menuCreate`/`menuUpdate`
//                     items pointing at those handles for the nav
//   bron.bodies[x] -> that page's `body` HTML (already nav/footer/head-free,
//                     which is exactly what a Shopify page body must be)
//   bron.head/nav/footer -> dropped; the theme provides these
// Nothing below does that yet — porting a demo's content into the new store
// isn't built for any site type — but the shape is there when it is, and the
// Admin API mutations involved are still unverified against a live Partner
// account (see CLAUDE.md's known gaps).
export async function processShopifyBuildJob(
  supabase: SupabaseClient,
  jobId: string,
  leadId: string,
  payload: { shopifyDomain?: string } | null,
) {
  const { data: lead, error: leadError } = await supabase
    .from("leads")
    .select("id, bedrijfsnaam")
    .eq("id", leadId)
    .single();
  if (leadError || !lead) throw new Error(`Lead niet gevonden: ${leadError?.message}`);

  // The store is created by hand in the Partner Dashboard and its domain
  // passed in here — see createDevelopmentStore for why there is no API to do
  // it for us. Everything after this point is the part that IS automatable.
  const domain = payload?.shopifyDomain?.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/$/, "");
  if (!domain) {
    await createDevelopmentStore(); // throws with the explanation
  }
  if (!/^[a-z0-9-]+\.myshopify\.com$/.test(domain!)) {
    throw new Error(`"${domain}" ziet er niet uit als een myshopify.com-domein.`);
  }
  const storeId = domain!;

  const { error: leadUpdateError } = await supabase
    .from("leads")
    .update({ klant_type: "shopify", status: "klant", shopify_store_id: storeId })
    .eq("id", leadId);
  if (leadUpdateError) throw new Error(`Kon lead niet bijwerken: ${leadUpdateError.message}`);

  const { error: klantError } = await supabase.from("klanten").insert({
    lead_id: leadId,
    type: "shopify",
    definitief_domein: domain,
    shopify_domain: domain,
    site_status: "Actief (Dawn-basistheme)",
  });
  if (klantError) throw new Error(`Kon klant niet aanmaken: ${klantError.message}`);

  // "Elke versie = een Shopify-thema" (3.8) — the store's default Dawn
  // theme is versienummer 1, concept until reviewed/approved like any
  // other site_versions row.
  const { error: versionError } = await supabase.from("site_versions").insert({
    lead_id: leadId,
    site_type: "shopify",
    versienummer: 1,
    status: "concept",
    content_referentie: domain,
  });
  if (versionError) throw new Error(`Kon site_version niet aanmaken: ${versionError.message}`);
}

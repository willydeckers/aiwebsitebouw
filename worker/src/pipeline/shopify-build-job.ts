import type { SupabaseClient } from "@supabase/supabase-js";
import { createDevelopmentStore } from "../shared/shopify-partner-client.js";

// Spec 3.8: "Development store via Shopify Partner API, Dawn-basistheme."
// The Partner API only creates the store — it does not hand back an Admin
// API access token, so shopify_access_token stays null here. Per the note
// in the klanten_shopify_credentials migration, wiring that token up (a
// custom-app install or OAuth grant against the new store) is a manual
// one-time step; chat-edit-shopify/staff-invite already refuse to run
// until klanten.shopify_access_token is populated.
export async function processShopifyBuildJob(supabase: SupabaseClient, jobId: string, leadId: string) {
  const { data: lead, error: leadError } = await supabase
    .from("leads")
    .select("id, bedrijfsnaam")
    .eq("id", leadId)
    .single();
  if (leadError || !lead) throw new Error(`Lead niet gevonden: ${leadError?.message}`);

  const storeName = `${lead.bedrijfsnaam}-${lead.id.slice(0, 8)}`.toLowerCase().replace(/[^a-z0-9-]/g, "-");
  const { storeId, domain } = await createDevelopmentStore(storeName);

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

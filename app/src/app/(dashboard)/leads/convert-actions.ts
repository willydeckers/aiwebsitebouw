import { createClient } from "@/lib/supabase/client";
import { logAudit } from "@/lib/audit";

/**
 * Spec section 3.7/2: statisch conversion is a plain DB write (no secret
 * needed). Shopify conversion enqueues a shopify_opbouw job — a "zware taak"
 * per spec section 2, processed by the separate hosted worker.
 *
 * That job used to be expected to create the development store itself. It
 * can't: the Partner API has no store-creation mutation (verified against the
 * live schema — see worker/src/shared/shopify-partner-client.ts). The store is
 * created by hand in the Partner Dashboard and its domain passed in here; the
 * job does everything after that point.
 */
export async function convertToKlant(
  leadId: string,
  type: "statisch" | "shopify",
  shopifyDomain?: string,
): Promise<string | null> {
  const supabase = createClient();

  if (type === "statisch") {
    const { error: klantError } = await supabase.from("klanten").insert({
      lead_id: leadId,
      type: "statisch",
      site_status: "Actief (statische demo als startpunt)",
    });

    if (klantError) {
      return `Conversie mislukt: ${klantError.message}`;
    }

    const { error: leadError } = await supabase
      .from("leads")
      .update({ klant_type: "statisch", status: "klant" })
      .eq("id", leadId);

    if (leadError) {
      return `Conversie mislukt: ${leadError.message}`;
    }

    await logAudit("lead_geconverteerd", leadId, { type: "statisch" });

    return null;
  }

  const domein = shopifyDomain?.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/$/, "");
  if (!domein || !/^[a-z0-9-]+\.myshopify\.com$/.test(domein)) {
    return (
      "Vul het myshopify.com-domein in van de development store die je in het Partner Dashboard " +
      "hebt aangemaakt (bv. mijnwinkel.myshopify.com). Shopify biedt geen API om die store voor ons aan te maken."
    );
  }

  const { error: jobError } = await supabase
    .from("jobs")
    .insert({ lead_id: leadId, type: "shopify_opbouw", status: "wachtrij", payload: { shopifyDomain: domein } });

  if (jobError) {
    if (jobError.code === "23505") {
      return "Er loopt al een actieve job voor deze lead.";
    }
    return `Kon job niet aanmaken: ${jobError.message}`;
  }

  // Not "lead_geconverteerd" here — the shopify_opbouw job hasn't run yet,
  // this only enqueues it (worker/src/pipeline/shopify-build-job.ts does
  // the actual conversion once it picks the job up).
  await logAudit("lead_conversie_gestart", leadId, { type: "shopify" });

  return null;
}

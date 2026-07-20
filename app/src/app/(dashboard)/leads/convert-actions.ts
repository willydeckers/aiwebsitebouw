import { createClient } from "@/lib/supabase/client";
import { logAudit } from "@/lib/audit";

/**
 * Spec section 3.7/2: statisch conversion is a plain DB write (no secret
 * needed). Shopify conversion enqueues a shopify_opbouw job — that's a
 * "zware taak" per spec section 2, processed by the separate hosted
 * worker (not an Edge Function), which creates the actual development
 * store via the Shopify Partner API and then writes klanten/leads itself.
 */
export async function convertToKlant(
  leadId: string,
  type: "statisch" | "shopify",
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

  const { error: jobError } = await supabase
    .from("jobs")
    .insert({ lead_id: leadId, type: "shopify_opbouw", status: "wachtrij" });

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

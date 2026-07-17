"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createDevelopmentStore } from "@/lib/shopify/create-dev-store";
import type { Lead } from "@/lib/types";

const UNIQUE_VIOLATION = "23505";

export async function convertToKlant(
  leadId: string,
  type: "statisch" | "shopify",
): Promise<string | null> {
  const supabase = await createClient();

  const { data: leadRow, error: leadError } = await supabase
    .from("leads")
    .select("*")
    .eq("id", leadId)
    .single();

  if (leadError || !leadRow) {
    return `Lead niet gevonden: ${leadError?.message}`;
  }

  const lead = leadRow as Lead;

  if (type === "statisch") {
    try {
      await supabase.from("klanten").insert({
        lead_id: leadId,
        type: "statisch",
        site_status: "Actief (statische demo als startpunt)",
      });

      await supabase
        .from("leads")
        .update({ klant_type: "statisch", status: "klant" })
        .eq("id", leadId);
    } catch (err) {
      return `Conversie mislukt: ${err instanceof Error ? err.message : String(err)}`;
    }

    revalidatePath("/leads");
    revalidatePath("/klanten");
    return null;
  }

  const { data: job, error: jobError } = await supabase
    .from("jobs")
    .insert({ lead_id: leadId, type: "build_shopify", status: "running" })
    .select("id")
    .single();

  if (jobError) {
    if (jobError.code === UNIQUE_VIOLATION) {
      return "Er loopt al een actieve job voor deze lead.";
    }
    return `Kon job niet aanmaken: ${jobError.message}`;
  }

  try {
    const { storeId, domain } = await createDevelopmentStore(`${lead.bedrijfsnaam} (demo)`);

    await supabase.from("klanten").insert({
      lead_id: leadId,
      type: "shopify",
      site_status: `Development store aangemaakt: ${domain}`,
    });

    await supabase
      .from("leads")
      .update({ klant_type: "shopify", shopify_store_id: storeId, status: "klant" })
      .eq("id", leadId);

    await supabase
      .from("jobs")
      .update({ status: "done", afgerond_op: new Date().toISOString() })
      .eq("id", job.id);
  } catch (err) {
    await supabase
      .from("jobs")
      .update({
        status: "failed",
        error_message: err instanceof Error ? err.message : String(err),
        afgerond_op: new Date().toISOString(),
      })
      .eq("id", job.id);

    revalidatePath("/leads");
    return `Conversie mislukt: ${err instanceof Error ? err.message : String(err)}`;
  }

  revalidatePath("/leads");
  revalidatePath("/klanten");
  return null;
}

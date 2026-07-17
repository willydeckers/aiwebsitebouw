"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { runGenerateDemo } from "@/lib/pipeline/generate-demo";
import { calculateKostEur } from "@/lib/anthropic/pricing";
import type { Lead } from "@/lib/types";

const UNIQUE_VIOLATION = "23505";

export async function startGeneration(leadId: string): Promise<string | null> {
  const supabase = await createClient();

  const { data: lead, error: leadError } = await supabase
    .from("leads")
    .select("*")
    .eq("id", leadId)
    .single();

  if (leadError || !lead) {
    return `Lead niet gevonden: ${leadError?.message}`;
  }

  if (!(lead as Lead).research_output) {
    return "Voer eerst de research-stap uit — de generator heeft die output nodig.";
  }

  const { data: job, error: jobError } = await supabase
    .from("jobs")
    .insert({ lead_id: leadId, type: "generate_demo", status: "running" })
    .select("id")
    .single();

  if (jobError) {
    if (jobError.code === UNIQUE_VIOLATION) {
      return "Er loopt al een actieve job voor deze lead.";
    }
    return `Kon job niet aanmaken: ${jobError.message}`;
  }

  await supabase.from("leads").update({ status: "genereren" }).eq("id", leadId);

  try {
    const [{ data: stijlvoorkeuren }, { data: sectorKennis }] = await Promise.all([
      supabase.from("stijlvoorkeuren").select("regel, context"),
      supabase.from("sector_kennis").select("regel").eq("sector", (lead as Lead).sector),
    ]);

    const { html, usage } = await runGenerateDemo(
      lead as Lead,
      stijlvoorkeuren ?? [],
      sectorKennis ?? [],
    );

    const { error: uploadError } = await supabase.storage
      .from("demos")
      .upload(`${leadId}/index.html`, html, {
        contentType: "text/html",
        upsert: true,
      });

    if (uploadError) {
      throw new Error(`Upload naar storage mislukt: ${uploadError.message}`);
    }

    const {
      data: { publicUrl },
    } = supabase.storage.from("demos").getPublicUrl(`${leadId}/index.html`);

    await supabase
      .from("leads")
      .update({ demo_url: publicUrl, status: "klaar" })
      .eq("id", leadId);

    await supabase.from("project_kosten").insert({
      lead_id: leadId,
      stap: "generatie",
      model: usage.model,
      tokens_in: usage.tokensIn,
      tokens_out: usage.tokensOut,
      kost_eur: calculateKostEur(usage.model, usage.tokensIn, usage.tokensOut),
    });

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
    return `Generatie mislukt: ${err instanceof Error ? err.message : String(err)}`;
  }

  revalidatePath("/leads");
  return null;
}

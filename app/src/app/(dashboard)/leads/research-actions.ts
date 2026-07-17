"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { runResearch } from "@/lib/pipeline/research";
import { calculateKostEur } from "@/lib/anthropic/pricing";
import type { Lead } from "@/lib/types";

const UNIQUE_VIOLATION = "23505";

export async function startResearch(leadId: string): Promise<string | null> {
  const supabase = await createClient();

  const { data: lead, error: leadError } = await supabase
    .from("leads")
    .select("*")
    .eq("id", leadId)
    .single();

  if (leadError || !lead) {
    return `Lead niet gevonden: ${leadError?.message}`;
  }

  const { data: job, error: jobError } = await supabase
    .from("jobs")
    .insert({ lead_id: leadId, type: "research", status: "running" })
    .select("id")
    .single();

  if (jobError) {
    if (jobError.code === UNIQUE_VIOLATION) {
      return "Er loopt al een actieve job voor deze lead.";
    }
    return `Kon job niet aanmaken: ${jobError.message}`;
  }

  await supabase.from("leads").update({ status: "research" }).eq("id", leadId);

  try {
    const { output, usage } = await runResearch(lead as Lead);

    await supabase.from("leads").update({ research_output: output }).eq("id", leadId);

    await supabase.from("project_kosten").insert({
      lead_id: leadId,
      stap: "research",
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
    return `Research mislukt: ${err instanceof Error ? err.message : String(err)}`;
  }

  revalidatePath("/leads");
  return null;
}

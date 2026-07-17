"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { runPatchEdit } from "@/lib/pipeline/patch-edit";
import { calculateKostEur } from "@/lib/anthropic/pricing";
import type { Lead } from "@/lib/types";

export async function startPatchEdit(
  leadId: string,
  instruction: string,
): Promise<string | null> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: leadRow, error: leadError } = await supabase
    .from("leads")
    .select("*")
    .eq("id", leadId)
    .single();

  if (leadError || !leadRow) {
    return `Lead niet gevonden: ${leadError?.message}`;
  }

  const lead = leadRow as Lead;

  if (!lead.demo_url) {
    return "Er is nog geen demo om te bewerken.";
  }

  try {
    const { data: fileData, error: downloadError } = await supabase.storage
      .from("demos")
      .download(`${leadId}/index.html`);

    if (downloadError || !fileData) {
      throw new Error(`Kon huidig bestand niet ophalen: ${downloadError?.message}`);
    }

    const currentHtml = await fileData.text();
    const { html, usage } = await runPatchEdit(currentHtml, instruction);

    const { error: uploadError } = await supabase.storage
      .from("demos")
      .upload(`${leadId}/index.html`, html, { contentType: "text/html", upsert: true });

    if (uploadError) {
      throw new Error(`Upload mislukt: ${uploadError.message}`);
    }

    await supabase.from("project_kosten").insert({
      lead_id: leadId,
      stap: "chat_edit",
      model: usage.model,
      tokens_in: usage.tokensIn,
      tokens_out: usage.tokensOut,
      kost_eur: calculateKostEur(usage.model, usage.tokensIn, usage.tokensOut),
    });

    // Persist the correction for future generations (spec section 3.5).
    await supabase.from("stijlvoorkeuren").insert({
      regel: instruction,
      context: `Chat-edit op lead ${lead.bedrijfsnaam}`,
      toegevoegd_door: user?.email ?? "onbekend",
    });
  } catch (err) {
    revalidatePath("/leads");
    return `Patch-edit mislukt: ${err instanceof Error ? err.message : String(err)}`;
  }

  revalidatePath("/leads");
  return null;
}

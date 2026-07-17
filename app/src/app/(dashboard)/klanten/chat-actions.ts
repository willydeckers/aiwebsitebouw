"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { runPatchEdit } from "@/lib/pipeline/patch-edit";
import { runShopifyChatEdit } from "@/lib/pipeline/shopify-chat-edit";
import { calculateKostEur } from "@/lib/anthropic/pricing";
import type { Lead } from "@/lib/types";

type KlantWithLead = {
  id: string;
  type: "statisch" | "shopify";
  shopify_domain: string | null;
  shopify_access_token: string | null;
  lead: Lead;
};

/**
 * Abstraction layer required by spec section 3.8: one chat interface, the
 * backend it talks to (file patch vs Shopify Admin API) is chosen internally
 * based on klant_type — never two separate UIs.
 */
export async function startKlantChatEdit(
  klantId: string,
  instruction: string,
): Promise<string | null> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: klantRow, error } = await supabase
    .from("klanten")
    .select("id, type, shopify_domain, shopify_access_token, lead:leads(*)")
    .eq("id", klantId)
    .single();

  if (error || !klantRow) {
    return `Klant niet gevonden: ${error?.message}`;
  }

  const klant = klantRow as unknown as KlantWithLead;
  const lead = klant.lead;

  try {
    if (klant.type === "shopify") {
      if (!klant.shopify_domain || !klant.shopify_access_token) {
        return "Shopify-koppeling ontbreekt nog voor deze klant (shopify_domain/shopify_access_token).";
      }

      const { usage } = await runShopifyChatEdit(
        instruction,
        klant.shopify_domain,
        klant.shopify_access_token,
      );

      await supabase.from("project_kosten").insert({
        lead_id: lead.id,
        stap: "chat_edit",
        model: usage.model,
        tokens_in: usage.tokensIn,
        tokens_out: usage.tokensOut,
        kost_eur: calculateKostEur(usage.model, usage.tokensIn, usage.tokensOut),
      });
    } else {
      if (!lead.demo_url) {
        return "Deze klant heeft nog geen site-bestand om te bewerken.";
      }

      const { data: fileData, error: downloadError } = await supabase.storage
        .from("demos")
        .download(`${lead.id}/index.html`);

      if (downloadError || !fileData) {
        throw new Error(`Kon huidig bestand niet ophalen: ${downloadError?.message}`);
      }

      const currentHtml = await fileData.text();
      const { html, usage } = await runPatchEdit(currentHtml, instruction);

      const { error: uploadError } = await supabase.storage
        .from("demos")
        .upload(`${lead.id}/index.html`, html, { contentType: "text/html", upsert: true });

      if (uploadError) {
        throw new Error(`Upload mislukt: ${uploadError.message}`);
      }

      await supabase.from("project_kosten").insert({
        lead_id: lead.id,
        stap: "chat_edit",
        model: usage.model,
        tokens_in: usage.tokensIn,
        tokens_out: usage.tokensOut,
        kost_eur: calculateKostEur(usage.model, usage.tokensIn, usage.tokensOut),
      });

      await supabase.from("stijlvoorkeuren").insert({
        regel: instruction,
        context: `Chat-edit op klant ${lead.bedrijfsnaam}`,
        toegevoegd_door: user?.email ?? "onbekend",
      });
    }
  } catch (err) {
    return `Bewerking mislukt: ${err instanceof Error ? err.message : String(err)}`;
  }

  revalidatePath("/klanten");
  return null;
}

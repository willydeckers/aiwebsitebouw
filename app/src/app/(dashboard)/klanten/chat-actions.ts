import { createClient } from "@/lib/supabase/client";
import { describeFunctionError } from "@/lib/supabase/function-error";

export type KlantChatEditResult = {
  error: string | null;
  antwoord: string | null;
  toegepast: boolean;
};

/**
 * Abstraction layer required by spec section 3.8: one chat interface, the
 * backend it talks to (file patch vs Shopify Admin API) is chosen here
 * based on klant_type — never two separate UIs.
 */
export async function startKlantChatEdit(
  klantId: string,
  instruction: string,
): Promise<KlantChatEditResult> {
  const supabase = createClient();

  const { data: klant, error } = await supabase
    .from("klanten")
    .select("id, type, lead_id")
    .eq("id", klantId)
    .single();

  if (error || !klant) {
    return { error: `Klant niet gevonden: ${error?.message}`, antwoord: null, toegepast: false };
  }

  const fn = klant.type === "shopify" ? "chat-edit-shopify" : "chat-edit-static";
  const body =
    klant.type === "shopify" ? { klantId, instruction } : { leadId: klant.lead_id, instruction };

  const { data, error: invokeError } = await supabase.functions.invoke(fn, { body });

  if (invokeError) {
    return { error: `Bewerking mislukt: ${await describeFunctionError(invokeError)}`, antwoord: null, toegepast: false };
  }
  if (data?.error) {
    return { error: data.error as string, antwoord: null, toegepast: false };
  }

  return { error: null, antwoord: (data?.antwoord as string | null) ?? null, toegepast: Boolean(data?.toegepast) };
}

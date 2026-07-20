import { createClient } from "@/lib/supabase/client";

/**
 * Abstraction layer required by spec section 3.8: one chat interface, the
 * backend it talks to (file patch vs Shopify Admin API) is chosen here
 * based on klant_type — never two separate UIs.
 */
export async function startKlantChatEdit(
  klantId: string,
  instruction: string,
): Promise<string | null> {
  const supabase = createClient();

  const { data: klant, error } = await supabase
    .from("klanten")
    .select("id, type, lead_id")
    .eq("id", klantId)
    .single();

  if (error || !klant) {
    return `Klant niet gevonden: ${error?.message}`;
  }

  const fn = klant.type === "shopify" ? "chat-edit-shopify" : "chat-edit-static";
  const body =
    klant.type === "shopify" ? { klantId, instruction } : { leadId: klant.lead_id, instruction };

  const { data, error: invokeError } = await supabase.functions.invoke(fn, { body });

  if (invokeError) {
    return `Bewerking mislukt: ${invokeError.message}`;
  }
  if (data?.error) {
    return data.error as string;
  }

  return null;
}

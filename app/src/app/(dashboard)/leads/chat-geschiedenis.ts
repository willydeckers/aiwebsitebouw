import { createClient } from "@/lib/supabase/client";

// The conversation about a lead's site, kept in the database rather than in
// React state so it survives closing the panel — and so both users see the
// same history, with who said what.

export type ChatRol = "gebruiker" | "ai" | "systeem";
export type ChatSoort = "chat" | "patch" | "regeneratie" | "upload";

export type ChatBericht = {
  id: string;
  lead_id: string;
  rol: ChatRol;
  afzender: string | null;
  bericht: string;
  soort: ChatSoort;
  site_version_id: string | null;
  aangemaakt_op: string;
};

export async function fetchChatGeschiedenis(leadId: string): Promise<ChatBericht[]> {
  const supabase = createClient();
  const { data } = await supabase
    .from("chat_berichten")
    .select("*")
    .eq("lead_id", leadId)
    .order("aangemaakt_op", { ascending: true })
    .limit(200);
  return (data as ChatBericht[] | null) ?? [];
}

export async function voegChatBerichtToe(bericht: {
  leadId: string;
  rol: ChatRol;
  tekst: string;
  soort?: ChatSoort;
  siteVersionId?: string | null;
}): Promise<ChatBericht | null> {
  const supabase = createClient();

  // Only a human message carries an address; recording "ai" as a sender would
  // make the transcript claim the assistant is a user.
  let afzender: string | null = null;
  if (bericht.rol === "gebruiker") {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    afzender = user?.email ?? null;
  }

  const { data } = await supabase
    .from("chat_berichten")
    .insert({
      lead_id: bericht.leadId,
      rol: bericht.rol,
      afzender,
      bericht: bericht.tekst,
      soort: bericht.soort ?? "chat",
      site_version_id: bericht.siteVersionId ?? null,
    })
    .select("*")
    .single();

  return (data as ChatBericht | null) ?? null;
}

/** "Garen" / "Warre" from an email, so the transcript reads like people
 *  talking rather than a list of addresses. */
export function afzenderLabel(bericht: ChatBericht): string {
  if (bericht.rol === "ai") return "AI";
  if (bericht.rol === "systeem") return "Systeem";
  if (!bericht.afzender) return "Gebruiker";
  const naam = bericht.afzender.split("@")[0].replace(/[._-]+/g, " ").trim();
  return naam.charAt(0).toUpperCase() + naam.slice(1);
}

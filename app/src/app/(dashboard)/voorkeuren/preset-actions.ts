import { createClient } from "@/lib/supabase/client";
import type { UiPreset } from "@/lib/ui-preset";
import { huidigEmail } from "@/lib/huidige-gebruiker";

function gebruikerFromEmail(email: string | undefined | null): "warre" | "garen" {
  return email?.toLowerCase().includes("garen") ? "garen" : "warre";
}

export async function fetchOwnPresets(): Promise<UiPreset[]> {
  const supabase = createClient();
  const email = await huidigEmail(supabase);
  if (!email) return [];

  const { data } = await supabase
    .from("ui_presets")
    .select("id, naam, thema, achtergrondkleur, accentkleur")
    .eq("gebruiker", gebruikerFromEmail(email))
    .order("naam");

  return (data as UiPreset[]) ?? [];
}

export async function createPreset(preset: {
  naam: string;
  thema: string | null;
  achtergrondkleur: string | null;
  accentkleur: string | null;
}): Promise<string | null> {
  const supabase = createClient();
  const email = await huidigEmail(supabase);
  if (!email) return "Niet ingelogd.";

  const { error } = await supabase.from("ui_presets").insert({
    gebruiker: gebruikerFromEmail(email),
    ...preset,
  });

  if (error?.code === "23505") return "Er bestaat al een preset met deze naam.";
  return error ? `Aanmaken mislukt: ${error.message}` : null;
}

export async function deletePreset(id: string): Promise<string | null> {
  const supabase = createClient();
  const { error } = await supabase.from("ui_presets").delete().eq("id", id);
  return error ? `Verwijderen mislukt: ${error.message}` : null;
}

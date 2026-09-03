import { createClient } from "@/lib/supabase/client";
import { huidigEmail } from "@/lib/huidige-gebruiker";

export type OpgeslagenInstelling = {
  sleutel: string;
  waarde: string;
  bijgewerkt_op: string;
  bijgewerkt_door: string | null;
};

export async function fetchInstellingen(): Promise<Record<string, OpgeslagenInstelling>> {
  const supabase = createClient();
  const { data } = await supabase
    .from("app_instellingen")
    .select("sleutel, waarde, bijgewerkt_op, bijgewerkt_door");

  const perSleutel: Record<string, OpgeslagenInstelling> = {};
  for (const rij of data ?? []) perSleutel[rij.sleutel as string] = rij as OpgeslagenInstelling;
  return perSleutel;
}

/**
 * Eén sleutel bewaren. Een lege waarde verwijdert de rij in plaats van een lege
 * string te bewaren: "niet ingesteld" en "ingesteld op niets" moeten voor de
 * worker hetzelfde betekenen, en één van de twee vormen is genoeg.
 */
export async function bewaarInstelling(
  sleutel: string,
  waarde: string,
  geheim: boolean,
): Promise<string | null> {
  const supabase = createClient();
  const schoon = waarde.trim();

  if (!schoon) {
    const { error } = await supabase.from("app_instellingen").delete().eq("sleutel", sleutel);
    return error ? `Wissen mislukt: ${error.message}` : null;
  }

  const { error } = await supabase.from("app_instellingen").upsert(
    {
      sleutel,
      waarde: schoon,
      geheim,
      bijgewerkt_op: new Date().toISOString(),
      bijgewerkt_door: await huidigEmail(supabase),
    },
    { onConflict: "sleutel" },
  );

  return error ? `Opslaan mislukt: ${error.message}` : null;
}

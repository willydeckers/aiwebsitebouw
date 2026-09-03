import { createWorkerClient } from "./supabase.js";

// De instellingen die in de app ingevuld zijn, opgehaald bij het opstarten.
//
// Waarom dit bestaat: de sleutels van dit project stonden verspreid over
// app/.env.local, worker/.env en de secrets van Supabase — drie bestanden die
// niets van elkaar weten. Zo stond SHOPIFY_PARTNER_ORGANIZATION_ID drie weken
// in het ene en niet in het andere, waardoor elke store-aanmaak-job meteen
// stierf. Nu is er één scherm, en leest de worker daaruit.
//
// Volgorde van winnen: wat in het scherm staat, gaat vóór wat in de omgeving
// staat. Dat is de enige regel die niet verrast — je hebt het daar net
// ingevuld en je ziet het daar staan; een .env-bestand dat stilletjes wint,
// zou precies het soort onzichtbaar verschil zijn dat dit moest oplossen.
//
// SUPABASE_URL en SUPABASE_SERVICE_ROLE_KEY komen hier NIET vandaan: die zijn
// nodig om deze tabel te kunnen lezen. Die blijven uit de omgeving komen.

export async function laadInstellingen(): Promise<{ geladen: string[]; fout: string | null }> {
  let supabase;
  try {
    supabase = createWorkerClient();
  } catch (err) {
    // Zonder verbinding is er niets op te halen; de omgevingscontrole die
    // hierna komt, meldt dat al met een bruikbaardere boodschap.
    return { geladen: [], fout: err instanceof Error ? err.message : String(err) };
  }

  const { data, error } = await supabase.from("app_instellingen").select("sleutel, waarde");

  if (error) {
    // Een ontbrekende tabel (migratie nog niet gedraaid) mag de worker niet
    // tegenhouden: dan gelden gewoon de waarden uit de omgeving, zoals vroeger.
    return { geladen: [], fout: error.message };
  }

  const geladen: string[] = [];
  for (const rij of data ?? []) {
    const sleutel = rij.sleutel as string;
    const waarde = (rij.waarde as string) ?? "";
    if (!waarde) continue;
    process.env[sleutel] = waarde;
    geladen.push(sleutel);
  }

  return { geladen, fout: null };
}

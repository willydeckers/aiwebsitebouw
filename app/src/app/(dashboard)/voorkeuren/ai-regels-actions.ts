import { createClient } from "@/lib/supabase/client";
import { logAudit } from "@/lib/audit";

// The two tables that steer every generation. Until now neither had any UI,
// which is why the Voorkeuren page felt like it was about nothing: the
// settings that actually matter were invisible and only writable by the AI
// itself.
//
// The stakes are concrete. In July a chat-edit on one lead ("look at
// tuinen-hendrix.be and use their services") was persisted here as a general
// rule and then applied to an unrelated flower shop's site. That leak was
// fixed at the writing end, but with no way to read the table there was still
// no way to notice a bad rule had landed.

export type Stijlvoorkeur = {
  id: string;
  regel: string;
  context: string | null;
  toegevoegd_door: string | null;
  aangemaakt_op: string;
};

export type SectorKennis = {
  id: string;
  sector: string;
  regel: string;
  toegevoegd_door: string | null;
  aangemaakt_op: string;
};

export async function fetchStijlvoorkeuren(): Promise<Stijlvoorkeur[]> {
  const supabase = createClient();
  const { data } = await supabase
    .from("stijlvoorkeuren")
    .select("id, regel, context, toegevoegd_door, aangemaakt_op")
    .order("aangemaakt_op", { ascending: false });
  return (data as Stijlvoorkeur[] | null) ?? [];
}

export async function addStijlvoorkeur(regel: string): Promise<string | null> {
  const schoon = regel.trim();
  if (schoon.length < 5) return "Schrijf een iets uitgebreidere regel.";

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { error } = await supabase.from("stijlvoorkeuren").insert({
    regel: schoon,
    context: "Handmatig toegevoegd via Voorkeuren",
    toegevoegd_door: user?.email ?? null,
  });
  if (error) return `Toevoegen mislukt: ${error.message}`;
  await logAudit("stijlvoorkeur_toegevoegd", undefined, { regel: schoon });
  return null;
}

export async function deleteStijlvoorkeur(id: string): Promise<string | null> {
  const supabase = createClient();
  const { error } = await supabase.from("stijlvoorkeuren").delete().eq("id", id);
  if (error) return `Verwijderen mislukt: ${error.message}`;
  await logAudit("stijlvoorkeur_verwijderd", undefined, { id });
  return null;
}

export async function fetchSectorKennis(): Promise<SectorKennis[]> {
  const supabase = createClient();
  const { data } = await supabase
    .from("sector_kennis")
    .select("id, sector, regel, toegevoegd_door, aangemaakt_op")
    .order("sector");
  return (data as SectorKennis[] | null) ?? [];
}

export async function addSectorKennis(sector: string, regel: string): Promise<string | null> {
  const schoneSector = sector.trim();
  const schoneRegel = regel.trim();
  if (!schoneSector) return "Vul een sector in.";
  if (schoneRegel.length < 5) return "Schrijf een iets uitgebreidere regel.";

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { error } = await supabase.from("sector_kennis").insert({
    sector: schoneSector,
    regel: schoneRegel,
    toegevoegd_door: user?.email ?? null,
  });
  if (error) return `Toevoegen mislukt: ${error.message}`;
  await logAudit("sectorkennis_toegevoegd", undefined, { sector: schoneSector });
  return null;
}

export async function deleteSectorKennis(id: string): Promise<string | null> {
  const supabase = createClient();
  const { error } = await supabase.from("sector_kennis").delete().eq("id", id);
  if (error) return `Verwijderen mislukt: ${error.message}`;
  await logAudit("sectorkennis_verwijderd", undefined, { id });
  return null;
}

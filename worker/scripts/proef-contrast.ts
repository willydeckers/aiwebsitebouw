// Meet het contrast van een bestaande site, zonder iets te wijzigen. Handig om
// na te gaan of de meting op echte gegenereerde pagina's zinnige dingen zegt
// (en geen valse alarmen geeft) voor ze een review laat afkeuren.
//
//   cd worker && npx tsx --env-file=.env scripts/proef-contrast.ts "<bedrijfsnaam>" [versienummer]

import { createClient } from "@supabase/supabase-js";
import { beoordeel, beschrijf } from "../src/shared/contrast.js";
import { HARDE_GRENS } from "../src/shared/contrast.js";
import { takeScreenshotMetContrast } from "../src/shared/screenshot.js";
import { haalAfbeeldingenAlsDataUri, vervangBestandsverwijzingen } from "../src/pipeline/media-ingest.js";

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const [naam, nummer] = process.argv.slice(2);

const { data: lead } = await supabase.from("leads").select("id, bedrijfsnaam").ilike("bedrijfsnaam", naam).single();
if (!lead) throw new Error(`Geen lead met de naam ${naam}`);

let query = supabase
  .from("site_versions")
  .select("versienummer, status, content_referentie, paginas")
  .eq("lead_id", lead.id);
query = nummer ? query.eq("versienummer", Number(nummer)) : query.order("versienummer", { ascending: false }).limit(1);
const { data: versie } = await query.single();
if (!versie?.content_referentie) throw new Error("Geen versie met inhoud.");

const map = (versie.content_referentie as string).replace(/\/index\.html$/, "");
const paginas = ((versie.paginas as { bestand: string }[] | null) ?? []).map((p) => p.bestand);
const beelden = await haalAfbeeldingenAlsDataUri(supabase, lead.id);

console.log(`${lead.bedrijfsnaam} — versie ${versie.versienummer} (${versie.status})\n`);
for (const bestand of paginas.length ? paginas : ["index.html"]) {
  const pad = paginas.length ? `${map}/${bestand}` : (versie.content_referentie as string);
  const { data } = await supabase.storage.from("demos").download(pad);
  if (!data) {
    console.log(`${bestand}: niet gevonden`);
    continue;
  }
  const html = vervangBestandsverwijzingen(await data.text(), beelden);
  const { contrast } = await takeScreenshotMetContrast(html);
  const problemen = beoordeel(bestand, contrast);
  console.log(`${bestand}: ${contrast.length} teksten gemeten, ${problemen.length} onder het minimum`);
  for (const p of problemen) {
    console.log(`  ${p.verhouding < HARDE_GRENS ? "HARD" : "zacht"}  ${beschrijf(p)}`);
  }
}

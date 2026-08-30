// Downloads a generated site version to a local folder, so its pages can be
// opened, served and link-checked without going through the app.
//
//   npx tsx --env-file=.env scripts/haal-site.ts "<bedrijfsnaam>" [doelmap]

import { createClient } from "@supabase/supabase-js";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const [naam, doelmap = "site-uit"] = process.argv.slice(2);

const { data: lead } = await supabase
  .from("leads")
  .select("id")
  .eq("bedrijfsnaam", naam)
  .single();
if (!lead) throw new Error(`Geen lead met de naam ${naam}`);

const { data: versie } = await supabase
  .from("site_versions")
  .select("versienummer, content_referentie, paginas, status")
  .eq("lead_id", lead.id)
  .order("versienummer", { ascending: false })
  .limit(1)
  .single();
if (!versie) throw new Error("Deze lead heeft nog geen versie.");

const map = path.dirname(versie.content_referentie as string);
const paginas = (versie.paginas as { bestand: string; titel: string }[] | null) ?? [
  { bestand: path.basename(versie.content_referentie as string), titel: "index" },
];

await mkdir(doelmap, { recursive: true });
console.log(`Versie ${versie.versienummer} (${versie.status}) — ${paginas.length} pagina's`);

for (const pagina of paginas) {
  const { data, error } = await supabase.storage.from("demos").download(`${map}/${pagina.bestand}`);
  if (error || !data) {
    console.log(`  ${pagina.bestand.padEnd(24)} NIET GEVONDEN (${error?.message})`);
    continue;
  }
  const html = await data.text();
  await writeFile(path.join(doelmap, pagina.bestand), html);
  console.log(`  ${pagina.bestand.padEnd(24)} ${(html.length / 1024).toFixed(0)} kB`);
}

console.log(`\nGeschreven naar ${path.resolve(doelmap)}`);

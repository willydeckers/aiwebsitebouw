// Prints every site version for a lead plus its review trail.
//
//   npx tsx --env-file=.env scripts/toon-versies.ts "<bedrijfsnaam>"
//
// Note the column name: review_log's timestamp column is literally called
// "timestamp", which is a reserved word and quoted in the migration. Ordering
// on the wrong name makes PostgREST fail the whole select and hand back null
// data with the error tucked away — it reads exactly like an empty table.

import { createClient } from "@supabase/supabase-js";

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

const { data: lead } = await supabase
  .from("leads")
  .select("id")
  .eq("bedrijfsnaam", process.argv[2])
  .single();
if (!lead) throw new Error("Geen lead met die naam");

const { data: versies } = await supabase
  .from("site_versions")
  .select("id, versienummer, status, paginas, content_referentie")
  .eq("lead_id", lead.id)
  .order("versienummer", { ascending: true });

for (const v of versies ?? []) {
  const paginas = (v.paginas as { bestand: string }[] | null)?.map((p) => p.bestand) ?? [];
  console.log(`\nVersie ${v.versienummer} — ${v.status} — ${v.content_referentie}`);
  console.log(`  ${paginas.length} pagina's: ${paginas.join(", ")}`);

  const { data: regels, error } = await supabase
    .from("review_log")
    .select("bron, instructie_of_bevinding, resultaat, error_message, timestamp")
    .eq("site_version_id", v.id)
    .order("timestamp", { ascending: true });
  if (error) console.log(`  (review_log onleesbaar: ${error.message})`);

  for (const r of regels ?? []) {
    const tijd = new Date(r.timestamp as string).toLocaleTimeString("nl-BE");
    console.log(`\n  [${tijd}] ${r.bron} — ${r.resultaat ?? r.error_message ?? ""}`);
    if (r.instructie_of_bevinding) console.log(`  ${r.instructie_of_bevinding}`);
  }
}

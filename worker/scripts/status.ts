// Quick read-only look at what the pipeline is doing right now.
//
//   npx tsx --env-file=.env scripts/status.ts [bedrijfsnaam]

import { createClient } from "@supabase/supabase-js";

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const naam = process.argv[2];

const { data: hartslag } = await supabase
  .from("worker_status")
  .select("laatste_hartslag, huidige_job_id")
  .maybeSingle();
if (hartslag?.laatste_hartslag) {
  const stil = Math.round((Date.now() - new Date(hartslag.laatste_hartslag).getTime()) / 1000);
  console.log(`Worker: laatste hartslag ${stil}s geleden${stil > 60 ? "  (LIJKT DOOD)" : ""}`);
} else {
  console.log("Worker: nooit een hartslag geschreven");
}

let leadId: string | undefined;
if (naam) {
  const { data: lead } = await supabase
    .from("leads")
    .select("id, bedrijfsnaam, status, klant_type, research_samenvatting")
    .eq("bedrijfsnaam", naam)
    .maybeSingle();
  if (!lead) {
    console.log(`Geen lead met de naam ${naam}`);
  } else {
    leadId = lead.id;
    console.log(`\nLead ${lead.bedrijfsnaam} (${lead.id})`);
    console.log(`  status: ${lead.status}   type: ${lead.klant_type ?? "-"}`);
    console.log(`  research: ${lead.research_samenvatting ? "aanwezig" : "nog niet"}`);

    const { data: versies } = await supabase
      .from("site_versions")
      .select("versienummer, status, paginas")
      .eq("lead_id", lead.id)
      .order("versienummer", { ascending: false });
    for (const v of versies ?? []) {
      const paginas = (v.paginas as { bestand: string }[] | null)?.map((p) => p.bestand);
      console.log(`  versie ${v.versienummer}: ${v.status}  ${paginas ? paginas.join(", ") : "(één bestand)"}`);
    }
  }
}

const query = supabase
  .from("jobs")
  .select("id, type, status, error_message, gestart_op, afgerond_op")
  .order("aangemaakt_op", { ascending: false })
  .limit(8);
const { data: jobs } = leadId ? await query.eq("lead_id", leadId) : await query;

console.log("\nJobs:");
for (const j of jobs ?? []) {
  const duur =
    j.gestart_op && j.afgerond_op
      ? ` (${Math.round((new Date(j.afgerond_op).getTime() - new Date(j.gestart_op).getTime()) / 1000)}s)`
      : j.gestart_op
        ? ` (loopt ${Math.round((Date.now() - new Date(j.gestart_op).getTime()) / 1000)}s)`
        : "";
  console.log(`  ${j.type.padEnd(22)} ${j.status.padEnd(14)}${duur}`);
  if (j.error_message) console.log(`      ${j.error_message.slice(0, 200)}`);
}

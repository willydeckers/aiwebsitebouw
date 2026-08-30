// Creates (or finds) a lead and queues the next pipeline step for it.
//
//   npx tsx --env-file=.env scripts/zet-lead-klaar.ts "<bedrijfsnaam>" <stap>
//
// The app does this through its own UI; this exists so a lead can be set up and
// driven from a terminal while the desktop build is being worked on, without
// clicking through a dashboard that may itself be mid-rebuild.

import { createClient } from "@supabase/supabase-js";

const [naam, stap = "research"] = process.argv.slice(2);
if (!naam) {
  console.error('Gebruik: zet-lead-klaar.ts "<bedrijfsnaam>" [research|generatie|review]');
  process.exit(1);
}

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

const { data: bestaand } = await supabase
  .from("leads")
  .select("id, status, sector, adres, klant_type")
  .eq("bedrijfsnaam", naam)
  .maybeSingle();

let leadId = bestaand?.id as string | undefined;

if (!leadId) {
  const { data, error } = await supabase
    .from("leads")
    .insert({
      bedrijfsnaam: naam,
      sector: process.env.LEAD_SECTOR ?? "Horeca",
      adres: process.env.LEAD_ADRES ?? null,
      notities: process.env.LEAD_NOTITIES ?? null,
      klant_type: process.env.LEAD_KLANT_TYPE ?? null,
      herkomst: "manueel",
      status: "nieuw",
    })
    .select("id")
    .single();
  if (error) throw new Error(`Kon lead niet aanmaken: ${error.message}`);
  leadId = data.id as string;
  console.log(`Lead aangemaakt: ${naam} (${leadId})`);
} else {
  console.log(`Lead bestond al: ${naam} (${leadId}) — status ${bestaand!.status}`);
}

const { data: job, error: jobError } = await supabase
  .from("jobs")
  .insert({ lead_id: leadId, type: stap, status: "wachtrij" })
  .select("id")
  .single();
if (jobError) throw new Error(`Kon job niet inplannen: ${jobError.message}`);

console.log(`Job '${stap}' in de wachtrij: ${job.id}`);

// Prints what research found for one lead, so it can be judged before spending
// a generation run on it.
//
//   npx tsx --env-file=.env scripts/toon-research.ts "<bedrijfsnaam>"

import { createClient } from "@supabase/supabase-js";

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const naam = process.argv[2];

const { data, error } = await supabase
  .from("leads")
  .select(
    "id, bedrijfsnaam, adres, telefoon, contact_email, website_url, website_status, research_samenvatting, open_vragen, notities",
  )
  .eq("bedrijfsnaam", naam)
  .single();

if (error) throw new Error(error.message);

for (const [sleutel, waarde] of Object.entries(data)) {
  if (waarde === null || waarde === "") continue;
  console.log(`\n── ${sleutel} ──\n${waarde}`);
}

// Prints the step log of the Shopify store-creation automation.
//
//   npx tsx --env-file=.env scripts/toon-shopify-log.ts "<bedrijfsnaam>"
//
// This is the trail that exists precisely because the automation drives a UI
// that can change any Tuesday: a row per step, with the selector it used and a
// screenshot path when it failed.

import { createClient } from "@supabase/supabase-js";

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

const { data: lead } = await supabase
  .from("leads")
  .select("id, shopify_store_id")
  .eq("bedrijfsnaam", process.argv[2])
  .single();
if (!lead) throw new Error("Geen lead met die naam");

const { data: stappen, error } = await supabase
  .from("shopify_automatisering_log")
  .select("stap, selector, resultaat, detail, schermafbeelding_pad, timestamp")
  .eq("lead_id", lead.id)
  .order("timestamp", { ascending: true });
if (error) throw new Error(error.message);

console.log(`${stappen?.length ?? 0} stap(pen):\n`);
for (const s of stappen ?? []) {
  const tijd = new Date(s.timestamp as string).toLocaleTimeString("nl-BE");
  console.log(`[${tijd}] ${String(s.resultaat).padEnd(14)} ${s.stap}`);
  if (s.selector) console.log(`             selector: ${s.selector}`);
  if (s.detail) console.log(`             ${s.detail}`);
  if (s.schermafbeelding_pad) console.log(`             beeld: ${s.schermafbeelding_pad}`);
}

const { data: stores } = await supabase
  .from("shopify_stores")
  .select("shop_domein, store_naam, status, fout_melding, app_geinstalleerd")
  .eq("lead_id", lead.id);
console.log(`\nWinkels voor deze lead: ${stores?.length ?? 0}`);
for (const s of stores ?? []) console.log(`  ${JSON.stringify(s)}`);

// Toont per lead welk model élke pipeline-stap echt zal gebruiken.
//
//   npx tsx --env-file=.env scripts/toon-lead-model.ts
//
// Bestaat omdat `leads.ai_model` niet één-op-één is met wat er draait: Fable
// mag enkel de site zelf schrijven, dus research, review en chat-edit worden
// op Opus gecapt. Die regel staat in resolveModel en niet in de UI, en is
// daardoor makkelijk verkeerd te onthouden — dit script leest hem uit de code
// die hem echt toepast, tegen de echte rijen.

import { createClient } from "@supabase/supabase-js";
import { MAX_TIER_ONDERSTEUNEND, calculateKostEur, resolveModel } from "../src/shared/anthropic.js";

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

const { data, error } = await supabase
  .from("leads")
  .select("id, bedrijfsnaam, status, ai_model")
  .order("laatst_bewerkt_op", { ascending: false });

if (error) throw new Error(error.message);

const standaard = process.env.MODEL_KWALITEIT || "claude-opus-4-8";
console.log(`Standaard (MODEL_KWALITEIT): ${standaard}`);
console.log(`Plafond voor research/review/chat-edit: ${MAX_TIER_ONDERSTEUNEND}\n`);

for (const lead of data ?? []) {
  const generatie = resolveModel(lead.ai_model);
  const ondersteunend = resolveModel(lead.ai_model, { maxTier: MAX_TIER_ONDERSTEUNEND });
  const gecapt = generatie !== ondersteunend ? "  (gecapt)" : "";

  console.log(`${lead.bedrijfsnaam}  [${lead.status}]`);
  console.log(`  gekozen:       ${lead.ai_model ?? "(niet ingesteld — valt terug op de standaard)"}`);
  console.log(`  generatie:     ${generatie}`);
  console.log(`  research/review/chat-edit: ${ondersteunend}${gecapt}`);

  // Meteen de prijstabel aftasten: een model zonder rij daarin laat een job
  // middenin crashen op "Onbekend model voor kostberekening", en dat wil je
  // hier zien staan, niet pas tijdens een echte generatie.
  for (const model of new Set([generatie, ondersteunend])) {
    try {
      calculateKostEur(model, 1000, 1000);
    } catch (err) {
      console.log(`  !! ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  console.log();
}

console.log(`${data?.length ?? 0} lead(s).`);

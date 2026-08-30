// Prints the global style preferences that steer every generation.
//
//   npx tsx --env-file=.env scripts/toon-voorkeuren.ts

import { createClient } from "@supabase/supabase-js";

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

const { data, error } = await supabase
  .from("stijlvoorkeuren")
  .select("*")
  ;

if (error) throw new Error(error.message);
console.log(`${data?.length ?? 0} stijlvoorkeur(en):\n`);
for (const rij of data ?? []) {
  console.log(JSON.stringify(rij, null, 1));
}

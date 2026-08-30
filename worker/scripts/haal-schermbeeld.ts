// Downloads a screenshot the Shopify automation stored when a step failed.
//
//   npx tsx --env-file=.env scripts/haal-schermbeeld.ts <opslagpad> [doelbestand]

import { createClient } from "@supabase/supabase-js";
import { writeFile } from "node:fs/promises";

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const [pad, doel = "schermbeeld.jpg"] = process.argv.slice(2);

const { data, error } = await supabase.storage.from("demos").download(pad);
if (error || !data) throw new Error(`Niet gevonden: ${error?.message}`);

await writeFile(doel, Buffer.from(await data.arrayBuffer()));
console.log(`${doel} — ${(data.size / 1024).toFixed(0)} kB`);

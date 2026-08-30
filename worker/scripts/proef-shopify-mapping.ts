// Runs the site -> Shopify mapping against a real generated site and prints
// exactly what would be created in the store.
//
//   npx tsx --env-file=.env scripts/proef-shopify-mapping.ts "<bedrijfsnaam>"
//
// The mapping has unit tests against a fixture. This runs it on live output,
// which is a different question: a fixture proves the code does what it says,
// this proves the generator produces something the code can actually map. It
// touches no Shopify API and needs no store — which matters, because there
// isn't one yet.

import { createClient } from "@supabase/supabase-js";
import path from "node:path";
import type { SiteBron } from "../src/shared/site-builder.js";
import {
  HOOFDMENU_HANDLE,
  handleVoor,
  menuItemsVoorShopify,
  overgeslagenPaginas,
  paginasVoorShopify,
  type ShopifyMenuItem,
} from "../src/shopify/site-naar-shopify.js";

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const naam = process.argv[2];

const { data: lead } = await supabase.from("leads").select("id, klant_type").eq("bedrijfsnaam", naam).single();
if (!lead) throw new Error(`Geen lead met de naam ${naam}`);

const { data: versie } = await supabase
  .from("site_versions")
  .select("versienummer, content_referentie, status")
  .eq("lead_id", lead.id)
  .order("versienummer", { ascending: false })
  .limit(1)
  .single();
if (!versie) throw new Error("Deze lead heeft nog geen versie.");

const map = path.dirname(versie.content_referentie as string);
const { data: bronBestand, error } = await supabase.storage.from("demos").download(`${map}/bron.json`);
if (error || !bronBestand) throw new Error(`Geen bron.json in ${map}: ${error?.message}`);

const bron = JSON.parse(await bronBestand.text()) as SiteBron;

console.log(`${naam} — versie ${versie.versienummer} (${versie.status}), klant_type ${lead.klant_type}\n`);

const paginas = paginasVoorShopify(bron);
console.log(`Pages die aangemaakt worden (${paginas.length}):`);
for (const p of paginas) {
  console.log(`  /${handleVoor(p.bestand).padEnd(16)} "${p.title}"  ${(p.body.length / 1024).toFixed(0)} kB  ${p.isPublished ? "gepubliceerd" : "verborgen"}`);
}

const overgeslagen = overgeslagenPaginas(bron);
console.log(`\nBewust overgeslagen (${overgeslagen.length}):`);
for (const o of overgeslagen) console.log(`  ${o.bestand.padEnd(20)} ${o.reden}`);

// Stand in for the gids Shopify hands back after pageCreate, so the menu can
// be built without a store existing.
const gids: Record<string, string> = Object.fromEntries(
  paginas.map((p) => [p.bestand, `gid://shopify/Page/PROEF-${handleVoor(p.bestand)}`]),
);
const items = menuItemsVoorShopify(bron, gids);

console.log(`\nMenu '${HOOFDMENU_HANDLE}':`);
function toon(lijst: ShopifyMenuItem[], diep = 1) {
  for (const item of lijst) {
    const doel = item.type === "PAGE" ? (item.resourceId ?? "?") : (item.url ?? "?");
    console.log(`${"  ".repeat(diep)}${item.title.padEnd(18)} ${item.type.padEnd(5)} ${doel}`);
    if (item.items?.length) toon(item.items, diep + 1);
  }
}
toon(items);

// The failure that would be invisible in a store: a menu entry that points at
// nothing, or a page nothing links to.
const inMenu = new Set<string>();
function verzamel(lijst: ShopifyMenuItem[]) {
  for (const i of lijst) {
    if (i.resourceId) inMenu.add(i.resourceId);
    if (i.items) verzamel(i.items);
  }
}
verzamel(items);

const zonderMenu = paginas.filter((p) => !inMenu.has(gids[p.bestand]));
const kapotteItems = [...inMenu].filter((id) => !Object.values(gids).includes(id));

console.log("\nControle:");
console.log(`  menu-items die nergens heen wijzen: ${kapotteItems.length ? kapotteItems.join(", ") : "geen"}`);
console.log(
  `  pages die niet in het menu staan: ${zonderMenu.length ? zonderMenu.map((p) => p.bestand).join(", ") : "geen"}`,
);
if (kapotteItems.length) process.exitCode = 1;

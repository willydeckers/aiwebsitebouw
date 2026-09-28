// Een siteversie bewerken in VS Code zonder de desktop-app — voor wie de
// worker vanuit een terminal draait. Doet exact wat "Openen in editor" in de
// werkruimte doet (editor/lokale-bewerking.ts) en blijft draaien zolang je
// bewerkt; Ctrl+C stopt de koppeling.
//
//   cd worker && npx tsx --env-file=.env scripts/bewerk-site.ts <lead-id> [versienummer]
//
// Zonder versienummer: de nieuwste versie. De live versie wordt geweigerd,
// net als in de app — maak eerst een kopie ("Bewaar als versie").
//
// Zet BEWERK_ZONDER_EDITOR=1 om de map klaar te zetten zonder VS Code te
// openen (handig om de synchronisatie zelf te testen).

import { createClient } from "@supabase/supabase-js";
import { startBewerking } from "../src/editor/lokale-bewerking.js";

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const [leadId, versienummer] = process.argv.slice(2);
if (!leadId) {
  console.error("Gebruik: npx tsx --env-file=.env scripts/bewerk-site.ts <lead-id> [versienummer]");
  process.exit(1);
}

let query = supabase.from("site_versions").select("id, versienummer, status").eq("lead_id", leadId);
query = versienummer
  ? query.eq("versienummer", Number(versienummer))
  : query.order("versienummer", { ascending: false }).limit(1);
const { data: versie } = await query.maybeSingle();
if (!versie) {
  console.error("Geen versie gevonden.");
  process.exit(1);
}

const map = await startBewerking({
  versieId: versie.id,
  email: process.env.BEWERK_EMAIL ?? "terminal",
  openEditor: process.env.BEWERK_ZONDER_EDITOR !== "1",
});
console.log(`Versie ${versie.versienummer} (${versie.status}) staat in ${map}`);
console.log("Bewaar daar om de site bij te werken. Ctrl+C om te stoppen.");

import { spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  watch,
  writeFileSync,
  type FSWatcher,
} from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createWorkerClient } from "../shared/supabase.js";
import { leesVers } from "../shared/opslag.js";
import {
  BRON_BESTANDEN,
  SiteBuildError,
  bestandenNaarBron,
  bouwSite,
  bronNaarBestanden,
  type PaginaMeta,
  type SiteBron,
} from "../shared/site-builder.js";
import { bouwAnalyticsGegevens, bouwSeoGegevens, type Lead } from "../pipeline/generate-demo.js";
import { lokaleHostingUrl } from "../hosting/lokale-server.js";
import { bepaalSynchronisatie, hashes, type HashMap } from "./synchronisatie.js";

// Een siteversie bewerken in VS Code (of een andere editor), zonder de backend
// aan te raken.
//
// Waarom: de chat doet niet altijd wat je bedoelt, en "die kleur daar" is vaak
// sneller zelf gevonden in de CSS dan uitgelegd aan een model. Dus zet de
// worker de bouwstenen van één versie in een gewone map, kijkt mee, en bij
// elke bewaring bouwt hij de site opnieuw en zet hij ze in Storage — de
// preview in de app volgt vanzelf.
//
// Bewust de BOUWSTENEN en niet de afgewerkte pagina's: _head.html,
// _navigatie.html, _footer.html, _paginas.json en per pagina enkel de inhoud.
// Dat zijn exact de bestanden die de AI in chat-edit ziet (zelfde mapping, zie
// bronNaarBestanden in site-builder.ts). Een afgewerkte pagina is niet terug te
// rekenen naar die onderdelen, dus hand-aanpassingen daarin zouden bij de
// volgende chat-edit gewoon verdwijnen. Zo niet: de nav pas je één keer aan en
// ze geldt op elke pagina, en de chat blijft werken op wat jij veranderde.
//
// Bewaren gaat door exact hetzelfde pad als chat-edit (bouwSite met het
// seo-blok en de analytics-instelling). Anders zou elke bewaring de canonical,
// Open Graph, JSON-LD en de cookiemelding van de site halen — dezelfde stille
// fout als de chat-edit-bug van 2026-09-02.
//
// De live versie wordt nooit rechtstreeks bewerkt: elke Ctrl+S, ook een halve
// tussenstand, zou meteen online staan. De app maakt eerst een kopie; hier
// wordt een actieve versie geweigerd, en een versie die tijdens het bewerken
// live gezet wordt, koppelt los.

const STAAT_BESTAND = ".bewerking.json";
const FOUT_BESTAND = "_FOUT.txt";
const LEESMIJ_BESTAND = "LEESMIJ.txt";
const WACHT_NA_BEWAREN_MS = 600;
const KIJK_REMOTE_MS = 4000;

type LeadRij = Lead;

type Sessie = {
  versieId: string;
  leadId: string;
  versienummer: number;
  contentReferentie: string;
  /** null = een oude één-pagina-versie: één volledig index.html. */
  paginas: PaginaMeta[] | null;
  map: string;
  email: string | null;
  basis: HashMap;
  laatstGezien: string | null;
  laatsteFout: string | null;
  /** De lokale toestand waarvan de build al geweigerd werd — niet elke 4 s
   *  opnieuw proberen zolang er niets veranderde. */
  geweigerd: string | null;
  watcher: FSWatcher | null;
  kijkTimer: NodeJS.Timeout | null;
  wachtTimer: NodeJS.Timeout | null;
  bezig: boolean;
  opnieuw: boolean;
};

type Staat = { versieId: string; basis: HashMap; laatstGezien: string | null };

const sessies = new Map<string, Sessie>();
let client: SupabaseClient | null = null;

function supabase(): SupabaseClient {
  client ??= createWorkerClient();
  return client;
}

/** Waar de mappen komen. De app geeft de echte map Documenten mee (Tauri lost
 *  ook een naar OneDrive omgeleide map juist op); anders een redelijke gok. */
export function bewerkBasisMap(): string {
  return process.env.WORKER_BEWERK_MAP?.trim() || path.join(homedir(), "Documents", "Web Agency sites");
}

function slug(naam: string): string {
  return (
    naam
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "site"
  );
}

function versieMap(contentReferentie: string): string {
  return contentReferentie.replace(/\/index\.html$/, "");
}

function isMeerpagina(sessie: Pick<Sessie, "paginas">): boolean {
  return Array.isArray(sessie.paginas) && sessie.paginas.length > 0;
}

// ── Bestanden ──────────────────────────────────────────────────────────────

/** Enkel wat bij de site hoort: de bouwstenen en de paginabestanden. Geen
 *  LEESMIJ, geen foutbestand, geen toestand, geen .vscode. */
function hoortBijSite(naam: string, meerpagina: boolean): boolean {
  if (!meerpagina) return naam === "index.html";
  if (naam === BRON_BESTANDEN.paginas) return true;
  return naam.endsWith(".html");
}

function leesLokaal(sessie: Sessie): Record<string, string> {
  const uit: Record<string, string> = {};
  if (!existsSync(sessie.map)) return uit;
  const meerpagina = isMeerpagina(sessie);
  for (const naam of readdirSync(sessie.map)) {
    if (!hoortBijSite(naam, meerpagina)) continue;
    // Regeleinden gelijkschakelen: \r\n van een Windows-editor is geen
    // inhoudelijke wijziging.
    uit[naam] = readFileSync(path.join(sessie.map, naam), "utf8").replace(/\r\n/g, "\n");
  }
  return uit;
}

// Via leesVers en niet download(): de CDN geeft vlak na een bewaring nog de
// vorige inhoud, en dan zou de synchronisatie die oude versie als "gewijzigd
// van buitenaf" naar schijf schrijven — over wat je net bewaarde heen.
async function leesRemote(sessie: Sessie): Promise<Record<string, string>> {
  if (isMeerpagina(sessie)) {
    const bron = await leesVers(supabase(), `${versieMap(sessie.contentReferentie)}/bron.json`);
    if (bron === null) throw new Error("Kon bron.json niet ophalen.");
    return bronNaarBestanden(JSON.parse(bron) as SiteBron);
  }
  const html = await leesVers(supabase(), sessie.contentReferentie);
  if (html === null) throw new Error("Kon de pagina niet ophalen.");
  return { "index.html": html };
}

function bewaarStaat(sessie: Sessie) {
  const staat: Staat = { versieId: sessie.versieId, basis: sessie.basis, laatstGezien: sessie.laatstGezien };
  writeFileSync(path.join(sessie.map, STAAT_BESTAND), JSON.stringify(staat, null, 2));
}

function leesStaat(map: string, versieId: string): Staat | null {
  try {
    const staat = JSON.parse(readFileSync(path.join(map, STAAT_BESTAND), "utf8")) as Staat;
    return staat.versieId === versieId ? staat : null;
  } catch {
    return null;
  }
}

async function meld(sessie: Pick<Sessie, "leadId" | "versieId">, tekst: string) {
  await supabase().from("chat_berichten").insert({
    lead_id: sessie.leadId,
    rol: "systeem",
    afzender: null,
    bericht: tekst,
    soort: "chat",
    site_version_id: sessie.versieId,
  });
}

// ── Opbouwen en uploaden ──────────────────────────────────────────────────

async function upload(sessie: Sessie, lokaal: Record<string, string>): Promise<string | null> {
  const db = supabase();
  const door = `${sessie.email ?? "onbekend"} (editor)`;

  if (!isMeerpagina(sessie)) {
    const { error } = await db.storage.from("demos").upload(sessie.contentReferentie, lokaal["index.html"] ?? "", {
      contentType: "text/html",
      upsert: true,
    });
    if (error) throw new Error(`Upload mislukt: ${error.message}`);
    const { data } = await db
      .from("site_versions")
      .update({ laatst_bewerkt_door: door })
      .eq("id", sessie.versieId)
      .select("laatst_bewerkt_op")
      .single();
    return (data?.laatst_bewerkt_op as string | undefined) ?? null;
  }

  const [{ data: lead }, { data: bestandRijen }] = await Promise.all([
    db
      .from("leads")
      .select("id, bedrijfsnaam, sector, adres, telefoon, notities, research_samenvatting, ai_model")
      .eq("id", sessie.leadId)
      .single(),
    db.from("site_bestanden").select("bestandsnaam").eq("lead_id", sessie.leadId),
  ]);
  if (!lead) throw new Error("Lead niet gevonden.");

  // Gooit SiteBuildError bij een dode link, een eigen <script>, een pagina
  // zonder menulink… — de aanroeper zet dat in _FOUT.txt.
  const bron = bestandenNaarBron(lokaal);
  // `bestanden` bewust niet aan bouwSite meegegeven, net als chat-edit: dat zet
  // de controle op dode downloadlinks aan, wat elke bewaring zou blokkeren op
  // een site die al naar een verwijderd bestand linkt.
  const bestandsnamen = (bestandRijen ?? []).map((r) => r.bestandsnaam as string);
  const gebouwd = bouwSite(bron, lead.bedrijfsnaam, {
    seo: bouwSeoGegevens(lead as LeadRij, bestandsnamen),
    analytics: bouwAnalyticsGegevens(),
  });

  const map = versieMap(sessie.contentReferentie);
  for (const pagina of gebouwd) {
    const { error } = await db.storage
      .from("demos")
      .upload(`${map}/${pagina.bestand}`, pagina.html, { contentType: "text/html", upsert: true });
    if (error) throw new Error(`Upload van ${pagina.bestand} mislukt: ${error.message}`);
  }
  const { error: bronFout } = await db.storage
    .from("demos")
    .upload(`${map}/bron.json`, JSON.stringify(bron, null, 2), { contentType: "application/json", upsert: true });
  if (bronFout) throw new Error(`Upload van bron.json mislukt: ${bronFout.message}`);

  const verouderd = (sessie.paginas ?? [])
    .filter((oud) => !gebouwd.some((p) => p.bestand === oud.bestand))
    .map((oud) => `${map}/${oud.bestand}`);
  if (verouderd.length) await db.storage.from("demos").remove(verouderd);

  const { data, error } = await db
    .from("site_versions")
    .update({ paginas: bron.paginas, laatst_bewerkt_door: door })
    .eq("id", sessie.versieId)
    .select("laatst_bewerkt_op")
    .single();
  if (error) throw new Error(`Kon de versie niet bijwerken: ${error.message}`);
  sessie.paginas = bron.paginas;
  return (data?.laatst_bewerkt_op as string | undefined) ?? null;
}

// ── De synchronisatie zelf ────────────────────────────────────────────────

async function synchroniseer(sessie: Sessie): Promise<void> {
  if (sessie.bezig) {
    sessie.opnieuw = true;
    return;
  }
  sessie.bezig = true;

  try {
    const { data: rij } = await supabase()
      .from("site_versions")
      .select("status, laatst_bewerkt_op, paginas, content_referentie")
      .eq("id", sessie.versieId)
      .maybeSingle();

    if (!rij) {
      await stop(sessie, `Versie ${sessie.versienummer} bestaat niet meer; de koppeling met de editor is gestopt.`);
      return;
    }
    if (rij.status === "actief") {
      await stop(
        sessie,
        `Versie ${sessie.versienummer} staat nu live. De koppeling met de editor is gestopt, zodat wat je ` +
          "daar nog bewaart niet meteen online komt. Open ze opnieuw in de editor om verder te werken — dat maakt " +
          "eerst een kopie.",
      );
      return;
    }

    // Enkel ophalen als er aan de andere kant iets veranderde; anders is de
    // basis gewoon wat er in Storage staat.
    let remote: Record<string, string> | null = null;
    if (rij.laatst_bewerkt_op !== sessie.laatstGezien) {
      sessie.paginas = (rij.paginas as PaginaMeta[] | null) ?? sessie.paginas;
      remote = await leesRemote(sessie);
    }
    const remoteHashes = remote ? hashes(remote) : sessie.basis;

    const lokaal = leesLokaal(sessie);
    const plan = bepaalSynchronisatie(sessie.basis, hashes(lokaal), remoteHashes);
    if (plan.naarSchijf.length || plan.vanSchijfWeg.length || plan.conflicten.length) {
      console.log(
        `Editor: versie ${sessie.versienummer} — van buitenaf binnengehaald: ` +
          `${[...plan.naarSchijf, ...plan.vanSchijfWeg.map((n) => `${n} (weg)`)].join(", ") || "niets"}` +
          (plan.conflicten.length ? `; aan beide kanten gewijzigd (editor wint): ${plan.conflicten.join(", ")}` : ""),
      );
    }

    for (const naam of plan.naarSchijf) {
      writeFileSync(path.join(sessie.map, naam), remote![naam]);
      lokaal[naam] = remote![naam];
    }
    for (const naam of plan.vanSchijfWeg) {
      rmSync(path.join(sessie.map, naam), { force: true });
      delete lokaal[naam];
    }
    if (plan.conflicten.length) {
      await meld(
        sessie,
        `${plan.conflicten.join(", ")} veranderde in de editor én ergens anders (bv. via de chat). De versie uit ` +
          "de editor is behouden.",
      );
    }

    sessie.basis = remoteHashes;
    sessie.laatstGezien = rij.laatst_bewerkt_op as string;

    // Stond er een fout, en is de map intussen weer gelijk aan wat online
    // staat (je draaide je wijziging terug), dan is er niets meer mis — ook
    // al valt er niets te uploaden.
    if (!plan.uploaden && sessie.laatsteFout) {
      rmSync(path.join(sessie.map, FOUT_BESTAND), { force: true });
      sessie.laatsteFout = null;
      sessie.geweigerd = null;
    }

    const lokaleSleutel = JSON.stringify(hashes(lokaal));
    if (plan.uploaden && !(remote === null && lokaleSleutel === sessie.geweigerd)) {
      try {
        const nieuw = await upload(sessie, lokaal);
        sessie.basis = hashes(lokaal);
        if (nieuw) sessie.laatstGezien = nieuw;
        sessie.geweigerd = null;
        rmSync(path.join(sessie.map, FOUT_BESTAND), { force: true });
        if (sessie.laatsteFout) await meld(sessie, `Versie ${sessie.versienummer}: de fout is opgelost, alles staat weer online in de preview.`);
        sessie.laatsteFout = null;
        console.log(`Editor: versie ${sessie.versienummer} van ${sessie.leadId} bijgewerkt.`);
      } catch (err) {
        const reden = err instanceof SiteBuildError || err instanceof Error ? err.message : String(err);
        sessie.geweigerd = lokaleSleutel;
        writeFileSync(
          path.join(sessie.map, FOUT_BESTAND),
          `Je laatste bewaring is NIET doorgevoerd — de site zou hierdoor stuk zijn:\n\n${reden}\n\n` +
            "Pas het aan en bewaar opnieuw. Dit bestand verdwijnt vanzelf zodra het weer lukt.\n",
        );
        // Niet bij elke Ctrl+S dezelfde regel in de chat.
        if (reden !== sessie.laatsteFout) {
          await meld(sessie, `Bewaring in de editor niet doorgevoerd (versie ${sessie.versienummer}): ${reden}`);
        }
        sessie.laatsteFout = reden;
      }
    }

    bewaarStaat(sessie);
  } catch (err) {
    console.error(`Editor-synchronisatie mislukt: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    sessie.bezig = false;
    if (sessie.opnieuw && sessies.has(sessie.versieId)) {
      sessie.opnieuw = false;
      void synchroniseer(sessie);
    }
  }
}

async function stop(sessie: Sessie, reden?: string) {
  sessie.watcher?.close();
  if (sessie.kijkTimer) clearInterval(sessie.kijkTimer);
  if (sessie.wachtTimer) clearTimeout(sessie.wachtTimer);
  sessies.delete(sessie.versieId);
  if (reden) {
    writeFileSync(path.join(sessie.map, FOUT_BESTAND), `${reden}\n`);
    await meld(sessie, reden);
  }
}

// ── Starten ───────────────────────────────────────────────────────────────

/**
 * Zet versie `versieId` in een map, houdt die in de gaten, en opent ze in de
 * editor. Een tweede keer voor dezelfde versie opent enkel de editor opnieuw.
 */
export async function startBewerking({
  versieId,
  email,
  openEditor = true,
}: {
  versieId: string;
  email: string | null;
  openEditor?: boolean;
}): Promise<string> {
  const bestaand = sessies.get(versieId);
  if (bestaand) {
    if (openEditor) await openInEditor(bestaand);
    return bestaand.map;
  }

  const db = supabase();
  const { data: versie } = await db
    .from("site_versions")
    .select("id, lead_id, versienummer, status, content_referentie, paginas, laatst_bewerkt_op")
    .eq("id", versieId)
    .maybeSingle();
  if (!versie?.content_referentie) throw new Error(`Versie ${versieId} niet gevonden of zonder inhoud.`);

  if (versie.status === "actief") {
    const tekst =
      `Versie ${versie.versienummer} staat live en wordt niet rechtstreeks in de editor geopend — elke bewaring ` +
      "zou meteen online staan. Gebruik 'Openen in editor' in de werkruimte: die maakt eerst een kopie.";
    await meld({ leadId: versie.lead_id, versieId }, tekst);
    throw new Error(tekst);
  }

  const { data: lead } = await db.from("leads").select("bedrijfsnaam").eq("id", versie.lead_id).single();
  const map = path.join(
    bewerkBasisMap(),
    `${slug(lead?.bedrijfsnaam ?? "site")}-${String(versie.lead_id).slice(0, 8)}`,
    `versie-${versie.versienummer}`,
  );
  mkdirSync(map, { recursive: true });

  const sessie: Sessie = {
    versieId,
    leadId: versie.lead_id,
    versienummer: versie.versienummer,
    contentReferentie: versie.content_referentie,
    paginas: (versie.paginas as PaginaMeta[] | null) ?? null,
    map,
    email,
    basis: {},
    laatstGezien: null,
    laatsteFout: null,
    geweigerd: null,
    watcher: null,
    kijkTimer: null,
    wachtTimer: null,
    bezig: false,
    opnieuw: false,
  };

  // Een map die al bestond (de worker werd herstart, of je opent dezelfde
  // versie opnieuw): vergelijken met hoe ze de vorige keer was, zodat wat je
  // intussen bewaarde nog meegaat — en wat intussen via de chat veranderde ook.
  // Een map zonder toestand: Storage wint, alles wordt opnieuw uitgeschreven.
  const staat = leesStaat(map, versieId);
  if (staat) {
    sessie.basis = staat.basis;
    sessie.laatstGezien = staat.laatstGezien;
  } else {
    sessie.basis = hashes(leesLokaal(sessie));
    sessie.laatstGezien = null;
  }

  schrijfHulpbestanden(sessie, lead?.bedrijfsnaam ?? "");
  sessies.set(versieId, sessie);
  await synchroniseer(sessie);

  // Enkel de bestanden van de site, en pas na een korte stilte: een editor
  // schrijft een bewaring soms in meerdere stappen.
  sessie.watcher = watch(map, (_gebeurtenis, naam) => {
    if (!naam || !hoortBijSite(String(naam), isMeerpagina(sessie))) return;
    if (sessie.wachtTimer) clearTimeout(sessie.wachtTimer);
    sessie.wachtTimer = setTimeout(() => void synchroniseer(sessie), WACHT_NA_BEWAREN_MS);
  });
  // Wijzigingen van buitenaf (een chat-edit) naar de map halen.
  sessie.kijkTimer = setInterval(() => void synchroniseer(sessie), KIJK_REMOTE_MS);

  let geopendIn = "";
  if (openEditor) geopendIn = await openInEditor(sessie);

  await meld(
    sessie,
    `Versie ${sessie.versienummer} staat ${geopendIn ? `open in ${geopendIn}` : "klaar"}: ${map}\n` +
      "Elke keer dat je daar bewaart, wordt deze versie bijgewerkt en volgt de preview. Uitleg staat in LEESMIJ.txt.",
  );
  console.log(`Editor: versie ${sessie.versienummer} van ${sessie.leadId} in ${map}`);
  return map;
}

function schrijfHulpbestanden(sessie: Sessie, bedrijfsnaam: string) {
  const voorbeeld = `${lokaleHostingUrl()}/${sessie.leadId}/v${sessie.versienummer}/`;
  const meerpagina = isMeerpagina(sessie);

  const uitleg = meerpagina
    ? `Wat hier staat
-------------
Dit zijn de BOUWSTENEN van de site, niet de afgewerkte pagina's. De code zet
de pagina's er bij elke bewaring uit samen — dezelfde bestanden die de AI in de
chat bewerkt.

  _head.html        Gedeelde <head>: lettertypes, tailwind.config (de
                    kleuren van het huisstijlpalet) en eigen <style>-regels.
                    Een kleur die overal terugkomt, zoek je hier eerst.
  _navigatie.html   De navigatiebalk. Eén keer aanpassen = op elke pagina.
  _footer.html      De footer. Idem.
  _paginas.json     De lijst van pagina's (bestand, titel, menunaam).
  <pagina>.html     Per pagina ENKEL de inhoud tussen navigatie en footer.
                    Geen <html>, <head>, <body>, nav of footer hierin.

Kleuren en layout staan meestal als Tailwind-klassen in de HTML
(bv. text-slate-300, bg-emerald-50, grid-cols-3). Lichte tekst op een lichte
achtergrond los je op door de tekstklasse donkerder te maken (bv. -300 -> -700)
of de achtergrond donkerder.

Regels die de code afdwingt (anders wordt je bewaring geweigerd)
----------------------------------------------------------------
- Geen eigen <script> of onclick=... — interactie loopt via de vaste widgets.
- Elke menulink naar een pagina draagt data-nav-actief="...klassen...".
- Interne links wijzen enkel naar pagina's uit _paginas.json (bv. href="contact.html").
- Elke afbeelding heeft een alt-tekst.
- Een nieuwe pagina: voeg ze toe aan _paginas.json, maak het bestand aan, en
  zet ze in _navigatie.html.
`
    : `Wat hier staat
-------------
Een oudere versie van vóór de meerpagina-sites: één volledig index.html. Wat je
bewaart, gaat ongewijzigd naar de site.
`;

  writeFileSync(
    path.join(sessie.map, LEESMIJ_BESTAND),
    `${bedrijfsnaam} — versie ${sessie.versienummer}
${"=".repeat(Math.max(10, bedrijfsnaam.length + 12))}

Elke keer dat je in deze map bewaart, bouwt de worker de site opnieuw en zet
hij ze in deze versie. De preview in de app volgt vanzelf. In een browser:

  ${voorbeeld}

${uitleg}
Als iets niet lukt
------------------
Kan een bewaring niet doorgevoerd worden, dan verschijnt hier ${FOUT_BESTAND}
met de reden, en een regel in de chat van deze site. Het bestand verdwijnt
vanzelf zodra het weer lukt.

Past iemand dezelfde versie intussen via de chat aan, dan komt dat hier ook
binnen. Heb je hetzelfde bestand zelf ook gewijzigd, dan wint wat hier staat.

Deze versie staat NIET live. Zet ze live vanuit de app ("Zet live") als je
klaar bent. Gebeurt dat terwijl deze map open staat, dan stopt de koppeling,
zodat wat je daarna bewaart niet meteen online komt.

Werkt de koppeling enkel zolang de worker (de app) draait.
`,
  );

  const vscode = path.join(sessie.map, ".vscode");
  mkdirSync(vscode, { recursive: true });
  writeFileSync(
    path.join(vscode, "settings.json"),
    JSON.stringify({ "files.exclude": { [STAAT_BESTAND]: true } }, null, 2),
  );
}

/** VS Code als die er is, anders de Verkenner. Geeft terug wat het werd. */
function openInEditor(sessie: Sessie): Promise<string> {
  return new Promise((resolve) => {
    let klaar = false;
    const val = (wat: string) => {
      if (klaar) return;
      klaar = true;
      resolve(wat);
    };

    const terugval = () => {
      const verkenner =
        process.platform === "win32"
          ? spawn("explorer.exe", [sessie.map], { detached: true, stdio: "ignore" })
          : spawn(process.platform === "darwin" ? "open" : "xdg-open", [sessie.map], {
              detached: true,
              stdio: "ignore",
            });
      verkenner.on("error", () => val(""));
      verkenner.unref();
      val("de Verkenner (VS Code niet gevonden)");
    };

    // Via de shell: `code` is op Windows een .cmd-bestand. Het pad zelf
    // aanhalen, want de shell voegt argumenten ongequote samen en de map heeft
    // een spatie ("Web Agency sites").
    const code = spawn(`code "${sessie.map}"`, {
      shell: true,
      windowsHide: true,
      detached: true,
      stdio: "ignore",
    });
    code.on("error", terugval);
    code.on("exit", (status) => (status === 0 ? val("VS Code") : terugval()));
    code.unref();
    // code.cmd keert normaal binnen een seconde terug. Blijft het hangen, dan
    // is de editor wel gestart.
    setTimeout(() => val("VS Code"), 8000);
  });
}

/** Het aantal lopende koppelingen, voor het log. */
export function aantalBewerkingen(): number {
  return sessies.size;
}

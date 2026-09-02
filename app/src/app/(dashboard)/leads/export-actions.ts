import { createClient } from "@/lib/supabase/client";
import { logAudit } from "@/lib/audit";
import { maakZip, type ZipInvoer } from "@/lib/zip";
import type { PaginaMeta, SiteVersion } from "@/lib/types";

/**
 * "Aankoop" betekent eigendomsoverdracht: de klant neemt de site mee en wij
 * hosten niet meer. Dat is technisch iets heel anders dan een domein koppelen
 * — er komt geen rij in onze routering bij, er gaat er juist een weg.
 *
 * Wat een export wél is: de statische pagina's plus de geüploade bestanden.
 * Wat ze niet is, en niet kan zijn: de formulieren, reviews, downloads-teller
 * en afgeschermde pagina's. Die draaien op `track-and-serve` met de
 * service-role — honeypot, rate limiting, moderatie, toegangscodes. Dat is
 * geen JavaScript dat we kunnen meegeven; het is een backend. Zie LEESMIJ.txt
 * in de zip: liever expliciet in het pakket dan alleen in een verkoopgesprek.
 */

const HOSTING_BASE = (process.env.NEXT_PUBLIC_DEMO_HOSTING_URL ?? "").replace(/\/$/, "");

/**
 * De canonical/og:url/JSON-LD-URL's wijzen naar ónze hostinglaag. Meegeven
 * zoals ze zijn zou een zoekmachine vertellen dat onze URL de echte is — op
 * een site die net van ons weg gaat, precies het verkeerde signaal. Kennen we
 * het nieuwe adres, dan herschrijven we ze; kennen we het niet, dan gaan ze
 * eruit (een ontbrekende canonical is neutraal, een foute niet).
 */
export function schoonSeoVoorExport(html: string, leadId: string, nieuweBasis: string | null): string {
  if (!HOSTING_BASE) return html;
  const oud = `${HOSTING_BASE}/${leadId}/`;

  if (nieuweBasis) return html.split(oud).join(`${nieuweBasis.replace(/\/$/, "")}/`);

  return html
    .replace(/<link rel="canonical"[^>]*>/gi, "")
    .replace(/<meta property="og:url"[^>]*>/gi, "")
    .split(oud)
    .join("/");
}

/** Zonder endpoint toont de widget zelf "Dit formulier is nog niet gekoppeld."
 *  Dat is een eerlijker resultaat dan een knop die stil niets doet. */
export function ontkoppelEndpoints(html: string): string {
  return html.replace(/\s+data-endpoint="[^"]*"/gi, "");
}

function leesmij(bedrijfsnaam: string, overgeslagen: string[], nieuweBasis: string | null): string {
  return [
    `Statische export van de website van ${bedrijfsnaam}.`,
    "",
    "WAT ERIN ZIT",
    "- Alle pagina's als losse .html-bestanden. Ze linken onderling relatief,",
    "  dus je kan de map op elke webhost plaatsen (of lokaal openen).",
    "- De map bestanden/ met de documenten en afbeeldingen die aan de site",
    "  gekoppeld zijn.",
    nieuweBasis ? "- sitemap.xml en robots.txt, ingevuld voor " + nieuweBasis + "." : "",
    "",
    "WAT ER NIET IN ZIT, EN WAAROM",
    "De contactformulieren, de reviews, de tellers achter de downloads en de",
    "afgeschermde pagina's werkten op een server, niet in de pagina zelf. Die",
    "server hoort bij het dashboard waar deze site gemaakt is en gaat niet mee.",
    "Concreet:",
    "- Een formulier toont \"nog niet gekoppeld\" tot je host er zijn eigen",
    "  verwerking achter zet.",
    "- De reviewlijst blijft leeg; de goedgekeurde reviews stonden in onze",
    "  database.",
    overgeslagen.length
      ? "- Deze pagina's zijn NIET meegeleverd omdat ze met een toegangscode\n" +
        "  beveiligd waren: " +
        overgeslagen.join(", ") +
        ".\n" +
        "  Als los bestand zou die beveiliging er gewoon af zijn, en dat is een\n" +
        "  stillere fout dan ze weglaten. Vraag ze op als je ze nodig hebt."
      : "",
    "",
    nieuweBasis
      ? ""
      : "TIP: de canonical- en Open Graph-tags zijn verwijderd omdat het\n" +
        "definitieve adres nog niet bekend was. Laat je host ze opnieuw zetten\n" +
        "zodra de site op zijn eigen domein staat.",
  ]
    .filter((r) => r !== "")
    .join("\n");
}

export async function exporteerSite(
  leadId: string,
  bedrijfsnaam: string,
  /** Het domein waar de site komt te staan, als dat al bekend is. */
  nieuweBasis: string | null,
): Promise<string | null> {
  const supabase = createClient();

  const { data: versie } = await supabase
    .from("site_versions")
    .select("*")
    .eq("lead_id", leadId)
    .eq("status", "actief")
    .maybeSingle();

  if (!versie?.content_referentie) return "Deze lead heeft nog geen actieve versie om te exporteren.";
  const version = versie as SiteVersion;
  const referentie = version.content_referentie as string;

  const paginas: (PaginaMeta & { toegang?: "publiek" | "beveiligd" })[] = version.paginas?.length
    ? version.paginas
    : [{ bestand: "index.html", titel: bedrijfsnaam, nav_label: "Home" }];

  const map = referentie.replace(/\/index\.html$/, "");
  const invoer: ZipInvoer[] = [];
  const overgeslagen: string[] = [];
  const encoder = new TextEncoder();

  for (const pagina of paginas) {
    if (pagina.toegang === "beveiligd") {
      overgeslagen.push(pagina.bestand);
      continue;
    }

    const pad = version.paginas?.length ? `${map}/${pagina.bestand}` : referentie;
    const { data, error } = await supabase.storage.from("demos").download(pad);
    if (error || !data) return `Kon ${pagina.bestand} niet ophalen: ${error?.message}`;

    const html = ontkoppelEndpoints(schoonSeoVoorExport(await data.text(), leadId, nieuweBasis));
    invoer.push({ naam: pagina.bestand, data: encoder.encode(html) });
  }

  const { data: bestanden } = await supabase
    .from("site_bestanden")
    .select("bestandsnaam, opslag_pad")
    .eq("lead_id", leadId);

  for (const rij of (bestanden ?? []) as { bestandsnaam: string; opslag_pad: string }[]) {
    const { data } = await supabase.storage.from("demos").download(rij.opslag_pad);
    if (!data) continue; // Eén ontbrekend document mag de hele export niet tegenhouden.
    invoer.push({ naam: `bestanden/${rij.bestandsnaam}`, data: new Uint8Array(await data.arrayBuffer()) });
  }

  if (nieuweBasis) {
    const basis = nieuweBasis.replace(/\/$/, "");
    const urls = paginas
      .filter((p) => p.toegang !== "beveiligd")
      .map((p) => `<url><loc>${basis}/${p.bestand === "index.html" ? "" : p.bestand}</loc></url>`)
      .join("");
    invoer.push({
      naam: "sitemap.xml",
      data: encoder.encode(
        `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>`,
      ),
    });
    invoer.push({
      naam: "robots.txt",
      data: encoder.encode(`User-agent: *\nAllow: /\nSitemap: ${basis}/sitemap.xml\n`),
    });
  }

  invoer.push({
    naam: "LEESMIJ.txt",
    data: encoder.encode(leesmij(bedrijfsnaam, overgeslagen, nieuweBasis)),
  });

  const blob = maakZip(invoer);
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${bedrijfsnaam.replace(/[^\w-]+/g, "-").toLowerCase()}-site.zip`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);

  await logAudit("site_geexporteerd", leadId, { paginas: invoer.length, overgeslagen });
  return null;
}

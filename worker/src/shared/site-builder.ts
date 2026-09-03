// Multi-page site assembly (spec 3.3, uitgebreid van "één HTML-bestand" naar
// een echte meerpagina-site).
//
// Duplicated verbatim from supabase/functions/_shared/site-builder.ts — see
// the note in that file on why there is no shared module across the Deno/Node
// boundary. The two copies differ in exactly two places: this header, and the
// import specifiers below (.js here, .ts there). Everything else is
// byte-identical.

// Why the model doesn't just emit N finished HTML files: it can't be trusted to
// repeat a navigation bar and footer byte-for-byte across four pages, nor to
// mark the right link as active on each one, nor to keep every internal href
// pointing at a file that actually exists. So the model produces the *parts*
// (shared head, one nav, one footer, one body per page) and this module
// assembles the pages deterministically. Consistency of nav/footer is then a
// property of the code, not of the model's diligence, and internal links are
// resolved-or-rejected here before anything reaches Storage.

import { zoekBankAfbeelding } from "./image-bank.js";
import {
  WIDGET_PROMPT,
  WIDGET_RUNTIME,
  bouwConsentRuntime,
  controleerGeenEigenScripts,
  controleerWidgets,
  vulEndpointsIn,
  type WidgetProbleem,
} from "./site-widgets.js";

export type PaginaMeta = {
  /** File name inside the version folder, e.g. "over-ons.html". */
  bestand: string;
  /** <title> for this page (the company name is appended by the builder). */
  titel: string;
  /** Label shown in the shared navigation. */
  nav_label: string;
  /**
   * Parent page's `bestand`, for a subtopic under a chapter. Absent/null for a
   * top-level page. Exactly one level of nesting is allowed — see
   * controleerHierarchie for why.
   */
  ouder?: string | null;
  /**
   * "beveiligd" means track-and-serve only sends this page to a browser that
   * has presented the lead's access code. Absent = "publiek".
   */
  toegang?: "publiek" | "beveiligd";
  /**
   * Zoekmachine-omschrijving voor déze pagina. Door het model geschreven (het
   * is inhoud), maar in code afgekapt/aangevuld — zie valideerMetaOmschrijving.
   */
  meta_omschrijving?: string | null;
};

/** The model's output, parsed. This is what gets stored as `bron.json` next to
 *  the assembled pages so chat-edit can patch the nav/footer once instead of
 *  once per page. */
export type SiteBron = {
  paginas: PaginaMeta[];
  /** Extra <head> content: fonts, tailwind.config, custom <style>. */
  head: string;
  /** The shared navigation markup, used on every page. */
  nav: string;
  /** The shared footer markup, used on every page. */
  footer: string;
  /** bestand -> body markup (everything between nav and footer). */
  bodies: Record<string, string>;
};

export type GebouwdePagina = { bestand: string; titel: string; html: string };

export class SiteBuildError extends Error {}

const BESTAND_PATROON = /^[a-z0-9][a-z0-9-]*\.html$/;

// ─────────────────────────────────────────────────────────────────────────
// 1. Parsing the model's delimited output
// ─────────────────────────────────────────────────────────────────────────

const SECTIE_PATROON = /^===([A-Z]+)(?::([^=]+))?===[ \t]*$/;

/**
 * Parses the `===SECTIE===` format described in MULTIPAGE_PROMPT below.
 * Throws SiteBuildError (not a bare Error) so callers can tell a malformed
 * model answer apart from an infrastructure failure.
 */
export function parseSiteBron(raw: string): SiteBron {
  const lines = raw.replace(/\r\n/g, "\n").split("\n");
  const secties: { naam: string; arg: string | null; regels: string[] }[] = [];

  for (const line of lines) {
    const match = SECTIE_PATROON.exec(line.trim());
    if (match) {
      secties.push({ naam: match[1], arg: match[2]?.trim() ?? null, regels: [] });
      continue;
    }
    // Anything before the first marker (a stray sentence of prose ahead of the
    // output — the same failure mode research/index.ts guards against) is
    // discarded rather than fatal.
    if (secties.length > 0) secties[secties.length - 1].regels.push(line);
  }

  if (secties.length === 0) {
    throw new SiteBuildError("Generatie-output bevat geen enkele ===SECTIE===-marker.");
  }

  const inhoud = (naam: string): string | null => {
    const sectie = secties.find((s) => s.naam === naam && !s.arg);
    return sectie ? sectie.regels.join("\n").trim() : null;
  };

  const metaRaw = inhoud("META");
  if (!metaRaw) throw new SiteBuildError("Sectie ===META=== ontbreekt in de generatie-output.");

  let meta: { paginas?: unknown };
  try {
    // Same defensive substring-extraction as research/index.ts: models
    // sometimes wrap JSON in a code fence or add a lead-in sentence.
    const start = metaRaw.indexOf("{");
    const end = metaRaw.lastIndexOf("}");
    if (start === -1 || end === -1) throw new Error("geen JSON-object gevonden");
    meta = JSON.parse(metaRaw.slice(start, end + 1));
  } catch (err) {
    throw new SiteBuildError(`Kon ===META=== niet als JSON lezen: ${err instanceof Error ? err.message : err}`);
  }

  if (!Array.isArray(meta.paginas) || meta.paginas.length === 0) {
    throw new SiteBuildError("===META=== bevat geen niet-lege 'paginas'-lijst.");
  }

  const paginas: PaginaMeta[] = meta.paginas.map((p, i) => {
    const pagina = p as Partial<PaginaMeta>;
    if (!pagina?.bestand || !pagina.titel || !pagina.nav_label) {
      throw new SiteBuildError(`Pagina ${i + 1} in ===META=== mist bestand/titel/nav_label.`);
    }
    if (!BESTAND_PATROON.test(pagina.bestand)) {
      throw new SiteBuildError(
        `Ongeldige bestandsnaam "${pagina.bestand}" — enkel kleine letters, cijfers en koppeltekens, eindigend op .html.`,
      );
    }
    if (pagina.toegang && pagina.toegang !== "publiek" && pagina.toegang !== "beveiligd") {
      throw new SiteBuildError(
        `Pagina ${pagina.bestand} heeft toegang "${pagina.toegang}" — enkel "publiek" of "beveiligd".`,
      );
    }
    return {
      bestand: pagina.bestand,
      titel: pagina.titel,
      nav_label: pagina.nav_label,
      ouder: pagina.ouder ?? null,
      toegang: pagina.toegang ?? "publiek",
      meta_omschrijving: pagina.meta_omschrijving ?? null,
    };
  });

  // The home page is the entry point every outreach link lands on; gating it
  // would mean a lead clicking the mail gets a code prompt and nothing else.
  const beveiligdeHome = paginas.find((p) => p.bestand === "index.html" && p.toegang === "beveiligd");
  if (beveiligdeHome) {
    throw new SiteBuildError("index.html kan niet beveiligd zijn — dat is de pagina waar de e-maillink op uitkomt.");
  }

  controleerHierarchie(paginas);

  const nav = inhoud("NAV");
  const footer = inhoud("FOOTER");
  if (!nav) throw new SiteBuildError("Sectie ===NAV=== ontbreekt of is leeg.");
  if (!footer) throw new SiteBuildError("Sectie ===FOOTER=== ontbreekt of is leeg.");

  const bodies: Record<string, string> = {};
  for (const sectie of secties) {
    if (sectie.naam !== "PAGINA" || !sectie.arg) continue;
    bodies[sectie.arg] = sectie.regels.join("\n").trim();
  }

  for (const pagina of paginas) {
    if (!bodies[pagina.bestand]?.trim()) {
      throw new SiteBuildError(`Sectie ===PAGINA:${pagina.bestand}=== ontbreekt of is leeg.`);
    }
  }
  for (const bestand of Object.keys(bodies)) {
    if (!paginas.some((p) => p.bestand === bestand)) {
      throw new SiteBuildError(`===PAGINA:${bestand}=== staat niet in de paginalijst van ===META===.`);
    }
  }

  return { paginas, head: inhoud("HEAD") ?? "", nav, footer, bodies };
}

/**
 * Ruim genoeg voor een volledige site van 4-6 pagina's in één antwoord.
 * Vereist een STREAMENDE call: de SDK weigert een niet-streamende call die
 * ze boven de 10 minuten schat (3600 * max_tokens / 128000 > 600). Dat is
 * ook waarom er geen vervolg-call meer is — die hervatte vroeger vanaf een
 * assistant-prefill, en prefill wordt door de huidige modellen geweigerd.
 */
export const MAX_OUTPUT_TOKENS = 64000;

// ─────────────────────────────────────────────────────────────────────────
// 1b. Page hierarchy (hoofdstuk -> subonderwerp)
// ─────────────────────────────────────────────────────────────────────────

/**
 * Validates the parent/child tree. Exactly one level of nesting is allowed:
 * that's what a navigation submenu and a breadcrumb can represent honestly,
 * and it's the depth the content actually has (chapter -> subtopic, with tabs
 * handling variation *within* a subtopic). Allowing arbitrary depth would mean
 * a nav no visitor can operate and a builder that has to invent tree UI.
 */
export function controleerHierarchie(paginas: PaginaMeta[]): void {
  const perBestand = new Map(paginas.map((p) => [p.bestand, p]));

  for (const pagina of paginas) {
    if (!pagina.ouder) continue;

    if (pagina.bestand === "index.html") {
      throw new SiteBuildError("index.html is de startpagina en kan geen ouder hebben.");
    }
    if (pagina.ouder === pagina.bestand) {
      throw new SiteBuildError(`${pagina.bestand} verwijst naar zichzelf als ouder.`);
    }
    const ouder = perBestand.get(pagina.ouder);
    if (!ouder) {
      throw new SiteBuildError(
        `${pagina.bestand} heeft ouder "${pagina.ouder}", maar die pagina staat niet in de paginalijst.`,
      );
    }
    if (ouder.ouder) {
      throw new SiteBuildError(
        `${pagina.bestand} zit drie niveaus diep (${ouder.ouder} > ${ouder.bestand} > ${pagina.bestand}) — ` +
          `maximaal één niveau subpagina's is toegestaan; gebruik tabs binnen een pagina voor diepere opdeling.`,
      );
    }
  }
}

/** Direct children of a page, in the order they appear in the page list. */
export function kinderenVan(paginas: PaginaMeta[], bestand: string): PaginaMeta[] {
  return paginas.filter((p) => p.ouder === bestand);
}

// ─────────────────────────────────────────────────────────────────────────
// 2. Internal-link resolution
// ─────────────────────────────────────────────────────────────────────────

const EXTERN_PATROON = /^(https?:|mailto:|tel:|data:|javascript:|\/\/)/i;

/** Uploaded downloads live beside the pages in the version folder. They're
 *  internal links but not page links, so page resolution has to leave them
 *  alone — they get their own existence check in bouwSite. */
export const BESTANDEN_MAP = "bestanden";
const BESTAND_LINK_PATROON = new RegExp(`^\\.?/?${BESTANDEN_MAP}/(.+)$`, "i");

function slug(waarde: string): string {
  return waarde
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\.html$/, "")
    .replace(/[^a-z0-9]/g, "");
}

/**
 * Maps whatever the model wrote in an href onto a real page file.
 * Returns null for links that aren't internal page links (external, anchors,
 * empty) and undefined for internal links that don't resolve to any page.
 */
function resolveHref(href: string, paginas: PaginaMeta[]): string | null | undefined {
  const trimmed = href.trim();
  if (!trimmed || trimmed === "#" || trimmed.startsWith("#")) return null;
  if (EXTERN_PATROON.test(trimmed)) return null;
  if (BESTAND_LINK_PATROON.test(trimmed)) return null;

  const hashIndex = trimmed.indexOf("#");
  const hash = hashIndex === -1 ? "" : trimmed.slice(hashIndex);
  let pad = (hashIndex === -1 ? trimmed : trimmed.slice(0, hashIndex)).split("?")[0];

  pad = pad.replace(/^\.\//, "").replace(/^\//, "");
  if (pad === "" || pad === "." || pad === "index") pad = "index.html";

  const doel = slug(pad);
  const match = paginas.find((p) => slug(p.bestand) === doel);
  if (!match) return undefined;
  return `${match.bestand}${hash}`;
}

const ANKER_PATROON = /<a\b[^>]*>/gi;
const HREF_PATROON = /\bhref\s*=\s*("([^"]*)"|'([^']*)')/i;

function hrefVan(tag: string): string | null {
  const match = HREF_PATROON.exec(tag);
  if (!match) return null;
  return match[2] ?? match[3] ?? "";
}

/**
 * Rewrites every internal href in `html` to the canonical page file name, and
 * collects the ones that point at a page that doesn't exist. Callers treat a
 * non-empty `kapot` as a hard failure — a demo sent to a lead must not have a
 * dead link in it, and a silent rewrite-to-home would hide the problem instead
 * of surfacing it.
 */
export function herschrijfLinks(
  html: string,
  paginas: PaginaMeta[],
): { html: string; kapot: string[] } {
  const kapot: string[] = [];
  const herschreven = html.replace(ANKER_PATROON, (tag) => {
    const href = hrefVan(tag);
    if (href === null) return tag;
    const doel = resolveHref(href, paginas);
    if (doel === null) return tag;
    if (doel === undefined) {
      kapot.push(href);
      return tag;
    }
    return tag.replace(HREF_PATROON, (_m, _q, dq, sq) => {
      const quote = dq !== undefined ? '"' : "'";
      return `href=${quote}${doel}${quote}`;
    });
  });
  return { html: herschreven, kapot };
}

// ─────────────────────────────────────────────────────────────────────────
// 3. Active-page marking in the shared navigation
// ─────────────────────────────────────────────────────────────────────────

const ACTIEF_ATTR_PATROON = /\bdata-nav-actief\s*=\s*("([^"]*)"|'([^']*)')/i;
const CLASS_PATROON = /\bclass\s*=\s*("([^"]*)"|'([^']*)')/i;

// Always injected, so "which page am I on" is visible even when the model
// forgets data-nav-actief on a link. Model-supplied classes layer on top.
const ACTIEF_STIJL = `<style>
  [aria-current="page"] { font-weight: 700; }
  nav [aria-current="page"], header [aria-current="page"] {
    text-decoration: underline;
    text-decoration-thickness: 2px;
    text-underline-offset: 6px;
  }
  /* Ancestor of the current page (the chapter a subtopic sits under): shown
     as the active section, but deliberately weaker than the page itself. */
  nav [aria-current="true"], header [aria-current="true"] { font-weight: 600; }
  [data-kruimelpad] { font-size: 0.875rem; }
  [data-kruimelpad] ol { display: flex; flex-wrap: wrap; gap: 0.5rem; list-style: none; margin: 0; padding: 0; }
  [data-kruimelpad] li + li::before { content: "/"; margin-right: 0.5rem; opacity: 0.5; }
</style>`;

/**
 * Returns the shared nav markup with the link(s) to `huidigBestand` marked as
 * the current page: `aria-current="page"` (the accessible signal, and what
 * ACTIEF_STIJL hooks into) plus the visual classes that link declared in
 * `data-nav-actief`.
 *
 * `data-nav-actief` is what identifies an anchor as a navigation link at all,
 * not just where its active classes come from. A real header holds more
 * anchors than menu items — the logo wrapping back to index.html, an
 * "offerte aanvragen" button pointing at contact.html — and marking those as
 * the current page underlines the logo and lights up a call-to-action for no
 * reason. Matching on the attribute skips exactly those.
 *
 * More than one hit is normal and correct: a header with a desktop menu and a
 * separate mobile menu has two links per page, and both are the current page.
 */
export function markeerActievePagina(
  nav: string,
  huidigBestand: string,
  ouderBestand?: string | null,
): { html: string; gemarkeerd: number } {
  let gemarkeerd = 0;
  const html = nav.replace(ANKER_PATROON, (tag) => {
    const href = hrefVan(tag);
    if (href === null) return tag;
    const doel = href.split("#")[0] || "index.html";
    // A subtopic often isn't a nav item itself — its chapter is. Marking the
    // chapter tells the visitor where they are instead of leaving the whole
    // menu looking inactive.
    const soort = doel === huidigBestand ? "page" : ouderBestand && doel === ouderBestand ? "true" : null;
    if (!soort) return tag;

    const actiefMatch = ACTIEF_ATTR_PATROON.exec(tag);
    if (!actiefMatch) return tag;
    if (/\baria-current\s*=/i.test(tag)) {
      gemarkeerd++;
      return tag;
    }

    gemarkeerd++;
    // Only the page itself takes the model's active styling; the ancestor
    // gets the marker alone, so a chapter never looks like the open page.
    const extraKlassen = soort === "page" ? (actiefMatch[2] ?? actiefMatch[3] ?? "").trim() : "";

    let resultaat = tag;
    if (extraKlassen) {
      const classMatch = CLASS_PATROON.exec(resultaat);
      if (classMatch) {
        const huidig = classMatch[2] ?? classMatch[3] ?? "";
        const quote = classMatch[2] !== undefined ? '"' : "'";
        resultaat = resultaat.replace(CLASS_PATROON, `class=${quote}${huidig} ${extraKlassen}${quote}`);
      } else {
        resultaat = resultaat.replace(/^<a\b/i, `<a class="${extraKlassen}"`);
      }
    }
    return resultaat.replace(/^<a\b/i, `<a aria-current="${soort}"`);
  });

  return { html, gemarkeerd };
}

// ─────────────────────────────────────────────────────────────────────────
// 4. Assembly
// ─────────────────────────────────────────────────────────────────────────

/**
 * Builds the breadcrumb for a page. Generated here rather than written by the
 * model for the same reason the nav is: the trail has to agree with the actual
 * page tree on every page, and a hand-written one drifts the moment a page is
 * renamed. Emitted with schema.org microdata so search engines read the
 * hierarchy the site actually has.
 */
export function bouwKruimelpad(pagina: PaginaMeta, paginas: PaginaMeta[]): string {
  if (pagina.bestand === "index.html") return "";

  const trail: PaginaMeta[] = [];
  const home = paginas.find((p) => p.bestand === "index.html");
  if (home) trail.push(home);
  if (pagina.ouder) {
    const ouder = paginas.find((p) => p.bestand === pagina.ouder);
    if (ouder) trail.push(ouder);
  }
  trail.push(pagina);

  const items = trail.map((stap, i) => {
    const laatste = i === trail.length - 1;
    const label = escapeHtml(stap.nav_label);
    const inhoud = laatste
      ? `<span itemprop="name" aria-current="page">${label}</span>`
      : `<a itemprop="item" href="${stap.bestand}"><span itemprop="name">${label}</span></a>`;
    return (
      `<li itemprop="itemListElement" itemscope itemtype="https://schema.org/ListItem">` +
      `${inhoud}<meta itemprop="position" content="${i + 1}"></li>`
    );
  });

  return (
    `<nav data-kruimelpad aria-label="Kruimelpad" class="mx-auto max-w-6xl px-6 py-3">` +
    `<ol itemscope itemtype="https://schema.org/BreadcrumbList">${items.join("")}</ol></nav>`
  );
}

function escapeHtml(waarde: string): string {
  return waarde
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Assembles the full set of standalone HTML files from a parsed SiteBron.
 * Every page gets the exact same head, nav and footer strings — that identity
 * is what makes requirement "consistent nav/footer" hold by construction.
 */
export type BouwOpties = {
  /** Names of the files uploaded for this lead, e.g. ["brochure.pdf"]. A
   *  download link to anything not in this list fails the build — the same
   *  rule as page links, for the same reason. Undefined = don't check (a
   *  caller that doesn't know the file list yet). */
  bestanden?: string[];
  /**
   * Alles wat nodig is voor canonical/Open Graph/LocalBusiness. Ontbreekt dit
   * blok (geen DEMO_HOSTING_URL, of een testscript dat enkel de markup wil),
   * dan worden die tags gewoon weggelaten — nooit een half ingevulde URL.
   */
  seo?: SeoGegevens;
  /**
   * Bezoekersstatistieken. Ontbreekt dit blok, dan komt er geen meetscript op
   * de site en dus ook geen cookiemelding — er valt dan niets te vragen. Zie
   * bouwConsentRuntime in site-widgets.ts voor die afweging.
   */
  analytics?: AnalyticsGegevens;
};

export type AnalyticsGegevens = {
  /** Volledige URL van het meetscript, bv. "https://plausible.io/js/script.js". */
  scriptUrl: string;
};

export type SeoGegevens = {
  leadId: string;
  /** Basis-URL zonder slash op het einde, bv. "https://sites.yudexstudios.com". */
  hostingBase: string;
  sector: string;
  adres?: string | null;
  telefoon?: string | null;
  ogAfbeelding?: string | null;
};

/** Google kapt rond 160 tekens af; langer is niet fout, maar wel zinloos. */
const MAX_META_OMSCHRIJVING = 160;

/**
 * De omschrijving is inhoud, dus door het model geschreven — maar een
 * ontbrekende of veel te lange omschrijving mag geen generatie laten falen.
 * Vandaar afkappen op een woordgrens en anders terugvallen op titel + naam.
 */
export function valideerMetaOmschrijving(ruw: string | null | undefined, titel: string, bedrijfsnaam: string): string {
  const schoon = (ruw ?? "").replace(/\s+/g, " ").trim();
  if (!schoon) return `${titel} — ${bedrijfsnaam}`;
  if (schoon.length <= MAX_META_OMSCHRIJVING) return schoon;

  const geknipt = schoon.slice(0, MAX_META_OMSCHRIJVING - 3);
  const spatie = geknipt.lastIndexOf(" ");
  return `${(spatie > 0 ? geknipt.slice(0, spatie) : geknipt).trimEnd()}...`;
}

/**
 * schema.org-type per sector. Een specifieker type dan LocalBusiness zegt een
 * zoekmachine méér, maar enkel als het klopt — bij twijfel het algemene type.
 */
const LOCAL_BUSINESS_TYPES: { trefwoorden: string[]; type: string }[] = [
  { trefwoorden: ["bloem", "florist"], type: "Florist" },
  { trefwoorden: ["restaurant", "bistro", "brasserie", "eetcafé", "eethuis", "frituur", "afhaal"], type: "Restaurant" },
  { trefwoorden: ["café", "cafe", "bar"], type: "BarOrPub" },
  { trefwoorden: ["bakker"], type: "Bakery" },
  { trefwoorden: ["slager"], type: "Store" },
  { trefwoorden: ["kapper", "kapsalon", "barbier", "schoonheid"], type: "HealthAndBeautyBusiness" },
  { trefwoorden: ["tuin", "hovenier", "groenaanleg", "landscap"], type: "HomeAndConstructionBusiness" },
  { trefwoorden: ["bouw", "aannemer", "renovatie", "dakwerk", "schrijnwerk", "installatie"], type: "HomeAndConstructionBusiness" },
  { trefwoorden: ["advocaat", "boekhoud", "consult", "advies", "makelaar", "verzekering"], type: "ProfessionalService" },
];

/**
 * Gestructureerde bedrijfsgegevens, in code opgebouwd. Bewust niet door het
 * model geschreven: JSON-LD moet syntactisch exact zijn, en een verzonnen veld
 * is hier hetzelfde soort fout als een verzonnen Unsplash-ID.
 */
export function bouwLocalBusinessJsonLd(gegevens: {
  bedrijfsnaam: string;
  sector: string;
  url: string;
  adres?: string | null;
  telefoon?: string | null;
  afbeelding?: string | null;
}): string {
  const sector = gegevens.sector.toLowerCase();
  const type =
    LOCAL_BUSINESS_TYPES.find((t) => t.trefwoorden.some((k) => sector.includes(k)))?.type ?? "LocalBusiness";

  const data: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": type,
    name: gegevens.bedrijfsnaam,
    url: gegevens.url,
  };
  // Het leads-schema heeft één vrij tekstveld voor het adres, geen aparte
  // straat/postcode/gemeente — dus een string, geen PostalAddress-object.
  if (gegevens.adres) data.address = gegevens.adres;
  if (gegevens.telefoon) data.telephone = gegevens.telefoon;
  if (gegevens.afbeelding) data.image = gegevens.afbeelding;

  return `<script type="application/ld+json">${JSON.stringify(data)}</script>`;
}

/**
 * `basisUrl` is de map waarin de pagina's staan, zonder slash op het einde —
 * "https://sites.example.be/{leadId}" op de functie-URL, of gewoon
 * "https://klant.be" zodra de site op een eigen domein draait. Bewust die ene
 * parameter in plaats van leadId + hostingBase: op een eigen domein zit er
 * geen lead-id in het pad, en een sitemap die naar de andere URL wijst
 * vertelt een zoekmachine dat de verkeerde adressen de echte zijn.
 *
 * Beveiligde pagina's blijven eruit: een crawler raakt er toch niet in.
 */
export function bouwSitemap(
  paginas: { bestand: string; toegang?: "publiek" | "beveiligd" }[],
  basisUrl: string,
): string {
  const basis = basisUrl.replace(/\/$/, "");
  const urls = paginas
    .filter((p) => p.toegang !== "beveiligd")
    // De home staat op de map-URL, niet op /index.html: dat is ook wat de
    // canonical in de pagina zelf zegt, en die twee moeten hetzelfde adres
    // aanwijzen — anders wijst de sitemap een URL aan die zichzelf afwijst.
    .map((p) => `<url><loc>${escapeHtml(p.bestand === "index.html" ? `${basis}/` : `${basis}/${p.bestand}`)}</loc></url>`)
    .join("");
  return `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>`;
}

export function bouwRobotsTxt(basisUrl: string): string {
  return `User-agent: *\nAllow: /\nSitemap: ${basisUrl.replace(/\/$/, "")}/sitemap.xml\n`;
}

/**
 * Vult een ontbrekende alt-tekst aan met de omschrijving uit de
 * afbeeldingenbank. Draait vóór controleerAltTeksten, zodat het model niet
 * gestraft wordt omdat het een bankfoto gebruikte zonder de omschrijving
 * over te typen — alleen écht onbeschreven beeld blijft over.
 */
export function vulAltTeksten(html: string): string {
  return html.replace(/<img\b[^>]*>/gi, (tag) => {
    if (/\balt\s*=/i.test(tag)) return tag;

    const src = /\bsrc\s*=\s*("([^"]*)"|'([^']*)')/i.exec(tag);
    const url = src?.[2] ?? src?.[3] ?? "";
    const bank = url ? zoekBankAfbeelding(url) : null;
    if (!bank) return tag;

    return tag.replace(/\s*(\/?)>$/, ` alt="${escapeHtml(bank.omschrijving)}"$1>`);
  });
}

/**
 * Een afbeelding zonder alt is onleesbaar voor een schermlezer en onzichtbaar
 * voor een zoekmachine. Even hard als een dode link, en om dezelfde reden:
 * het valt niet op in een screenshot.
 */
export function controleerAltTeksten(bestand: string, html: string): WidgetProbleem[] {
  const problemen: WidgetProbleem[] = [];
  for (const tag of html.match(/<img\b[^>]*>/gi) ?? []) {
    if (!/\balt\s*=/i.test(tag)) {
      problemen.push({ bestand, widget: "img", reden: `ontbrekend alt-attribuut op ${tag.slice(0, 80)}` });
    }
  }
  return problemen;
}

/**
 * Makes every <img> load the way it should, in code rather than by asking the
 * model nicely.
 *
 * Three things, all of which the model got wrong or left out often enough to
 * be worth guaranteeing:
 *
 * 1. `auto=format` on Unsplash URLs. That is what actually delivers WebP/AVIF
 *    — imgix negotiates on the Accept header, so a modern browser gets WebP
 *    and an old one still gets JPEG. Serving WebP is therefore not a matter of
 *    storing different files; it is one query parameter, and the risk is a
 *    hand-written URL that drops it.
 * 2. `loading="lazy"` on everything except the first image. Lazy-loading the
 *    image at the top of the page delays the very thing the visitor is waiting
 *    for, so the first one is eager and high priority instead; a services page
 *    with a dozen photos loads one, not twelve.
 * 3. `decoding="async"`, so decoding a large photo doesn't block the rest.
 *
 * An explicit attribute the model wrote is always left alone — this fills gaps,
 * it doesn't overrule a deliberate choice.
 */
export function optimaliseerAfbeeldingen(html: string): string {
  let eerste = true;

  return html.replace(/<img\b[^>]*>/gi, (tag) => {
    let uit = tag;

    uit = uit.replace(
      /(\bsrc\s*=\s*)("([^"]*)"|'([^']*)')/i,
      (heel, aanloop: string, _geheel: string, dubbel: string, enkel: string) => {
        const url = dubbel ?? enkel ?? "";
        if (!url.includes("images.unsplash.com") || /[?&]auto=/.test(url)) return heel;
        return `${aanloop}"${url}${url.includes("?") ? "&" : "?"}auto=format"`;
      },
    );

    const heeftLoading = /\bloading\s*=/i.test(uit);
    const heeftDecoding = /\bdecoding\s*=/i.test(uit);
    const heeftPrioriteit = /\bfetchpriority\s*=/i.test(uit);

    const toevoegen: string[] = [];
    if (!heeftLoading) toevoegen.push(eerste ? 'loading="eager"' : 'loading="lazy"');
    if (eerste && !heeftPrioriteit) toevoegen.push('fetchpriority="high"');
    if (!heeftDecoding) toevoegen.push('decoding="async"');
    eerste = false;

    if (!toevoegen.length) return uit;
    // Insert before the tag's own closing bracket, keeping a self-closing
    // slash where the model used one.
    return uit.replace(/\s*(\/?)>$/, ` ${toevoegen.join(" ")}$1>`);
  });
}

/**
 * De privacypagina staat op elke gegenereerde site, en wordt hier door de code
 * geschreven in plaats van door het model.
 *
 * Waarom niet door het model: dit is geen inhoudskeuze. Het is een opsomming
 * van wat de site feitelijk doet — welke formulieren erop staan, of er gemeten
 * wordt, of er een toegangscode is — en dat weet de code exact en het model
 * enkel bij benadering. Een model dat een bewaartermijn verzint of een
 * formulier vergeet te vermelden, levert een tekst op die er juridisch uitziet
 * en feitelijk niet klopt. Dat is erger dan geen tekst.
 *
 * Om dezelfde reden staat de pagina bewust niet in `bron.paginas`: daardoor
 * komt ze nooit in bron.json, en dus ook niet in de virtuele bestandenlijst die
 * chat-edit aan het model toont. Ze kan niet per ongeluk weggevraagd worden.
 *
 * LET OP voor wie dit onderhoudt: dit is een feitelijke basistekst, geen
 * juridisch advies. Ze beschrijft correct wat deze sites doen; of dat volstaat
 * voor een specifieke klant (bv. een medische praktijk) hoort een mens na te
 * kijken.
 */
export const PRIVACY_BESTAND = "privacybeleid.html";

export type PrivacyGegevens = {
  bedrijfsnaam: string;
  adres?: string | null;
  telefoon?: string | null;
  /** Staat er ergens een contactformulier op de site? */
  heeftFormulier: boolean;
  /** Kunnen bezoekers zelf een review achterlaten? */
  heeftReviews: boolean;
  /** Zit er een pagina achter een toegangscode? */
  heeftBeveiligdePagina: boolean;
  /** Worden er bezoekcijfers gemeten (na toestemming)? */
  heeftStatistieken: boolean;
};

function bouwPrivacyBody(g: PrivacyGegevens): string {
  const naam = escapeHtml(g.bedrijfsnaam);
  const regels: string[] = [];

  const kop = (tekst: string) => `<h2 class="mt-10 text-xl font-semibold">${tekst}</h2>`;
  const tekst = (inhoud: string) => `<p class="mt-3 leading-relaxed">${inhoud}</p>`;

  regels.push(`<h1 class="text-3xl font-bold">Privacybeleid</h1>`);
  regels.push(
    tekst(
      `Deze pagina legt uit welke gegevens ${naam} via deze website verzamelt, waarom dat ` +
        `gebeurt en wat je eraan kan doen.`,
    ),
  );

  regels.push(kop("Wie verwerkt je gegevens"));
  const contactRegels = [`<strong>${naam}</strong>`];
  if (g.adres) contactRegels.push(escapeHtml(g.adres));
  if (g.telefoon) contactRegels.push(escapeHtml(g.telefoon));
  regels.push(tekst(contactRegels.join("<br>")));

  regels.push(kop("Welke gegevens, en waarvoor"));
  const punten: string[] = [];
  if (g.heeftFormulier) {
    punten.push(
      `<strong>Wat je in een formulier invult</strong> — je naam, je e-mailadres en je bericht. ` +
        `Die gebruiken we alleen om je vraag te beantwoorden, niet om je later ongevraagd te mailen.`,
    );
  }
  if (g.heeftReviews) {
    punten.push(
      `<strong>Een review die je zelf achterlaat</strong> — de naam en de tekst die je invult. ` +
        `Een review verschijnt pas op de site nadat wij ze hebben nagelezen.`,
    );
  }
  if (g.heeftBeveiligdePagina) {
    punten.push(
      `<strong>De toegangscode van een afgeschermde pagina</strong> — als je die invult, onthoudt ` +
        `je browser dat je ze had, zodat je ze niet elke keer opnieuw moet typen. Daar hoort geen ` +
        `naam of e-mailadres bij.`,
    );
  }
  if (g.heeftStatistieken) {
    punten.push(
      `<strong>Anonieme bezoekcijfers</strong> — hoeveel mensen welke pagina bekijken, en alleen ` +
        `als je daar toestemming voor geeft. Er wordt geen profiel van je gemaakt en je wordt niet ` +
        `over andere websites gevolgd.`,
    );
  }
  if (!punten.length) {
    regels.push(
      tekst(
        `Deze website verzamelt uit zichzelf geen persoonsgegevens. Er staat geen formulier op en ` +
          `er wordt niets gemeten.`,
      ),
    );
  } else {
    regels.push(
      `<ul class="mt-3 list-disc space-y-2 pl-5 leading-relaxed">` +
        punten.map((p) => `<li>${p}</li>`).join("") +
        `</ul>`,
    );
  }

  regels.push(kop("Hoe lang we het bijhouden"));
  regels.push(
    tekst(
      g.heeftFormulier || g.heeftReviews
        ? `Berichten en reviews houden we bij zolang ze nuttig zijn voor het contact waar ze uit ` +
            `voortkomen. Vraag je ons om ze te verwijderen, dan doen we dat.`
        : `Er worden geen persoonsgegevens bewaard.`,
    ),
  );

  regels.push(kop("Wie het nog te zien krijgt"));
  regels.push(
    tekst(
      `We verkopen je gegevens niet en we geven ze niet door voor reclame. Ze staan op de servers ` +
        `van de partijen die deze website hosten, en die mogen ze alleen gebruiken om die website ` +
        `te laten werken.`,
    ),
  );

  regels.push(kop("Cookies"));
  regels.push(
    tekst(
      g.heeftStatistieken
        ? `Deze site plaatst geen advertentiecookies. We onthouden in je browser alleen je keuze ` +
            `over de bezoekcijfers hierboven, zodat we het niet telkens opnieuw vragen. Je kan die ` +
            `keuze hieronder wijzigen.`
        : `Deze site plaatst geen advertentie- of trackingcookies.`,
    ),
  );
  if (g.heeftStatistieken) {
    regels.push(
      `<p class="mt-4"><button type="button" data-consent-herzien ` +
        `class="rounded-lg border border-current px-4 py-2 text-sm font-medium">` +
        `Cookiekeuze wijzigen</button></p>`,
    );
  }

  regels.push(kop("Je rechten"));
  regels.push(
    tekst(
      `Je mag altijd vragen welke gegevens we van je hebben, ze laten verbeteren of ze laten ` +
        `verwijderen. Een bericht via de contactgegevens hierboven volstaat. Ben je niet tevreden ` +
        `met wat we ermee doen, dan kan je klacht indienen bij de Gegevensbeschermingsautoriteit ` +
        `(<a class="underline" href="https://www.gegevensbeschermingsautoriteit.be" rel="noopener" ` +
        `target="_blank">gegevensbeschermingsautoriteit.be</a>).`,
    ),
  );

  return `<main class="mx-auto max-w-3xl px-6 py-16">${regels.join("\n")}</main>`;
}

export function bouwSite(
  bron: SiteBron,
  bedrijfsnaam: string,
  opties: BouwOpties = {},
): GebouwdePagina[] {
  const { bestanden, seo, analytics } = opties;
  if (!bron.paginas.some((p) => p.bestand === "index.html")) {
    throw new SiteBuildError("De site heeft geen index.html — dat is verplicht als startpagina.");
  }

  const bestandsnamen = bron.paginas.map((p) => p.bestand);
  const duplicaten = bestandsnamen.filter((b, i) => bestandsnamen.indexOf(b) !== i);
  if (duplicaten.length) {
    throw new SiteBuildError(`Dubbele bestandsnaam in de paginalijst: ${[...new Set(duplicaten)].join(", ")}.`);
  }

  const navResultaat = herschrijfLinks(bron.nav, bron.paginas);
  const footerResultaat = herschrijfLinks(bron.footer, bron.paginas);
  navResultaat.html = vulAltTeksten(navResultaat.html);
  footerResultaat.html = vulAltTeksten(footerResultaat.html);

  // Every page must be reachable from the shared nav — a generated file no
  // link points at is exactly the "losse HTML-bestanden die niet naar elkaar
  // verwijzen" failure this whole module exists to prevent.
  const navDoelen = new Set<string>();
  for (const tag of navResultaat.html.match(ANKER_PATROON) ?? []) {
    const href = hrefVan(tag);
    if (href !== null && !EXTERN_PATROON.test(href.trim()) && !href.trim().startsWith("#")) {
      navDoelen.add(href.split("#")[0]);
    }
  }
  // Top-level pages must be in the nav. Subtopics may instead be reached from
  // their own chapter page — a nav listing every subtopic is unusable, and a
  // chapter that doesn't link its own subtopics is the broken case.
  const kapot = [...navResultaat.kapot, ...footerResultaat.kapot];
  const bodies: Record<string, string> = {};
  for (const pagina of bron.paginas) {
    const resultaat = herschrijfLinks(bron.bodies[pagina.bestand] ?? "", bron.paginas);
    bodies[pagina.bestand] = vulAltTeksten(resultaat.html);
    kapot.push(...resultaat.kapot);
  }

  const onbereikbaar = bron.paginas.filter((p) => {
    if (navDoelen.has(p.bestand)) return false;
    if (!p.ouder) return true;
    return !(bodies[p.ouder] ?? "").includes(`href="${p.bestand}"`);
  });
  if (onbereikbaar.length) {
    throw new SiteBuildError(
      `Niet bereikbaar: ${onbereikbaar.map((p) => p.bestand).join(", ")} — een hoofdpagina moet in de ` +
        `navigatiebalk staan, een subpagina in de navigatie of op zijn ouderpagina.`,
    );
  }

  if (kapot.length) {
    throw new SiteBuildError(
      `Dode interne links naar niet-bestaande pagina's: ${[...new Set(kapot)].join(", ")}. ` +
        `Beschikbare pagina's: ${bestandsnamen.join(", ")}.`,
    );
  }

  // Download links point at files the user uploaded for this lead, not at
  // pages — so they skip page resolution above and get checked here instead.
  if (bestanden) {
    const gevraagd = new Set<string>();
    for (const html of [navResultaat.html, footerResultaat.html, ...Object.values(bodies)]) {
      const verwijzingen = [
        ...(html.match(ANKER_PATROON) ?? []).map(hrefVan),
        // <img src="bestanden/logo.jpg"> is the same promise as a download
        // link and breaks just as visibly, so it gets the same check.
        ...[...html.matchAll(/<img\b[^>]*\bsrc\s*=\s*("([^"]*)"|'([^']*)')/gi)].map((m) => m[2] ?? m[3] ?? ""),
      ];
      for (const verwijzing of verwijzingen) {
        const match = verwijzing === null ? null : BESTAND_LINK_PATROON.exec(verwijzing.trim());
        if (match) gevraagd.add(decodeURIComponent(match[1].split("?")[0]));
      }
    }
    const ontbrekend = [...gevraagd].filter((naam) => !bestanden.includes(naam));
    if (ontbrekend.length) {
      throw new SiteBuildError(
        `Links naar niet-bestaande downloads: ${ontbrekend.join(", ")}. ` +
          `Beschikbare bestanden: ${bestanden.length ? bestanden.join(", ") : "(geen)"}.`,
      );
    }
  }

  // Widgets are checked against their markup contract here, for the same
  // reason links are: a tabs block whose buttons point at panels that don't
  // exist looks perfectly fine in a screenshot and is dead on click.
  const problemen: WidgetProbleem[] = [
    ...controleerGeenEigenScripts("HEAD", bron.head, true),
    ...controleerGeenEigenScripts("NAV", navResultaat.html, false),
    ...controleerGeenEigenScripts("FOOTER", footerResultaat.html, false),
    ...controleerWidgets("NAV", navResultaat.html),
    ...controleerWidgets("FOOTER", footerResultaat.html),
    ...controleerAltTeksten("NAV", navResultaat.html),
    ...controleerAltTeksten("FOOTER", footerResultaat.html),
  ];
  for (const pagina of bron.paginas) {
    problemen.push(
      ...controleerGeenEigenScripts(pagina.bestand, bodies[pagina.bestand], false),
      ...controleerWidgets(pagina.bestand, bodies[pagina.bestand]),
      ...controleerAltTeksten(pagina.bestand, bodies[pagina.bestand]),
    );
  }
  if (problemen.length) {
    throw new SiteBuildError(
      "Problemen met interactieve blokken:\n" +
        problemen.map((p) => `- [${p.bestand}] ${p.widget}: ${p.reden}`).join("\n"),
    );
  }

  // Vanaf hier is het model klaar en neemt de code over. De cookiemelding en de
  // privacylink worden ná alle controles hierboven toegevoegd, met opzet: ze
  // horen niet tot wat het model schreef, dus ze mogen ook niet meetellen in
  // wat het model verweten wordt. Het is dezelfde volgorde als WIDGET_RUNTIME.
  const consentRuntime = analytics ? bouwConsentRuntime(analytics.scriptUrl) : "";

  // Schreef het model zelf al een privacypagina, dan is die van hem: die staat
  // netjes in de nav en in bron.paginas, en er twee hebben is verwarrender dan
  // er één die niet van ons is.
  const eigenPrivacyPagina = bron.paginas.some((p) => p.bestand === PRIVACY_BESTAND);
  const alleBodies = Object.values(bodies).join("\n");
  const privacy: PrivacyGegevens = {
    bedrijfsnaam,
    adres: seo?.adres,
    telefoon: seo?.telefoon,
    heeftFormulier: /data-widget\s*=\s*"formulier"/i.test(alleBodies),
    heeftReviews: /data-widget\s*=\s*"reviews"/i.test(alleBodies),
    heeftBeveiligdePagina: bron.paginas.some((p) => p.toegang === "beveiligd"),
    heeftStatistieken: !!analytics,
  };

  if (!eigenPrivacyPagina) {
    // In de footer, niet in de nav: een juridische pagina hoort daar volgens
    // gewoonte thuis, en de bereikbaarheidscontrole hierboven kijkt enkel naar
    // de nav én enkel naar bron.paginas — die ziet deze pagina dus nooit.
    //
    // Binnen de laatste </footer> en niet erachter: erachter plakken geeft een
    // link die los in de <body> hangt. Dat ziet er in een screenshot identiek
    // uit — het staat onderaan — maar het is geen footerinhoud meer, en dat is
    // precies het soort verschil dat de review-loop nooit kan zien.
    const link =
      `<p class="mx-auto max-w-3xl px-6 pb-6 text-center text-xs opacity-70">` +
      `<a href="${PRIVACY_BESTAND}">Privacybeleid</a></p>`;
    const sluit = footerResultaat.html.lastIndexOf("</footer>");
    footerResultaat.html =
      sluit === -1
        ? `${footerResultaat.html}\n${link}`
        : `${footerResultaat.html.slice(0, sluit)}${link}\n${footerResultaat.html.slice(sluit)}`;
  }

  const gebouwdePaginas = bron.paginas.map((pagina) => {
    const nav = markeerActievePagina(navResultaat.html, pagina.bestand, pagina.ouder);
    if (nav.gemarkeerd === 0) {
      throw new SiteBuildError(
        `Geen navigatielink met data-nav-actief voor ${pagina.bestand}${pagina.ouder ? ` of zijn ouder ${pagina.ouder}` : ""} — ` +
          `zonder dat attribuut kan de actieve pagina niet gemarkeerd worden.`,
      );
    }

    const omschrijving = valideerMetaOmschrijving(pagina.meta_omschrijving, pagina.titel, bedrijfsnaam);
    const paginaUrl = seo
      ? pagina.bestand === "index.html"
        ? `${seo.hostingBase}/${seo.leadId}/`
        : `${seo.hostingBase}/${seo.leadId}/${pagina.bestand}`
      : null;

    // Canonical/OG/JSON-LD worden hier door de code gezet, niet door het
    // model: het zijn geen inhoudskeuzes maar exacte, machineleesbare velden.
    const seoTags = paginaUrl
      ? [
          `<link rel="canonical" href="${escapeHtml(paginaUrl)}">`,
          `<meta property="og:type" content="website">`,
          `<meta property="og:title" content="${escapeHtml(`${pagina.titel} — ${bedrijfsnaam}`)}">`,
          `<meta property="og:description" content="${escapeHtml(omschrijving)}">`,
          `<meta property="og:url" content="${escapeHtml(paginaUrl)}">`,
          seo?.ogAfbeelding ? `<meta property="og:image" content="${escapeHtml(seo.ogAfbeelding)}">` : "",
        ].filter(Boolean)
      : [];

    // Enkel op de home: het bedrijf bestaat één keer, niet één keer per pagina.
    const jsonLd =
      seo && pagina.bestand === "index.html"
        ? bouwLocalBusinessJsonLd({
            bedrijfsnaam,
            sector: seo.sector,
            url: `${seo.hostingBase}/${seo.leadId}/`,
            adres: seo.adres,
            telefoon: seo.telefoon,
            afbeelding: seo.ogAfbeelding,
          })
        : "";

    const gebouwd = {
      bestand: pagina.bestand,
      titel: pagina.titel,
      html: [
        "<!DOCTYPE html>",
        '<html lang="nl">',
        "<head>",
        '<meta charset="utf-8">',
        '<meta name="viewport" content="width=device-width, initial-scale=1">',
        `<title>${escapeHtml(pagina.titel)} — ${escapeHtml(bedrijfsnaam)}</title>`,
        `<meta name="description" content="${escapeHtml(omschrijving)}">`,
        ...seoTags,
        jsonLd,
        '<script src="https://cdn.tailwindcss.com"></script>',
        bron.head,
        ACTIEF_STIJL,
        "</head>",
        "<body>",
        nav.html,
        bouwKruimelpad(pagina, bron.paginas),
        bodies[pagina.bestand],
        footerResultaat.html,
        // Last thing before </body>, so every element a widget binds to
        // already exists by the time it runs — no widget depends on where the
        // model happened to place anything.
        WIDGET_RUNTIME,
        consentRuntime,
        "</body>",
        "</html>",
        "",
      ].join("\n"),
    };

    // The model never writes a hosting endpoint into the markup; see
    // vulEndpointsIn for why the values it fills in are relative.
    return { ...gebouwd, html: optimaliseerAfbeeldingen(vulEndpointsIn(gebouwd.html)) };
  });

  if (eigenPrivacyPagina) return gebouwdePaginas;

  // Dezelfde schil als elke andere pagina — dezelfde head, nav en footer — maar
  // zonder actieve nav-markering, want deze pagina staat niet in het menu.
  const privacyHtml = [
    "<!DOCTYPE html>",
    '<html lang="nl">',
    "<head>",
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>Privacybeleid — ${escapeHtml(bedrijfsnaam)}</title>`,
    `<meta name="description" content="${escapeHtml(`Hoe ${bedrijfsnaam} omgaat met je gegevens.`)}">`,
    // Bewust geen canonical of Open Graph: een privacypagina hoort niet gedeeld
    // of apart geïndexeerd te worden, en om diezelfde reden staat ze ook niet
    // in de sitemap (die wordt uit site_versions.paginas gebouwd).
    '<meta name="robots" content="noindex">',
    '<script src="https://cdn.tailwindcss.com"></script>',
    bron.head,
    ACTIEF_STIJL,
    "</head>",
    "<body>",
    navResultaat.html,
    bouwPrivacyBody(privacy),
    footerResultaat.html,
    WIDGET_RUNTIME,
    consentRuntime,
    "</body>",
    "</html>",
    "",
  ].join("\n");

  gebouwdePaginas.push({
    bestand: PRIVACY_BESTAND,
    titel: "Privacybeleid",
    html: optimaliseerAfbeeldingen(vulEndpointsIn(privacyHtml)),
  });

  return gebouwdePaginas;
}

// ─────────────────────────────────────────────────────────────────────────
// 5. The prompt fragment that produces this format
// ─────────────────────────────────────────────────────────────────────────

export const MULTIPAGE_PROMPT = `Je levert GEEN losse, volledige HTML-bestanden op. Je levert de
onderdelen van één samenhangende meerpagina-site; de code zet daar zelf de losse pagina's uit
samen. Daardoor zijn de navigatiebalk en de footer op élke pagina gegarandeerd identiek en hoef
jij ze maar één keer te schrijven.

Antwoord in exact dit formaat, zonder markdown-codeblok en zonder uitleg ervoor of erna. Elke
markerregel staat alleen op zijn eigen regel:

===META===
{"paginas":[{"bestand":"index.html","titel":"Home","nav_label":"Home","meta_omschrijving":"..."},{"bestand":"over-ons.html","titel":"Over ons","nav_label":"Over ons","meta_omschrijving":"..."}]}
===HEAD===
(extra <head>-inhoud: Google-fonts-link, <script>tailwind.config = {...}</script>, eigen <style>.
Geen <title>, geen <meta charset>, geen Tailwind-CDN-script — die zet de code er zelf al in.)
===NAV===
(de gedeelde navigatiebalk: één <header>/<nav>-blok, inclusief een werkende mobiele variant)
===FOOTER===
(de gedeelde footer: één <footer>-blok)
===PAGINA:index.html===
(enkel de inhoud tussen nav en footer voor deze pagina — geen <html>, <head>, <body>, nav of footer)
===PAGINA:over-ons.html===
(idem)

Een pagina mag een subpagina van een andere zijn: zet dan "ouder":"diensten.html" in haar
META-regel. Gebruik dat wanneer één hoofdthema echt uiteenvalt in aparte onderwerpen die elk een
eigen pagina verdienen (hoofdstuk -> subonderwerp), bv. diensten.html met daaronder
tuinaanleg.html en tuinonderhoud.html. Regels:
- Maximaal één niveau diep. Moet je nóg verder opdelen, gebruik dan tabs binnen die pagina.
- De ouderpagina moet zelf naar al haar subpagina's linken (een overzicht met kaartjes).
- Subpagina's hoeven niet in de navigatiebalk te staan; staan ze er wel, dan als submenu onder
  de ouder. De code markeert bij een subpagina automatisch de ouder in de nav als actieve sectie.
- Het kruimelpad (Home / Diensten / Tuinaanleg) wordt door de code toegevoegd — schrijf het niet
  zelf.
- Gebruik geen subpagina's als de inhoud het niet vraagt; een platte site van 5 pagina's is
  beter dan een kunstmatige boom.

Harde regels voor het paginasysteem:
- Bouw 4 tot 8 pagina's. Verplicht: index.html (home). Verder wat de brief/research vraagt, bv.
  over-ons.html, diensten.html (of producten.html), realisaties.html, contact.html.
- Bestandsnamen: enkel kleine letters, cijfers en koppeltekens, eindigend op .html.
- Elke pagina in ===META=== moet een eigen ===PAGINA:...===-sectie hebben, en omgekeerd.
- De navigatiebalk moet naar ELKE pagina uit ===META=== linken. Een pagina die nergens in de nav
  staat, wordt geweigerd.
- Interne links zijn altijd relatief naar het bestand zelf: href="over-ons.html", nooit
  href="/over-ons", href="over-ons" of een verzonnen pad. Link nooit naar een bestand dat niet
  in ===META=== staat — dat wordt geweigerd en de hele generatie faalt.
- Ankerlinks binnen dezelfde pagina (href="#diensten") mogen, en href="index.html#contact" mag
  ook. Externe links (https://, mailto:, tel:) blijven ongemoeid.
- Geef ELKE navigatielink een data-nav-actief-attribuut met de Tailwind-klassen die moeten
  gelden wanneer díe pagina de huidige is, bv.
  <a href="over-ons.html" class="text-slate-600 hover:text-slate-900" data-nav-actief="text-emerald-700 font-semibold">Over ons</a>.
  De code zet dat attribuut per pagina om in de actieve staat (plus aria-current="page"); zet
  zelf nergens aria-current. Dit attribuut is tegelijk hoe de code herkent wélke links echte
  menu-items zijn: zet het NIET op het logo, op een "offerte aanvragen"-knop of op een andere
  link in de header die geen menu-item is — anders worden die ook als huidige pagina
  gemarkeerd. Heb je een aparte mobiele menulijst, geef die links het attribuut wél.
  Een pagina zonder zo'n navigatielink wordt geweigerd.
- Verdeel de inhoud ECHT over de pagina's: elke pagina moet op zichzelf een volwaardige pagina
  zijn met eigen koppen, tekst en secties. Een pagina met drie regels tekst is geen pagina.
  Zet niet alles op de home en laat de rest leeg, maar geef de home wel een overzicht met
  doorkliks naar de diepere pagina's.
- Contactgegevens (adres, telefoon, e-mail, openingsuren) horen volledig op contact.html en
  verkort in de footer.

Vindbaarheid in zoekmachines (SEO):
- Geef ELKE pagina in ===META=== een "meta_omschrijving": één zin van 120 tot 160 tekens die
  beschrijft wat er op díe pagina staat. Schrijf ze voor een mens die hem in Google leest, met
  de bedrijfsnaam en de gemeente erin waar dat natuurlijk past. Elke pagina krijgt een eigen
  omschrijving — niet één keer dezelfde tekst hergebruiken.
- Geef ELKE <img> een alt-attribuut dat beschrijft wat er te zien is ("boeketten in de
  winkelvitrine"), niet de bestandsnaam en niet "afbeelding". Is de afbeelding puur decoratief,
  gebruik dan alt="". Een <img> zonder alt-attribuut laat de hele generatie mislukken.
- Gebruik één <h1> per pagina, en daaronder <h2>/<h3> in logische volgorde — sla geen niveau
  over en kies een kopniveau nooit om zijn lettergrootte (dat doe je met Tailwind-klassen).
- De canonical-URL, de Open Graph-tags en de gestructureerde bedrijfsgegevens worden door de
  code toegevoegd. Schrijf ze zelf niet.

${WIDGET_PROMPT}`;

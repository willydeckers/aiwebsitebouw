// Multi-page site assembly (spec 3.3, uitgebreid van "één HTML-bestand" naar
// een echte meerpagina-site).
//
// Duplicated verbatim in worker/src/shared/site-builder.ts — see the note in
// sector-styles.ts on why there's no shared module across the Deno/Node
// boundary. The two copies differ in exactly two places: this header, and the
// import specifier below (Deno wants ./site-widgets.ts, Node/tsx wants
// ./site-widgets.js). Everything else is byte-identical; keep it that way.

import {
  WIDGET_PROMPT,
  WIDGET_RUNTIME,
  controleerGeenEigenScripts,
  controleerWidgets,
  vulEndpointsIn,
  type WidgetProbleem,
} from "./site-widgets.ts";
//
// Why the model doesn't just emit N finished HTML files: it can't be trusted to
// repeat a navigation bar and footer byte-for-byte across four pages, nor to
// mark the right link as active on each one, nor to keep every internal href
// pointing at a file that actually exists. So the model produces the *parts*
// (shared head, one nav, one footer, one body per page) and this module
// assembles the pages deterministically. Consistency of nav/footer is then a
// property of the code, not of the model's diligence, and internal links are
// resolved-or-rejected here before anything reaches Storage.

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
    return {
      bestand: pagina.bestand,
      titel: pagina.titel,
      nav_label: pagina.nav_label,
      ouder: pagina.ouder ?? null,
    };
  });

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
 * Highest max_tokens the Anthropic SDK still allows on a NON-streaming call
 * (it refuses anything it estimates could run past 10 minutes:
 * 3600 * max_tokens / 128000 > 600). Streaming would lift that, but an
 * Edge Function streaming tens of thousands of SSE events runs into
 * Supabase's per-invocation resource limit instead — so generation stays
 * non-streaming and gets a continuation call when it needs more room.
 */
export const MAX_OUTPUT_TOKENS = 21000;

/**
 * Cuts a truncated answer back to the last COMPLETE section. A response that
 * stopped on max_tokens ends mid-section; that partial section is thrown away
 * here so a continuation call (which resumes from this exact text as an
 * assistant prefill) rewrites it in full rather than splicing two halves of
 * one page together.
 */
export function knipNaLaatsteVolledigeSectie(tekst: string): string {
  const regels = tekst.split("\n");
  for (let i = regels.length - 1; i >= 0; i--) {
    if (SECTIE_PATROON.test(regels[i].trim())) {
      return regels.slice(0, i).join("\n").trimEnd();
    }
  }
  return tekst.trimEnd();
}

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
  /** Used to fill in the hosting endpoints on form/review widgets. */
  leadId?: string;
  /** Names of the files uploaded for this lead, e.g. ["brochure.pdf"]. A
   *  download link to anything not in this list fails the build — the same
   *  rule as page links, for the same reason. Undefined = don't check (a
   *  caller that doesn't know the file list yet). */
  bestanden?: string[];
};

export function bouwSite(
  bron: SiteBron,
  bedrijfsnaam: string,
  opties: BouwOpties = {},
): GebouwdePagina[] {
  const { leadId, bestanden } = opties;
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
    bodies[pagina.bestand] = resultaat.html;
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
      for (const tag of html.match(ANKER_PATROON) ?? []) {
        const href = hrefVan(tag);
        const match = href === null ? null : BESTAND_LINK_PATROON.exec(href.trim());
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
  ];
  for (const pagina of bron.paginas) {
    problemen.push(
      ...controleerGeenEigenScripts(pagina.bestand, bodies[pagina.bestand], false),
      ...controleerWidgets(pagina.bestand, bodies[pagina.bestand]),
    );
  }
  if (problemen.length) {
    throw new SiteBuildError(
      "Problemen met interactieve blokken:\n" +
        problemen.map((p) => `- [${p.bestand}] ${p.widget}: ${p.reden}`).join("\n"),
    );
  }

  return bron.paginas.map((pagina) => {
    const nav = markeerActievePagina(navResultaat.html, pagina.bestand, pagina.ouder);
    if (nav.gemarkeerd === 0) {
      throw new SiteBuildError(
        `Geen navigatielink met data-nav-actief voor ${pagina.bestand}${pagina.ouder ? ` of zijn ouder ${pagina.ouder}` : ""} — ` +
          `zonder dat attribuut kan de actieve pagina niet gemarkeerd worden.`,
      );
    }

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
        "</body>",
        "</html>",
        "",
      ].join("\n"),
    };

    // The model never writes a hosting URL into the markup: the builder knows
    // the lead id, and this keeps working when the custom domain from spec
    // section 2 replaces the raw function URL.
    return leadId ? { ...gebouwd, html: vulEndpointsIn(gebouwd.html, leadId) } : gebouwd;
  });
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
{"paginas":[{"bestand":"index.html","titel":"Home","nav_label":"Home"},{"bestand":"over-ons.html","titel":"Over ons","nav_label":"Over ons"}]}
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

${WIDGET_PROMPT}`;

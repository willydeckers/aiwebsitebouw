// Multi-page site assembly (spec 3.3, uitgebreid van "één HTML-bestand" naar
// een echte meerpagina-site).
//
// Duplicated verbatim from supabase/functions/_shared/site-builder.ts — see
// the note in that file (and in generate-demo.ts) on why there is no shared
// module across the Deno/Node boundary. Apart from this header the two files
// are byte-identical; keep them that way by hand.
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
    return { bestand: pagina.bestand, titel: pagina.titel, nav_label: pagina.nav_label };
  });

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

// ─────────────────────────────────────────────────────────────────────────
// 2. Internal-link resolution
// ─────────────────────────────────────────────────────────────────────────

const EXTERN_PATROON = /^(https?:|mailto:|tel:|data:|javascript:|\/\/)/i;

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
</style>`;

/**
 * Returns the shared nav markup with the link to `huidigBestand` marked as the
 * current page: `aria-current="page"` (the accessible signal, and what
 * ACTIEF_STIJL hooks into) plus whatever visual classes the nav link declared
 * in `data-nav-actief`.
 */
export function markeerActievePagina(nav: string, huidigBestand: string): string {
  return nav.replace(ANKER_PATROON, (tag) => {
    const href = hrefVan(tag);
    if (href === null) return tag;
    if ((href.split("#")[0] || "index.html") !== huidigBestand) return tag;
    if (/\baria-current\s*=/i.test(tag)) return tag;

    const actiefMatch = ACTIEF_ATTR_PATROON.exec(tag);
    const extraKlassen = (actiefMatch?.[2] ?? actiefMatch?.[3] ?? "").trim();

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
    return resultaat.replace(/^<a\b/i, '<a aria-current="page"');
  });
}

// ─────────────────────────────────────────────────────────────────────────
// 4. Assembly
// ─────────────────────────────────────────────────────────────────────────

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
export function bouwSite(bron: SiteBron, bedrijfsnaam: string): GebouwdePagina[] {
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
  const onbereikbaar = bron.paginas.filter((p) => !navDoelen.has(p.bestand));
  if (onbereikbaar.length) {
    throw new SiteBuildError(
      `De navigatie linkt niet naar: ${onbereikbaar.map((p) => p.bestand).join(", ")} — elke pagina moet in de navigatiebalk staan.`,
    );
  }

  const kapot = [...navResultaat.kapot, ...footerResultaat.kapot];
  const bodies: Record<string, string> = {};
  for (const pagina of bron.paginas) {
    const resultaat = herschrijfLinks(bron.bodies[pagina.bestand] ?? "", bron.paginas);
    bodies[pagina.bestand] = resultaat.html;
    kapot.push(...resultaat.kapot);
  }

  if (kapot.length) {
    throw new SiteBuildError(
      `Dode interne links naar niet-bestaande pagina's: ${[...new Set(kapot)].join(", ")}. ` +
        `Beschikbare pagina's: ${bestandsnamen.join(", ")}.`,
    );
  }

  return bron.paginas.map((pagina) => ({
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
      markeerActievePagina(navResultaat.html, pagina.bestand),
      bodies[pagina.bestand],
      footerResultaat.html,
      "</body>",
      "</html>",
      "",
    ].join("\n"),
  }));
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

Harde regels voor het paginasysteem:
- Bouw 4 tot 6 pagina's. Verplicht: index.html (home). Verder wat de brief/research vraagt, bv.
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
- Geef elke navigatielink een data-nav-actief-attribuut met de Tailwind-klassen die moeten
  gelden wanneer díe pagina de huidige is, bv.
  <a href="over-ons.html" class="text-slate-600 hover:text-slate-900" data-nav-actief="text-emerald-700 font-semibold">Over ons</a>.
  De code zet dat attribuut per pagina om in de actieve staat (plus aria-current="page"); zet
  zelf nergens aria-current.
- Verdeel de inhoud ECHT over de pagina's: elke pagina moet op zichzelf een volwaardige pagina
  zijn met eigen koppen, tekst en secties. Een pagina met drie regels tekst is geen pagina.
  Zet niet alles op de home en laat de rest leeg, maar geef de home wel een overzicht met
  doorkliks naar de diepere pagina's.
- Contactgegevens (adres, telefoon, e-mail, openingsuren) horen volledig op contact.html en
  verkort in de footer.`;

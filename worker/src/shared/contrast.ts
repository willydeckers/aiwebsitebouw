import type { Page } from "playwright";

// Lichte tekst op een lichte achtergrond, gemeten in plaats van gehoopt.
//
// Het was de meest gemelde fout in de gegenereerde sites, en de review-AI zag
// hem soms wel en soms niet: op een verkleinde screenshot is lichtgrijs op wit
// precies het soort detail dat wegvalt. De browser weet het exact — welke
// kleur de tekst heeft en wat er echt onder ligt — dus meet de code het, en
// krijgt het model het als feit in plaats van als indruk.
//
// Verdeling van het werk: de pagina levert ruwe kleuren (zie meetContrast
// onderaan), de rekenkunde gebeurt hier in Node, zodat die getest kan worden
// zonder browser (scripts/test-contrast.ts).

export type Rgba = [number, number, number, number]; // r,g,b 0..255, a 0..1

/** Minimum volgens WCAG AA. Grote tekst mag minder. */
export const MINIMUM_NORMAAL = 4.5;
export const MINIMUM_GROOT = 3;
/**
 * Onder deze verhouding keurt de review-loop altijd af, wat het model er ook
 * van vindt. Bewust lager dan 4.5: tussen 3 en 4.5 is het een aandachtspunt
 * voor de reviewer, geen harde weigering — een hergeneratie kost minuten en
 * geld, en een licht te zachte bijschrift-kleur is dat niet waard.
 */
export const HARDE_GRENS = 3;

export type ContrastProbleem = {
  pagina: string;
  tekst: string;
  voorgrond: string;
  achtergrond: string;
  verhouding: number;
  minimum: number;
};

/** `voor` over `achter` gelegd, zoals de browser het schildert. */
export function legOver(voor: Rgba, achter: Rgba): Rgba {
  const a = voor[3] + achter[3] * (1 - voor[3]);
  if (a === 0) return [0, 0, 0, 0];
  const kanaal = (i: number) => (voor[i] * voor[3] + achter[i] * achter[3] * (1 - voor[3])) / a;
  return [kanaal(0), kanaal(1), kanaal(2), a];
}

export function relatieveLuminantie([r, g, b]: Rgba): number {
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

export function contrastVerhouding(a: Rgba, b: Rgba): number {
  const la = relatieveLuminantie(a);
  const lb = relatieveLuminantie(b);
  const [licht, donker] = la > lb ? [la, lb] : [lb, la];
  return (licht + 0.05) / (donker + 0.05);
}

export function hex([r, g, b]: Rgba): string {
  return `#${[r, g, b].map((c) => Math.round(c).toString(16).padStart(2, "0")).join("")}`;
}

/** Wat de pagina per stuk tekst teruggeeft. */
export type RuweMeting = {
  tekst: string;
  kleur: Rgba;
  /** Achtergrondlagen van dichtbij naar ver, tot en met de eerste dekkende. */
  lagen: Rgba[];
  /** Er ligt een foto, video of verloop onder: niet betrouwbaar te meten. */
  opAfbeelding: boolean;
  lettergrootte: number;
  gewicht: number;
};

const WIT: Rgba = [255, 255, 255, 1];

/** Zet ruwe metingen om naar problemen, slechtste eerst, dubbels eruit. */
export function beoordeel(pagina: string, metingen: RuweMeting[], maxAantal = 10): ContrastProbleem[] {
  const gezien = new Set<string>();
  const problemen: ContrastProbleem[] = [];

  for (const m of metingen) {
    if (m.opAfbeelding) continue;
    // Van ver naar dichtbij opstapelen op wit (het canvas van een pagina).
    const achtergrond = [...m.lagen].reverse().reduce((onder, laag) => legOver(laag, onder), WIT);
    const voorgrond = legOver(m.kleur, achtergrond);
    const verhouding = contrastVerhouding(voorgrond, achtergrond);
    const groot = m.lettergrootte >= 24 || (m.lettergrootte >= 18.66 && m.gewicht >= 700);
    const minimum = groot ? MINIMUM_GROOT : MINIMUM_NORMAAL;
    if (verhouding >= minimum) continue;

    const sleutel = `${hex(voorgrond)}|${hex(achtergrond)}|${m.tekst}`;
    if (gezien.has(sleutel)) continue;
    gezien.add(sleutel);

    problemen.push({
      pagina,
      tekst: m.tekst,
      voorgrond: hex(voorgrond),
      achtergrond: hex(achtergrond),
      verhouding: Math.round(verhouding * 100) / 100,
      minimum,
    });
  }

  return problemen.sort((a, b) => a.verhouding - b.verhouding).slice(0, maxAantal);
}

export function beschrijf(p: ContrastProbleem): string {
  return (
    `"${p.tekst}" (${p.pagina}): tekst ${p.voorgrond} op ${p.achtergrond} = ` +
    `${p.verhouding.toFixed(1)}:1, minimum ${p.minimum}:1`
  );
}

/**
 * Meet elke zichtbare tekst op een al geladen pagina.
 *
 * Kijkt naar wat er écht onder de tekst ligt (elementsFromPoint), niet naar
 * de voorouders: een hero met een absolute <img> en een donkere overlay-div
 * als broertjes van de tekst zou via de voorouders "wit op wit" lijken.
 * Ligt er een foto of verloop onder vóór er een dekkende kleur komt, dan
 * slaat de meting die tekst over in plaats van te gokken.
 *
 * Tekst met aria-hidden (bewust decoratief, zoals een groot "01" op de
 * achtergrond) telt niet mee — dat is ook wat de generator hoort te doen met
 * zulke tekst.
 */
export async function meetContrast(page: Page): Promise<RuweMeting[]> {
  return (await page.evaluate(MEET_SCRIPT)) as RuweMeting[];
}

// Als gewone JavaScript-tekst en niet als functie aan page.evaluate: tsx en
// esbuild (keepNames) wikkelen benoemde functies in een __name()-hulpje dat
// in de pagina niet bestaat — een functie die hier doorgegeven werd, crashte
// dus pas in de browser ("__name is not defined"), en enkel in die build.
const MEET_SCRIPT = `(() => {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 1;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  // Via een pixel in plaats van de CSS-tekst te ontleden: zo werkt het voor
  // rgb(), hex, oklch() en wat Tailwind nog kan teruggeven.
  const naarRgba = (css) => {
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillStyle = "rgba(0,0,0,0)";
    ctx.fillStyle = css;
    ctx.fillRect(0, 0, 1, 1);
    const d = ctx.getImageData(0, 0, 1, 1).data;
    return [d[0], d[1], d[2], d[3] / 255];
  };

  const OVERSLAAN = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "SVG", "OPTION", "TITLE", "TEMPLATE"]);
  const MEDIA = new Set(["IMG", "VIDEO", "CANVAS", "PICTURE", "IFRAME", "SVG"]);
  const uit = [];

  for (const el of Array.from(document.body.querySelectorAll("*"))) {
    if (OVERSLAAN.has(el.tagName.toUpperCase())) continue;
    if (el.closest("[aria-hidden='true']")) continue;
    const tekstKnoop = Array.from(el.childNodes).find(
      (n) => n.nodeType === Node.TEXT_NODE && (n.textContent || "").trim().length >= 2,
    );
    if (!tekstKnoop) continue;

    const stijl = getComputedStyle(el);
    if (stijl.visibility === "hidden" || stijl.display === "none") continue;

    // Doorzichtigheid van de voorouders telt mee in de tekstkleur.
    let doorzicht = 1;
    for (let x = el; x; x = x.parentElement) doorzicht *= Number(getComputedStyle(x).opacity);
    // Onzichtbaar (bv. een reveal-animatie die nog niet afging): niet wat een
    // bezoeker ziet, dus ook niet beoordelen.
    if (doorzicht < 0.1) continue;

    const bereik = document.createRange();
    bereik.selectNodeContents(tekstKnoop);
    const vak = bereik.getClientRects()[0];
    if (!vak || vak.width < 2 || vak.height < 2) continue;

    // In beeld brengen: elementsFromPoint werkt enkel binnen het venster.
    window.scrollTo(0, Math.max(0, vak.top + window.scrollY - window.innerHeight / 2));
    const nu = bereik.getClientRects()[0];
    if (!nu) continue;
    const x = nu.left + nu.width / 2;
    const y = nu.top + nu.height / 2;
    if (x < 0 || y < 0 || x >= window.innerWidth || y >= window.innerHeight) continue;

    const stapel = document.elementsFromPoint(x, y);
    const index = stapel.indexOf(el);
    // Iets anders ligt bovenop (een sticky header): niet te beoordelen.
    if (index === -1) continue;

    const lagen = [];
    let opAfbeelding = false;
    for (const onder of stapel.slice(index)) {
      if (onder !== el && MEDIA.has(onder.tagName.toUpperCase())) {
        opAfbeelding = true;
        break;
      }
      const s = getComputedStyle(onder);
      if (s.backgroundImage && s.backgroundImage !== "none") {
        opAfbeelding = true;
        break;
      }
      const laag = naarRgba(s.backgroundColor);
      if (laag[3] > 0) lagen.push(laag);
      if (laag[3] >= 0.99) break;
    }

    const kleur = naarRgba(stijl.color);
    kleur[3] *= doorzicht;

    uit.push({
      tekst: (tekstKnoop.textContent || "").trim().replace(/\\s+/g, " ").slice(0, 60),
      kleur,
      lagen,
      opAfbeelding,
      lettergrootte: parseFloat(stijl.fontSize),
      gewicht: Number(stijl.fontWeight) || 400,
    });
  }

  window.scrollTo(0, 0);
  return uit;
})()`;

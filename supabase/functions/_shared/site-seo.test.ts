// Draaien met: cd supabase && deno test functions/_shared/site-seo.test.ts
//
// Deze tests bestaan omdat het ontbreken van dit blok stil is: bouwSite() laat
// canonical/OG/JSON-LD dan gewoon weg, zonder fout, en de pagina ziet er op een
// screenshot identiek uit. Zo verdwenen die tags maandenlang na elke
// chat-bewerking zonder dat iemand het merkte.

import { assert, assertEquals } from "jsr:@std/assert@1";
import { bouwSeoGegevens } from "./site-seo.ts";
import { bouwSite, parseSiteBron } from "./site-builder.ts";

const BASIS = "https://sites.yudexstudios.com";
const LEAD = {
  sector: "bloemist",
  adres: "Dorpsstraat 1, 3990 Peer",
  telefoon: "011 22 33 44",
  notities: null,
  research_samenvatting: null,
};

Deno.test("zonder basis-URL geen half ingevuld blok", () => {
  assertEquals(
    bouwSeoGegevens({ leadId: "lead-1", hostingBase: "", lead: LEAD, bestanden: [] }),
    undefined,
  );
  assertEquals(
    bouwSeoGegevens({ leadId: "lead-1", hostingBase: BASIS, lead: null, bestanden: [] }),
    undefined,
  );
});

Deno.test("een slash op het einde van de basis-URL geeft geen dubbele slash", () => {
  const seo = bouwSeoGegevens({
    leadId: "lead-1",
    hostingBase: `${BASIS}/`,
    lead: LEAD,
    bestanden: ["logo.png"],
  })!;
  assertEquals(seo.hostingBase, BASIS);
  assertEquals(seo.ogAfbeelding, `${BASIS}/lead-1/bestanden/logo.png`);
});

Deno.test("een geüpload logo wint van een bankfoto", () => {
  const met = bouwSeoGegevens({
    leadId: "lead-1",
    hostingBase: BASIS,
    lead: LEAD,
    bestanden: ["brochure.pdf", "Logo.SVG"],
  })!;
  assertEquals(met.ogAfbeelding, `${BASIS}/lead-1/bestanden/Logo.SVG`);

  const zonder = bouwSeoGegevens({
    leadId: "lead-1",
    hostingBase: BASIS,
    lead: LEAD,
    bestanden: ["brochure.pdf"],
  })!;
  assert(zonder.ogAfbeelding?.startsWith("https://images.unsplash.com/"), "geen bankfoto gekozen");
});

Deno.test("enkel een bestand dat letterlijk logo.<ext> heet telt als logo", () => {
  // De regel is smal met opzet (/^logo\./i): "logo definitief.png" is géén
  // logo. Dat is te verdedigen, maar het is het soort detail dat je één keer
  // wil vastleggen in plaats van elke keer opnieuw uit te zoeken.
  const losseNaam = bouwSeoGegevens({
    leadId: "lead-1",
    hostingBase: BASIS,
    lead: LEAD,
    bestanden: ["logo definitief.png"],
  })!;
  assert(
    losseNaam.ogAfbeelding?.startsWith("https://images.unsplash.com/"),
    "een bestand met een spatie na logo werd toch als logo genomen",
  );

  // En wat wél een logo is, wordt correct ge-encodeerd in de URL.
  const metSpatie = bouwSeoGegevens({
    leadId: "lead-1",
    hostingBase: BASIS,
    lead: LEAD,
    bestanden: ["logo.mijn merk.png"],
  })!;
  assertEquals(metSpatie.ogAfbeelding, `${BASIS}/lead-1/bestanden/logo.mijn%20merk.png`);
});

Deno.test("een sector zonder passende foto levert geen og:image", () => {
  const seo = bouwSeoGegevens({
    leadId: "lead-1",
    hostingBase: BASIS,
    lead: { ...LEAD, sector: "ruimtevaart" },
    bestanden: [],
  })!;
  assertEquals(seo.ogAfbeelding, null);
});

// ── De regressie zelf ─────────────────────────────────────────────────────

const BRON = `===META===
{"paginas":[{"bestand":"index.html","titel":"Home","nav_label":"Home"}]}
===HEAD===
===NAV===
<header><nav><a href="index.html" data-nav-actief="font-bold">Home</a></nav></header>
===FOOTER===
<footer>Bloemen De Roos</footer>
===PAGINA:index.html===
<main><h1>Welkom</h1></main>
`;

Deno.test("mét dit blok staan canonical, og:url en JSON-LD op de pagina", () => {
  const seo = bouwSeoGegevens({ leadId: "lead-1", hostingBase: BASIS, lead: LEAD, bestanden: [] });
  const home = bouwSite(parseSiteBron(BRON), "Bloemen De Roos", { seo })
    .find((p) => p.bestand === "index.html")!;

  assert(home.html.includes(`<link rel="canonical" href="${BASIS}/lead-1/">`), "geen canonical");
  assert(home.html.includes(`<meta property="og:url" content="${BASIS}/lead-1/">`), "geen og:url");
  assert(home.html.includes('"@type":"Florist"'), "geen LocalBusiness-JSON-LD");
});

Deno.test("zónder dit blok verdwijnen ze — dat was de bug", () => {
  // Dit is precies wat chat-edit-static deed: bouwSite() zonder seo aanroepen.
  // De test staat er zodat het verschil zichtbaar is en niet opnieuw wegglipt.
  const home = bouwSite(parseSiteBron(BRON), "Bloemen De Roos")
    .find((p) => p.bestand === "index.html")!;

  assertEquals(home.html.includes("rel=\"canonical\""), false);
  assertEquals(home.html.includes("og:url"), false);
  assertEquals(home.html.includes("LocalBusiness"), false);
  // De gewone description blijft wél staan; enkel de absolute URL's vallen weg.
  assert(home.html.includes('<meta name="description"'), "description hoort te blijven");
});

// Tests voor de editor-koppeling: de driewegbeslissing (wie veranderde wat)
// en de mapping bron <-> bestanden die chat-edit en de editor delen.
//
//   cd worker && npx tsx scripts/test-editor-sync.ts

import assert from "node:assert/strict";
import { bepaalSynchronisatie, hashVan } from "../src/editor/synchronisatie.js";
import {
  BRON_BESTANDEN,
  SiteBuildError,
  bestandenNaarBron,
  bouwSite,
  bronNaarBestanden,
  parseSiteBron,
} from "../src/shared/site-builder.js";

let geslaagd = 0;
function test(naam: string, fn: () => void) {
  try {
    fn();
    geslaagd++;
    console.log(`  ok  ${naam}`);
  } catch (err) {
    console.error(`FAIL  ${naam}`);
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  }
}

const h = hashVan;

// ── Driewegbeslissing ──────────────────────────────────────────────────────

test("niets veranderd: niets te doen", () => {
  const plan = bepaalSynchronisatie({ a: h("1") }, { a: h("1") }, { a: h("1") });
  assert.deepEqual(plan, { naarSchijf: [], vanSchijfWeg: [], uploaden: false, conflicten: [] });
});

test("enkel lokaal gewijzigd: uploaden", () => {
  const plan = bepaalSynchronisatie({ a: h("1") }, { a: h("2") }, { a: h("1") });
  assert.equal(plan.uploaden, true);
  assert.deepEqual(plan.naarSchijf, []);
});

test("enkel remote gewijzigd (bv. een chat-edit): naar schijf", () => {
  const plan = bepaalSynchronisatie({ a: h("1") }, { a: h("1") }, { a: h("2") });
  assert.deepEqual(plan.naarSchijf, ["a"]);
  assert.equal(plan.uploaden, false);
});

test("elk een ander bestand gewijzigd: allebei overleven", () => {
  const basis = { footer: h("f1"), home: h("h1") };
  const plan = bepaalSynchronisatie(basis, { footer: h("f1"), home: h("h2") }, { footer: h("f2"), home: h("h1") });
  assert.deepEqual(plan.naarSchijf, ["footer"]);
  assert.equal(plan.uploaden, true);
  assert.deepEqual(plan.conflicten, []);
});

test("hetzelfde bestand aan beide kanten anders: lokaal wint, als conflict gemeld", () => {
  const plan = bepaalSynchronisatie({ a: h("1") }, { a: h("lokaal") }, { a: h("remote") });
  assert.deepEqual(plan.conflicten, ["a"]);
  assert.equal(plan.uploaden, true);
  assert.deepEqual(plan.naarSchijf, []);
});

test("aan beide kanten dezelfde wijziging: geen conflict", () => {
  const plan = bepaalSynchronisatie({ a: h("1") }, { a: h("2") }, { a: h("2") });
  assert.deepEqual(plan, { naarSchijf: [], vanSchijfWeg: [], uploaden: false, conflicten: [] });
});

test("remote verwijderde een pagina die lokaal niet veranderde: van schijf weg", () => {
  const plan = bepaalSynchronisatie({ a: h("1"), weg: h("x") }, { a: h("1"), weg: h("x") }, { a: h("1") });
  assert.deepEqual(plan.vanSchijfWeg, ["weg"]);
});

test("een nieuwe pagina, lokaal aangemaakt: uploaden", () => {
  const plan = bepaalSynchronisatie({ a: h("1") }, { a: h("1"), nieuw: h("n") }, { a: h("1") });
  assert.equal(plan.uploaden, true);
});

test("eerste keer (lege map, geen toestand): alles van remote naar schijf", () => {
  const plan = bepaalSynchronisatie({}, {}, { a: h("1"), b: h("2") });
  assert.deepEqual(plan.naarSchijf, ["a", "b"]);
  assert.equal(plan.uploaden, false);
});

test("Windows-regeleinden zijn geen wijziging", () => {
  assert.equal(h("a\r\nb"), h("a\nb"));
});

// ── Bron <-> bestanden ─────────────────────────────────────────────────────

const SITE = `===META===
{"paginas":[
  {"bestand":"index.html","titel":"Home","nav_label":"Home"},
  {"bestand":"contact.html","titel":"Contact","nav_label":"Contact"}
]}
===HEAD===
<script>tailwind.config = { theme: { extend: { colors: { merk: "#14532d" } } } }</script>
===NAV===
<nav>
<a href="index.html" class="text-slate-700" data-nav-actief="font-semibold">Home</a>
<a href="contact.html" class="text-slate-700" data-nav-actief="font-semibold">Contact</a>
</nav>
===FOOTER===
<footer><p>Test BV</p></footer>
===PAGINA:index.html===
<main><h1 class="text-merk">Welkom</h1></main>
===PAGINA:contact.html===
<main><h1>Contact</h1></main>
`;

test("bron -> bestanden -> bron is verliesloos", () => {
  const bron = parseSiteBron(SITE);
  const bestanden = bronNaarBestanden(bron);
  assert.deepEqual(
    Object.keys(bestanden).sort(),
    [BRON_BESTANDEN.footer, BRON_BESTANDEN.head, BRON_BESTANDEN.nav, BRON_BESTANDEN.paginas, "contact.html", "index.html"].sort(),
  );
  assert.deepEqual(bestandenNaarBron(bestanden), bron);
});

test("met een map-voorvoegsel, zoals chat-edit het gebruikt", () => {
  const bron = parseSiteBron(SITE);
  const bestanden = bronNaarBestanden(bron, "/demo");
  assert.ok("/demo/_navigatie.html" in bestanden);
  assert.ok("/demo/index.html" in bestanden);
  assert.deepEqual(bestandenNaarBron(bestanden, "/demo"), bron);
});

test("een kleur aanpassen in _head.html komt op elke pagina terecht", () => {
  const bestanden = bronNaarBestanden(parseSiteBron(SITE));
  bestanden[BRON_BESTANDEN.head] = bestanden[BRON_BESTANDEN.head].replace("#14532d", "#1e3a8a");
  const paginas = bouwSite(bestandenNaarBron(bestanden), "Test BV");
  for (const naam of ["index.html", "contact.html"]) {
    assert.match(paginas.find((p) => p.bestand === naam)!.html, /#1e3a8a/, naam);
  }
});

test("een kapotte _paginas.json geeft een leesbare fout, geen crash", () => {
  const bestanden = bronNaarBestanden(parseSiteBron(SITE));
  bestanden[BRON_BESTANDEN.paginas] = "[{ bestand: index.html";
  assert.throws(() => bestandenNaarBron(bestanden), (err: unknown) => {
    assert.ok(err instanceof SiteBuildError);
    assert.match((err as Error).message, /geen geldige JSON/);
    return true;
  });
});

test("een pagina in de lijst zonder bestand wordt geweigerd", () => {
  const bestanden = bronNaarBestanden(parseSiteBron(SITE));
  delete bestanden["contact.html"];
  assert.throws(() => bestandenNaarBron(bestanden), /contact\.html staat in _paginas\.json/);
});

test("een dode link na een handmatige bewerking laat de build falen", () => {
  const bestanden = bronNaarBestanden(parseSiteBron(SITE));
  bestanden["index.html"] += '\n<a href="contakt.html">Contact</a>';
  assert.throws(() => bouwSite(bestandenNaarBron(bestanden), "Test BV"), SiteBuildError);
});

console.log(`\n${geslaagd} tests geslaagd${process.exitCode ? " (met fouten)" : ""}`);

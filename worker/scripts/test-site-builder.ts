// Regression test for the multi-page site builder (spec 3.3, multi-page
// extension). Deliberately dependency-free and runnable with the tsx that's
// already a devDependency here — same "minimal, no test framework" approach as
// supabase/tests (see that README).
//
//   cd worker && npx tsx scripts/test-site-builder.ts
//
// It exercises the Node copy of the builder. The Deno copy in
// supabase/functions/_shared/site-builder.ts is byte-identical apart from its
// header comment, so this covers both.

import assert from "node:assert/strict";
import {
  SiteBuildError,
  bouwSite,
  markeerActievePagina,
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

const GELDIG = `Hier is de site:
===META===
{"paginas":[
  {"bestand":"index.html","titel":"Home","nav_label":"Home"},
  {"bestand":"over-ons.html","titel":"Over ons","nav_label":"Over ons"},
  {"bestand":"diensten.html","titel":"Diensten","nav_label":"Diensten"},
  {"bestand":"contact.html","titel":"Contact","nav_label":"Contact"}
]}
===HEAD===
<style>body{font-family:system-ui}</style>
===NAV===
<header><nav>
<a href="index.html" class="text-slate-600" data-nav-actief="text-emerald-700 font-semibold">Home</a>
<a href="over-ons.html" class="text-slate-600" data-nav-actief="text-emerald-700 font-semibold">Over ons</a>
<a href="diensten.html" class="text-slate-600" data-nav-actief="text-emerald-700 font-semibold">Diensten</a>
<a href="contact.html" class="text-slate-600" data-nav-actief="text-emerald-700 font-semibold">Contact</a>
</nav></header>
===FOOTER===
<footer><a href="contact.html">Contact</a> — <a href="mailto:info@example.be">info@example.be</a></footer>
===PAGINA:index.html===
<main><h1>Welkom</h1><a href="./diensten.html#tuinaanleg">Bekijk onze diensten</a></main>
===PAGINA:over-ons.html===
<main><h1>Over ons</h1></main>
===PAGINA:diensten.html===
<main><h1>Diensten</h1><a href="/Contact">Contacteer ons</a></main>
===PAGINA:contact.html===
<main><h1>Contact</h1><a href="https://example.be">Externe link</a><a href="#formulier">Anker</a></main>
`;

console.log("site-builder");

test("parst het ===SECTIE===-formaat en negeert prose ervoor", () => {
  const bron = parseSiteBron(GELDIG);
  assert.equal(bron.paginas.length, 4);
  assert.equal(bron.paginas[0].bestand, "index.html");
  assert.ok(bron.nav.includes("<nav>"));
  assert.ok(bron.footer.includes("<footer>"));
  assert.ok(bron.bodies["contact.html"].includes("Anker"));
});

test("bouwt één bestand per pagina met identieke nav en footer", () => {
  const paginas = bouwSite(parseSiteBron(GELDIG), "Tuinbouw Hendrix");
  assert.equal(paginas.length, 4);

  const navBlokken = paginas.map((p) => p.html.split("<header>")[1].split("</header>")[0]);
  const footerBlokken = paginas.map((p) => p.html.split("<footer>")[1].split("</footer>")[0]);

  // Footers zijn overal letterlijk identiek; navs verschillen enkel in de
  // actieve markering (daarom hieronder pas na verwijdering ervan).
  assert.equal(new Set(footerBlokken).size, 1, "footer verschilt tussen pagina's");
  const genormaliseerd = navBlokken.map((n) =>
    n.replace(/ aria-current="page"/g, "").replace(/ text-emerald-700 font-semibold/g, ""),
  );
  assert.equal(new Set(genormaliseerd).size, 1, "navigatie verschilt structureel tussen pagina's");
});

test("markeert exact één navigatielink als actieve pagina", () => {
  for (const pagina of bouwSite(parseSiteBron(GELDIG), "Tuinbouw Hendrix")) {
    const nav = pagina.html.split("<header>")[1].split("</header>")[0];
    const actief = nav.match(/aria-current="page"/g) ?? [];
    assert.equal(actief.length, 1, `${pagina.bestand}: ${actief.length} actieve links`);
    const actieveTag = (nav.match(/<a[^>]*aria-current="page"[^>]*>/) ?? [""])[0];
    assert.ok(actieveTag.includes(`href="${pagina.bestand}"`), `${pagina.bestand}: verkeerde link actief`);
    assert.ok(actieveTag.includes("text-emerald-700"), `${pagina.bestand}: data-nav-actief niet toegepast`);
    assert.ok(actieveTag.includes("text-slate-600"), `${pagina.bestand}: bestaande klassen verdwenen`);
  }
});

test("normaliseert interne links naar bestaande bestanden", () => {
  const paginas = bouwSite(parseSiteBron(GELDIG), "Tuinbouw Hendrix");
  const index = paginas.find((p) => p.bestand === "index.html")!;
  const diensten = paginas.find((p) => p.bestand === "diensten.html")!;
  assert.ok(index.html.includes('href="diensten.html#tuinaanleg"'), "./-prefix niet genormaliseerd");
  assert.ok(diensten.html.includes('href="contact.html"'), "/Contact niet genormaliseerd");
});

test("laat externe links en ankers ongemoeid", () => {
  const contact = bouwSite(parseSiteBron(GELDIG), "Tuinbouw Hendrix").find(
    (p) => p.bestand === "contact.html",
  )!;
  assert.ok(contact.html.includes('href="https://example.be"'));
  assert.ok(contact.html.includes('href="#formulier"'));
  assert.ok(contact.html.includes('href="mailto:info@example.be"'));
});

test("elke pagina is bereikbaar via de gedeelde navigatie", () => {
  const paginas = bouwSite(parseSiteBron(GELDIG), "Tuinbouw Hendrix");
  for (const doel of paginas) {
    for (const bron of paginas) {
      assert.ok(
        bron.html.includes(`href="${doel.bestand}"`),
        `${bron.bestand} linkt niet naar ${doel.bestand}`,
      );
    }
  }
});

test("weigert een dode interne link", () => {
  const kapot = GELDIG.replace('<a href="/Contact">', '<a href="offertes.html">');
  assert.throws(() => bouwSite(parseSiteBron(kapot), "Test"), (err: unknown) => {
    assert.ok(err instanceof SiteBuildError);
    assert.match((err as Error).message, /offertes\.html/);
    return true;
  });
});

test("weigert een pagina die niet in de navigatie staat", () => {
  const zonderNavLink = GELDIG.replace(
    '<a href="diensten.html" class="text-slate-600" data-nav-actief="text-emerald-700 font-semibold">Diensten</a>\n',
    "",
  );
  assert.throws(() => bouwSite(parseSiteBron(zonderNavLink), "Test"), (err: unknown) => {
    assert.match((err as Error).message, /diensten\.html/);
    return true;
  });
});

test("weigert een ontbrekende ===PAGINA===-sectie", () => {
  const zonderBody = GELDIG.replace("===PAGINA:over-ons.html===\n<main><h1>Over ons</h1></main>\n", "");
  assert.throws(() => parseSiteBron(zonderBody), /over-ons\.html/);
});

test("weigert een site zonder index.html", () => {
  const zonderIndex = GELDIG.replace(/\{"bestand":"index\.html"[^}]*\},\n\s*/, "")
    .replace("===PAGINA:index.html===\n<main><h1>Welkom</h1><a href=\"./diensten.html#tuinaanleg\">Bekijk onze diensten</a></main>\n", "")
    .replace('<a href="index.html" class="text-slate-600" data-nav-actief="text-emerald-700 font-semibold">Home</a>\n', "");
  assert.throws(() => bouwSite(parseSiteBron(zonderIndex), "Test"), /index\.html/);
});

test("markeerActievePagina blijft idempotent bij herhaald toepassen", () => {
  const nav = '<a href="index.html" data-nav-actief="font-bold">Home</a>';
  const eenmaal = markeerActievePagina(nav, "index.html");
  assert.equal(markeerActievePagina(eenmaal, "index.html"), eenmaal);
});

console.log(`\n${geslaagd} tests geslaagd${process.exitCode ? " (met fouten)" : ""}`);

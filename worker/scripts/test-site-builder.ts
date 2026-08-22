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
  optimaliseerAfbeeldingen,
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
<header>
<a href="index.html" class="logo"><img src="logo.png" alt="Logo"></a>
<nav>
<a href="index.html" class="text-slate-600" data-nav-actief="text-emerald-700 font-semibold">Home</a>
<a href="over-ons.html" class="text-slate-600" data-nav-actief="text-emerald-700 font-semibold">Over ons</a>
<a href="diensten.html" class="text-slate-600" data-nav-actief="text-emerald-700 font-semibold">Diensten</a>
<a href="contact.html" class="text-slate-600" data-nav-actief="text-emerald-700 font-semibold">Contact</a>
</nav>
<nav class="mobiel">
<a href="index.html" class="blok" data-nav-actief="text-emerald-700 font-semibold">Home</a>
<a href="over-ons.html" class="blok" data-nav-actief="text-emerald-700 font-semibold">Over ons</a>
<a href="diensten.html" class="blok" data-nav-actief="text-emerald-700 font-semibold">Diensten</a>
<a href="contact.html" class="blok" data-nav-actief="text-emerald-700 font-semibold">Contact</a>
</nav>
<a href="contact.html" class="cta">Vraag een offerte</a>
</header>
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

test("markeert per pagina elke menulink naar die pagina als actief", () => {
  for (const pagina of bouwSite(parseSiteBron(GELDIG), "Tuinbouw Hendrix")) {
    const nav = pagina.html.split("<header>")[1].split("</header>")[0];
    const actieveTags = nav.match(/<a[^>]*aria-current="page"[^>]*>/g) ?? [];
    // Desktop- en mobielmenu bevatten allebei een link naar deze pagina.
    assert.equal(actieveTags.length, 2, `${pagina.bestand}: ${actieveTags.length} actieve links`);
    for (const tag of actieveTags) {
      assert.ok(tag.includes(`href="${pagina.bestand}"`), `${pagina.bestand}: verkeerde link actief`);
      assert.ok(tag.includes("text-emerald-700"), `${pagina.bestand}: data-nav-actief niet toegepast`);
    }
    assert.ok(
      actieveTags.some((t) => t.includes("text-slate-600")),
      `${pagina.bestand}: bestaande klassen verdwenen`,
    );
  }
});

test("markeert logo en call-to-action niet als actieve pagina", () => {
  const paginas = bouwSite(parseSiteBron(GELDIG), "Tuinbouw Hendrix");
  const index = paginas.find((p) => p.bestand === "index.html")!;
  const contact = paginas.find((p) => p.bestand === "contact.html")!;
  assert.ok(!/<a[^>]*class="logo"[^>]*aria-current/.test(index.html), "logo werd als huidige pagina gemarkeerd");
  assert.ok(!/<a[^>]*class="cta"[^>]*aria-current/.test(contact.html), "cta-knop werd als huidige pagina gemarkeerd");
});

test("weigert een pagina zonder navigatielink met data-nav-actief", () => {
  const zonderAttribuut = GELDIG.replace(
    / class="text-slate-600" data-nav-actief="text-emerald-700 font-semibold">Diensten/,
    ' class="text-slate-600">Diensten',
  ).replace(
    / class="blok" data-nav-actief="text-emerald-700 font-semibold">Diensten/,
    ' class="blok">Diensten',
  );
  assert.throws(() => bouwSite(parseSiteBron(zonderAttribuut), "Test"), /diensten\.html/);
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
  const zonderNavLink = GELDIG.replace(/<a href="diensten\.html"[^>]*>Diensten<\/a>\n/g, "");
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
    .replace(/<a href="index\.html"[^>]*>(Home|<img[^>]*>)<\/a>\n/g, "");
  assert.throws(() => bouwSite(parseSiteBron(zonderIndex), "Test"), /index\.html/);
});

test("markeerActievePagina blijft idempotent bij herhaald toepassen", () => {
  const nav = '<a href="index.html" data-nav-actief="font-bold">Home</a>';
  const eenmaal = markeerActievePagina(nav, "index.html");
  assert.equal(eenmaal.gemarkeerd, 1);
  const tweemaal = markeerActievePagina(eenmaal.html, "index.html");
  assert.equal(tweemaal.html, eenmaal.html);
  assert.equal(tweemaal.gemarkeerd, 1);
});

// ── Hiërarchie: hoofdstuk -> subonderwerp ────────────────────────────────

const GENEST = `===META===
{"paginas":[
  {"bestand":"index.html","titel":"Home","nav_label":"Home"},
  {"bestand":"diensten.html","titel":"Diensten","nav_label":"Diensten"},
  {"bestand":"tuinaanleg.html","titel":"Tuinaanleg","nav_label":"Tuinaanleg","ouder":"diensten.html"},
  {"bestand":"onderhoud.html","titel":"Onderhoud","nav_label":"Onderhoud","ouder":"diensten.html"}
]}
===HEAD===
<style>body{font-family:system-ui}</style>
===NAV===
<header>
<nav>
<a href="index.html" class="c" data-nav-actief="actief">Home</a>
<a href="diensten.html" class="c" data-nav-actief="actief">Diensten</a>
</nav>
</header>
===FOOTER===
<footer><a href="index.html">Home</a></footer>
===PAGINA:index.html===
<main><h1>Welkom</h1></main>
===PAGINA:diensten.html===
<main><h1>Diensten</h1><a href="tuinaanleg.html">Tuinaanleg</a><a href="onderhoud.html">Onderhoud</a></main>
===PAGINA:tuinaanleg.html===
<main><h1>Tuinaanleg</h1></main>
===PAGINA:onderhoud.html===
<main><h1>Onderhoud</h1></main>
`;

test("bouwt een subpagina die enkel via haar ouderpagina bereikbaar is", () => {
  const paginas = bouwSite(parseSiteBron(GENEST), "Test");
  assert.equal(paginas.length, 4);
  assert.ok(paginas.some((p) => p.bestand === "tuinaanleg.html"));
});

test("markeert de ouder in de nav als actieve sectie op een subpagina", () => {
  const sub = bouwSite(parseSiteBron(GENEST), "Test").find((p) => p.bestand === "tuinaanleg.html")!;
  const nav = sub.html.split("<header>")[1].split("</header>")[0];
  assert.ok(nav.includes('aria-current="true"'), "ouder niet gemarkeerd als sectie");
  assert.ok(!nav.includes('aria-current="page"'), "nav mag geen page-markering hebben voor een pagina die er niet in staat");
  const ouderTag = nav.match(/<a[^>]*aria-current="true"[^>]*>/)![0];
  assert.ok(ouderTag.includes('href="diensten.html"'), ouderTag);
  // De ouder krijgt niet de volle actieve styling van de modelklassen: het
  // class-attribuut blijft ongewijzigd (data-nav-actief zelf staat er nog wel).
  assert.equal(ouderTag.match(/\bclass="([^"]*)"/)![1], "c", ouderTag);
});

test("zet een kruimelpad op subpagina's, niet op de home", () => {
  const paginas = bouwSite(parseSiteBron(GENEST), "Test");
  const home = paginas.find((p) => p.bestand === "index.html")!;
  const sub = paginas.find((p) => p.bestand === "tuinaanleg.html")!;
  const tussen = paginas.find((p) => p.bestand === "diensten.html")!;

  // Let op: de ingespoten stylesheet noemt [data-kruimelpad] op élke pagina —
  // zoek dus naar het element, niet naar de string.
  assert.ok(!home.html.includes("<nav data-kruimelpad"), "home hoort geen kruimelpad te hebben");
  assert.ok(tussen.html.includes("<nav data-kruimelpad"));
  assert.equal((tussen.html.match(/itemprop="name"/g) ?? []).length, 2, "Home / Diensten");

  const pad = sub.html.split("<nav data-kruimelpad")[1].split("</nav>")[0];
  assert.ok(pad.includes(">Home<"), pad);
  assert.ok(pad.includes(">Diensten<"), pad);
  assert.ok(pad.includes(">Tuinaanleg<"), pad);
  assert.ok(pad.includes('href="diensten.html"'), "ouder in het kruimelpad moet klikbaar zijn");
  assert.ok(pad.includes('BreadcrumbList'), "schema.org-markup ontbreekt");
});

test("weigert een subpagina die nergens vandaan bereikbaar is", () => {
  const wees = GENEST.replace('<a href="tuinaanleg.html">Tuinaanleg</a>', "");
  assert.throws(() => bouwSite(parseSiteBron(wees), "Test"), /tuinaanleg\.html/);
});

test("weigert drie niveaus diep", () => {
  const teDiep = GENEST.replace(
    '{"bestand":"onderhoud.html","titel":"Onderhoud","nav_label":"Onderhoud","ouder":"diensten.html"}',
    '{"bestand":"onderhoud.html","titel":"Onderhoud","nav_label":"Onderhoud","ouder":"tuinaanleg.html"}',
  );
  assert.throws(() => parseSiteBron(teDiep), /drie niveaus diep/);
});

test("weigert een ouder die niet bestaat en een pagina die haar eigen ouder is", () => {
  const geenOuder = GENEST.replace('"ouder":"diensten.html"', '"ouder":"bestaat-niet.html"');
  assert.throws(() => parseSiteBron(geenOuder), /bestaat-niet\.html/);

  const zichzelf = GENEST.replace(
    '{"bestand":"tuinaanleg.html","titel":"Tuinaanleg","nav_label":"Tuinaanleg","ouder":"diensten.html"}',
    '{"bestand":"tuinaanleg.html","titel":"Tuinaanleg","nav_label":"Tuinaanleg","ouder":"tuinaanleg.html"}',
  );
  assert.throws(() => parseSiteBron(zichzelf), /zichzelf/);
});

test("weigert een ouder op index.html", () => {
  const homeOuder = GENEST.replace(
    '{"bestand":"index.html","titel":"Home","nav_label":"Home"}',
    '{"bestand":"index.html","titel":"Home","nav_label":"Home","ouder":"diensten.html"}',
  );
  assert.throws(() => parseSiteBron(homeOuder), /startpagina/);
});

test("controleert downloadlinks tegen de geüploade bestanden", () => {
  const metDownload = GENEST.replace(
    "<main><h1>Tuinaanleg</h1></main>",
    '<main><h1>Tuinaanleg</h1><div data-widget="downloads"><a href="bestanden/prijslijst.pdf" download>Prijslijst</a></div></main>',
  );
  // Zonder lijst: niet gecontroleerd (de aanroeper kent de bestanden nog niet).
  assert.equal(bouwSite(parseSiteBron(metDownload), "Test").length, 4);
  // Met lijst: bekend bestand mag, onbekend niet.
  assert.equal(bouwSite(parseSiteBron(metDownload), "Test", { bestanden: ["prijslijst.pdf"] }).length, 4);
  assert.throws(
    () => bouwSite(parseSiteBron(metDownload), "Test", { bestanden: ["iets-anders.pdf"] }),
    /prijslijst\.pdf/,
  );
});

test("laadt de eerste afbeelding meteen en de rest pas als ze in beeld komt", () => {
  const html = optimaliseerAfbeeldingen(
    '<img src="a.jpg"><p>x</p><img src="b.jpg"><img src="c.jpg">',
  );
  const tags = html.match(/<img[^>]*>/g)!;
  assert.match(tags[0], /loading="eager"/);
  assert.match(tags[0], /fetchpriority="high"/);
  assert.match(tags[1], /loading="lazy"/);
  assert.match(tags[2], /loading="lazy"/);
  assert.ok(!/fetchpriority/.test(tags[1]));
  for (const tag of tags) assert.match(tag, /decoding="async"/);
});

test("laat een expliciete loading-keuze staan", () => {
  const html = optimaliseerAfbeeldingen('<img src="a.jpg" loading="lazy">');
  assert.match(html, /loading="lazy"/);
  assert.ok(!/loading="eager"/.test(html));
});

test("zet auto=format op afbeeldingenbank-URLs, want dat is wat WebP levert", () => {
  // Met bestaande query -> &, zonder -> ?, en een URL die het al heeft blijft
  // ongemoeid (geen dubbele parameter).
  assert.match(
    optimaliseerAfbeeldingen('<img src="https://images.unsplash.com/photo-1?w=800">'),
    /photo-1\?w=800&auto=format/,
  );
  assert.match(
    optimaliseerAfbeeldingen('<img src="https://images.unsplash.com/photo-2">'),
    /photo-2\?auto=format/,
  );
  const alGoed = '<img src="https://images.unsplash.com/photo-3?auto=format&w=800">';
  assert.equal((optimaliseerAfbeeldingen(alGoed).match(/auto=/g) ?? []).length, 1);
  // Een eigen geuploade afbeelding krijgt geen Unsplash-parameters aangeplakt.
  assert.ok(!/auto=format/.test(optimaliseerAfbeeldingen('<img src="bestanden/logo.png">')));
});

test("houdt een zelfsluitende tag zelfsluitend", () => {
  assert.match(optimaliseerAfbeeldingen('<img src="a.jpg" />'), /decoding="async"\/>/);
});

test("de gebouwde pagina komt er met geoptimaliseerde afbeeldingen uit", () => {
  const metBeeld = GENEST.replace(
    "<main><h1>Tuinaanleg</h1></main>",
    '<main><h1>Tuinaanleg</h1><img src="https://images.unsplash.com/photo-9?w=800"><img src="https://images.unsplash.com/photo-8?w=800"></main>',
  );
  const paginas = bouwSite(parseSiteBron(metBeeld), "Test");
  const pagina = paginas.find((p) => p.bestand === "tuinaanleg.html")!;
  assert.match(pagina.html, /auto=format/);
  assert.match(pagina.html, /loading="lazy"/);
});

console.log(`\n${geslaagd} tests geslaagd${process.exitCode ? " (met fouten)" : ""}`);

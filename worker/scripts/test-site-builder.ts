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
  PRIVACY_BESTAND,
  SiteBuildError,
  bouwLocalBusinessJsonLd,
  bouwRobotsTxt,
  bouwSite,
  bouwSitemap,
  markeerActievePagina,
  optimaliseerAfbeeldingen,
  parseSiteBron,
  valideerMetaOmschrijving,
  vulAltTeksten,
} from "../src/shared/site-builder.js";
import { IMAGE_BANK } from "../src/shared/image-bank.js";

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
  // Vier van het model, plus de privacypagina die de code er altijd bij zet.
  assert.equal(paginas.length, 5);

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
    // De privacypagina staat bewust niet in het menu; daar hoort niets actief.
    if (pagina.bestand === PRIVACY_BESTAND) continue;
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
  assert.equal(paginas.length, 5);
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
  assert.equal(bouwSite(parseSiteBron(metDownload), "Test").length, 5);
  // Met lijst: bekend bestand mag, onbekend niet.
  assert.equal(bouwSite(parseSiteBron(metDownload), "Test", { bestanden: ["prijslijst.pdf"] }).length, 5);
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
    '<main><h1>Tuinaanleg</h1><img src="https://images.unsplash.com/photo-9?w=800" alt="een aangelegde tuin">' +
      '<img src="https://images.unsplash.com/photo-8?w=800" alt="een terras in aanbouw"></main>',
  );
  const paginas = bouwSite(parseSiteBron(metBeeld), "Test");
  const pagina = paginas.find((p) => p.bestand === "tuinaanleg.html")!;
  assert.match(pagina.html, /auto=format/);
  assert.match(pagina.html, /loading="lazy"/);
});

// ── SEO ───────────────────────────────────────────────────────────────────

const SEO = {
  leadId: "lead-1",
  hostingBase: "https://sites.example.be",
  sector: "bloemist",
  adres: "Dorpsstraat 1, 3990 Peer",
  telefoon: "011 22 33 44",
  ogAfbeelding: "https://images.unsplash.com/photo-1?auto=format",
};

test("valt terug op titel en bedrijfsnaam zonder meta-omschrijving", () => {
  assert.equal(valideerMetaOmschrijving(null, "Diensten", "Test BV"), "Diensten — Test BV");
  assert.equal(valideerMetaOmschrijving("   ", "Diensten", "Test BV"), "Diensten — Test BV");
});

test("kapt een te lange meta-omschrijving af op een woordgrens", () => {
  const lang = `${"woord ".repeat(60)}einde`;
  const uit = valideerMetaOmschrijving(lang, "Home", "Test BV");
  assert.ok(uit.length <= 160, `lengte was ${uit.length}`);
  assert.ok(uit.endsWith("..."));
  assert.ok(!uit.includes("  "));
  // Mag niet midden in een woord afkappen.
  assert.ok(/woord\.\.\.$/.test(uit), uit);
});

test("laat een omschrijving van de juiste lengte ongemoeid", () => {
  const goed = "Bloemen en boeketten uit Peer, vers gebonden voor elke gelegenheid.";
  assert.equal(valideerMetaOmschrijving(goed, "Home", "De Roos"), goed);
});

test("zet meta description, canonical en og-tags op elke pagina", () => {
  const paginas = bouwSite(parseSiteBron(GELDIG), "Test BV", { seo: SEO });
  for (const pagina of paginas) {
    // De privacypagina hoort juist niet geindexeerd of gedeeld te worden.
    if (pagina.bestand === PRIVACY_BESTAND) continue;
    assert.match(pagina.html, /<meta name="description" content="[^"]+">/);
    // De home canonicaliseert naar de map-URL, elke andere pagina naar
    // haar eigen bestand — dezelfde vorm als in de sitemap.
    const verwacht =
      pagina.bestand === "index.html"
        ? "https://sites.example.be/lead-1/"
        : `https://sites.example.be/lead-1/${pagina.bestand}`;
    assert.match(pagina.html, new RegExp(`<link rel="canonical" href="${verwacht}">`));
    assert.match(pagina.html, new RegExp(`<meta property="og:url" content="${verwacht}">`));
    assert.match(pagina.html, /<meta property="og:title"/);
    assert.match(pagina.html, /<meta property="og:description"/);
    assert.match(pagina.html, /<meta property="og:image" content="https:\/\/images.unsplash.com/);
  }
});

test("laat canonical en og weg zonder seo-blok, maar houdt de description", () => {
  const pagina = bouwSite(parseSiteBron(GELDIG), "Test BV")[0];
  assert.match(pagina.html, /<meta name="description"/);
  assert.ok(!/rel="canonical"/.test(pagina.html));
  assert.ok(!/og:title/.test(pagina.html));
});

test("zet LocalBusiness-JSON-LD enkel op de home", () => {
  const paginas = bouwSite(parseSiteBron(GELDIG), "Test BV", { seo: SEO });
  const home = paginas.find((p) => p.bestand === "index.html")!;
  const ander = paginas.find((p) => p.bestand === "over-ons.html")!;
  assert.match(home.html, /application\/ld\+json/);
  assert.ok(!/application\/ld\+json/.test(ander.html));
});

test("kiest een specifiek schema.org-type, en anders LocalBusiness", () => {
  const bloemist = JSON.parse(
    /<script type="application\/ld\+json">(.*)<\/script>/.exec(
      bouwLocalBusinessJsonLd({ bedrijfsnaam: "De Roos", sector: "bloemist", url: "https://x/" }),
    )![1],
  );
  assert.equal(bloemist["@type"], "Florist");
  assert.equal(bloemist.name, "De Roos");
  // Velden die er niet zijn, worden niet als lege string meegestuurd.
  assert.ok(!("address" in bloemist));

  const onbekend = JSON.parse(
    /<script type="application\/ld\+json">(.*)<\/script>/.exec(
      bouwLocalBusinessJsonLd({
        bedrijfsnaam: "X",
        sector: "iets heel anders",
        url: "https://x/",
        adres: "Straat 1",
        telefoon: "011",
      }),
    )![1],
  );
  assert.equal(onbekend["@type"], "LocalBusiness");
  assert.equal(onbekend.address, "Straat 1");
  assert.equal(onbekend.telephone, "011");
});

test("laat een beveiligde pagina uit de sitemap", () => {
  const xml = bouwSitemap(
    [
      { bestand: "index.html" },
      { bestand: "prijzen.html", toegang: "beveiligd" },
      { bestand: "contact.html", toegang: "publiek" },
    ],
    "https://sites.example.be/lead-1",
  );
  assert.match(xml, /<loc>https:\/\/sites.example.be\/lead-1\/<\/loc>/);
  assert.match(xml, /<loc>https:\/\/sites.example.be\/lead-1\/contact.html<\/loc>/);
  assert.ok(!xml.includes("prijzen.html"));
});

// Op een eigen domein staat de site in de root: geen lead-id in het pad, en
// dus ook niet in de sitemap. Dit is de reden dat bouwSitemap één basis-URL
// neemt in plaats van leadId + hostingBase.
test("sitemap op een eigen domein zet de pagina's in de root", () => {
  const xml = bouwSitemap([{ bestand: "index.html" }, { bestand: "contact.html" }], "https://klant.be");
  assert.match(xml, /<loc>https:\/\/klant.be\/<\/loc>/);
  assert.match(xml, /<loc>https:\/\/klant.be\/contact.html<\/loc>/);
  assert.ok(!xml.includes("lead-1"));
});

test("robots.txt wijst naar de sitemap van dezelfde site", () => {
  assert.match(
    bouwRobotsTxt("https://sites.example.be/lead-1"),
    /Sitemap: https:\/\/sites.example.be\/lead-1\/sitemap.xml/,
  );
  // Een slash op het einde mag, en mag geen dubbele slash opleveren.
  assert.match(bouwRobotsTxt("https://klant.be/"), /Sitemap: https:\/\/klant.be\/sitemap.xml/);
});

test("vult alt aan uit de afbeeldingenbank en laat een eigen alt staan", () => {
  const bank = IMAGE_BANK[0];
  const aangevuld = vulAltTeksten(`<img src="${bank.url}">`);
  assert.match(aangevuld, new RegExp(`alt="${bank.omschrijving}"`));

  const eigen = vulAltTeksten(`<img src="${bank.url}" alt="mijn eigen tekst">`);
  assert.match(eigen, /alt="mijn eigen tekst"/);
  assert.equal((eigen.match(/alt=/g) ?? []).length, 1);

  // Een onbekende URL kan niet aangevuld worden — die moet de build laten falen.
  assert.equal(vulAltTeksten('<img src="bestanden/foto.jpg">'), '<img src="bestanden/foto.jpg">');
});

test("weigert een afbeelding zonder alt die niet aan te vullen is", () => {
  const metBeeld = GELDIG.replace(
    "<main><h1>Over ons</h1></main>",
    '<main><h1>Over ons</h1><img src="bestanden/team.jpg"></main>',
  );
  assert.throws(
    () => bouwSite(parseSiteBron(metBeeld), "Test BV", { bestanden: ["team.jpg"] }),
    (err: unknown) => err instanceof SiteBuildError && /alt-attribuut/.test((err as Error).message),
  );
});

// ── Privacypagina en cookiemelding ────────────────────────────────────────

test("zet op elke site een privacypagina die het model niet geschreven heeft", () => {
  const paginas = bouwSite(parseSiteBron(GELDIG), "Tuinbouw Hendrix");
  const privacy = paginas.find((p) => p.bestand === PRIVACY_BESTAND);
  assert.ok(privacy, "geen privacypagina gebouwd");
  assert.match(privacy!.html, /<h1[^>]*>Privacybeleid<\/h1>/);
  assert.match(privacy!.html, /Tuinbouw Hendrix/);
  // Dezelfde schil als de rest: het is een pagina van de site, geen los blad.
  assert.ok(privacy!.html.includes("<header>"), "privacypagina mist de gedeelde nav");
  assert.ok(privacy!.html.includes("<footer>"), "privacypagina mist de gedeelde footer");
  // En ze hoort niet in de zoekresultaten (en dus ook niet in de sitemap, die
  // uit site_versions.paginas komt en deze pagina daarom nooit bevat).
  assert.match(privacy!.html, /<meta name="robots" content="noindex">/);
});

test("linkt naar het privacybeleid vanuit de footer van elke pagina", () => {
  for (const pagina of bouwSite(parseSiteBron(GELDIG), "Test")) {
    // Binnen <footer>...</footer>, niet er ergens achteraan geplakt: dat laatste
    // ziet er onderaan de pagina hetzelfde uit maar hangt los in de body.
    const footer = pagina.html.split("<footer>")[1].split("</footer>")[0];
    assert.ok(
      footer.includes(`href="${PRIVACY_BESTAND}"`),
      `${pagina.bestand}: geen privacylink binnen de footer`,
    );
  }
});

test("beschrijft in het privacybeleid enkel wat de site echt doet", () => {
  const zonder = bouwSite(parseSiteBron(GELDIG), "Test").find((p) => p.bestand === PRIVACY_BESTAND)!;
  assert.ok(!/formulier invult/.test(zonder.html), "belooft formuliergegevens die er niet zijn");

  const metFormulier = GELDIG.replace(
    "<main><h1>Contact</h1>",
    '<main><h1>Contact</h1><div data-widget="formulier"><form><input name="naam"><textarea name="bericht"></textarea><div data-honeypot><input name="website"></div><button type="submit">Ok</button></form><p data-status-melding hidden></p></div>',
  );
  const met = bouwSite(parseSiteBron(metFormulier), "Test").find((p) => p.bestand === PRIVACY_BESTAND)!;
  assert.match(met.html, /formulier invult/);
});

test("laat de cookiemelding weg zolang er niets te meten valt", () => {
  for (const pagina of bouwSite(parseSiteBron(GELDIG), "Test")) {
    assert.ok(!/data-consent-melding/.test(pagina.html), `${pagina.bestand}: melding zonder reden`);
  }
});

test("vraagt toestemming voor het meetscript, en laadt het pas daarna", () => {
  const paginas = bouwSite(parseSiteBron(GELDIG), "Test", {
    analytics: { scriptUrl: "https://plausible.io/js/script.js" },
  });

  for (const pagina of paginas) {
    assert.ok(/data-consent-melding/.test(pagina.html), `${pagina.bestand}: geen cookiemelding`);
    // Het script mag niet als <script src> in de HTML staan: dan is het al
    // opgehaald voor de bezoeker iets kon kiezen, en is de keuze decoratie.
    assert.ok(
      !/<script[^>]+src="https:\/\/plausible\.io/.test(pagina.html),
      `${pagina.bestand}: meetscript staat al in de HTML`,
    );
  }

  const privacy = paginas.find((p) => p.bestand === PRIVACY_BESTAND)!;
  assert.match(privacy.html, /data-consent-herzien/, "geen manier om de keuze te herzien");
});

test("laat een eigen privacypagina van het model voorgaan", () => {
  const eigen =
    GELDIG.replace(
      '{"bestand":"contact.html","titel":"Contact","nav_label":"Contact"}',
      '{"bestand":"contact.html","titel":"Contact","nav_label":"Contact"},\n' +
        '  {"bestand":"privacybeleid.html","titel":"Privacybeleid","nav_label":"Privacy"}',
    ).replace(
      '<a href="contact.html" class="cta">Vraag een offerte</a>',
      '<a href="contact.html" class="cta">Vraag een offerte</a>\n' +
        '<a href="privacybeleid.html" class="text-slate-600" data-nav-actief="text-emerald-700 font-semibold">Privacy</a>',
    ) + "===PAGINA:privacybeleid.html===\n<main><h1>Onze privacyverklaring</h1></main>\n";
  const paginas = bouwSite(parseSiteBron(eigen), "Test");
  assert.equal(paginas.filter((p) => p.bestand === PRIVACY_BESTAND).length, 1);
  // De pagina van het model, niet die van ons: die van ons draagt altijd noindex.
  const privacy = paginas.find((p) => p.bestand === PRIVACY_BESTAND)!;
  assert.ok(!/content="noindex"/.test(privacy.html), "eigen privacypagina overschreven");
});

console.log(`\n${geslaagd} tests geslaagd${process.exitCode ? " (met fouten)" : ""}`);

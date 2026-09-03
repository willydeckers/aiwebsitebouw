// Draaien met: cd supabase && deno test functions/_shared/site-404.test.ts
//
// Wat hier stil fout kan gaan: een 404 die er wél uitziet maar geen weg terug
// biedt, of die de huisstijl van de site laat vallen zonder dat iemand het
// merkt — een 404 komt in geen enkele screenshot van de review-loop voor.

import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import { bouwNietGevondenPagina } from "./site-404.ts";

const NAV = '<header><a href="index.html">Logo</a></header>';
const FOOTER = "<footer>Tuinbouw Hendrix</footer>";
const HEAD = "<style>body{font-family:Georgia}</style>";

Deno.test("gebruikt de schil van de site als die beschikbaar is", () => {
  const html = bouwNietGevondenPagina({
    homeUrl: "/lead-1/",
    bedrijfsnaam: "Tuinbouw Hendrix",
    head: HEAD,
    nav: NAV,
    footer: FOOTER,
  });

  assertStringIncludes(html, NAV);
  assertStringIncludes(html, FOOTER);
  assertStringIncludes(html, HEAD);
  // Zonder Tailwind laden de klassen van de schil niet en staat er een
  // ongestileerde pagina in de huisstijl van niets.
  assertStringIncludes(html, "cdn.tailwindcss.com");
  assertStringIncludes(html, "<title>Deze pagina bestaat niet (meer) — Tuinbouw Hendrix</title>");
});

Deno.test("valt terug op eigen opmaak zonder schil, niet op platte tekst", () => {
  const html = bouwNietGevondenPagina({ homeUrl: "/", bedrijfsnaam: "Test" });

  assert(!html.includes("cdn.tailwindcss.com"), "laadt Tailwind zonder er markup voor te hebben");
  assertStringIncludes(html, "<style>");
  assertStringIncludes(html, "404");
});

Deno.test("een halve schil telt niet als schil", () => {
  // Enkel een nav en geen footer geeft een pagina die er afgebroken uitziet,
  // en dat leest als een storing in plaats van als een verkeerd adres.
  const html = bouwNietGevondenPagina({ homeUrl: "/", nav: NAV, footer: "  " });
  assert(!html.includes(NAV), "gebruikte een onvolledige schil toch");
});

Deno.test("wijst altijd een weg terug aan", () => {
  for (const opties of [
    { homeUrl: "/lead-1/", nav: NAV, footer: FOOTER },
    { homeUrl: "/lead-1/" },
  ]) {
    const html = bouwNietGevondenPagina(opties);
    assertStringIncludes(html, 'href="/lead-1/"');
    assertStringIncludes(html, "Naar de startpagina");
  }
});

Deno.test("houdt een 404 uit de zoekresultaten", () => {
  for (const opties of [{ homeUrl: "/", nav: NAV, footer: FOOTER }, { homeUrl: "/" }]) {
    assertStringIncludes(bouwNietGevondenPagina(opties), '<meta name="robots" content="noindex">');
  }
});

Deno.test("ontsnapt een bedrijfsnaam met aanhalingstekens", () => {
  const html = bouwNietGevondenPagina({ homeUrl: "/", bedrijfsnaam: 'Bloemen "De Roos" <script>' });
  assert(!html.includes("<script>Deze"), "naam kwam ongefilterd in de pagina");
  assertStringIncludes(html, "&lt;script&gt;");
});

Deno.test("laat de boodschap aanpassen voor een bestand dat niet bestaat", () => {
  const html = bouwNietGevondenPagina({
    homeUrl: "/lead-1/",
    titel: "Dit bestand bestaat niet (meer)",
    boodschap: "De link klopt niet, of het bestand is verwijderd.",
  });
  assertStringIncludes(html, "Dit bestand bestaat niet (meer)");
  assertEquals(html.includes("Deze pagina bestaat niet"), false);
});

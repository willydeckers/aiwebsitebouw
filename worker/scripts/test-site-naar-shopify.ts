// Regression test for the demo -> Shopify content mapping. Same
// dependency-free style as the other two suites.
//
//   cd worker && npm run test:shopify-mapping

import assert from "node:assert/strict";
import { parseSiteBron } from "../src/shared/site-builder.js";
import {
  handleVoor,
  menuItemsVoorShopify,
  overgeslagenPaginas,
  paginasVoorShopify,
} from "../src/shopify/site-naar-shopify.js";

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

const BRON = `===META===
{"paginas":[
 {"bestand":"index.html","titel":"Home","nav_label":"Home"},
 {"bestand":"diensten.html","titel":"Onze diensten","nav_label":"Diensten"},
 {"bestand":"tuinaanleg.html","titel":"Tuinaanleg","nav_label":"Tuinaanleg","ouder":"diensten.html"},
 {"bestand":"contact.html","titel":"Contact","nav_label":"Contact"},
 {"bestand":"klantenzone.html","titel":"Klantenzone","nav_label":"Klantenzone","toegang":"beveiligd"}
]}
===HEAD===
<style>body{font-family:system-ui}</style>
===NAV===
<header>
<nav>
<a href="index.html" class="c" data-nav-actief="a">Home</a>
<a href="diensten.html" class="c" data-nav-actief="a">Diensten</a>
<a href="contact.html" class="c" data-nav-actief="a">Contact</a>
<a href="klantenzone.html" class="c" data-nav-actief="a">Klantenzone</a>
</nav>
</header>
===FOOTER===
<footer><a href="contact.html">Contact</a></footer>
===PAGINA:index.html===
<main><h1>Welkom</h1></main>
===PAGINA:diensten.html===
<main><h1>Diensten</h1><a href="tuinaanleg.html">Tuinaanleg</a></main>
===PAGINA:tuinaanleg.html===
<main><h1>Tuinaanleg</h1></main>
===PAGINA:contact.html===
<main><h1>Contact</h1></main>
===PAGINA:klantenzone.html===
<main><h1>Enkel voor klanten</h1></main>
`;

const bron = parseSiteBron(BRON);

console.log("site-naar-shopify");

test("maakt een handle van een bestandsnaam", () => {
  assert.equal(handleVoor("over-ons.html"), "over-ons");
  assert.equal(handleVoor("index.html"), "index");
  assert.equal(handleVoor("Rare Naam.HTML"), "rare-naam");
});

test("zet elke pagina om behalve de home", () => {
  const paginas = paginasVoorShopify(bron);
  const bestanden = paginas.map((p) => p.bestand);
  assert.ok(!bestanden.includes("index.html"), "home mag geen Page worden — dat is de storefront");
  assert.deepEqual(bestanden, ["diensten.html", "tuinaanleg.html", "contact.html"]);
  const diensten = paginas.find((p) => p.bestand === "diensten.html")!;
  assert.equal(diensten.title, "Onze diensten");
  assert.equal(diensten.handle, "diensten");
  assert.ok(diensten.body.includes("<h1>Diensten</h1>"));
});

test("neemt de body over zonder nav, footer of head", () => {
  const contact = paginasVoorShopify(bron).find((p) => p.bestand === "contact.html")!;
  assert.ok(!contact.body.includes("<header"), "nav hoort bij het thema, niet in de pagina");
  assert.ok(!contact.body.includes("<footer"), "footer hoort bij het thema");
  assert.ok(!contact.body.includes("<style"), "head-inhoud hoort bij het thema");
});

test("zet een afgeschermde pagina NIET over", () => {
  const bestanden = paginasVoorShopify(bron).map((p) => p.bestand);
  assert.ok(!bestanden.includes("klantenzone.html"), "beveiligde pagina zou publiek worden");

  const overgeslagen = overgeslagenPaginas(bron);
  assert.equal(overgeslagen.length, 1);
  assert.equal(overgeslagen[0].bestand, "klantenzone.html");
  assert.match(overgeslagen[0].reden, /afgeschermde pagina/);
});

test("bouwt het menu uit de paginaboom, met de home als storefront-root", () => {
  const gids = {
    "diensten.html": "gid://shopify/Page/1",
    "tuinaanleg.html": "gid://shopify/Page/2",
    "contact.html": "gid://shopify/Page/3",
  };
  const items = menuItemsVoorShopify(bron, gids);

  assert.deepEqual(items.map((i) => i.title), ["Home", "Diensten", "Contact"]);
  assert.deepEqual(items[0], { title: "Home", type: "HTTP", url: "/" });
  assert.equal(items[1].type, "PAGE");
  assert.equal(items[1].resourceId, "gid://shopify/Page/1");

  // De subpagina hangt onder haar ouder, niet als los hoofditem.
  assert.equal(items[1].items?.length, 1);
  assert.equal(items[1].items?.[0].title, "Tuinaanleg");
  assert.equal(items[1].items?.[0].resourceId, "gid://shopify/Page/2");
  assert.ok(!items.some((i) => i.title === "Tuinaanleg"), "subpagina mag geen hoofditem zijn");
});

test("laat een afgeschermde pagina ook uit het menu", () => {
  const items = menuItemsVoorShopify(bron, { "contact.html": "gid://shopify/Page/3" });
  assert.ok(!items.some((i) => i.title === "Klantenzone"));
});

test("slaat een pagina over waarvan de gid ontbreekt", () => {
  // Een pageCreate die faalde mag geen menu-item opleveren dat nergens heen wijst.
  const items = menuItemsVoorShopify(bron, {});
  assert.deepEqual(items.map((i) => i.title), ["Home"]);
});

console.log(`\n${geslaagd} tests geslaagd${process.exitCode ? " (met fouten)" : ""}`);

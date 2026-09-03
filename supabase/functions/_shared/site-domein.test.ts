// Draaien met: cd supabase && deno test functions/_shared/site-domein.test.ts
//
// Dit dekt de beslissing die anders stil fout gaat: een verkeerd basispad
// geeft geen exception maar een formulier dat naar niets post, en een verkeerd
// geclassificeerde host geeft een 404 op een site die wél bereikbaar is.

import { assertEquals } from "jsr:@std/assert@1";
import { bepaalRouteVorm, isEigenPlatformHost } from "./site-domein.ts";

const BASIS = "https://sites-oorsprong.yudexstudios.com";

Deno.test("de functie-URL en localhost zijn platformhosts", () => {
  assertEquals(isEigenPlatformHost("abcdef.supabase.co", BASIS), true);
  assertEquals(isEigenPlatformHost("abcdef.supabase.co:443", BASIS), true);
  assertEquals(isEigenPlatformHost("localhost:54321", BASIS), true);
});

Deno.test("de vaste oorsprong is een platformhost, geen klantdomein", () => {
  // Zonder deze regel zou élke demo-link 404'en zodra de custom domain van
  // Supabase in gebruik is.
  assertEquals(isEigenPlatformHost("sites-oorsprong.yudexstudios.com", BASIS), true);
  assertEquals(isEigenPlatformHost("SITES-OORSPRONG.YUDEXSTUDIOS.COM", BASIS), true);
});

Deno.test("een klantdomein en een bureau-subdomein zijn dat niet", () => {
  assertEquals(isEigenPlatformHost("klant.be", BASIS), false);
  assertEquals(isEigenPlatformHost("florian.yudexstudios.com", BASIS), false);
});

Deno.test("een onleesbare hostingBase blokkeert geen enkel domein", () => {
  assertEquals(isEigenPlatformHost("klant.be", "niet-eens-een-url"), false);
  assertEquals(isEigenPlatformHost("klant.be", ""), false);
});

Deno.test("functie-URL: lead-id uit het pad, basispad tot en met dat id", () => {
  const pad = "/functions/v1/track-and-serve/lead-1/contact.html";
  const vorm = bepaalRouteVorm("abc.supabase.co", pad, ["lead-1", "contact.html"], BASIS);

  assertEquals(vorm, {
    soort: "platform",
    leadId: "lead-1",
    segmenten: ["contact.html"],
    basisPad: "/functions/v1/track-and-serve/lead-1/",
    basisUrl: `${BASIS}/lead-1`,
  });
});

Deno.test("functie-URL zonder lead-id levert geen route", () => {
  assertEquals(bepaalRouteVorm("abc.supabase.co", "/", [], BASIS), null);
});

Deno.test("functie-URL zonder DEMO_HOSTING_URL heeft geen basisUrl", () => {
  const vorm = bepaalRouteVorm("abc.supabase.co", "/lead-1/", ["lead-1"], "");
  assertEquals(vorm?.soort === "platform" ? vorm.basisUrl : "fout", null);
});

Deno.test("eigen domein: de site staat in de root", () => {
  const vorm = bepaalRouteVorm("klant.be", "/contact.html", ["contact.html"], BASIS);

  assertEquals(vorm, {
    soort: "domein",
    host: "klant.be",
    segmenten: ["contact.html"],
    basisPad: "/",
    basisUrl: "https://klant.be",
  });
});

Deno.test("eigen domein: de homepagina heeft geen segmenten", () => {
  const vorm = bepaalRouteVorm("klant.be", "/", [], BASIS);
  assertEquals(vorm?.soort === "domein" ? vorm.segmenten : ["fout"], []);
});

Deno.test("eigen domein: de host wordt genormaliseerd, poort en hoofdletters eraf", () => {
  const vorm = bepaalRouteVorm("KLANT.BE:443", "/", [], BASIS);
  assertEquals(vorm?.soort === "domein" ? vorm.host : "fout", "klant.be");
  assertEquals(vorm?.soort === "domein" ? vorm.basisUrl : "fout", "https://klant.be");
});

Deno.test("eigen domein: endpoints van de site hangen onder /", () => {
  // De widgets vullen relatieve endpoints in ("formulier", "reviews"); die
  // moeten op een eigen domein op /formulier uitkomen, niet op /{leadId}/.
  const vorm = bepaalRouteVorm("klant.be", "/formulier", ["formulier"], BASIS);
  assertEquals(vorm?.basisPad, "/");
  assertEquals(vorm?.soort === "domein" ? vorm.segmenten[0] : "fout", "formulier");
});

// ── De regressie die de demo-links plat legde ─────────────────────────────

Deno.test("een lead-id in het pad wint van wat de Host-header beweert", () => {
  // Dit is precies wat er live misging: een Edge Function ziet niet
  // noodzakelijk de hostnaam waarop de bezoeker de site opvroeg. Kwam die
  // header binnen als iets anders dan *.supabase.co, dan werd élke demo-link
  // als klantdomein opgezocht, niet gevonden, en met 404 beantwoord.
  const vorm = bepaalRouteVorm(
    "iets-interns.example",
    "/track-and-serve/36ff0584-aa25-4be2-86f7-1afac318ed52/contact.html",
    ["36ff0584-aa25-4be2-86f7-1afac318ed52", "contact.html"],
    BASIS,
  );

  assertEquals(vorm?.soort, "platform");
  if (vorm?.soort !== "platform") return;
  assertEquals(vorm.leadId, "36ff0584-aa25-4be2-86f7-1afac318ed52");
  assertEquals(vorm.segmenten, ["contact.html"]);
  assertEquals(vorm.basisPad, "/track-and-serve/36ff0584-aa25-4be2-86f7-1afac318ed52/");
});

Deno.test("een eigen domein blijft een eigen domein: geen lead-id in het pad", () => {
  const vorm = bepaalRouteVorm("klant.be", "/contact.html", ["contact.html"], BASIS);
  assertEquals(vorm?.soort, "domein");
  if (vorm?.soort !== "domein") return;
  assertEquals(vorm.host, "klant.be");
  assertEquals(vorm.basisPad, "/");
});

/**
 * De pagina die een bezoeker krijgt als hij op een adres uitkomt dat niet
 * (meer) bestaat.
 *
 * Waarom dit meer is dan een string: tot nu gaf elke 404 hier platte tekst
 * ("Pagina niet gevonden."), zonder opmaak en zonder weg terug. Dat is een
 * doodlopend spoor op de site van een klant — precies op het moment dat een
 * bezoeker een oude link uit een mail of een zoekresultaat volgt.
 *
 * De huisstijl van een gegenereerde site staat nergens in de database: kleuren
 * en lettertypes zitten enkel als markup in de opgeslagen bestanden. Daarom
 * krijgt deze functie de gedeelde head/nav/footer van de site mee (die staan
 * samen in bron.json) en zet ze daar dezelfde schil mee op als elke echte
 * pagina. Lukt dat ophalen niet — een oude versie van vóór het meerpagina-
 * systeem heeft geen bron.json — dan valt ze terug op een eigen, sobere
 * opmaak. Bewust niet op platte tekst: een nette pagina zonder de huisstijl is
 * nog altijd beter dan geen pagina.
 *
 * Deze functie is puur, zodat ze te testen is zonder Storage of database.
 */

export type NietGevondenOpties = {
  /** Waar "terug naar de startpagina" heen wijst, bv. "/" of "/{leadId}/". */
  homeUrl: string;
  bedrijfsnaam?: string | null;
  /** De gedeelde <head>-inhoud uit bron.json. Ontbreekt = sobere terugval. */
  head?: string | null;
  nav?: string | null;
  footer?: string | null;
  titel?: string;
  boodschap?: string;
};

function escape(waarde: string): string {
  return waarde
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const STANDAARD_TITEL = "Deze pagina bestaat niet (meer)";
const STANDAARD_BOODSCHAP =
  "Het adres klopt niet, of de pagina is verplaatst. Via de startpagina vind je de weg terug.";

export function bouwNietGevondenPagina(o: NietGevondenOpties): string {
  const titel = o.titel ?? STANDAARD_TITEL;
  const boodschap = o.boodschap ?? STANDAARD_BOODSCHAP;
  const naam = o.bedrijfsnaam?.trim() ?? "";

  // Nav én footer, niet één van beide: met enkel een nav ziet de pagina er
  // half uit, en dat leest als een fout in plaats van als een 404.
  const heeftSchil = !!(o.nav?.trim() && o.footer?.trim());

  const kern = `<main class="mx-auto max-w-2xl px-6 py-24 text-center">
<p class="text-sm uppercase tracking-widest opacity-60">404</p>
<h1 class="mt-3 text-3xl font-bold">${escape(titel)}</h1>
<p class="mt-4 leading-relaxed">${escape(boodschap)}</p>
<p class="mt-8"><a href="${escape(o.homeUrl)}" class="inline-block rounded-lg border border-current px-5 py-2.5 font-medium">Naar de startpagina</a></p>
</main>`;

  if (heeftSchil) {
    return [
      "<!DOCTYPE html>",
      '<html lang="nl">',
      "<head>",
      '<meta charset="utf-8">',
      '<meta name="viewport" content="width=device-width, initial-scale=1">',
      `<title>${escape(titel)}${naam ? ` — ${escape(naam)}` : ""}</title>`,
      // Een 404 hoort niet geïndexeerd te worden; de status zegt het al, maar
      // niet elke crawler leest die even nauw.
      '<meta name="robots" content="noindex">',
      '<script src="https://cdn.tailwindcss.com"></script>',
      o.head ?? "",
      "</head>",
      "<body>",
      o.nav ?? "",
      kern,
      o.footer ?? "",
      "</body>",
      "</html>",
      "",
    ].join("\n");
  }

  // Terugval: geen huisstijl beschikbaar, dus eigen opmaak — dezelfde sobere
  // lijn als het toegangsscherm in site-toegang.ts.
  return `<!DOCTYPE html>
<html lang="nl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape(titel)}${naam ? ` — ${escape(naam)}` : ""}</title>
<meta name="robots" content="noindex">
<style>
  body { margin: 0; min-height: 100vh; display: grid; place-items: center;
         font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
         background: #f8fafc; color: #0f172a; padding: 1.5rem; }
  .kaart { max-width: 32rem; text-align: center; }
  .code { font-size: .75rem; letter-spacing: .2em; text-transform: uppercase; opacity: .6; }
  h1 { font-size: 1.6rem; margin: .5rem 0 0; }
  p { line-height: 1.6; }
  a { display: inline-block; margin-top: 1.5rem; padding: .6rem 1.25rem;
      border: 1px solid currentColor; border-radius: .5rem;
      text-decoration: none; color: inherit; font-weight: 500; }
  @media (prefers-color-scheme: dark) { body { background: #0f172a; color: #f8fafc; } }
</style>
</head>
<body>
<div class="kaart">
<p class="code">404</p>
<h1>${escape(titel)}</h1>
<p>${escape(boodschap)}</p>
<a href="${escape(o.homeUrl)}">Naar de startpagina</a>
</div>
</body>
</html>
`;
}

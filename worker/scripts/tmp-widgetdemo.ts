import { mkdirSync, writeFileSync } from "node:fs";
import { bouwSite, parseSiteBron } from "../src/shared/site-builder.js";

// Builds a throwaway site that exercises every widget, straight through the
// real builder, so the runtime can be driven in a browser.
const uit = process.env.UIT!;

const BRON = `===META===
{"paginas":[
 {"bestand":"index.html","titel":"Home","nav_label":"Home"},
 {"bestand":"leren.html","titel":"Leren","nav_label":"Leren"}
]}
===HEAD===
<script>
  tailwind.config = { theme: { extend: { colors: { merk: '#15803d' } } } }
</script>
===NAV===
<header data-widget="menu" class="p-4 border-b flex gap-4 items-center">
  <a href="index.html" class="font-bold">Logo</a>
  <nav class="hidden md:flex gap-3">
    <a href="index.html" class="text-slate-600" data-nav-actief="text-merk font-semibold">Home</a>
    <a href="leren.html" class="text-slate-600" data-nav-actief="text-merk font-semibold">Leren</a>
  </nav>
  <button data-menu-knop class="md:hidden border px-2 py-1" aria-label="Menu openen">Menu</button>
  <div data-menu-paneel class="hidden md:hidden absolute top-16 left-0 right-0 bg-white border p-4">
    <a href="index.html" class="block" data-nav-actief="text-merk font-semibold">Home</a>
    <a href="leren.html" class="block" data-nav-actief="text-merk font-semibold">Leren</a>
  </div>
</header>
===FOOTER===
<footer class="p-4 border-t">
  <div data-widget="community"><a href="https://discord.gg/voorbeeld" rel="noopener">Discord</a></div>
</footer>
===PAGINA:index.html===
<main class="p-6 space-y-8">
  <section data-widget="accordion" class="max-w-xl">
    <details class="border p-2"><summary>Vraag een</summary><p>Antwoord een.</p></details>
    <details class="border p-2"><summary>Vraag twee</summary><p>Antwoord twee.</p></details>
  </section>

  <section data-widget="tabs" class="max-w-xl">
    <div data-tabs-lijst class="flex gap-2">
      <button data-tab="a" class="border px-3 py-1">Aanleg</button>
      <button data-tab="b" class="border px-3 py-1">Onderhoud</button>
    </div>
    <div data-tab-paneel="a" class="border p-3">Paneel aanleg</div>
    <div data-tab-paneel="b" class="border p-3">Paneel onderhoud</div>
  </section>

  <section data-widget="video" data-video-bron="youtube" data-video-id="dQw4w9WgXcQ" data-video-titel="Onze werkwijze" class="max-w-xl">
    <button data-video-knop class="border px-3 py-2">Video afspelen</button>
  </section>

  <section data-widget="downloads">
    <a href="bestanden/brochure.pdf" download>Brochure (PDF)</a>
  </section>

  <section data-widget="formulier" data-soort="contact" data-bevestiging="Bedankt!" class="max-w-xl">
    <form class="space-y-2">
      <label class="block">Naam <input name="naam" required class="border"></label>
      <label class="block">E-mail <input type="email" name="email" required class="border"></label>
      <label class="block">Bericht <textarea name="bericht" required class="border"></textarea></label>
      <div data-honeypot aria-hidden="true"><label>Leeg laten <input name="website" tabindex="-1"></label></div>
      <button type="submit" class="border px-3 py-1">Versturen</button>
    </form>
    <p data-status-melding hidden></p>
  </section>

  <section data-widget="reviews" class="max-w-xl">
    <div data-review-lijst><article><p>Plaatsvervangende review</p></article></div>
    <template data-review-sjabloon>
      <article><p data-review-score></p><p data-review-tekst></p><p data-review-naam></p></article>
    </template>
  </section>
</main>
===PAGINA:leren.html===
<main class="p-6">
  <section data-widget="quiz" class="max-w-xl space-y-4">
    <div data-vraag="Welke bodem watert het best af?" class="space-y-1">
      <p>Welke bodem watert het best af?</p>
      <button data-antwoord data-juist class="border px-2 py-1">Zandgrond</button>
      <button data-antwoord class="border px-2 py-1">Beton</button>
      <div data-uitleg-blok hidden class="text-sm">Zandgrond is doorlatend.</div>
    </div>
    <div data-vraag="Wanneer snoeien?" class="space-y-1">
      <p>Wanneer snoei je best?</p>
      <button data-antwoord class="border px-2 py-1">Tijdens de vorst</button>
      <button data-antwoord data-juist class="border px-2 py-1">Eind de winter</button>
      <div data-uitleg-blok hidden class="text-sm">Na de vorst, voor het uitlopen.</div>
    </div>
    <p data-quiz-score hidden class="font-semibold"></p>
  </section>
</main>
`;

mkdirSync(uit, { recursive: true });
for (const pagina of bouwSite(parseSiteBron(BRON), "Widgetdemo", { bestanden: ["brochure.pdf"] })) {
  writeFileSync(`${uit}/${pagina.bestand}`, pagina.html);
  console.log("geschreven:", pagina.bestand, pagina.html.length, "bytes");
}

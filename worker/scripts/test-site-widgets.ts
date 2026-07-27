// Regression test for the interactive building blocks (accordion, tabs, quiz,
// video, downloads, forms, reviews, community, mobile menu). Same
// dependency-free approach as test-site-builder.ts.
//
//   cd worker && npm run test:site-widgets

import assert from "node:assert/strict";
import {
  WIDGET_RUNTIME,
  controleerGeenEigenScripts,
  controleerWidgets,
  vulEndpointsIn,
} from "../src/shared/site-widgets.js";

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

const redenen = (body: string) => controleerWidgets("test.html", body).map((p) => `${p.widget}: ${p.reden}`);

console.log("site-widgets");

test("accepteert een correcte accordion", () => {
  assert.deepEqual(
    redenen(`<div data-widget="accordion"><details><summary>V</summary><p>A</p></details></div>`),
    [],
  );
});

test("weigert een accordion zonder details/summary", () => {
  assert.match(redenen(`<div data-widget="accordion"><p>geen items</p></div>`)[0], /geen <details>/);
  assert.match(
    redenen(`<div data-widget="accordion"><details><p>geen summary</p></details></div>`)[0],
    /zonder <summary>/,
  );
});

test("accepteert tabs waarvan elke knop een paneel heeft", () => {
  const ok = `<div data-widget="tabs">
    <div data-tabs-lijst><button data-tab="a">A</button><button data-tab="b">B</button></div>
    <div data-tab-paneel="a">1</div><div data-tab-paneel="b">2</div>
  </div>`;
  assert.deepEqual(redenen(ok), []);
});

test("weigert een tab zonder paneel en een paneel zonder tab", () => {
  const kapot = `<div data-widget="tabs">
    <div data-tabs-lijst><button data-tab="a">A</button><button data-tab="b">B</button></div>
    <div data-tab-paneel="a">1</div><div data-tab-paneel="c">3</div>
  </div>`;
  const r = redenen(kapot).join(" | ");
  assert.match(r, /tab zonder paneel: b/);
  assert.match(r, /paneel zonder tab: c/);
});

test("weigert een quizvraag zonder precies één juist antwoord", () => {
  const geenJuist = `<div data-widget="quiz"><div data-vraag="x">
    <button data-antwoord>A</button><button data-antwoord>B</button></div></div>`;
  assert.match(redenen(geenJuist).join(" "), /0 juiste antwoorden/);

  const tweeJuist = `<div data-widget="quiz"><div data-vraag="x">
    <button data-antwoord data-juist>A</button><button data-antwoord data-juist>B</button></div></div>`;
  assert.match(redenen(tweeJuist).join(" "), /2 juiste antwoorden/);

  const teWeinig = `<div data-widget="quiz"><div data-vraag="x">
    <button data-antwoord data-juist>A</button></div></div>`;
  assert.match(redenen(teWeinig).join(" "), /minder dan 2 antwoorden/);
});

test("accepteert een correcte quiz", () => {
  const ok = `<div data-widget="quiz">
    <div data-vraag="x"><button data-antwoord data-juist>A</button><button data-antwoord>B</button></div>
    <div data-vraag="y"><button data-antwoord>C</button><button data-antwoord data-juist>D</button></div>
    <p data-quiz-score hidden></p></div>`;
  assert.deepEqual(redenen(ok), []);
});

test("weigert een verzonnen video-id", () => {
  const kort = `<div data-widget="video" data-video-bron="youtube" data-video-id="abc"><button data-video-knop>Play</button></div>`;
  assert.match(redenen(kort).join(" "), /ongeldig YouTube-id/);

  const vimeo = `<div data-widget="video" data-video-bron="vimeo" data-video-id="niet-numeriek"><button data-video-knop>Play</button></div>`;
  assert.match(redenen(vimeo).join(" "), /ongeldig Vimeo-id/);

  const geenBron = `<div data-widget="video" data-video-id="dQw4w9WgXcQ"><button data-video-knop>Play</button></div>`;
  assert.match(redenen(geenBron).join(" "), /data-video-bron ontbreekt/);
});

test("accepteert een geldig YouTube-id met click-to-load knop", () => {
  const ok = `<div data-widget="video" data-video-bron="youtube" data-video-id="dQw4w9WgXcQ" data-video-titel="T"><button data-video-knop>Play</button></div>`;
  assert.deepEqual(redenen(ok), []);
});

test("eist een honeypot en statusmelding op elk formulier", () => {
  const zonder = `<div data-widget="formulier"><form><button type="submit">Ok</button></form></div>`;
  const r = redenen(zonder).join(" | ");
  assert.match(r, /honeypot/);
  assert.match(r, /status-melding/);

  const ok = `<div data-widget="formulier"><form><input name="naam">
    <div data-honeypot><input name="website"></div>
    <button type="submit">Ok</button></form><p data-status-melding hidden></p></div>`;
  assert.deepEqual(redenen(ok), []);
});

test("eist lijst en sjabloon op een reviews-blok", () => {
  const zonder = `<div data-widget="reviews"><p>niks</p></div>`;
  const r = redenen(zonder).join(" | ");
  assert.match(r, /data-review-lijst/);
  assert.match(r, /data-review-sjabloon/);
});

test("weigert een onbekende widgetnaam", () => {
  assert.match(redenen(`<div data-widget="carousel"></div>`).join(" "), /onbekende widget/);
});

test("eist knop en paneel op het mobiele menu", () => {
  assert.match(redenen(`<header data-widget="menu"></header>`).join(" | "), /data-menu-knop/);
  const ok = `<header data-widget="menu"><button data-menu-knop>M</button><div data-menu-paneel class="hidden"></div></header>`;
  assert.deepEqual(redenen(ok), []);
});

test("weigert eigen JavaScript in een pagina", () => {
  const r = controleerGeenEigenScripts("test.html", `<script>alert(1)</script>`, false);
  assert.equal(r.length, 1);
  assert.match(r[0].reden, /data-widget-blokken/);
});

test("weigert een externe <script src> ook in de head", () => {
  const r = controleerGeenEigenScripts("HEAD", `<script src="https://voorbeeld.be/x.js"></script>`, true);
  assert.match(r[0].reden, /externe <script src>/);
});

test("laat een tailwind.config-toewijzing in de head toe", () => {
  const config = `<script>\n  tailwind.config = { theme: { extend: { colors: { x: '#fff' } } } }\n</script>`;
  assert.deepEqual(controleerGeenEigenScripts("HEAD", config, true), []);
  // ...maar niet in de body, en niet als er DOM-code in zit.
  assert.equal(controleerGeenEigenScripts("index.html", config, false).length, 1);
  const stiekem = `<script>tailwind.config = {}; document.body.innerHTML = ""</script>`;
  assert.equal(controleerGeenEigenScripts("HEAD", stiekem, true).length, 1);
});

test("weigert een inline onclick-handler", () => {
  const r = controleerGeenEigenScripts("test.html", `<button onclick="doe()">x</button>`, false);
  assert.match(r[0].reden, /inline onclick/);
});

test("vult endpoints in op formulier- en reviewblokken", () => {
  const html = `<div data-widget="formulier" data-soort="contact"></div><div data-widget="reviews"></div>`;
  const uit = vulEndpointsIn(html, "lead-1");
  assert.ok(uit.includes('data-endpoint="/lead-1/formulier"'), uit);
  assert.ok(uit.includes('data-endpoint="/lead-1/reviews"'), uit);
  // Idempotent: opnieuw invullen levert niet twee attributen op.
  const nogmaals = vulEndpointsIn(uit, "lead-2");
  assert.equal((nogmaals.match(/data-endpoint=/g) ?? []).length, 2);
  assert.ok(nogmaals.includes('data-endpoint="/lead-2/formulier"'));
});

test("runtime bevat geen externe verwijzingen", () => {
  const externe = WIDGET_RUNTIME.match(/https?:\/\/[^"' )]+/g) ?? [];
  // Enkel de video-embedhosts, en die worden pas geraakt na een klik.
  for (const url of externe) {
    assert.ok(
      /youtube-nocookie\.com|player\.vimeo\.com/.test(url),
      `onverwachte externe URL in de runtime: ${url}`,
    );
  }
});

console.log(`\n${geslaagd} tests geslaagd${process.exitCode ? " (met fouten)" : ""}`);

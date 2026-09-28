// Tests voor de contrastmeting: de rekenkunde zonder browser, en daarna de
// meting zelf op een echte pagina in Chromium.
//
//   cd worker && npx tsx scripts/test-contrast.ts
//
// Het browserdeel slaat zichzelf over (met een melding) als Chromium niet wil
// starten — dat is op deze machine af en toe zo, en dan zegt een rode test
// niets over de meting.

import assert from "node:assert/strict";
import {
  beoordeel,
  contrastVerhouding,
  legOver,
  type Rgba,
} from "../src/shared/contrast.js";
import { takeScreenshotMetContrast } from "../src/shared/screenshot.js";

let geslaagd = 0;
async function test(naam: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    geslaagd++;
    console.log(`  ok  ${naam}`);
  } catch (err) {
    console.error(`FAIL  ${naam}`);
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  }
}

const wit: Rgba = [255, 255, 255, 1];
const zwart: Rgba = [0, 0, 0, 1];

await test("zwart op wit is 21:1, wit op wit 1:1", () => {
  assert.equal(Math.round(contrastVerhouding(zwart, wit)), 21);
  assert.equal(contrastVerhouding(wit, wit), 1);
});

await test("Tailwind slate-400 op wit zakt onder 4.5, slate-700 niet", () => {
  // slate-400 = #94a3b8, slate-700 = #334155
  assert.ok(contrastVerhouding([148, 163, 184, 1], wit) < 4.5);
  assert.ok(contrastVerhouding([51, 65, 85, 1], wit) > 4.5);
});

await test("half doorzichtig zwart op wit wordt grijs", () => {
  const [r, g, b, a] = legOver([0, 0, 0, 0.5], wit);
  assert.equal(a, 1);
  assert.ok(Math.abs(r - 127.5) < 1 && Math.abs(g - 127.5) < 1 && Math.abs(b - 127.5) < 1);
});

await test("tekst op een foto wordt niet beoordeeld", () => {
  const problemen = beoordeel("index.html", [
    { tekst: "Welkom", kleur: wit, lagen: [], opAfbeelding: true, lettergrootte: 16, gewicht: 400 },
  ]);
  assert.equal(problemen.length, 0);
});

await test("grote tekst mag tot 3:1", () => {
  // #767676 op wit ≈ 4.54:1; #949494 ≈ 3.03:1
  const grijs: Rgba = [148, 148, 148, 1];
  const klein = beoordeel("x", [{ tekst: "klein", kleur: grijs, lagen: [wit], opAfbeelding: false, lettergrootte: 16, gewicht: 400 }]);
  const groot = beoordeel("x", [{ tekst: "groot", kleur: grijs, lagen: [wit], opAfbeelding: false, lettergrootte: 32, gewicht: 700 }]);
  assert.equal(klein.length, 1);
  assert.equal(groot.length, 0);
});

// ── In een echte browser ───────────────────────────────────────────────────

const PAGINA = `<!DOCTYPE html><html><head><meta charset="utf-8"></head>
<body style="margin:0;font-family:sans-serif;background:#fff">
  <section style="background:#f8fafc;padding:40px">
    <p id="slecht" style="color:#cbd5e1">Deze tekst is bijna onleesbaar</p>
    <p style="color:#334155">Deze tekst is prima leesbaar</p>
    <span aria-hidden="true" style="color:#f1f5f9;font-size:14px">decoratief</span>
  </section>
  <section style="position:relative;height:300px">
    <img alt="" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='10'%3E%3Crect width='10' height='10' fill='%23222'/%3E%3C/svg%3E"
      style="position:absolute;inset:0;width:100%;height:100%">
    <p style="position:relative;color:#fff;padding:40px">Wit op een foto</p>
  </section>
  <section style="background:#0f172a;padding:40px">
    <p style="color:#ffffff">Wit op donker</p>
    <p style="color:#1e293b">Donker op donker</p>
  </section>
</body></html>`;

let metingen: Awaited<ReturnType<typeof takeScreenshotMetContrast>>["contrast"] | null = null;
try {
  metingen = (await takeScreenshotMetContrast(PAGINA, { width: 1000, height: 600 })).contrast;
} catch (err) {
  console.warn(`  --  browsertests overgeslagen: Chromium startte niet (${err instanceof Error ? err.message : err})`);
}

if (metingen) {
  const problemen = beoordeel("test.html", metingen);
  const teksten = problemen.map((p) => p.tekst);

  await test("vindt lichte tekst op een lichte achtergrond", () => {
    assert.ok(teksten.includes("Deze tekst is bijna onleesbaar"), JSON.stringify(problemen));
  });

  await test("vindt donkere tekst op een donkere achtergrond", () => {
    assert.ok(teksten.includes("Donker op donker"), JSON.stringify(problemen));
  });

  await test("laat leesbare tekst met rust", () => {
    assert.ok(!teksten.includes("Deze tekst is prima leesbaar"));
    assert.ok(!teksten.includes("Wit op donker"));
  });

  await test("slaat tekst over een foto over in plaats van 'wit op wit' te melden", () => {
    assert.ok(!teksten.includes("Wit op een foto"), JSON.stringify(problemen));
  });

  await test("slaat aria-hidden (decoratieve) tekst over", () => {
    assert.ok(!teksten.includes("decoratief"));
  });
}

console.log(`\n${geslaagd} tests geslaagd${process.exitCode ? " (met fouten)" : ""}`);

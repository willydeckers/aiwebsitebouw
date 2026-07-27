// Interactive building blocks for generated sites: FAQ-accordion, tabs,
// quizzes, video embeds, downloads, forms/reviews and community links.
//
// Duplicated in worker/src/shared/site-widgets.ts — see site-builder.ts's
// header for why there's no shared module across the Deno/Node boundary. Both
// copies have ZERO imports so they can stay literal copies of each other.
//
// Why a fixed runtime instead of letting the model write the JS: it's the same
// argument site-builder.ts makes about navigation. Hand-written accordion and
// tab scripts come out subtly different every generation — a missing
// aria-expanded here, a keyboard trap there, an event listener bound before
// the element exists — and none of that is visible in a screenshot, so the
// review loop can't catch it either. The model writes markup with data-*
// attributes; this runtime supplies the behaviour, once, verified.
//
// Constraints every widget here respects:
//   - No external scripts. A generated demo loads Tailwind's CDN and nothing
//     else, and a strict page must keep working if even that fails.
//   - Progressive enhancement. Content is in the markup; if the script never
//     runs, the text is still readable (tabs fall back to stacked sections,
//     the accordion is native <details>).
//   - No third-party requests until the visitor asks for one. Video embeds are
//     click-to-load, so no YouTube/Vimeo cookies are set on page load — this
//     is a GDPR requirement (spec section 7), not a nicety.

/** Widgets the model may use. Kept as data so the prompt and the validator
 *  can't drift apart. */
export const WIDGETS = [
  "menu",
  "accordion",
  "tabs",
  "quiz",
  "video",
  "downloads",
  "formulier",
  "reviews",
  "community",
] as const;

export type WidgetNaam = (typeof WIDGETS)[number];

// ─────────────────────────────────────────────────────────────────────────
// The runtime, injected into every generated page by bouwSite()
// ─────────────────────────────────────────────────────────────────────────

const WIDGET_STIJL = `<style>
  [data-widget="tabs"] [data-tab-paneel][hidden] { display: none; }
  [data-widget="tabs"] [data-tab] { cursor: pointer; }
  [data-widget="quiz"] [data-antwoord] { cursor: pointer; width: 100%; text-align: left; }
  [data-widget="quiz"] [data-antwoord][disabled] { cursor: default; }
  [data-widget="quiz"] [data-antwoord][data-status="juist"] { outline: 2px solid #15803d; outline-offset: 2px; }
  [data-widget="quiz"] [data-antwoord][data-status="fout"] { outline: 2px solid #b91c1c; outline-offset: 2px; }
  [data-widget="quiz"] [data-uitleg-blok][hidden] { display: none; }
  [data-widget="video"] [data-video-knop] { cursor: pointer; }
  [data-widget="video"] iframe, [data-widget="video"] video { width: 100%; aspect-ratio: 16 / 9; border: 0; }
  [data-widget="formulier"] [data-honeypot] {
    position: absolute; left: -9999px; width: 1px; height: 1px; overflow: hidden;
  }
  [data-widget] [data-status-melding][hidden] { display: none; }
  @media (prefers-reduced-motion: reduce) { * { scroll-behavior: auto !important; } }
</style>`;

// Written as one IIFE with no dependencies, and defensively: a single broken
// widget must not take the rest of the page down with it, hence the per-widget
// try/catch.
const WIDGET_SCRIPT = `<script>
(function () {
  "use strict";
  var $$ = function (root, sel) { return Array.prototype.slice.call(root.querySelectorAll(sel)); };

  function veilig(naam, fn) {
    try { fn(); } catch (err) { if (window.console) console.error("widget " + naam + ":", err); }
  }

  // ── Mobiel menu ────────────────────────────────────────────────────────
  // Exists so the shared nav never needs hand-written JavaScript. The
  // generated version of this worked, but only by accident of where the model
  // happened to put its <script> — one section higher, in <head>, and
  // getElementById would have returned null and the button would have done
  // nothing on every page, invisibly.
  function menu(root) {
    var knop = root.querySelector("[data-menu-knop]");
    var paneel = root.querySelector("[data-menu-paneel]");
    if (!knop || !paneel) return;
    var klasse = root.getAttribute("data-menu-klasse") || "hidden";

    knop.setAttribute("type", "button");
    knop.setAttribute("aria-controls", paneel.id || (paneel.id = "menu-paneel"));

    function zet(open) {
      paneel.classList.toggle(klasse, !open);
      knop.setAttribute("aria-expanded", open ? "true" : "false");
    }

    zet(false);
    knop.addEventListener("click", function () {
      zet(knop.getAttribute("aria-expanded") !== "true");
    });
    paneel.addEventListener("click", function (e) {
      // Navigating away should not leave the menu open behind the new page.
      var el = e.target;
      while (el && el !== paneel && el.nodeName !== "A") el = el.parentElement;
      if (el && el.nodeName === "A") zet(false);
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && knop.getAttribute("aria-expanded") === "true") {
        zet(false);
        knop.focus();
      }
    });
  }

  // ── FAQ-accordion ──────────────────────────────────────────────────────
  // Native <details>/<summary> does the real work (open/close, keyboard and
  // screen-reader support are free and cannot break). This only adds the
  // "opening one closes the others" behaviour, and only when asked for.
  function accordion(root) {
    var items = $$(root, "details");
    if (root.getAttribute("data-accordion-enkel") === "nee") return;
    items.forEach(function (item) {
      item.addEventListener("toggle", function () {
        if (!item.open) return;
        items.forEach(function (ander) { if (ander !== item) ander.open = false; });
      });
    });
  }

  // ── Tabs ───────────────────────────────────────────────────────────────
  function tabs(root) {
    var lijst = root.querySelector("[data-tabs-lijst]");
    var knoppen = $$(root, "[data-tab]");
    var panelen = $$(root, "[data-tab-paneel]");
    if (!knoppen.length || !panelen.length) return;

    if (lijst) lijst.setAttribute("role", "tablist");
    knoppen.forEach(function (knop, i) {
      var id = knop.getAttribute("data-tab");
      knop.setAttribute("role", "tab");
      knop.setAttribute("type", "button");
      knop.id = knop.id || "tab-" + id;
      knop.setAttribute("aria-controls", "paneel-" + id);
      knop.tabIndex = i === 0 ? 0 : -1;
    });
    panelen.forEach(function (paneel) {
      var id = paneel.getAttribute("data-tab-paneel");
      paneel.setAttribute("role", "tabpanel");
      paneel.id = "paneel-" + id;
      paneel.setAttribute("aria-labelledby", "tab-" + id);
    });

    function toon(id, focus) {
      knoppen.forEach(function (knop) {
        var actief = knop.getAttribute("data-tab") === id;
        knop.setAttribute("aria-selected", actief ? "true" : "false");
        knop.tabIndex = actief ? 0 : -1;
        if (actief && focus) knop.focus();
      });
      panelen.forEach(function (paneel) {
        paneel.hidden = paneel.getAttribute("data-tab-paneel") !== id;
      });
    }

    knoppen.forEach(function (knop) {
      knop.addEventListener("click", function () { toon(knop.getAttribute("data-tab"), false); });
      knop.addEventListener("keydown", function (e) {
        var i = knoppen.indexOf(knop);
        var volgende =
          e.key === "ArrowRight" ? (i + 1) % knoppen.length :
          e.key === "ArrowLeft" ? (i - 1 + knoppen.length) % knoppen.length :
          e.key === "Home" ? 0 :
          e.key === "End" ? knoppen.length - 1 : -1;
        if (volgende === -1) return;
        e.preventDefault();
        toon(knoppen[volgende].getAttribute("data-tab"), true);
      });
    });

    toon(knoppen[0].getAttribute("data-tab"), false);
  }

  // ── Quiz ───────────────────────────────────────────────────────────────
  function quiz(root) {
    var vragen = $$(root, "[data-vraag]");
    var scoreBlok = root.querySelector("[data-quiz-score]");
    var beantwoord = 0;
    var juist = 0;

    vragen.forEach(function (vraag) {
      var antwoorden = $$(vraag, "[data-antwoord]");
      var uitleg = vraag.querySelector("[data-uitleg-blok]");
      antwoorden.forEach(function (knop) {
        knop.setAttribute("type", "button");
        knop.addEventListener("click", function () {
          if (vraag.getAttribute("data-beantwoord") === "ja") return;
          vraag.setAttribute("data-beantwoord", "ja");
          beantwoord++;
          var isJuist = knop.hasAttribute("data-juist");
          if (isJuist) juist++;
          antwoorden.forEach(function (ander) {
            ander.disabled = true;
            if (ander.hasAttribute("data-juist")) ander.setAttribute("data-status", "juist");
            else if (ander === knop) ander.setAttribute("data-status", "fout");
          });
          if (uitleg) uitleg.hidden = false;
          if (scoreBlok) {
            scoreBlok.hidden = false;
            scoreBlok.textContent = juist + " van " + beantwoord + " juist" +
              (beantwoord === vragen.length ? " — je hebt alle vragen beantwoord." : "");
          }
        });
      });
    });
  }

  // ── Video ──────────────────────────────────────────────────────────────
  // Click-to-load: nothing is requested from YouTube/Vimeo until the visitor
  // presses play, so the page sets no third-party cookies on load.
  function video(root) {
    var knop = root.querySelector("[data-video-knop]");
    if (!knop) return;
    var bron = root.getAttribute("data-video-bron");
    var id = root.getAttribute("data-video-id") || "";
    var url = root.getAttribute("data-video-url") || "";
    var titel = root.getAttribute("data-video-titel") || "Video";

    knop.addEventListener("click", function () {
      var element;
      if (bron === "bestand") {
        element = document.createElement("video");
        element.src = url;
        element.controls = true;
        element.autoplay = true;
        element.setAttribute("playsinline", "");
      } else {
        element = document.createElement("iframe");
        element.src = bron === "vimeo"
          ? "https://player.vimeo.com/video/" + encodeURIComponent(id) + "?autoplay=1"
          : "https://www.youtube-nocookie.com/embed/" + encodeURIComponent(id) + "?autoplay=1&rel=0";
        element.allow = "accelerometer; autoplay; encrypted-media; picture-in-picture";
        element.setAttribute("allowfullscreen", "");
        element.setAttribute("referrerpolicy", "strict-origin-when-cross-origin");
      }
      element.setAttribute("title", titel);
      knop.parentNode.replaceChild(element, knop);
    });
  }

  // ── Formulier + reviews ────────────────────────────────────────────────
  // Posts to the site's own hosting layer (track-and-serve). data-endpoint is
  // filled in by the builder, so the page never has to know its own URL.
  function formulier(root) {
    var form = root.querySelector("form");
    if (!form) return;
    var melding = root.querySelector("[data-status-melding]");
    var endpoint = root.getAttribute("data-endpoint");

    function zeg(tekst, gelukt) {
      if (!melding) return;
      melding.hidden = false;
      melding.textContent = tekst;
      melding.setAttribute("data-status", gelukt ? "ok" : "fout");
      melding.setAttribute("role", "status");
    }

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      if (!endpoint) { zeg("Dit formulier is nog niet gekoppeld.", false); return; }
      var knop = form.querySelector("[type=submit]");
      if (knop) knop.disabled = true;
      zeg("Bezig met versturen...", true);

      var data = {};
      new FormData(form).forEach(function (waarde, sleutel) { data[sleutel] = waarde; });
      data.soort = root.getAttribute("data-soort") || "contact";

      fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data)
      }).then(function (res) {
        return res.json().catch(function () { return {}; }).then(function (body) {
          if (!res.ok) throw new Error(body.error || "Versturen mislukt.");
          return body;
        });
      }).then(function () {
        form.reset();
        zeg(root.getAttribute("data-bevestiging") || "Bedankt! We nemen snel contact op.", true);
      }).catch(function (err) {
        zeg(err.message || "Versturen mislukt. Probeer later opnieuw.", false);
      }).then(function () {
        if (knop) knop.disabled = false;
      });
    });
  }

  // ── Gepubliceerde reviews ophalen ──────────────────────────────────────
  function reviews(root) {
    var lijst = root.querySelector("[data-review-lijst]");
    var sjabloon = root.querySelector("template[data-review-sjabloon]");
    var endpoint = root.getAttribute("data-endpoint");
    if (!lijst || !sjabloon || !endpoint) return;

    fetch(endpoint).then(function (res) { return res.json(); }).then(function (body) {
      var items = (body && body.reviews) || [];
      if (!items.length) return;
      // Only replaces the generated placeholder reviews once real, approved
      // ones exist — an empty result leaves the page exactly as generated.
      lijst.innerHTML = "";
      items.forEach(function (review) {
        var knip = sjabloon.content.cloneNode(true);
        var naam = knip.querySelector("[data-review-naam]");
        var tekst = knip.querySelector("[data-review-tekst]");
        var score = knip.querySelector("[data-review-score]");
        if (naam) naam.textContent = review.naam || "Anoniem";
        if (tekst) tekst.textContent = review.tekst || "";
        if (score) score.textContent = "★".repeat(Math.max(1, Math.min(5, review.score || 5)));
        lijst.appendChild(knip);
      });
    }).catch(function () {
      // Placeholder reviews stay visible — better than an empty section.
    });
  }

  var starters = {
    menu: menu, accordion: accordion, tabs: tabs, quiz: quiz, video: video,
    formulier: formulier, reviews: reviews
  };

  function start() {
    $$(document, "[data-widget]").forEach(function (root) {
      var naam = root.getAttribute("data-widget");
      if (starters[naam]) veilig(naam, function () { starters[naam](root); });
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
</script>`;

export const WIDGET_RUNTIME = WIDGET_STIJL + "\n" + WIDGET_SCRIPT;

// ─────────────────────────────────────────────────────────────────────────
// Validation — the markup contract, enforced
// ─────────────────────────────────────────────────────────────────────────

export type WidgetProbleem = { bestand: string; widget: string; reden: string };

const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;
const VIMEO_ID = /^\d+$/;

function attr(tag: string, naam: string): string | null {
  const match = new RegExp(`\\b${naam}\\s*=\\s*("([^"]*)"|'([^']*)')`, "i").exec(tag);
  if (!match) return null;
  return match[2] ?? match[3] ?? "";
}

/**
 * Checks that each widget in a page body actually carries the markup its
 * behaviour needs. A tabs block whose buttons point at panels that don't
 * exist renders as a row of dead buttons — visible to nobody until a lead
 * clicks it, which is exactly the class of defect the screenshot review
 * cannot catch.
 */
export function controleerWidgets(bestand: string, body: string): WidgetProbleem[] {
  const problemen: WidgetProbleem[] = [];
  const meld = (widget: string, reden: string) => problemen.push({ bestand, widget, reden });

  // Split the body into one chunk per widget root. Crude but sufficient: the
  // chunk runs to the next widget root, so nested widgets are not supported
  // (and are rejected below rather than silently half-working).
  const roots = [...body.matchAll(/<[a-z]+\b[^>]*\bdata-widget\s*=\s*"([^"]*)"[^>]*>/gi)];

  for (let i = 0; i < roots.length; i++) {
    const naam = roots[i][1];
    const start = roots[i].index ?? 0;
    const eind = i + 1 < roots.length ? roots[i + 1].index ?? body.length : body.length;
    const blok = body.slice(start, eind);
    const tag = roots[i][0];

    if (!(WIDGETS as readonly string[]).includes(naam)) {
      meld(naam, `onbekende widget — beschikbaar: ${WIDGETS.join(", ")}`);
      continue;
    }

    if (naam === "menu") {
      if (!blok.includes("data-menu-knop")) meld(naam, "geen [data-menu-knop]");
      if (!blok.includes("data-menu-paneel")) meld(naam, "geen [data-menu-paneel]");
    }

    if (naam === "accordion") {
      if (!/<details\b/i.test(blok)) meld(naam, "geen <details>-items gevonden");
      else if (!/<summary\b/i.test(blok)) meld(naam, "een <details> zonder <summary>");
    }

    if (naam === "tabs") {
      const knoppen = [...blok.matchAll(/\bdata-tab\s*=\s*"([^"]*)"/gi)].map((m) => m[1]);
      const panelen = [...blok.matchAll(/\bdata-tab-paneel\s*=\s*"([^"]*)"/gi)].map((m) => m[1]);
      if (!knoppen.length) meld(naam, "geen tabknoppen (data-tab)");
      const zonderPaneel = knoppen.filter((k) => !panelen.includes(k));
      const zonderKnop = panelen.filter((p) => !knoppen.includes(p));
      if (zonderPaneel.length) meld(naam, `tab zonder paneel: ${zonderPaneel.join(", ")}`);
      if (zonderKnop.length) meld(naam, `paneel zonder tab: ${zonderKnop.join(", ")}`);
    }

    if (naam === "quiz") {
      const vragen = [...blok.matchAll(/\bdata-vraag\b/gi)].length;
      if (!vragen) meld(naam, "geen vragen (data-vraag)");
      const vraagBlokken = blok.split(/(?=<[a-z]+\b[^>]*\bdata-vraag\b)/i).slice(1);
      vraagBlokken.forEach((vraag, index) => {
        const antwoorden = [...vraag.matchAll(/\bdata-antwoord\b/gi)].length;
        const juist = [...vraag.matchAll(/\bdata-juist\b/gi)].length;
        if (antwoorden < 2) meld(naam, `vraag ${index + 1} heeft minder dan 2 antwoorden`);
        if (juist !== 1) meld(naam, `vraag ${index + 1} heeft ${juist} juiste antwoorden, moet er exact 1 zijn`);
      });
    }

    if (naam === "video") {
      const bron = attr(tag, "data-video-bron");
      const id = attr(tag, "data-video-id");
      const url = attr(tag, "data-video-url");
      if (!blok.includes("data-video-knop")) meld(naam, "geen play-knop (data-video-knop)");
      if (bron === "youtube" && !YOUTUBE_ID.test(id ?? "")) {
        meld(naam, `ongeldig YouTube-id ${JSON.stringify(id)} — 11 tekens verwacht`);
      } else if (bron === "vimeo" && !VIMEO_ID.test(id ?? "")) {
        meld(naam, `ongeldig Vimeo-id ${JSON.stringify(id)} — enkel cijfers`);
      } else if (bron === "bestand" && !url) {
        meld(naam, "data-video-bron=bestand zonder data-video-url");
      } else if (!bron) {
        meld(naam, "data-video-bron ontbreekt (youtube, vimeo of bestand)");
      }
    }

    if (naam === "formulier") {
      if (!/<form\b/i.test(blok)) meld(naam, "geen <form>");
      if (!blok.includes("data-status-melding")) meld(naam, "geen [data-status-melding] om de bevestiging in te tonen");
      if (!blok.includes("data-honeypot")) meld(naam, "geen [data-honeypot]-veld (verplicht tegen spam)");
      if (!/type\s*=\s*"submit"/i.test(blok)) meld(naam, "geen knop met type=submit");
    }

    if (naam === "reviews") {
      if (!blok.includes("data-review-lijst")) meld(naam, "geen [data-review-lijst]");
      if (!/<template\b[^>]*data-review-sjabloon/i.test(blok)) meld(naam, "geen <template data-review-sjabloon>");
    }
  }

  return problemen;
}

const SCRIPT_BLOK = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;

/**
 * Rejects model-authored JavaScript. Everything interactive now has a widget,
 * so a hand-written script is either a duplicate of one (with its own subtle
 * differences per generation) or something nobody validated at all. The one
 * exception is a `tailwind.config` assignment in the head, which is
 * configuration rather than behaviour — it touches no DOM and cannot break at
 * runtime.
 */
export function controleerGeenEigenScripts(bestand: string, html: string, isHead: boolean): WidgetProbleem[] {
  const problemen: WidgetProbleem[] = [];

  for (const match of html.matchAll(SCRIPT_BLOK)) {
    const attributen = match[1] ?? "";
    const inhoud = (match[2] ?? "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").trim();

    if (/\bsrc\s*=/i.test(attributen)) {
      problemen.push({ bestand, widget: "script", reden: "externe <script src> is niet toegestaan" });
      continue;
    }
    const isTailwindConfig =
      isHead && /^tailwind\.config\s*=/.test(inhoud) && !/\b(document|window|fetch|addEventListener)\b/.test(inhoud);
    if (!isTailwindConfig) {
      problemen.push({
        bestand,
        widget: "script",
        reden: isHead
          ? "eigen <script> in HEAD — enkel een tailwind.config-toewijzing is toegestaan"
          : "eigen <script> — gebruik een van de data-widget-blokken in plaats van eigen JavaScript",
      });
    }
  }

  // Inline handlers are the same problem in a smaller wrapper.
  const handler = /\son(click|change|submit|load|input|keydown|mouseover)\s*=/i.exec(html);
  if (handler) {
    problemen.push({ bestand, widget: "script", reden: `inline ${handler[0].trim()}-handler — gebruik een data-widget-blok` });
  }

  return problemen;
}

/**
 * Fills in `data-endpoint` on every widget that talks to the hosting layer.
 * The generated markup never contains a hosting URL — the builder knows the
 * lead id, the model doesn't, and a hard-coded one would break the moment the
 * custom domain from spec section 2 lands.
 */
export function vulEndpointsIn(html: string, leadId: string): string {
  return html
    .replace(
      /(<[a-z]+\b[^>]*\bdata-widget\s*=\s*"formulier"[^>]*)>/gi,
      (_m, open) => `${open.replace(/\s+data-endpoint="[^"]*"/gi, "")} data-endpoint="/${leadId}/formulier">`,
    )
    .replace(
      /(<[a-z]+\b[^>]*\bdata-widget\s*=\s*"reviews"[^>]*)>/gi,
      (_m, open) => `${open.replace(/\s+data-endpoint="[^"]*"/gi, "")} data-endpoint="/${leadId}/reviews">`,
    );
}

// ─────────────────────────────────────────────────────────────────────────
// The prompt fragment describing the contract above
// ─────────────────────────────────────────────────────────────────────────

export const WIDGET_PROMPT = `Interactieve onderdelen: schrijf hier NOOIT eigen JavaScript voor. De
code voegt op elke pagina één vaste, geteste runtime toe die de onderstaande blokken laat werken
zodra je de juiste data-attributen gebruikt. Eigen <script>-blokken worden geweigerd. Gebruik een
blok alleen als de inhoud er echt om vraagt — een quiz op een bakkerssite hoort er niet.

Alle blokken zijn gewone Tailwind-markup; vormgeving kies je zelf. Verplicht is enkel de structuur:

MOBIEL MENU — verplicht in ===NAV=== zodra je een hamburgerknop gebruikt. Schrijf hier zelf geen
toggle-script voor; de runtime doet aria-expanded, sluiten met Escape en sluiten bij het klikken
van een link:
<header data-widget="menu">
  ... desktopmenu ...
  <button data-menu-knop class="lg:hidden" aria-label="Menu openen">...</button>
  <div data-menu-paneel class="hidden lg:hidden">... dezelfde links, mobiel ...</div>
</header>
(De klasse die verborgen/zichtbaar wisselt is standaard "hidden"; met data-menu-klasse kies je
een andere.)

FAQ-ACCORDION — native <details>, werkt ook zonder JavaScript:
<div data-widget="accordion">
  <details><summary>Vraag?</summary><div>Antwoord.</div></details>
  <details><summary>Nog een vraag?</summary><div>Antwoord.</div></details>
</div>
(Standaard sluit het openen van één item de andere; zet data-accordion-enkel="nee" als ze
tegelijk open mogen staan.)

TABS — voor één onderwerp in meerdere invalshoeken op dezelfde pagina:
<div data-widget="tabs">
  <div data-tabs-lijst><button data-tab="a">Aanleg</button><button data-tab="b">Onderhoud</button></div>
  <div data-tab-paneel="a">...</div>
  <div data-tab-paneel="b">...</div>
</div>
Elke data-tab moet een data-tab-paneel met dezelfde waarde hebben, en omgekeerd.

QUIZ — enkel bij educatieve inhoud:
<div data-widget="quiz">
  <div data-vraag="Welke bodem is het best?">
    <p>Welke bodem is het best?</p>
    <button data-antwoord data-juist>Zandgrond</button>
    <button data-antwoord>Beton</button>
    <div data-uitleg-blok hidden>Zandgrond watert goed af.</div>
  </div>
  <p data-quiz-score hidden></p>
</div>
Exact één data-juist per vraag, minstens twee antwoorden.

VIDEO — enkel met een ID/URL die LETTERLIJK in de research of notities staat. Verzin nooit een
YouTube- of Vimeo-ID; een verzonnen ID is een kapotte video en de build weigert hem.
<div data-widget="video" data-video-bron="youtube" data-video-id="dQw4w9WgXcQ" data-video-titel="Onze werkwijze">
  <button data-video-knop class="...">Video afspelen</button>
</div>
(data-video-bron mag ook "vimeo" met een numeriek data-video-id, of "bestand" met data-video-url.)

DOWNLOADS — gewone links naar bestanden die de gebruiker bij deze lead heeft geüpload; die staan
in de meegegeven lijst met beschikbare bestanden. Link nooit naar een bestand dat daar niet in
staat.
<div data-widget="downloads">
  <a href="bestanden/brochure.pdf" download>Brochure (PDF)</a>
</div>

FORMULIER — contact- of offerteformulier. De code vult het verzendadres zelf in:
<div data-widget="formulier" data-soort="contact" data-bevestiging="Bedankt, we bellen u binnen 2 werkdagen.">
  <form>
    <label>Naam <input name="naam" required></label>
    <label>E-mail <input type="email" name="email" required></label>
    <label>Bericht <textarea name="bericht" required></textarea></label>
    <div data-honeypot aria-hidden="true"><label>Laat dit veld leeg <input name="website" tabindex="-1"></label></div>
    <button type="submit">Versturen</button>
  </form>
  <p data-status-melding hidden></p>
</div>
Het data-honeypot-veld is verplicht (spam). data-soort="offerte" of "review" mag ook; bij een
review hoort een <select name="score"> met 1 t/m 5 in het formulier.

REVIEWS — toont echte, goedgekeurde reviews zodra die er zijn; wat jij schrijft is de
plaatsvervanger tot dan. Zet daarom echte, uit de research afkomstige testimonials in de lijst
als die er zijn, en anders niets verzonnens:
<div data-widget="reviews">
  <div data-review-lijst>...jouw markup per review...</div>
  <template data-review-sjabloon>
    <article><p data-review-score></p><p data-review-tekst></p><p data-review-naam></p></article>
  </template>
</div>

COMMUNITY — gewone links naar de kanalen die in de research staan (Discord, Facebook, Instagram):
<div data-widget="community"><a href="https://discord.gg/..." rel="noopener">Discord</a></div>`;

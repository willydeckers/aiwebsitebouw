// Previews render the stored HTML through `srcdoc`, not by navigating to a
// URL — Supabase Storage never serves stored objects as renderable text/html
// (see version-actions.ts). A document loaded that way has no origin and no
// directory, so the relative <a href="over-ons.html"> links that make the real
// site work resolve to nothing here: clicking one inside the preview would go
// to about:blank.
//
// So the preview intercepts those clicks and asks its parent window to swap in
// the other page's HTML, which the parent already has in memory. Anchors,
// mailto:, tel: and external links are left to behave normally.
export const PREVIEW_NAVIGATIE_BERICHT = "demo-preview-navigatie";

export type PreviewNavigatieBericht = {
  type: typeof PREVIEW_NAVIGATIE_BERICHT;
  bestand: string;
  hash: string;
};

const NAVIGATIE_SCRIPT = `<script>
(function () {
  document.addEventListener("click", function (event) {
    var el = event.target;
    while (el && el.nodeName !== "A") el = el.parentElement;
    if (!el) return;
    var href = el.getAttribute("href") || "";
    if (!href || /^(https?:|mailto:|tel:|data:|javascript:|#|\\/\\/)/i.test(href)) return;
    event.preventDefault();
    var hashIndex = href.indexOf("#");
    parent.postMessage(
      {
        type: ${JSON.stringify(PREVIEW_NAVIGATIE_BERICHT)},
        bestand: (hashIndex === -1 ? href : href.slice(0, hashIndex)).replace(/^\\.\\//, ""),
        hash: hashIndex === -1 ? "" : href.slice(hashIndex),
      },
      "*"
    );
  }, true);
})();
</script>`;

// Deliberately waits for load + a beat rather than scrolling inline: the
// generated pages pull Tailwind from the CDN, so at parse time the document is
// still unstyled and every section sits at roughly y=0. Scrolling then lands
// nowhere and the restyle drops you back at the top (observed: a
// contact.html#offerte link left the preview at scrollTop 0 with the target at
// 869px).
function scrollScript(hash: string): string {
  if (!hash || hash === "#") return "";
  return `<script>
(function () {
  function spring() {
    var doel = document.querySelector(${JSON.stringify(hash)});
    // behavior:"auto" on purpose — generated pages set scroll-behavior:smooth
    // for their own anchor links, and a smooth scroll is animation-driven, so
    // it silently does nothing in an iframe the browser isn't currently
    // compositing. This jump has to land whether or not the panel is on screen.
    if (doel) doel.scrollIntoView({ behavior: "auto", block: "start" });
  }
  window.addEventListener("load", function () { setTimeout(spring, 150); });
})();
</script>`;
}

/**
 * Wraps a stored page for preview: the same HTML plus the click interceptor,
 * and (when arriving via a `page.html#sectie` link) a jump to that section.
 */
export function bouwPreviewDocument(html: string, hash = ""): string {
  const extra = NAVIGATIE_SCRIPT + scrollScript(hash);
  return html.includes("</body>") ? html.replace("</body>", `${extra}\n</body>`) : html + extra;
}

/** Every preview opens on the home page — the builder requires index.html to
 *  exist, and single-file versions are keyed under that name too. */
export const START_PAGINA = "index.html";

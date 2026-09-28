"use client";

import { useEffect, useRef, useState } from "react";
import type { SiteVersion } from "@/lib/types";
import { fetchDemoSite, type DemoSite } from "./version-actions";
import {
  bouwPreviewDocument,
  PREVIEW_NAVIGATIE_BERICHT,
  START_PAGINA,
  type PreviewNavigatieBericht,
} from "./preview-document";

// De site op volledig scherm bekijken.
//
// Dit vervangt het losse popup-venster dat hier eerst stond. Dat werkte in de
// praktijk niet: `window.open` wordt geblokkeerd door de popup-blocker van een
// gewone browser én door de WebView van de verpakte Windows-app, en dan kreeg
// je enkel de melding "kon geen popup openen" — precies op het moment dat je
// de site aan een klant wil tonen. Een overlay in de app zelf kan niet
// geblokkeerd worden en werkt overal hetzelfde.
//
// De pagina's staan in het geheugen, niet op een URL: interne links kunnen dus
// niet zelf navigeren (zie preview-document.ts). De iframe vraagt de pagina op
// via postMessage en de wissel gebeurt hier.

type Viewport = "desktop" | "tablet" | "mobiel";

const VIEWPORT_BREEDTE: Record<Viewport, string> = {
  desktop: "100%",
  tablet: "820px",
  mobiel: "390px",
};

const VIEWPORT_LABEL: Record<Viewport, string> = {
  desktop: "Desktop",
  tablet: "Tablet",
  mobiel: "Mobiel",
};

export function SitePreviewVenster({
  version,
  titel,
  onClose,
}: {
  version: SiteVersion;
  titel?: string;
  onClose: () => void;
}) {
  const [site, setSite] = useState<DemoSite | null>(null);
  const [huidigePagina, setHuidigePagina] = useState(START_PAGINA);
  const [hash, setHash] = useState("");
  const [viewport, setViewport] = useState<Viewport>("desktop");
  const [fout, setFout] = useState<string | null>(null);
  const [laadt, setLaadt] = useState(true);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  // Opnieuw ophalen zodra deze versie inhoudelijk verandert (een chat-edit of
  // een bewaring in de editor zet laatst_bewerkt_op), niet bij elk nieuw
  // object dat de ouder na een refetch doorgeeft. Blijft het dezelfde versie,
  // dan blijf je ook op dezelfde pagina staan.
  const [geladenVersie, setGeladenVersie] = useState<string | null>(null);
  useEffect(() => {
    let afgebroken = false;
    fetchDemoSite(version).then((geladen) => {
      if (afgebroken) return;
      setSite(geladen);
      if (geladenVersie !== version.id) {
        setHuidigePagina(START_PAGINA);
        setHash("");
      }
      setGeladenVersie(version.id);
      setFout(geladen ? null : "Kon deze versie niet ophalen.");
      setLaadt(false);
    });
    return () => {
      afgebroken = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version.id, version.content_referentie, version.laatst_bewerkt_op]);

  // Capture-fase + stopImmediatePropagation: Escape sluit enkel deze laag, niet
  // ook de werkruimte of het leadpaneel eronder (die luisteren in de
  // bubbelfase en krijgen de toets dan niet meer).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      e.stopImmediatePropagation();
      onClose();
    }
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      const bericht = event.data as PreviewNavigatieBericht | undefined;
      if (bericht?.type !== PREVIEW_NAVIGATIE_BERICHT || !site) return;
      if (event.source !== iframeRef.current?.contentWindow) return;
      if (!site[bericht.bestand]) {
        setFout(`Deze link wijst naar ${bericht.bestand}, maar die pagina bestaat niet in deze versie.`);
        return;
      }
      setFout(null);
      setHuidigePagina(bericht.bestand);
      setHash(bericht.hash);
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [site]);

  const paginas = version.paginas ?? [];
  const label = (bestand: string) =>
    paginas.find((p) => p.bestand === bestand)?.nav_label ?? bestand;
  const html = site?.[huidigePagina] ?? null;

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-slate-100">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white px-5 py-3">
        <div className="min-w-0">
          <h2 className="truncate text-sm font-semibold text-slate-900">
            {titel ?? `Versie ${version.versienummer}`}
          </h2>
          <p className="text-xs text-slate-500">
            {version.status}
            {paginas.length > 1 ? ` · ${paginas.length} pagina's` : ""}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {paginas.length > 1 ? (
            <select
              value={huidigePagina}
              onChange={(e) => {
                setHuidigePagina(e.target.value);
                setHash("");
                setFout(null);
              }}
              aria-label="Pagina"
              className="rounded-xl border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-700 outline-none focus:border-blue-400"
            >
              {paginas.map((p) => (
                <option key={p.bestand} value={p.bestand}>
                  {p.nav_label}
                </option>
              ))}
            </select>
          ) : null}

          <div className="flex gap-1">
            {(Object.keys(VIEWPORT_BREEDTE) as Viewport[]).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setViewport(v)}
                className={`rounded-xl px-2.5 py-1.5 text-xs font-medium ${
                  viewport === v
                    ? "bg-blue-600 text-white"
                    : "border border-slate-200 text-slate-600 hover:bg-slate-50"
                }`}
              >
                {VIEWPORT_LABEL[v]}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-slate-200 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100"
          >
            Sluiten
          </button>
        </div>
      </header>

      {fout ? (
        <p className="border-b border-amber-200 bg-amber-50 px-5 py-2 text-xs text-amber-900">{fout}</p>
      ) : null}

      <div className="flex flex-1 justify-center overflow-auto p-4">
        {laadt ? (
          <p className="mt-10 text-sm text-slate-500">Laden…</p>
        ) : html ? (
          <iframe
            ref={iframeRef}
            key={`${huidigePagina}${hash}`}
            srcDoc={bouwPreviewDocument(html, hash)}
            title={`Preview — ${label(huidigePagina)}`}
            className="h-full rounded-xl border border-slate-200 bg-white shadow-sm transition-[width]"
            style={{ width: VIEWPORT_BREEDTE[viewport] }}
          />
        ) : (
          <p className="mt-10 text-sm text-slate-500">Geen inhoud om te tonen.</p>
        )}
      </div>
    </div>
  );
}

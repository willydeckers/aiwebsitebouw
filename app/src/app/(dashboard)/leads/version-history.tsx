"use client";

import { useState, useTransition } from "react";
import type { SiteVersion, SiteVersionStatus } from "@/lib/types";
import { activateVersion, fetchDemoSite, revertToVersion } from "./version-actions";
import {
  bouwPreviewDocument,
  PREVIEW_NAVIGATIE_BERICHT,
  START_PAGINA,
  type PreviewNavigatieBericht,
} from "./preview-document";

const STATUS_LABELS: Record<SiteVersionStatus, string> = {
  concept: "Concept",
  afgerond: "Afgerond",
  actief: "Actief",
};

export function VersionHistory({
  leadId,
  versions,
  onChanged,
}: {
  leadId: string;
  versions: SiteVersion[];
  onChanged: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Opens a real popup window rather than expanding inline — a full window
  // gives a much better sense of "this is what the lead will actually see"
  // than a cramped iframe in the panel, and it's reused per version (same
  // window name) so repeat clicks don't pile up new windows.
  //
  // The window has to open synchronously, in the same tick as the click —
  // browsers only allow window.open() without being treated (and blocked)
  // as an unsolicited popup when it's directly inside a user-gesture
  // handler. Opening it first and writing the fetched HTML into it once
  // that resolves keeps it inside that gesture; opening it only after the
  // `await fetchDemoHtml(...)` (i.e. once the fetch resolves) is what
  // browsers block.
  function handlePreview(version: SiteVersion) {
    setError(null);
    if (!version.content_referentie) {
      setError("Deze versie heeft geen opgeslagen inhoud.");
      return;
    }
    const popup = window.open("", `demo-preview-${version.id}`, "width=1280,height=900");
    if (!popup) {
      setError("Kon geen popup-venster openen — controleer of je browser popups blokkeert voor deze site.");
      return;
    }
    popup.document.title = `Versie ${version.versienummer} — laden...`;
    popup.document.body.innerHTML =
      "<p style='font-family:sans-serif;padding:2rem;color:#64748b'>Laden...</p>";

    startTransition(async () => {
      const site = await fetchDemoSite(version);
      if (!site) {
        setError("Kon deze versie niet ophalen.");
        popup.close();
        return;
      }

      // The site's pages live in memory here, not at a URL, so the popup gets
      // a full-window iframe it can swap between them (see preview-document.ts
      // for why the pages can't just link to each other directly). Built with
      // DOM calls rather than document.write of a script: same-origin popup,
      // so no escaping of the page HTML is needed anywhere.
      popup.document.open();
      popup.document.write(
        "<!DOCTYPE html><html lang='nl'><head><meta charset='utf-8'>" +
          "<style>html,body{margin:0;height:100%}iframe{display:block;border:0;width:100%;height:100%}</style>" +
          "</head><body><iframe id='pagina'></iframe></body></html>",
      );
      popup.document.close();
      popup.document.title = `Versie ${version.versienummer} — preview`;

      const frame = popup.document.getElementById("pagina") as HTMLIFrameElement;
      const toon = (bestand: string, hash: string) => {
        frame.srcdoc = bouwPreviewDocument(site[bestand], hash);
      };

      popup.addEventListener("message", (event: MessageEvent) => {
        const bericht = event.data as PreviewNavigatieBericht | undefined;
        if (bericht?.type !== PREVIEW_NAVIGATIE_BERICHT) return;
        if (!site[bericht.bestand]) {
          popup.alert(`Deze link wijst naar ${bericht.bestand}, maar die pagina bestaat niet in deze versie.`);
          return;
        }
        toon(bericht.bestand, bericht.hash);
      });

      toon(START_PAGINA, "");
      popup.focus();
    });
  }

  function handleActivate(version: SiteVersion) {
    setError(null);
    startTransition(async () => {
      const result = await activateVersion(leadId, version.id);
      if (result) setError(result);
      else onChanged();
    });
  }

  function handleRevert(version: SiteVersion) {
    setError(null);
    startTransition(async () => {
      const result = await revertToVersion(leadId, version);
      if (result) setError(result);
      else onChanged();
    });
  }

  if (versions.length === 0) return null;

  return (
    <section className="mt-6 space-y-2 text-sm">
      <h3 className="font-medium text-slate-700">Versiegeschiedenis (3.5/3.8)</h3>
      <ul className="space-y-1">
        {versions.map((version) => (
          <li key={version.id} className="rounded-xl border border-blue-100 p-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-slate-700">
                Versie {version.versienummer} — {STATUS_LABELS[version.status]}
              </span>
              <div className="flex gap-2 text-xs">
                <button
                  type="button"
                  onClick={() => handlePreview(version)}
                  disabled={pending}
                  className="text-blue-600 hover:underline disabled:opacity-50"
                >
                  Bekijk
                </button>
                {version.status === "afgerond" ? (
                  <button
                    type="button"
                    onClick={() => handleActivate(version)}
                    disabled={pending}
                    className="text-blue-600 hover:underline disabled:opacity-50"
                  >
                    Maak deze actief
                  </button>
                ) : null}
                {version.status !== "concept" ? (
                  <button
                    type="button"
                    onClick={() => handleRevert(version)}
                    disabled={pending}
                    className="text-slate-500 hover:underline disabled:opacity-50"
                  >
                    Herstel als nieuwe versie
                  </button>
                ) : null}
              </div>
            </div>
          </li>
        ))}
      </ul>
      {error ? <p className="text-xs text-red-600">{error}</p> : null}
    </section>
  );
}

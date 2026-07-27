"use client";

import { useState, useTransition } from "react";
import type { SiteVersion, SiteVersionStatus } from "@/lib/types";
import { activateVersion, fetchDemoHtml, revertToVersion } from "./version-actions";

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
      const html = await fetchDemoHtml(version.content_referentie!);
      if (!html) {
        setError("Kon deze versie niet ophalen.");
        popup.close();
        return;
      }
      popup.document.open();
      popup.document.write(html);
      popup.document.close();
      popup.document.title = `Versie ${version.versienummer} — preview`;
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

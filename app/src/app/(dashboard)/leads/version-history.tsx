"use client";

import { useState, useTransition } from "react";
import type { SiteVersion, SiteVersionStatus } from "@/lib/types";
import { activateVersion, revertToVersion } from "./version-actions";
import { SitePreviewVenster } from "./site-preview-venster";

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
  const [preview, setPreview] = useState<SiteVersion | null>(null);

  // Een overlay in de app, geen apart venster: window.open wordt geblokkeerd
  // door de popup-blocker van een browser en door de WebView van de verpakte
  // app, en dan kreeg je enkel een foutmelding. Zie site-preview-venster.tsx.
  function handlePreview(version: SiteVersion) {
    setError(null);
    if (!version.content_referentie) {
      setError("Deze versie heeft geen opgeslagen inhoud.");
      return;
    }
    setPreview(version);
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
      <h3 className="font-medium text-slate-700">Versiegeschiedenis</h3>
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

      {preview ? (
        <SitePreviewVenster
          version={preview}
          titel={`Versie ${preview.versienummer}`}
          onClose={() => setPreview(null)}
        />
      ) : null}
    </section>
  );
}

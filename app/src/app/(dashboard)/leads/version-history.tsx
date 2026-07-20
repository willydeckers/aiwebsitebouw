"use client";

import { useState, useTransition } from "react";
import type { SiteVersion, SiteVersionStatus } from "@/lib/types";
import { activateVersion, fetchSignedDemoUrl, revertToVersion } from "./version-actions";

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
  const [previewFor, setPreviewFor] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handlePreview(version: SiteVersion) {
    setError(null);
    if (previewFor === version.id) {
      setPreviewFor(null);
      setPreviewUrl(null);
      return;
    }
    if (!version.content_referentie) {
      setError("Deze versie heeft geen opgeslagen inhoud.");
      return;
    }
    startTransition(async () => {
      const url = await fetchSignedDemoUrl(version.content_referentie!);
      if (!url) {
        setError("Kon deze versie niet ophalen.");
        return;
      }
      setPreviewFor(version.id);
      setPreviewUrl(url);
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
                  {previewFor === version.id ? "Verberg" : "Bekijk"}
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
            {previewFor === version.id && previewUrl ? (
              <iframe
                src={previewUrl}
                title={`Versie ${version.versienummer}`}
                className="mt-2 h-96 w-full rounded-xl border border-blue-100 bg-white"
              />
            ) : null}
          </li>
        ))}
      </ul>
      {error ? <p className="text-xs text-red-600">{error}</p> : null}
    </section>
  );
}

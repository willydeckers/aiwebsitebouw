"use client";

import { useState, useTransition } from "react";
import { generateStaffInvite } from "./staff-actions";

export function StaffInviteButton({
  klantId,
  status,
  onChanged,
}: {
  klantId: string;
  status: string | null;
  onChanged: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [stappen, setStappen] = useState<{ reden: string; instructies: string[] } | null>(null);
  const [metBestellingen, setMetBestellingen] = useState(false);
  const [pending, startTransition] = useTransition();

  function haalStappen() {
    setError(null);
    startTransition(async () => {
      const resultaat = await generateStaffInvite(klantId, metBestellingen);
      if (resultaat.soort === "fout") setError(resultaat.bericht);
      else if (resultaat.soort === "handmatig") setStappen(resultaat);
      else onChanged();
    });
  }

  function bevestig() {
    setError(null);
    startTransition(async () => {
      const resultaat = await generateStaffInvite(klantId, metBestellingen, true);
      if (resultaat.soort === "fout") setError(resultaat.bericht);
      else {
        setStappen(null);
        onChanged();
      }
    });
  }

  return (
    <div className="mt-3 space-y-2">
      <label className="flex items-center gap-2 text-xs text-slate-600">
        <input
          type="checkbox"
          checked={metBestellingen}
          onChange={(e) => setMetBestellingen(e.target.checked)}
        />
        Ook toegang tot Bestellingen (spec sectie 4 — optioneel)
      </label>

      <button
        type="button"
        onClick={haalStappen}
        disabled={pending}
        title="Shopify heeft geen API om staff uit te nodigen — dit toont de stappen en noteert het resultaat."
        className="rounded-xl border border-blue-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-blue-50 disabled:opacity-50"
      >
        {pending ? "Bezig..." : "Staff-uitnodiging voorbereiden"}
      </button>

      {stappen ? (
        <div className="space-y-2 rounded-xl border border-amber-200 bg-amber-50/60 p-3 text-xs">
          <p className="text-amber-900">{stappen.reden}</p>
          <ol className="list-decimal space-y-1 pl-4 text-slate-700">
            {stappen.instructies.map((stap) => (
              <li key={stap}>{stap}</li>
            ))}
          </ol>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={bevestig}
              disabled={pending}
              className="rounded-xl bg-blue-600 px-3 py-1 font-medium text-white disabled:opacity-50"
            >
              Gedaan — noteer als uitgenodigd
            </button>
            <button
              type="button"
              onClick={() => setStappen(null)}
              className="rounded-xl border border-blue-200 px-3 py-1 text-slate-600"
            >
              Annuleer
            </button>
          </div>
        </div>
      ) : null}

      {status ? <p className="text-xs text-slate-500">Status: {status}</p> : null}
      {error ? <p className="text-xs text-red-600">{error}</p> : null}
    </div>
  );
}

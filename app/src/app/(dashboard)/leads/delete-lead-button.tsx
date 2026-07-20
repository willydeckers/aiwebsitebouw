"use client";

import { useState, useTransition } from "react";
import { deleteLead } from "./actions";

export function DeleteLeadButton({
  leadId,
  onDeleted,
}: {
  leadId: string;
  onDeleted: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleConfirm() {
    setError(null);
    startTransition(async () => {
      const result = await deleteLead(leadId);
      if (result) {
        setError(result);
      } else {
        onDeleted();
      }
    });
  }

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="text-xs text-red-500 hover:text-red-700"
      >
        Lead verwijderen
      </button>
    );
  }

  return (
    <div className="space-y-1">
      <p className="text-xs text-red-600">
        Verwijdert deze lead en alle bijhorende demo-bestanden definitief. Zeker?
      </p>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={handleConfirm}
          disabled={pending}
          className="rounded-xl bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50"
        >
          {pending ? "Bezig..." : "Ja, verwijder"}
        </button>
        <button
          type="button"
          onClick={() => setConfirming(false)}
          disabled={pending}
          className="rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
        >
          Annuleer
        </button>
      </div>
      {error ? <p className="text-xs text-red-600">{error}</p> : null}
    </div>
  );
}

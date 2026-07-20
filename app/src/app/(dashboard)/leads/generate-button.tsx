"use client";

import { useState, useTransition } from "react";
import { startGeneration } from "./generate-actions";

export function GenerateButton({
  leadId,
  onChanged,
}: {
  leadId: string;
  onChanged: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleClick() {
    setError(null);
    startTransition(async () => {
      const result = await startGeneration(leadId);
      if (result) {
        setError(result);
      } else {
        onChanged();
      }
    });
  }

  return (
    <div className="space-y-1">
      <button
        type="button"
        onClick={handleClick}
        disabled={pending}
        title="Genereert de statische demo-HTML (spec 3.3) — vereist research-output en een geldige ANTHROPIC_API_KEY."
        className="w-full rounded-xl border border-blue-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-blue-50 disabled:opacity-50"
      >
        {pending ? "Demo wordt gegenereerd..." : "Genereer demo (test)"}
      </button>
      {error ? <p className="text-xs text-red-600">{error}</p> : null}
    </div>
  );
}

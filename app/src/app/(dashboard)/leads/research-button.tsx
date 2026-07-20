"use client";

import { useState, useTransition } from "react";
import { startResearch } from "./research-actions";

export function ResearchButton({
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
      const result = await startResearch(leadId);
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
        title="Roept de research-stap aan (spec 3.2) — vereist een geldige ANTHROPIC_API_KEY."
        className="w-full rounded-xl border border-blue-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-blue-50 disabled:opacity-50"
      >
        {pending ? "Research loopt..." : "Start research (test)"}
      </button>
      {error ? <p className="text-xs text-red-600">{error}</p> : null}
    </div>
  );
}

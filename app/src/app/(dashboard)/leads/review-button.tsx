"use client";

import { useState, useTransition } from "react";
import { startReview } from "./review-actions";

export function ReviewButton({
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
      const result = await startReview(leadId);
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
        title="Zet een review-job in de wachtrij (spec 3.4/2 — zware taak, verwerkt door de aparte worker). Voortgang komt binnen via Realtime."
        className="w-full rounded-xl border border-blue-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-blue-50 disabled:opacity-50"
      >
        {pending ? "Review-job aanmaken..." : "Start review (test)"}
      </button>
      {error ? <p className="text-xs text-red-600">{error}</p> : null}
    </div>
  );
}

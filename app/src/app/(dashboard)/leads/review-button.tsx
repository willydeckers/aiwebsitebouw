"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { startReview } from "./review-actions";

export function ReviewButton({ leadId }: { leadId: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleClick() {
    setError(null);
    startTransition(async () => {
      const result = await startReview(leadId);
      if (result) {
        setError(result);
      } else {
        router.refresh();
      }
    });
  }

  return (
    <div className="space-y-1">
      <button
        type="button"
        onClick={handleClick}
        disabled={pending}
        title="Screenshot + AI-beoordeling, max 5 iteraties (spec 3.4) — vereist een demo_url en een geldige ANTHROPIC_API_KEY."
        className="w-full rounded-xl border border-blue-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-blue-50 disabled:opacity-50"
      >
        {pending ? "Review loopt..." : "Start review (test)"}
      </button>
      {error ? <p className="text-xs text-red-600">{error}</p> : null}
    </div>
  );
}

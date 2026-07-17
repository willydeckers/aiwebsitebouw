"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { startGeneration } from "./generate-actions";

export function GenerateButton({ leadId }: { leadId: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleClick() {
    setError(null);
    startTransition(async () => {
      const result = await startGeneration(leadId);
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
        title="Genereert de statische demo-HTML (spec 3.3) — vereist research-output en een geldige ANTHROPIC_API_KEY."
        className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-100 disabled:opacity-50"
      >
        {pending ? "Demo wordt gegenereerd..." : "Genereer demo (test)"}
      </button>
      {error ? <p className="text-xs text-red-600">{error}</p> : null}
    </div>
  );
}

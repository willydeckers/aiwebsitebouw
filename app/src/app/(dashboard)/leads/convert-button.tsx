"use client";

import { useState, useTransition } from "react";
import { convertToKlant } from "./convert-actions";

export function ConvertButton({
  leadId,
  onChanged,
}: {
  leadId: string;
  onChanged: () => void;
}) {
  const [choosing, setChoosing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleChoose(type: "statisch" | "shopify") {
    setError(null);
    startTransition(async () => {
      const result = await convertToKlant(leadId, type);
      if (result) {
        setError(result);
      } else {
        setChoosing(false);
        onChanged();
      }
    });
  }

  if (!choosing) {
    return (
      <button
        type="button"
        onClick={() => setChoosing(true)}
        className="w-full rounded-xl border border-blue-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-blue-50"
      >
        Markeer als klant
      </button>
    );
  }

  return (
    <div className="space-y-1">
      <p className="text-xs text-slate-500">Kies het type (spec sectie 3.7 — eenrichtingsverkeer):</p>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => handleChoose("statisch")}
          disabled={pending}
          className="flex-1 rounded-xl border border-blue-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-blue-50 disabled:opacity-50"
        >
          {pending ? "Bezig..." : "Statisch"}
        </button>
        <button
          type="button"
          onClick={() => handleChoose("shopify")}
          disabled={pending}
          className="flex-1 rounded-xl border border-blue-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-blue-50 disabled:opacity-50"
        >
          {pending ? "Bezig..." : "Shopify"}
        </button>
      </div>
      {error ? <p className="text-xs text-red-600">{error}</p> : null}
    </div>
  );
}

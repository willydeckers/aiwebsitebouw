"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { generateStaffInvite } from "./staff-actions";

export function StaffInviteButton({
  klantId,
  status,
}: {
  klantId: string;
  status: string | null;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleClick() {
    setError(null);
    startTransition(async () => {
      const result = await generateStaffInvite(klantId);
      if (result) {
        setError(result);
      } else {
        router.refresh();
      }
    });
  }

  return (
    <div className="mt-3 space-y-1">
      <button
        type="button"
        onClick={handleClick}
        disabled={pending}
        title="Nodigt de klant uit als Shopify staff-account, beperkt tot Producten (spec 3.9)."
        className="rounded-xl border border-blue-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-blue-50 disabled:opacity-50"
      >
        {pending ? "Bezig..." : "Genereer staff-uitnodiging"}
      </button>
      {status ? <p className="text-xs text-slate-500">Status: {status}</p> : null}
      {error ? <p className="text-xs text-red-600">{error}</p> : null}
    </div>
  );
}

"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { LEAD_STATUSES, LEAD_STATUS_LABELS } from "@/lib/types";
import { AddLeadDialog } from "./add-lead-dialog";

export function LeadsToolbar({ activeStatus }: { activeStatus: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [dialogOpen, setDialogOpen] = useState(false);

  function handleStatusChange(value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value) {
      params.set("status", value);
    } else {
      params.delete("status");
    }
    params.delete("lead");
    router.push(`/leads${params.toString() ? `?${params.toString()}` : ""}`);
  }

  return (
    <div className="mt-4 flex items-center justify-between gap-3">
      <select
        value={activeStatus}
        onChange={(e) => handleStatusChange(e.target.value)}
        className="rounded-md border border-neutral-300 px-3 py-2 text-sm"
      >
        <option value="">Alle statussen</option>
        {LEAD_STATUSES.map((s) => (
          <option key={s} value={s}>
            {LEAD_STATUS_LABELS[s]}
          </option>
        ))}
      </select>

      <button
        onClick={() => setDialogOpen(true)}
        className="rounded-md bg-neutral-900 px-3 py-2 text-sm font-medium text-white"
      >
        + Lead toevoegen
      </button>

      <AddLeadDialog open={dialogOpen} onClose={() => setDialogOpen(false)} />
    </div>
  );
}

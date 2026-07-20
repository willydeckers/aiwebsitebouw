"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { LEAD_STATUSES, LEAD_STATUS_LABELS } from "@/lib/types";
import { AddLeadDialog } from "./add-lead-dialog";
import { SourcingConfigDialog } from "./sourcing-config-dialog";

export function LeadsToolbar({
  activeStatus,
  onLeadCreated,
}: {
  activeStatus: string;
  onLeadCreated: () => void;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [sourcingDialogOpen, setSourcingDialogOpen] = useState(false);

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
        className="rounded-xl border border-blue-200 bg-white/80 px-3 py-2 text-sm text-slate-900"
      >
        <option value="">Alle statussen</option>
        {LEAD_STATUSES.map((s) => (
          <option key={s} value={s}>
            {LEAD_STATUS_LABELS[s]}
          </option>
        ))}
      </select>

      <div className="flex items-center gap-2">
        <button
          onClick={() => setSourcingDialogOpen(true)}
          title="Sourcing-configuratie (spec 3.1a)"
          aria-label="Sourcing-configuratie"
          className="rounded-xl border border-blue-200 p-2 text-slate-600 hover:bg-blue-50"
        >
          ⚙
        </button>
        <button
          onClick={() => setDialogOpen(true)}
          className="rounded-xl bg-blue-600 px-3 py-2 text-sm font-medium text-white shadow-md shadow-blue-300/50 transition hover:bg-blue-500"
        >
          + Lead toevoegen
        </button>
      </div>

      <AddLeadDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        onCreated={onLeadCreated}
      />
      <SourcingConfigDialog open={sourcingDialogOpen} onClose={() => setSourcingDialogOpen(false)} />
    </div>
  );
}

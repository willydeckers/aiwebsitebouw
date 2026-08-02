"use client";

import { useCallback, useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { Lead, LeadStatus } from "@/lib/types";
import { LeadsToolbar } from "./leads-toolbar";
import { LeadsTable } from "./leads-table";
import { LeadDetailPanel } from "./lead-detail-panel";

export default function LeadsPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const status = searchParams.get("status") ?? "";
  const selectedLeadId = searchParams.get("lead");

  const [leads, setLeads] = useState<Lead[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadLeads = useCallback(() => {
    const supabase = createClient();
    let query = supabase.from("leads").select("*").order("aangemaakt_op", { ascending: false });
    // "actief" and "aandacht" are groups, not statuses — the overview tiles
    // link here with those, since "3 leads need attention" is only useful if
    // clicking it shows you which three.
    if (status === "actief") {
      query = query.in("status", ["nieuw", "research", "genereren", "klaar"]);
    } else if (status === "aandacht") {
      query = query.in("status", ["geblokkeerd", "budget_overschreden"]);
    } else if (status) {
      query = query.eq("status", status as LeadStatus);
    }

    query.then(({ data, error }) => {
      if (error) setError(error.message);
      else {
        setError(null);
        setLeads(data as Lead[]);
      }
    });
  }, [status]);

  useEffect(() => {
    loadLeads();

    // Spec section 2 only names jobs/site_versions/review_log for Realtime,
    // but a job finishing is exactly what changes a lead's status — so a
    // jobs change is the signal to refresh the leads list too.
    const supabase = createClient();
    const channel = supabase
      .channel("leads-page-jobs")
      .on("postgres_changes", { event: "*", schema: "public", table: "jobs" }, () => loadLeads())
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [loadLeads]);

  const selectedLead = selectedLeadId
    ? (leads ?? []).find((l) => l.id === selectedLeadId) ?? null
    : null;

  return (
    <div>
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-slate-900">Leads</h1>
      </div>

      <LeadsToolbar activeStatus={status} onLeadCreated={loadLeads} />

      {error ? (
        <p className="mt-4 text-sm text-red-600">Kon leads niet laden: {error}</p>
      ) : leads === null ? (
        <p className="mt-6 text-sm text-slate-500">Laden...</p>
      ) : (
        <LeadsTable leads={leads} />
      )}

      {selectedLead ? (
        <LeadDetailPanel
          key={selectedLead.id}
          lead={selectedLead}
          onChanged={loadLeads}
          onClose={() => {
            const params = new URLSearchParams(searchParams.toString());
            params.delete("lead");
            router.push(`/leads${params.toString() ? `?${params.toString()}` : ""}`);
          }}
        />
      ) : null}
    </div>
  );
}

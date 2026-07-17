import { createClient } from "@/lib/supabase/server";
import type { Lead, LeadStatus } from "@/lib/types";
import { LeadsToolbar } from "./leads-toolbar";
import { LeadsTable } from "./leads-table";
import { LeadDetailPanel } from "./lead-detail-panel";

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; lead?: string }>;
}) {
  const { status, lead: selectedLeadId } = await searchParams;

  const supabase = await createClient();

  let query = supabase
    .from("leads")
    .select("*")
    .order("aangemaakt_op", { ascending: false });

  if (status) {
    query = query.eq("status", status as LeadStatus);
  }

  const { data: leads, error } = await query;

  const selectedLead = selectedLeadId
    ? (leads ?? []).find((l) => l.id === selectedLeadId) ?? null
    : null;

  return (
    <div>
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-neutral-900">Leads</h1>
      </div>

      <LeadsToolbar activeStatus={status ?? ""} />

      {error ? (
        <p className="mt-4 text-sm text-red-600">
          Kon leads niet laden: {error.message}
        </p>
      ) : (
        <LeadsTable leads={(leads ?? []) as Lead[]} />
      )}

      {selectedLead ? <LeadDetailPanel lead={selectedLead as Lead} /> : null}
    </div>
  );
}

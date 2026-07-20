"use client";

import { useEffect, useState } from "react";
import type { Lead, SiteVersion, ReviewLogEntry } from "@/lib/types";
import { LEAD_PIPELINE, LEAD_STATUS_LABELS } from "@/lib/types";
import { fetchCostSummary, type CostSummary } from "@/lib/costs";
import { createClient } from "@/lib/supabase/client";
import { updateLeadNotities } from "./actions";
import { StatusBadge } from "./status-badge";
import { ResearchButton } from "./research-button";
import { GenerateButton } from "./generate-button";
import { ReviewButton } from "./review-button";
import { DemoPreview } from "./demo-preview";
import { ConvertButton } from "./convert-button";
import { CostSummaryView } from "./cost-summary-view";
import { DeleteLeadButton } from "./delete-lead-button";

export function LeadDetailPanel({
  lead,
  onChanged,
  onClose,
}: {
  lead: Lead;
  onChanged: () => void;
  onClose: () => void;
}) {
  const [notities, setNotities] = useState(lead.notities ?? "");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [siteVersion, setSiteVersion] = useState<SiteVersion | null>(null);
  const [reviewLog, setReviewLog] = useState<ReviewLogEntry[]>([]);
  const [costSummary, setCostSummary] = useState<CostSummary | null>(null);

  useEffect(() => {
    const supabase = createClient();

    fetchCostSummary(supabase, lead.id).then(setCostSummary);

    supabase
      .from("site_versions")
      .select("*")
      .eq("lead_id", lead.id)
      .order("versienummer", { ascending: false })
      .limit(1)
      .maybeSingle()
      .then(({ data }) => setSiteVersion(data as SiteVersion | null));

    supabase
      .from("review_log")
      .select("*")
      .eq("lead_id", lead.id)
      .order("timestamp", { ascending: false })
      .limit(5)
      .then(({ data }) => setReviewLog((data as ReviewLogEntry[]) ?? []));

    // Spec section 2: Realtime on site_versions/review_log.
    const channel = supabase
      .channel(`lead-detail-${lead.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "site_versions", filter: `lead_id=eq.${lead.id}` },
        (payload) => setSiteVersion(payload.new as SiteVersion),
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "review_log", filter: `lead_id=eq.${lead.id}` },
        (payload) => setReviewLog((prev) => [payload.new as ReviewLogEntry, ...prev].slice(0, 5)),
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [lead.id]);

  async function handleBlur() {
    if (notities === (lead.notities ?? "")) return;
    setSaving(true);
    const error = await updateLeadNotities(lead.id, notities);
    setSaveError(error);
    setSaving(false);
    if (!error) onChanged();
  }

  const pipelineIndex = LEAD_PIPELINE.indexOf(lead.status);
  const isSideState = pipelineIndex === -1; // geblokkeerd / budget_overschreden / dood

  const demoHostingBase = process.env.NEXT_PUBLIC_DEMO_HOSTING_URL;
  const demoUrl =
    siteVersion && demoHostingBase ? `${demoHostingBase}/${lead.id}` : null;

  return (
    <div className="fixed inset-0 z-10 flex justify-end bg-slate-900/20 backdrop-blur-sm">
      <div
        className={`h-full w-full overflow-y-auto border-l border-white/60 bg-white/80 p-6 shadow-xl shadow-blue-200/40 backdrop-blur-xl ${
          siteVersion ? "max-w-3xl" : "max-w-md"
        }`}
      >
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-base font-semibold text-slate-900">
              {lead.bedrijfsnaam}
            </h2>
            <p className="text-sm text-slate-500">{lead.sector}</p>
          </div>
          <button
            onClick={onClose}
            className="text-sm text-slate-500 hover:text-slate-800"
          >
            Sluiten
          </button>
        </div>

        <section className="mt-6 space-y-1 text-sm">
          <h3 className="font-medium text-slate-700">Bedrijfsgegevens</h3>
          <p className="text-slate-600">{lead.adres || "Geen adres"}</p>
          <p className="text-slate-600">
            {lead.contact_naam || "Geen contactpersoon"}
          </p>
          <p className="text-slate-600">
            {lead.contact_email || "Geen contact e-mail"}
            {lead.contact_email_persoonsgebonden ? (
              <span className="ml-1 text-xs text-amber-600">
                (persoonsgebonden — zie GDPR-regel spec 7)
              </span>
            ) : null}
          </p>
          {lead.herkomst === "sourcing" ? (
            <p className="text-xs text-slate-400">Herkomst: automatische sourcing-run</p>
          ) : null}
        </section>

        <section className="mt-6">
          {lead.klant_type ? (
            <p className="text-sm text-slate-600">
              Klant — type: <span className="font-medium">{lead.klant_type}</span>
              {lead.shopify_store_id ? ` (store: ${lead.shopify_store_id})` : ""}
            </p>
          ) : (
            <ConvertButton leadId={lead.id} onChanged={onChanged} />
          )}
        </section>

        <section className="mt-6">
          <h3 className="text-sm font-medium text-slate-700">Status</h3>

          {isSideState ? (
            <div className="mt-2">
              <StatusBadge status={lead.status} />
            </div>
          ) : (
            <ol className="mt-3 flex flex-wrap items-center gap-1 text-xs">
              {LEAD_PIPELINE.map((step, i) => (
                <li key={step} className="flex items-center gap-1">
                  <span
                    className={`rounded-full px-2 py-1 font-medium ${
                      i <= pipelineIndex
                        ? "bg-blue-600 text-white shadow-sm shadow-blue-300/50"
                        : "bg-blue-50 text-slate-400"
                    }`}
                  >
                    {LEAD_STATUS_LABELS[step]}
                  </span>
                  {i < LEAD_PIPELINE.length - 1 ? (
                    <span className="text-blue-200">→</span>
                  ) : null}
                </li>
              ))}
            </ol>
          )}
        </section>

        <section className="mt-6 space-y-1">
          <label htmlFor="notities" className="text-sm font-medium text-slate-700">
            Notities / briefing
          </label>
          <textarea
            id="notities"
            value={notities}
            onChange={(e) => setNotities(e.target.value)}
            onBlur={handleBlur}
            rows={5}
            className="w-full rounded-xl border border-blue-200 bg-white/80 px-3 py-2 text-sm text-slate-900 outline-none placeholder:text-slate-400 focus:border-blue-400 focus:ring-2 focus:ring-blue-200"
          />
          {saving ? (
            <p className="text-xs text-slate-400">Opslaan...</p>
          ) : saveError ? (
            <p className="text-xs text-red-600">{saveError}</p>
          ) : null}
        </section>

        {lead.open_vragen ? (
          <section className="mt-6 space-y-1 text-sm">
            <h3 className="font-medium text-slate-700">Open vragen (research, 3.2)</h3>
            <p className="text-slate-600">{lead.open_vragen}</p>
          </section>
        ) : null}

        {siteVersion ? (
          <section className="mt-6 text-sm">
            <h3 className="font-medium text-slate-700">
              Site-versie {siteVersion.versienummer} ({siteVersion.status})
            </h3>
          </section>
        ) : null}

        {siteVersion ? (
          <DemoPreview
            lead={lead}
            demoUrl={demoUrl}
            siteVersion={siteVersion}
            reviewLog={reviewLog}
            onChanged={onChanged}
          />
        ) : null}

        {costSummary ? <CostSummaryView summary={costSummary} /> : null}

        <section className="mt-6 space-y-2">
          <ResearchButton leadId={lead.id} onChanged={onChanged} />
          <GenerateButton leadId={lead.id} onChanged={onChanged} />
          <ReviewButton leadId={lead.id} onChanged={onChanged} />
        </section>

        <section className="mt-6 border-t border-slate-100 pt-4">
          <DeleteLeadButton
            leadId={lead.id}
            onDeleted={() => {
              onChanged();
              onClose();
            }}
          />
        </section>
      </div>
    </div>
  );
}

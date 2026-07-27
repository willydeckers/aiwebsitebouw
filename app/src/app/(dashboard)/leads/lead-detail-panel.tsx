"use client";

import { useEffect, useState } from "react";
import type { Lead, SiteVersion, ReviewLogEntry, Job } from "@/lib/types";
import { LEAD_PIPELINE, LEAD_STATUS_LABELS } from "@/lib/types";
import { fetchCostSummary, type CostSummary } from "@/lib/costs";
import { createClient } from "@/lib/supabase/client";
import { updateLeadGegevens, updateLeadNotities } from "./actions";
import { StatusBadge } from "./status-badge";
import { PipelineButton } from "./pipeline-button";
import { DemoPreview } from "./demo-preview";
import { ConvertButton } from "./convert-button";
import { CostSummaryView } from "./cost-summary-view";
import { DeleteLeadButton } from "./delete-lead-button";
import { VersionHistory } from "./version-history";

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
  const [adres, setAdres] = useState(lead.adres ?? "");
  const [contactNaam, setContactNaam] = useState(lead.contact_naam ?? "");
  const [contactEmail, setContactEmail] = useState(lead.contact_email ?? "");
  const [gegevensError, setGegevensError] = useState<string | null>(null);
  const [gegevensSaving, setGegevensSaving] = useState(false);
  const [siteVersions, setSiteVersions] = useState<SiteVersion[]>([]);
  const [reviewLog, setReviewLog] = useState<ReviewLogEntry[]>([]);
  const [costSummary, setCostSummary] = useState<CostSummary | null>(null);
  const [latestJob, setLatestJob] = useState<Job | null>(null);

  useEffect(() => {
    const supabase = createClient();

    function loadSiteVersions() {
      supabase
        .from("site_versions")
        .select("*")
        .eq("lead_id", lead.id)
        .order("versienummer", { ascending: false })
        .then(({ data }) => setSiteVersions((data as SiteVersion[]) ?? []));
    }

    function loadLatestJob() {
      supabase
        .from("jobs")
        .select("*")
        .eq("lead_id", lead.id)
        .order("aangemaakt_op", { ascending: false })
        .limit(1)
        .maybeSingle()
        .then(({ data }) => setLatestJob((data as Job | null) ?? null));
    }

    fetchCostSummary(supabase, lead.id).then(setCostSummary);
    loadSiteVersions();
    loadLatestJob();

    supabase
      .from("review_log")
      .select("*")
      .eq("lead_id", lead.id)
      .order("timestamp", { ascending: false })
      .limit(5)
      .then(({ data }) => setReviewLog((data as ReviewLogEntry[]) ?? []));

    // Spec section 2: Realtime on site_versions/review_log/jobs. site_versions
    // changes (activate/revert/new version) can touch more than one row at
    // once, so a full refetch is simpler and less error-prone here than
    // patching the array in place from a single-row payload. jobs is what
    // drives the live "which pipeline step is running now" indicator, most
    // relevant while the separate worker service is churning through a
    // review-loop job.
    const channel = supabase
      .channel(`lead-detail-${lead.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "site_versions", filter: `lead_id=eq.${lead.id}` },
        () => loadSiteVersions(),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "jobs", filter: `lead_id=eq.${lead.id}` },
        () => loadLatestJob(),
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

  async function handleGegevensBlur() {
    if (
      adres === (lead.adres ?? "") &&
      contactNaam === (lead.contact_naam ?? "") &&
      contactEmail === (lead.contact_email ?? "")
    ) {
      return;
    }
    setGegevensSaving(true);
    const error = await updateLeadGegevens(lead.id, {
      adres: adres.trim() || null,
      contact_naam: contactNaam.trim() || null,
      contact_email: contactEmail.trim() || null,
    });
    setGegevensError(error);
    setGegevensSaving(false);
    if (!error) onChanged();
  }

  const pipelineIndex = LEAD_PIPELINE.indexOf(lead.status);
  const isSideState = pipelineIndex === -1; // geblokkeerd / budget_overschreden / dood
  const genererenIndex = LEAD_PIPELINE.indexOf("genereren");

  const reviewJobActive =
    latestJob?.type === "review" && (latestJob.status === "wachtrij" || latestJob.status === "bezig");
  // "Review" isn't a LeadStatus (spec 3.4 runs it inside "genereren" without
  // its own status) — inserted into the pill row as its own step so
  // progress through the review-loop is visible instead of the status bar
  // just sitting on "Genereren" for however long the worker takes.
  const reviewReached = pipelineIndex > genererenIndex || reviewJobActive || reviewLog.length > 0;

  const latestVersion = siteVersions[0] ?? null;
  const actieveVersion = siteVersions.find((v) => v.status === "actief") ?? null;

  const demoHostingBase = process.env.NEXT_PUBLIC_DEMO_HOSTING_URL;
  // Only a genuinely actieve version resolves on the public hosting route
  // (track-and-serve returns 404 otherwise) — building the URL from any
  // latest version would show a broken link before the first approval.
  // Trailing slash on purpose — the multi-page demo's internal links are
  // relative to the version folder, so the browser has to treat /{leadId}/
  // as a directory (track-and-serve redirects to add it, but linking it
  // right saves the round-trip).
  const demoUrl =
    actieveVersion && demoHostingBase ? `${demoHostingBase}/${lead.id}/` : null;

  return (
    <div className="fixed inset-0 z-10 flex justify-end bg-slate-900/20 backdrop-blur-sm">
      <div
        className={`h-full w-full overflow-y-auto border-l border-white/60 bg-white/95 p-6 shadow-xl shadow-blue-200/40 backdrop-blur-xl ${
          latestVersion ? "max-w-3xl" : "max-w-md"
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
            aria-label="Sluiten"
            className="rounded-full p-1.5 text-slate-400 transition-all duration-200 hover:rotate-90 hover:bg-slate-900/5 hover:text-slate-700"
          >
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>

        <section className="mt-6 space-y-2 text-sm">
          <h3 className="font-medium text-slate-700">Bedrijfsgegevens</h3>

          <div className="space-y-1">
            <label htmlFor="lead-adres" className="text-xs text-slate-500">
              Adres
            </label>
            <input
              id="lead-adres"
              value={adres}
              onChange={(e) => setAdres(e.target.value)}
              onBlur={handleGegevensBlur}
              placeholder="Geen adres"
              className="w-full rounded-xl border border-blue-200 bg-white/80 px-3 py-2 text-sm text-slate-900 outline-none placeholder:text-slate-400 focus:border-blue-400 focus:ring-2 focus:ring-blue-200"
            />
          </div>

          <div className="space-y-1">
            <label htmlFor="lead-contact-naam" className="text-xs text-slate-500">
              Contactpersoon
            </label>
            <input
              id="lead-contact-naam"
              value={contactNaam}
              onChange={(e) => setContactNaam(e.target.value)}
              onBlur={handleGegevensBlur}
              placeholder="Geen contactpersoon"
              className="w-full rounded-xl border border-blue-200 bg-white/80 px-3 py-2 text-sm text-slate-900 outline-none placeholder:text-slate-400 focus:border-blue-400 focus:ring-2 focus:ring-blue-200"
            />
          </div>

          <div className="space-y-1">
            <label htmlFor="lead-contact-email" className="text-xs text-slate-500">
              Contact e-mail
              {lead.contact_email_persoonsgebonden ? (
                <span className="ml-1 text-amber-600">
                  (persoonsgebonden — zie GDPR-regel spec 7)
                </span>
              ) : null}
            </label>
            <input
              id="lead-contact-email"
              type="email"
              value={contactEmail}
              onChange={(e) => setContactEmail(e.target.value)}
              onBlur={handleGegevensBlur}
              placeholder="Geen contact e-mail"
              className="w-full rounded-xl border border-blue-200 bg-white/80 px-3 py-2 text-sm text-slate-900 outline-none placeholder:text-slate-400 focus:border-blue-400 focus:ring-2 focus:ring-blue-200"
            />
          </div>

          {gegevensSaving ? (
            <p className="text-xs text-slate-400">Opslaan...</p>
          ) : gegevensError ? (
            <p className="text-xs text-red-600">{gegevensError}</p>
          ) : null}

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
              {LEAD_PIPELINE.flatMap((step, i) => {
                const pill = (
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
                    {i < LEAD_PIPELINE.length - 1 ? <span className="text-blue-200">→</span> : null}
                  </li>
                );
                if (step !== "genereren") return [pill];
                const reviewPill = (
                  <li key="review" className="flex items-center gap-1">
                    <span
                      className={`rounded-full px-2 py-1 font-medium ${
                        reviewReached
                          ? `bg-blue-600 text-white shadow-sm shadow-blue-300/50 ${
                              reviewJobActive ? "animate-pulse" : ""
                            }`
                          : "bg-blue-50 text-slate-400"
                      }`}
                    >
                      Review
                    </span>
                    <span className="text-blue-200">→</span>
                  </li>
                );
                return [pill, reviewPill];
              })}
            </ol>
          )}

          {latestJob ? (
            <p className="mt-2 text-xs text-slate-500">
              Laatste job: <span className="font-medium">{latestJob.type}</span> —{" "}
              {latestJob.status}
              {latestJob.status === "bezig" || latestJob.status === "wachtrij" ? (
                <span className="ml-1 inline-block animate-pulse text-blue-500">●</span>
              ) : null}
              {latestJob.error_message ? (
                <span className="block text-red-600">{latestJob.error_message}</span>
              ) : null}
              {latestJob.type === "review" ? (
                <span className="block text-slate-400">
                  Verwerkt door de aparte worker-service (max 5 iteraties, spec 3.4) — vereist dat
                  `worker/` ergens draait.
                </span>
              ) : null}
            </p>
          ) : null}
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

        {latestVersion ? (
          <DemoPreview
            lead={lead}
            demoUrl={demoUrl}
            siteVersion={latestVersion}
            reviewLog={reviewLog}
            onChanged={onChanged}
          />
        ) : null}

        <VersionHistory leadId={lead.id} versions={siteVersions} onChanged={onChanged} />

        {costSummary ? <CostSummaryView summary={costSummary} /> : null}

        <section className="mt-6 space-y-2">
          <PipelineButton
            leadId={lead.id}
            alreadyResearched={pipelineIndex > LEAD_PIPELINE.indexOf("research") || !!lead.research_samenvatting || !!lead.open_vragen}
            alreadyGenerated={siteVersions.length > 0}
            reviewHandled={reviewReached}
            onChanged={onChanged}
          />
        </section>

        <section className="mt-6 border-t border-slate-100 pt-4">
          <DeleteLeadButton
            leadId={lead.id}
            bedrijfsnaam={lead.bedrijfsnaam}
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

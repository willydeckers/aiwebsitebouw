"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import type { Lead } from "@/lib/types";
import { LEAD_PIPELINE, LEAD_STATUS_LABELS } from "@/lib/types";
import { updateLeadNotities } from "./actions";
import { StatusBadge } from "./status-badge";
import { ResearchButton } from "./research-button";
import { GenerateButton } from "./generate-button";
import { ReviewButton } from "./review-button";
import { DemoPreview } from "./demo-preview";
import { ConvertButton } from "./convert-button";

export function LeadDetailPanel({ lead }: { lead: Lead }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [notities, setNotities] = useState(lead.notities ?? "");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function close() {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("lead");
    router.push(`/leads${params.toString() ? `?${params.toString()}` : ""}`);
  }

  async function handleBlur() {
    if (notities === (lead.notities ?? "")) return;
    setSaving(true);
    const error = await updateLeadNotities(lead.id, notities);
    setSaveError(error);
    setSaving(false);
  }

  const pipelineIndex = LEAD_PIPELINE.indexOf(lead.status);
  const isSideState = pipelineIndex === -1; // geblokkeerd / dood

  return (
    <div className="fixed inset-0 z-10 flex justify-end bg-black/20">
      <div
        className={`h-full w-full overflow-y-auto bg-white p-6 shadow-xl ${
          lead.demo_url ? "max-w-3xl" : "max-w-md"
        }`}
      >
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-base font-semibold text-neutral-900">
              {lead.bedrijfsnaam}
            </h2>
            <p className="text-sm text-neutral-500">{lead.sector}</p>
          </div>
          <button
            onClick={close}
            className="text-sm text-neutral-500 hover:text-neutral-800"
          >
            Sluiten
          </button>
        </div>

        <section className="mt-6 space-y-1 text-sm">
          <h3 className="font-medium text-neutral-700">Bedrijfsgegevens</h3>
          <p className="text-neutral-600">{lead.adres || "Geen adres"}</p>
          <p className="text-neutral-600">
            {lead.contact_naam || "Geen contactpersoon"}
          </p>
          <p className="text-neutral-600">
            {lead.contact_email || "Geen contact e-mail"}
          </p>
        </section>

        <section className="mt-6">
          {lead.klant_type ? (
            <p className="text-sm text-neutral-600">
              Klant — type: <span className="font-medium">{lead.klant_type}</span>
              {lead.shopify_store_id ? ` (store: ${lead.shopify_store_id})` : ""}
            </p>
          ) : (
            <ConvertButton leadId={lead.id} />
          )}
        </section>

        <section className="mt-6">
          <h3 className="text-sm font-medium text-neutral-700">Status</h3>

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
                        ? "bg-neutral-900 text-white"
                        : "bg-neutral-100 text-neutral-400"
                    }`}
                  >
                    {LEAD_STATUS_LABELS[step]}
                  </span>
                  {i < LEAD_PIPELINE.length - 1 ? (
                    <span className="text-neutral-300">→</span>
                  ) : null}
                </li>
              ))}
            </ol>
          )}
        </section>

        <section className="mt-6 space-y-1">
          <label htmlFor="notities" className="text-sm font-medium text-neutral-700">
            Notities / briefing
          </label>
          <textarea
            id="notities"
            value={notities}
            onChange={(e) => setNotities(e.target.value)}
            onBlur={handleBlur}
            rows={5}
            className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-500"
          />
          {saving ? (
            <p className="text-xs text-neutral-400">Opslaan...</p>
          ) : saveError ? (
            <p className="text-xs text-red-600">{saveError}</p>
          ) : null}
        </section>

        {lead.research_output ? (
          <section className="mt-6 space-y-2 text-sm">
            <h3 className="font-medium text-neutral-700">Research (3.2)</h3>
            {lead.research_output.bedrijfsverhaal ? (
              <p className="text-neutral-600">{lead.research_output.bedrijfsverhaal}</p>
            ) : (
              <p className="text-neutral-400">Geen bedrijfsverhaal gevonden.</p>
            )}
            {lead.research_output.kernfeiten.length > 0 ? (
              <ul className="list-disc space-y-0.5 pl-5 text-neutral-600">
                {lead.research_output.kernfeiten.map((feit, i) => (
                  <li key={i}>{feit}</li>
                ))}
              </ul>
            ) : null}
            {lead.research_output.bronnen.length > 0 ? (
              <ul className="space-y-0.5 pl-0 text-xs text-neutral-400">
                {lead.research_output.bronnen.map((bron, i) => (
                  <li key={i} className="truncate">
                    {bron}
                  </li>
                ))}
              </ul>
            ) : null}
          </section>
        ) : null}

        {lead.demo_url ? <DemoPreview lead={lead} /> : null}

        <section className="mt-6 space-y-2">
          <ResearchButton leadId={lead.id} />
          <GenerateButton leadId={lead.id} />
          <ReviewButton leadId={lead.id} />

          <button
            type="button"
            disabled
            title="Wordt gebouwd zodra de demo-preview met chatbox klaar is (build stap 7-8) — dit koppelt research + generatie + review tot één actie."
            className="w-full rounded-md bg-neutral-200 px-3 py-2 text-sm font-medium text-neutral-500"
          >
            {lead.status === "nieuw" ? "Genereer demo" : "Bekijk demo"}
          </button>
        </section>
      </div>
    </div>
  );
}

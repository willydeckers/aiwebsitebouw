"use client";

import { useState } from "react";
import type { Lead } from "@/lib/types";
import { AI_MODELLEN, STANDAARD_AI_MODEL, type AiModel } from "@/lib/ai-modellen";
import { updateLeadAiModel, updateLeadGegevens } from "./actions";

const veld =
  "w-full rounded-xl border border-blue-200 bg-white/80 px-3 py-2 text-sm text-slate-900 outline-none " +
  "placeholder:text-slate-400 focus:border-blue-400 focus:ring-2 focus:ring-blue-200";

/**
 * Bedrijfsgegevens en modelkeuze — wat je één keer instelt en zelden terugkijkt.
 * Gedeeld door het leadpaneel en de werkruimte; staat standaard dicht.
 */
export function LeadInstellingenBlok({ lead, onChanged }: { lead: Lead; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const [adres, setAdres] = useState(lead.adres ?? "");
  const [contactNaam, setContactNaam] = useState(lead.contact_naam ?? "");
  const [contactEmail, setContactEmail] = useState(lead.contact_email ?? "");
  const [gegevensError, setGegevensError] = useState<string | null>(null);
  const [gegevensSaving, setGegevensSaving] = useState(false);
  const [modelError, setModelError] = useState<string | null>(null);
  const [modelSaving, setModelSaving] = useState(false);

  const gekozenModel =
    AI_MODELLEN.find((m) => m.id === (lead.ai_model ?? STANDAARD_AI_MODEL)) ?? AI_MODELLEN[0];

  async function handleModelChange(model: AiModel) {
    setModelSaving(true);
    const error = await updateLeadAiModel(lead.id, model);
    setModelError(error);
    setModelSaving(false);
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

  return (
    <section className="space-y-2 text-sm">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between rounded-xl border border-blue-100 px-3 py-2 text-left font-medium text-slate-700 hover:bg-blue-50"
      >
        <span>Bedrijfsgegevens &amp; AI-model</span>
        <span className="text-xs text-slate-400">{open ? "verbergen" : "tonen"}</span>
      </button>

      {!open ? null : (
        <div className="space-y-5 rounded-xl border border-blue-100 p-3">
          <div className="space-y-2">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Bedrijfsgegevens</h4>

            <div className="space-y-1">
              <label htmlFor={`lead-adres-${lead.id}`} className="text-xs text-slate-500">
                Adres
              </label>
              <input
                id={`lead-adres-${lead.id}`}
                value={adres}
                onChange={(e) => setAdres(e.target.value)}
                onBlur={handleGegevensBlur}
                placeholder="Geen adres"
                className={veld}
              />
            </div>

            <div className="space-y-1">
              <label htmlFor={`lead-contact-naam-${lead.id}`} className="text-xs text-slate-500">
                Contactpersoon
              </label>
              <input
                id={`lead-contact-naam-${lead.id}`}
                value={contactNaam}
                onChange={(e) => setContactNaam(e.target.value)}
                onBlur={handleGegevensBlur}
                placeholder="Geen contactpersoon"
                className={veld}
              />
            </div>

            <div className="space-y-1">
              <label htmlFor={`lead-contact-email-${lead.id}`} className="text-xs text-slate-500">
                Contact e-mail
                {lead.contact_email_persoonsgebonden ? (
                  <span className="ml-1 text-amber-600">
                    (persoonlijk e-mailadres — vraag toestemming voor je het bewaart)
                  </span>
                ) : null}
              </label>
              <input
                id={`lead-contact-email-${lead.id}`}
                type="email"
                value={contactEmail}
                onChange={(e) => setContactEmail(e.target.value)}
                onBlur={handleGegevensBlur}
                placeholder="Geen contact e-mail"
                className={veld}
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
          </div>

          <div className="space-y-2">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500">AI-model</h4>

            <div className="space-y-1">
              <select
                id={`lead-ai-model-${lead.id}`}
                aria-label="AI-model voor deze lead"
                value={lead.ai_model ?? STANDAARD_AI_MODEL}
                onChange={(e) => handleModelChange(e.target.value as AiModel)}
                disabled={modelSaving}
                className={`${veld} disabled:opacity-60`}
              >
                {AI_MODELLEN.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </select>
              <p className="text-xs text-slate-500">{gekozenModel.uitleg}</p>
            </div>

            <p className="text-xs text-slate-400">
              Geldt vanaf de volgende pipeline-stap — een al gegenereerde site verandert niet.
            </p>

            {modelSaving ? (
              <p className="text-xs text-slate-400">Opslaan...</p>
            ) : modelError ? (
              <p className="text-xs text-red-600">{modelError}</p>
            ) : null}
          </div>
        </div>
      )}
    </section>
  );
}

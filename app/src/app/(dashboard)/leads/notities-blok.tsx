"use client";

import { useState } from "react";
import { updateLeadNotities } from "./actions";

/**
 * De briefing van een lead: wat je over het bedrijf weet. Gedeeld door het
 * leadpaneel en de werkruimte, zodat die twee niet uit elkaar groeien.
 *
 * Klapt vanzelf open zolang het veld leeg is: dan is het geen lap tekst maar
 * precies het veld dat je moet invullen.
 */
export function NotitiesBlok({
  lead,
  onChanged,
}: {
  lead: { id: string; notities: string | null };
  onChanged: () => void;
}) {
  const [notities, setNotities] = useState(lead.notities ?? "");
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  async function handleBlur() {
    if (notities === (lead.notities ?? "")) return;
    setSaving(true);
    const error = await updateLeadNotities(lead.id, notities);
    setSaveError(error);
    setSaving(false);
    if (!error) onChanged();
  }

  const zichtbaar = open || !notities.trim();

  return (
    <section className="space-y-1">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between rounded-xl border border-blue-100 px-3 py-2 text-left text-sm font-medium text-slate-700 hover:bg-blue-50"
      >
        <span>
          Notities / briefing
          {notities.trim() ? (
            <span className="ml-2 text-xs font-normal text-slate-400">{notities.trim().length} tekens</span>
          ) : (
            <span className="ml-2 text-xs font-normal text-amber-700">nog leeg</span>
          )}
        </span>
        <span className="text-xs text-slate-400">{zichtbaar ? "verbergen" : "tonen"}</span>
      </button>

      {zichtbaar ? (
        <>
          <label htmlFor={`notities-${lead.id}`} className="sr-only">
            Notities / briefing
          </label>
          <textarea
            id={`notities-${lead.id}`}
            value={notities}
            onChange={(e) => setNotities(e.target.value)}
            onBlur={handleBlur}
            rows={5}
            placeholder="Wat je over dit bedrijf weet: aanbod, openingsuren, wat ze zelf aanleveren."
            className="w-full rounded-xl border border-blue-200 bg-white/80 px-3 py-2 text-sm text-slate-900 outline-none placeholder:text-slate-400 focus:border-blue-400 focus:ring-2 focus:ring-blue-200"
          />
          {saving ? (
            <p className="text-xs text-slate-400">Opslaan...</p>
          ) : saveError ? (
            <p className="text-xs text-red-600">{saveError}</p>
          ) : null}
        </>
      ) : null}
    </section>
  );
}

/** De vragen die de research niet kon beantwoorden. Enkel als er zijn. */
export function OpenVragenBlok({ openVragen }: { openVragen: string | null }) {
  const [open, setOpen] = useState(false);
  if (!openVragen) return null;

  return (
    <section className="space-y-1 text-sm">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between rounded-xl border border-amber-200 bg-amber-50/60 px-3 py-2 text-left font-medium text-amber-900 hover:bg-amber-50"
      >
        <span>Openstaande vragen uit de research</span>
        <span className="text-xs text-amber-700">{open ? "verbergen" : "tonen"}</span>
      </button>
      {open ? (
        <p className="whitespace-pre-wrap rounded-xl border border-amber-100 p-3 text-slate-600">{openVragen}</p>
      ) : null}
    </section>
  );
}

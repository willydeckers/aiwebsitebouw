"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { SiteWerkruimte } from "../leads/site-werkruimte";

// Het klantenscherm ís de werkruimte (leads/site-werkruimte.tsx), als pagina.
//
// Hier stond een eigen preview + chat die de helft miste van wat het
// leadpaneel toonde: geen briefing, geen bedrijfsgegevens, geen site-interactie,
// geen pakket & domein — en een klant van bundel wisselen kon nergens. Nu is het
// dezelfde component als de werkruimte die je vanuit een lead opent; dit
// bestand vertaalt enkel het klant-id uit de URL naar het lead-id.
export function KlantDetailView({ klantId, onBack }: { klantId: string; onBack: () => void }) {
  const [leadId, setLeadId] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;
    supabase
      .from("klanten")
      .select("lead_id")
      .eq("id", klantId)
      .single()
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error || !data) setLoadError(error?.message ?? "Klant niet gevonden.");
        else setLeadId(data.lead_id as string);
      });
    return () => {
      cancelled = true;
    };
  }, [klantId]);

  if (loadError) {
    return (
      <div>
        <BackButton onBack={onBack} />
        <p className="mt-4 text-sm text-red-600">Kon klant niet laden: {loadError}</p>
      </div>
    );
  }

  if (!leadId) {
    return (
      <div>
        <BackButton onBack={onBack} />
        <p className="mt-4 text-sm text-slate-500">Laden...</p>
      </div>
    );
  }

  return <SiteWerkruimte leadId={leadId} weergave="pagina" onSluiten={onBack} />;
}

function BackButton({ onBack }: { onBack: () => void }) {
  return (
    <button
      type="button"
      onClick={onBack}
      aria-label="Terug naar klanten"
      className="flex h-8 w-8 items-center justify-center rounded-full text-slate-500 transition hover:bg-slate-900/5 hover:text-slate-800"
    >
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M15 18l-6-6 6-6" />
      </svg>
    </button>
  );
}

"use client";

import { useEffect, useState, useTransition } from "react";
import { createClient } from "@/lib/supabase/client";

// Waar de site naartoe schrijft, en welk nummer erop staat.
//
// Dit stond nergens: een contact- of reservatieformulier belandde alleen in de
// database, en of iemand dat zag hing ervan af of hij toevallig in het
// dashboard keek. Voor een reservatie is dat te laat — vandaar één adres per
// klant waar die berichten heen gaan. Het telefoonnummer zit in dezelfde
// schermbreedte omdat het dezelfde vraag beantwoordt: hoe bereikt een bezoeker
// deze zaak, en hoe bereikt deze zaak ons.

export function SiteContactPanel({ leadId }: { leadId: string }) {
  const [open, setOpen] = useState(false);
  const [telefoon, setTelefoon] = useState("");
  const [meldingenEmail, setMeldingenEmail] = useState("");
  const [geladen, setGeladen] = useState(false);
  const [melding, setMelding] = useState<string | null>(null);
  const [bezig, start] = useTransition();

  useEffect(() => {
    if (!open || geladen) return;
    const supabase = createClient();
    supabase
      .from("leads")
      .select("telefoon, meldingen_email")
      .eq("id", leadId)
      .maybeSingle()
      .then(({ data }) => {
        setTelefoon(data?.telefoon ?? "");
        setMeldingenEmail(data?.meldingen_email ?? "");
        setGeladen(true);
      });
  }, [open, geladen, leadId]);

  function bewaar() {
    setMelding(null);
    start(async () => {
      const supabase = createClient();
      const { error } = await supabase
        .from("leads")
        .update({
          telefoon: telefoon.trim() || null,
          meldingen_email: meldingenEmail.trim() || null,
        })
        .eq("id", leadId);
      setMelding(error ? `Opslaan mislukt: ${error.message}` : "Bewaard.");
    });
  }

  return (
    <section className="mt-4 space-y-2 text-sm">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between rounded-xl border border-blue-100 px-3 py-2 text-left font-medium text-slate-700 hover:bg-blue-50"
      >
        <span>
          Contact &amp; meldingen
          {geladen && !meldingenEmail ? (
            <span className="ml-2 text-xs font-normal text-amber-700">
              inzendingen worden niet gemaild
            </span>
          ) : null}
        </span>
        <span className="text-xs text-slate-400">{open ? "verbergen" : "tonen"}</span>
      </button>

      {!open ? null : (
        <div className="space-y-4 rounded-xl border border-blue-100 p-3">
          <div className="space-y-1">
            <label htmlFor="site-meldingen-email" className="text-xs font-medium text-slate-700">
              Inzendingen mailen naar
            </label>
            <input
              id="site-meldingen-email"
              type="email"
              value={meldingenEmail}
              onChange={(e) => setMeldingenEmail(e.target.value)}
              placeholder="bv. reservaties@dezaak.be"
              className="w-full rounded-xl border border-blue-200 bg-white/80 px-3 py-2 text-sm text-slate-900 outline-none placeholder:text-slate-400 focus:border-blue-400 focus:ring-2 focus:ring-blue-200"
            />
            <p className="text-xs text-slate-500">
              Elk bericht van een contact- of reservatieformulier gaat hier meteen naartoe.
              Antwoorden komt bij de bezoeker terecht, niet bij ons. Laat je dit leeg, dan wordt de
              inzending alleen bewaard en moet je ze hier komen lezen.
            </p>
          </div>

          <div className="space-y-1">
            <label htmlFor="site-telefoon" className="text-xs font-medium text-slate-700">
              Telefoonnummer op de site
            </label>
            <input
              id="site-telefoon"
              value={telefoon}
              onChange={(e) => setTelefoon(e.target.value)}
              placeholder="bv. 011 22 33 44"
              className="w-full rounded-xl border border-blue-200 bg-white/80 px-3 py-2 text-sm text-slate-900 outline-none placeholder:text-slate-400 focus:border-blue-400 focus:ring-2 focus:ring-blue-200"
            />
            <p className="text-xs text-slate-500">
              Wordt gebruikt in de bedrijfsgegevens van de site. Een wijziging komt op de site bij
              de volgende hergeneratie, of meteen als je het via de chat laat aanpassen.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={bewaar}
              disabled={bezig || !geladen}
              className="rounded-xl bg-blue-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {bezig ? "Bezig…" : "Bewaren"}
            </button>
            {melding ? <span className="text-xs text-slate-500">{melding}</span> : null}
          </div>
        </div>
      )}
    </section>
  );
}

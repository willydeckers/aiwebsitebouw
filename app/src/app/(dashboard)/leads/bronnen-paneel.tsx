"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import type { SiteBestand } from "@/lib/types";
import { deleteBestand, fetchBestanden } from "./site-interactie-actions";

// Wat de AI van deze klant weet: de bestanden die in het gesprek terecht zijn
// gekomen.
//
// Die belandden tot nu in een uitklapblok ergens onderaan het leadpaneel, ver
// van de chat waarin je ze net had gesleept. Terwijl dat precies de vraag is
// die je tijdens het werken hebt: heeft hij het logo nu wél, en welke menukaart
// zit erin? Vandaar hier, naast het gesprek.

function leesbareGrootte(bytes: number | null): string {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} kB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function soortLabel(bestand: SiteBestand): string {
  const type = bestand.content_type ?? "";
  if (/^logo\./i.test(bestand.bestandsnaam)) return "logo";
  if (type.startsWith("image/")) return "afbeelding";
  if (type === "application/pdf") return "pdf";
  if (type.startsWith("text/")) return "tekst";
  return "bestand";
}

export function BronnenPaneel({
  leadId,
  onClose,
  onGewijzigd,
}: {
  leadId: string;
  onClose: () => void;
  onGewijzigd?: () => void;
}) {
  const [bestanden, setBestanden] = useState<SiteBestand[] | null>(null);
  const [fout, setFout] = useState<string | null>(null);
  const [bezig, start] = useTransition();

  const herlaad = useCallback(() => {
    fetchBestanden(leadId).then(setBestanden);
  }, [leadId]);

  useEffect(herlaad, [herlaad]);

  // Capture-fase + stopImmediatePropagation: Escape sluit enkel deze laag, niet
  // ook de werkruimte of het leadpaneel eronder (die luisteren in de
  // bubbelfase en krijgen de toets dan niet meer).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      e.stopImmediatePropagation();
      onClose();
    }
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  function verwijder(bestand: SiteBestand) {
    setFout(null);
    start(async () => {
      const melding = await deleteBestand(bestand);
      if (melding) {
        setFout(melding);
        return;
      }
      herlaad();
      onGewijzigd?.();
    });
  }

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-slate-900/20 backdrop-blur-sm">
      <div className="flex h-full w-full max-w-md flex-col border-l border-slate-200 bg-white">
        <header className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">Bronnen in deze chat</h2>
            <p className="text-xs text-slate-500">
              Alles wat je hier toevoegde en wat de generator kan gebruiken.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-slate-200 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100"
          >
            Sluiten
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {fout ? <p className="mb-2 text-xs text-red-600">{fout}</p> : null}

          {bestanden === null ? (
            <p className="text-sm text-slate-500">Laden…</p>
          ) : bestanden.length === 0 ? (
            <div className="text-sm text-slate-500">
              <p className="font-medium text-slate-700">Nog geen bronnen.</p>
              <p className="mt-1">
                Sleep een logo, menukaart of foto in het gesprek, of gebruik de paperclip. Staat er
                tekst op een foto, dan wordt die uitgelezen en meegenomen bij het bouwen.
              </p>
            </div>
          ) : (
            <ul className="space-y-2">
              {bestanden.map((bestand) => (
                <li key={bestand.id} className="rounded-xl border border-slate-200 p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-slate-800">
                        {bestand.bestandsnaam}
                      </p>
                      <p className="text-xs text-slate-500">
                        {soortLabel(bestand)}
                        {bestand.grootte_bytes ? ` · ${leesbareGrootte(bestand.grootte_bytes)}` : ""}
                        {bestand.toegevoegd_door ? ` · ${bestand.toegevoegd_door}` : ""}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => verwijder(bestand)}
                      disabled={bezig}
                      title="Verwijder deze bron"
                      className="shrink-0 rounded-lg border border-slate-200 px-2 py-1 text-xs text-slate-500 hover:bg-slate-100 disabled:opacity-50"
                    >
                      Verwijder
                    </button>
                  </div>

                  {bestand.omschrijving ? (
                    <details className="mt-2">
                      <summary className="cursor-pointer text-xs text-slate-500">
                        Uitgelezen tekst
                      </summary>
                      <p className="mt-1 max-h-40 overflow-y-auto whitespace-pre-wrap rounded-lg bg-slate-50 p-2 text-xs text-slate-600">
                        {bestand.omschrijving}
                      </p>
                    </details>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

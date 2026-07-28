"use client";

import { useEffect, useState, useTransition } from "react";
import {
  addSectorKennis,
  addStijlvoorkeur,
  deleteSectorKennis,
  deleteStijlvoorkeur,
  fetchSectorKennis,
  fetchStijlvoorkeuren,
  type SectorKennis,
  type Stijlvoorkeur,
} from "./ai-regels-actions";

const KAART =
  "mt-6 max-w-3xl space-y-3 rounded-3xl border border-white/60 bg-white/70 p-6 shadow-xl shadow-blue-200/40 backdrop-blur-xl";

export function AiRegelsPanel() {
  const [stijl, setStijl] = useState<Stijlvoorkeur[]>([]);
  const [kennis, setKennis] = useState<SectorKennis[]>([]);
  const [nieuweRegel, setNieuweRegel] = useState("");
  const [nieuweSector, setNieuweSector] = useState("");
  const [nieuweSectorRegel, setNieuweSectorRegel] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function herlaad() {
    startTransition(async () => {
      setStijl(await fetchStijlvoorkeuren());
      setKennis(await fetchSectorKennis());
    });
  }

  useEffect(herlaad, []);

  function doe(actie: () => Promise<string | null>) {
    setError(null);
    startTransition(async () => {
      const fout = await actie();
      if (fout) setError(fout);
      else herlaad();
    });
  }

  const perSector = kennis.reduce<Record<string, SectorKennis[]>>((acc, rij) => {
    (acc[rij.sector] ??= []).push(rij);
    return acc;
  }, {});

  return (
    <>
      <section className={KAART}>
        <div>
          <h2 className="text-sm font-medium text-slate-700">Stijlvoorkeuren</h2>
          <p className="mt-1 text-sm text-slate-600">
            Regels die bij <span className="font-medium">elke</span> nieuwe website worden
            toegepast, voor alle klanten. Gebruik dit voor hoe jullie sites er horen uit te zien —
            niet voor iets dat over één klant gaat.
          </p>
          <p className="mt-1 text-xs text-slate-400">
            De AI zet hier zelf ook regels bij: als je in de chatbox iets aanpast dat algemeen
            bruikbaar is, wordt dat hier onthouden. Loopt er een site raar, kijk dan hier eerst —
            een verkeerde regel beïnvloedt alles wat je daarna genereert.
          </p>
        </div>

        {error ? <p className="text-sm text-red-600">{error}</p> : null}

        {stijl.length === 0 ? (
          <p className="text-sm text-slate-400">
            Nog geen stijlvoorkeuren. Zonder regels kiest de AI zelf, op basis van de sector.
          </p>
        ) : (
          <ul className="space-y-1">
            {stijl.map((rij) => (
              <li
                key={rij.id}
                className="flex items-start justify-between gap-3 rounded-xl border border-blue-100 p-2 text-sm"
              >
                <span className="text-slate-700">
                  {rij.regel}
                  {rij.context ? <span className="block text-xs text-slate-400">{rij.context}</span> : null}
                </span>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => doe(() => deleteStijlvoorkeur(rij.id))}
                  className="shrink-0 text-xs text-red-600 hover:underline disabled:opacity-50"
                >
                  Verwijder
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="flex gap-2">
          <input
            value={nieuweRegel}
            onChange={(e) => setNieuweRegel(e.target.value)}
            placeholder="bv. gebruik altijd afgeronde knoppen"
            className="flex-1 rounded-xl border border-blue-200 px-3 py-2 text-sm text-slate-900 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-200"
          />
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              doe(async () => {
                const fout = await addStijlvoorkeur(nieuweRegel);
                if (!fout) setNieuweRegel("");
                return fout;
              })
            }
            className="rounded-xl bg-blue-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            Toevoegen
          </button>
        </div>
      </section>

      <section className={KAART}>
        <div>
          <h2 className="text-sm font-medium text-slate-700">Sectorkennis</h2>
          <p className="mt-1 text-sm text-slate-600">
            Hetzelfde idee, maar enkel voor één sector. Een bloemist krijgt deze regels wel, een
            aannemer niet.
          </p>
          <p className="mt-1 text-xs text-slate-400">
            De sector moet exact overeenkomen met wat er bij de lead staat, anders wordt de regel
            niet gebruikt.
          </p>
        </div>

        {kennis.length === 0 ? (
          <p className="text-sm text-slate-400">Nog geen sectorkennis geregistreerd.</p>
        ) : (
          Object.entries(perSector).map(([sector, regels]) => (
            <div key={sector} className="space-y-1">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">{sector}</h3>
              <ul className="space-y-1">
                {regels.map((rij) => (
                  <li
                    key={rij.id}
                    className="flex items-start justify-between gap-3 rounded-xl border border-blue-100 p-2 text-sm"
                  >
                    <span className="text-slate-700">{rij.regel}</span>
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => doe(() => deleteSectorKennis(rij.id))}
                      className="shrink-0 text-xs text-red-600 hover:underline disabled:opacity-50"
                    >
                      Verwijder
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))
        )}

        <div className="flex flex-wrap gap-2">
          <input
            value={nieuweSector}
            onChange={(e) => setNieuweSector(e.target.value)}
            placeholder="Sector, bv. Bloemenhandel"
            className="w-48 rounded-xl border border-blue-200 px-3 py-2 text-sm text-slate-900 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-200"
          />
          <input
            value={nieuweSectorRegel}
            onChange={(e) => setNieuweSectorRegel(e.target.value)}
            placeholder="bv. toon altijd een seizoensaanbod"
            className="flex-1 rounded-xl border border-blue-200 px-3 py-2 text-sm text-slate-900 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-200"
          />
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              doe(async () => {
                const fout = await addSectorKennis(nieuweSector, nieuweSectorRegel);
                if (!fout) setNieuweSectorRegel("");
                return fout;
              })
            }
            className="rounded-xl bg-blue-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            Toevoegen
          </button>
        </div>
      </section>
    </>
  );
}

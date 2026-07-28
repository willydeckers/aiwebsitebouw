"use client";

import { useEffect, useState, useTransition } from "react";
import type { SiteBestand, SiteInzending, SiteToegang } from "@/lib/types";
import {
  clearToegangscode,
  deleteBestand,
  deleteInzending,
  fetchBestanden,
  fetchInzendingen,
  fetchToegang,
  setInzendingStatus,
  setToegangscode,
} from "./site-interactie-actions";

const SOORT_LABEL: Record<SiteInzending["soort"], string> = {
  contact: "Contact",
  offerte: "Offerte",
  review: "Review",
};

function bytesLabel(bytes: number | null): string {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} kB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * The three things a generated site needs from a human: someone to read what
 * visitors send in, files to offer as downloads, and a code for the pages that
 * are gated. Grouped in one collapsible block so the lead panel doesn't grow a
 * third of a screen for leads that use none of it.
 */
export function SiteInteractiePanel({ leadId }: { leadId: string }) {
  const [open, setOpen] = useState(false);
  const [inzendingen, setInzendingen] = useState<SiteInzending[]>([]);
  const [bestanden, setBestanden] = useState<SiteBestand[]>([]);
  const [toegang, setToegang] = useState<SiteToegang | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const [code, setCode] = useState("");
  const [hint, setHint] = useState("");

  function herlaad() {
    startTransition(async () => {
      const [i, b, t] = await Promise.all([
        fetchInzendingen(leadId),
        fetchBestanden(leadId),
        fetchToegang(leadId),
      ]);
      setInzendingen(i);
      setBestanden(b);
      setToegang(t);
      setHint(t?.hint ?? "");
    });
  }

  useEffect(() => {
    if (open) herlaad();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, leadId]);

  function doe(actie: () => Promise<string | null>) {
    setError(null);
    startTransition(async () => {
      const fout = await actie();
      if (fout) setError(fout);
      else herlaad();
    });
  }

  const nieuw = inzendingen.filter((i) => i.status === "nieuw").length;

  return (
    <section className="mt-6 space-y-2 text-sm">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between rounded-xl border border-blue-100 px-3 py-2 text-left font-medium text-slate-700 hover:bg-blue-50"
      >
        <span>
          Site-interactie
          {nieuw > 0 ? (
            <span className="ml-2 rounded-full bg-blue-600 px-2 py-0.5 text-xs font-semibold text-white">
              {nieuw} nieuw
            </span>
          ) : null}
        </span>
        <span className="text-xs text-slate-400">{open ? "verbergen" : "tonen"}</span>
      </button>

      {!open ? null : (
        <div className="space-y-5 rounded-xl border border-blue-100 p-3">
          {error ? <p className="text-xs text-red-600">{error}</p> : null}

          {/* ── Inzendingen ───────────────────────────────────────────── */}
          <div className="space-y-2">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Inzendingen van de site
            </h4>
            {inzendingen.length === 0 ? (
              <p className="text-xs text-slate-400">
                Nog niets binnengekomen via de formulieren op de site.
              </p>
            ) : (
              <ul className="space-y-2">
                {inzendingen.map((inzending) => (
                  <li key={inzending.id} className="rounded-lg border border-slate-100 p-2">
                    <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                      <span className="font-medium text-slate-700">{SOORT_LABEL[inzending.soort]}</span>
                      {inzending.score ? <span>{"★".repeat(inzending.score)}</span> : null}
                      <span>{new Date(inzending.aangemaakt_op).toLocaleString("nl-BE")}</span>
                      <span
                        className={`rounded-full px-2 py-0.5 ${
                          inzending.status === "nieuw"
                            ? "bg-blue-50 text-blue-700"
                            : inzending.status === "goedgekeurd"
                              ? "bg-green-50 text-green-700"
                              : "bg-slate-100 text-slate-500"
                        }`}
                      >
                        {inzending.status}
                      </span>
                    </div>
                    <p className="mt-1 text-slate-800">
                      {inzending.naam ?? "Anoniem"}
                      {inzending.email ? (
                        <a href={`mailto:${inzending.email}`} className="ml-2 text-blue-600 hover:underline">
                          {inzending.email}
                        </a>
                      ) : null}
                    </p>
                    {inzending.bericht ? (
                      <p className="mt-1 whitespace-pre-wrap text-slate-600">{inzending.bericht}</p>
                    ) : null}
                    <div className="mt-1 flex gap-3 text-xs">
                      {inzending.soort === "review" && inzending.status !== "goedgekeurd" ? (
                        <button
                          type="button"
                          disabled={pending}
                          onClick={() => doe(() => setInzendingStatus(inzending.id, "goedgekeurd"))}
                          className="text-green-700 hover:underline disabled:opacity-50"
                          title="Pas na goedkeuring verschijnt deze review op de live site."
                        >
                          Publiceer op de site
                        </button>
                      ) : null}
                      {inzending.status === "nieuw" ? (
                        <button
                          type="button"
                          disabled={pending}
                          onClick={() => doe(() => setInzendingStatus(inzending.id, "gelezen"))}
                          className="text-slate-500 hover:underline disabled:opacity-50"
                        >
                          Markeer als gelezen
                        </button>
                      ) : null}
                      <button
                        type="button"
                        disabled={pending}
                        onClick={() => doe(() => setInzendingStatus(inzending.id, "spam"))}
                        className="text-slate-500 hover:underline disabled:opacity-50"
                      >
                        Spam
                      </button>
                      <button
                        type="button"
                        disabled={pending}
                        onClick={() => doe(() => deleteInzending(inzending.id))}
                        className="text-red-600 hover:underline disabled:opacity-50"
                      >
                        Verwijder
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* ── Downloads ─────────────────────────────────────────────── */}
          <div className="space-y-2">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Downloadbare bestanden
            </h4>
            <p className="text-xs text-slate-400">
              Toevoegen doe je met de <span className="font-medium">+</span>-knop in de chatbox bij
              de demo-preview — een menukaart wordt daar meteen uitgelezen zodat je kan nakijken
              wat eruit komt. Hieronder staat wat er al is.
            </p>
            {bestanden.length === 0 ? (
              <p className="text-xs text-slate-400">Nog geen bestanden voor deze lead.</p>
            ) : (
              <ul className="space-y-1">
                {bestanden.map((bestand) => (
                  <li key={bestand.id} className="flex flex-wrap items-center justify-between gap-2 text-xs">
                    <span className="text-slate-700">
                      {bestand.bestandsnaam}
                      <span className="ml-2 text-slate-400">{bytesLabel(bestand.grootte_bytes)}</span>
                      {bestand.omschrijving ? (
                        <span className="ml-2 text-slate-400">— {bestand.omschrijving}</span>
                      ) : null}
                      {bestand.geextraheerde_tekst ? (
                        <details className="mt-1 w-full text-slate-500">
                          <summary className="cursor-pointer text-blue-600 hover:underline">
                            Uitgelezen tekst ({bestand.geextraheerde_tekst.length} tekens) — controleer dit
                          </summary>
                          <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap rounded-lg bg-slate-50 p-2">
                            {bestand.geextraheerde_tekst}
                          </pre>
                        </details>
                      ) : bestand.tekst_geextraheerd_op ? (
                        <span className="ml-2 text-slate-400">— geen tekst op gevonden</span>
                      ) : null}
                    </span>
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => doe(() => deleteBestand(bestand))}
                      className="text-red-600 hover:underline disabled:opacity-50"
                    >
                      Verwijder
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* ── Toegangscode ──────────────────────────────────────────── */}
          <div className="space-y-2">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Toegangscode voor afgeschermde pagina&apos;s
            </h4>
            <p className="text-xs text-slate-400">
              Eén gedeelde code per site, geen accounts. Pagina&apos;s met{" "}
              <code className="rounded bg-slate-100 px-1">toegang: beveiligd</code> worden pas verstuurd
              nadat een bezoeker die code invult.
            </p>
            {toegang ? (
              <p className="text-xs text-green-700">
                Code ingesteld op {new Date(toegang.aangemaakt_op).toLocaleDateString("nl-BE")}
                {toegang.aangemaakt_door ? ` door ${toegang.aangemaakt_door}` : ""}. De code zelf is niet
                opvraagbaar — stel een nieuwe in als ze kwijt is.
              </p>
            ) : (
              <p className="text-xs text-slate-400">Nog geen code ingesteld.</p>
            )}
            <div className="flex flex-wrap gap-2">
              <input
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder={toegang ? "Nieuwe code" : "Code (min. 6 tekens)"}
                className="flex-1 rounded-xl border border-blue-200 px-2 py-1 text-xs text-slate-900 outline-none focus:border-blue-400"
              />
              <input
                value={hint}
                onChange={(e) => setHint(e.target.value)}
                placeholder="Hint op het invulscherm (optioneel)"
                className="flex-1 rounded-xl border border-blue-200 px-2 py-1 text-xs text-slate-900 outline-none focus:border-blue-400"
              />
              <button
                type="button"
                disabled={pending}
                onClick={() =>
                  doe(async () => {
                    const fout = await setToegangscode(leadId, code, hint);
                    if (!fout) setCode("");
                    return fout;
                  })
                }
                className="rounded-xl bg-blue-600 px-3 py-1 text-xs font-medium text-white disabled:opacity-50"
              >
                {toegang ? "Vervang code" : "Stel code in"}
              </button>
              {toegang ? (
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => doe(() => clearToegangscode(leadId))}
                  className="rounded-xl border border-blue-200 px-3 py-1 text-xs text-slate-600 disabled:opacity-50"
                  title="Afgeschermde pagina's worden daarna geweigerd tot er een nieuwe code is."
                >
                  Verwijder code
                </button>
              ) : null}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

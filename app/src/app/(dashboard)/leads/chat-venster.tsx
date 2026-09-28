"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import type { SiteVersion } from "@/lib/types";
import { AI_MODELLEN, STANDAARD_AI_MODEL, type AiModel } from "@/lib/ai-modellen";
import { updateLeadAiModel } from "./actions";
import { revertToVersion } from "./version-actions";
import { PubliceerDialoog } from "./publiceer-dialoog";
import { BronnenPaneel } from "./bronnen-paneel";
import { afzenderLabel, type ChatBericht } from "./chat-geschiedenis";
import { useLeadChat, type ChatOpties } from "./use-lead-chat";

// Het gesprek over één site, ingebed in de werkruimte (site-werkruimte.tsx).
//
// Dezelfde hook als het strookje in het leadpaneel, zodat de twee niet uit
// elkaar kunnen lopen. Wat hier anders is, is de vorm: een gesprek zoals je het
// van een chat verwacht in plaats van een lijstje regels.
//
// Eén invoerveld, en dat doet één ding: gericht aanpassen. Hier stond eerst een
// schakelaar met "hele site hergenereren" als gelijkwaardige tweede keuze. In
// de praktijk wordt dat bijna nooit gebruikt, en een verkeerd gekozen stand
// kostte minuten en modelgeld. Het zit nu achter een bescheiden link met een
// bevestiging ervoor — en het maakt altijd een nieuwe versie in plaats van de
// huidige te overschrijven.

const SOORT_LABEL: Record<ChatBericht["soort"], string> = {
  chat: "",
  patch: "aanpassing",
  regeneratie: "hergeneratie",
  upload: "bestand",
};

function Bericht({ bericht }: { bericht: ChatBericht }) {
  const vanMij = bericht.rol === "gebruiker";
  const label = SOORT_LABEL[bericht.soort];
  const tijd = new Date(bericht.aangemaakt_op).toLocaleString("nl-BE", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });

  // Systeemregels zijn geen gespreksdeelnemer maar een notitie over wat er
  // gebeurde; die krijgen daarom geen bel maar een rustige regel in het midden.
  if (bericht.rol === "systeem") {
    return (
      <li className="flex justify-center">
        <p className="max-w-[46rem] whitespace-pre-wrap rounded-xl bg-slate-100 px-3 py-2 text-center text-xs text-slate-600">
          {bericht.bericht}
        </p>
      </li>
    );
  }

  return (
    <li className={`flex flex-col gap-1 ${vanMij ? "items-end" : "items-start"}`}>
      <p className="px-1 text-xs text-slate-500">
        {afzenderLabel(bericht)}
        {label ? ` · ${label}` : ""}
        <span className="ml-2 text-slate-400">{tijd}</span>
      </p>
      <div
        className={`max-w-[46rem] whitespace-pre-wrap rounded-2xl px-4 py-2.5 text-sm ${
          vanMij
            ? "bg-blue-600 text-white"
            : "border border-slate-200 bg-white text-slate-800 shadow-sm"
        }`}
      >
        {bericht.bericht}
      </div>
    </li>
  );
}

export function ChatVenster({
  lead,
  siteVersion,
  liveVersion = null,
  onChanged,
  onVersieGewijzigd,
  readOnly = false,
  readOnlyReden,
  magHergenereren = true,
  chatOpties,
}: {
  lead: { id: string; bedrijfsnaam: string; ai_model?: string | null };
  /** De versie die op het scherm staat — daar gaan aanpassingen naartoe. */
  siteVersion: SiteVersion | null;
  /** De versie die nu live staat, als die er is — nodig om te tonen dat je naar
   *  een andere versie zit te kijken dan wat bezoekers zien. */
  liveVersion?: SiteVersion | null;
  onChanged: () => void;
  onVersieGewijzigd?: () => void;
  /** Meekijken mag, typen niet — voor de bewerk-vergrendeling bij klanten. */
  readOnly?: boolean;
  readOnlyReden?: string;
  /** Shopify-sites worden niet door de generator gebouwd, dus daar bestaat
   *  "hele site hergenereren" niet. */
  magHergenereren?: boolean;
  chatOpties?: ChatOpties;
}) {
  const chat = useLeadChat(lead.id, siteVersion, onChanged, onVersieGewijzigd, chatOpties);
  const [sleeptOver, setSleeptOver] = useState(false);
  // Wat je hier kiest, of anders wat de lead heeft. Afgeleid in plaats van
  // één keer overgenomen: de werkruimte laadt de lead zelf, dus ai_model kan
  // pas na het eerste renderen binnenkomen — en dan bleef de keuzelijst op de
  // standaard staan, wat op het klantenscherm altijd zo was.
  const [modelKeuze, setModelKeuze] = useState<AiModel | null>(null);
  const model = modelKeuze ?? (lead.ai_model as AiModel | null | undefined) ?? STANDAARD_AI_MODEL;
  const [melding, setMelding] = useState<string | null>(null);
  const [publiceerOpen, setPubliceerOpen] = useState(false);
  const [bronnenOpen, setBronnenOpen] = useState(false);
  const [hergenereerOpen, setHergenereerOpen] = useState(false);
  const [bezigMetVersie, startVersie] = useTransition();
  const bestandInput = useRef<HTMLInputElement>(null);
  const invoerRef = useRef<HTMLTextAreaElement>(null);
  const onderkant = useRef<HTMLDivElement>(null);

  useEffect(() => {
    onderkant.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [chat.berichten.length, chat.bezig, chat.uploadBezig]);

  // Meegroeien met de tekst, tot een redelijke hoogte — zoals je van een
  // chatvenster verwacht in plaats van één regel die wegschuift.
  useEffect(() => {
    const veld = invoerRef.current;
    if (!veld) return;
    veld.style.height = "auto";
    veld.style.height = `${Math.min(veld.scrollHeight, 200)}px`;
  }, [chat.invoer]);

  function verwerkBestanden(bestanden: FileList | null) {
    for (const file of Array.from(bestanden ?? [])) chat.voegBestandToe(file);
  }

  async function kiesModel(nieuw: AiModel) {
    setModelKeuze(nieuw);
    setMelding(null);
    const fout = await updateLeadAiModel(lead.id, nieuw);
    if (fout) setMelding(fout);
    else onChanged();
  }

  function bewaarAlsVersie() {
    if (!siteVersion) return;
    setMelding(null);
    startVersie(async () => {
      const fout = await revertToVersion(lead.id, siteVersion);
      setMelding(fout ?? "Bewaard als nieuwe versie (afgerond).");
      if (!fout) onChanged();
    });
  }

  const bezig = chat.bezig || chat.uploadBezig;
  const geblokkeerd = bezig || readOnly;
  // Zonder site valt er niets gericht aan te passen: dan wordt wat je typt de
  // briefing voor de eerste versie (zie verstuur() in de hook).
  const eersteVersie = !siteVersion;

  return (
    <div
      className="flex h-full min-h-0 flex-col overflow-hidden rounded-2xl border border-blue-100 bg-slate-50"
      onDragOver={(e) => {
        e.preventDefault();
        if (!readOnly) setSleeptOver(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setSleeptOver(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setSleeptOver(false);
        if (!readOnly) verwerkBestanden(e.dataTransfer.files);
      }}
    >
      <header className="border-b border-slate-200 bg-white px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="text-xs text-slate-500">
              {siteVersion
                ? `Je past versie ${siteVersion.versienummer} aan (${siteVersion.status})`
                : "Nog geen site — je eerste bericht wordt de briefing"}
            </p>
            {/* Welke versie bezoekers zien. Zonder dit kijk je naar een concept
                en denk je dat het de live site is — of andersom. */}
            {siteVersion ? (
              liveVersion?.id === siteVersion.id ? (
                <p className="mt-0.5 inline-flex items-center gap-1 text-xs font-medium text-emerald-700">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                  Dit is wat bezoekers zien — aanpassingen staan meteen online
                </p>
              ) : liveVersion ? (
                <p className="mt-0.5 text-xs text-amber-700">
                  Live staat versie {liveVersion.versienummer} — je kijkt naar een andere versie.
                </p>
              ) : (
                <p className="mt-0.5 text-xs text-slate-500">Er staat niets online.</p>
              )
            ) : null}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <label className="sr-only" htmlFor="chat-model">
              AI-model
            </label>
            <select
              id="chat-model"
              value={model}
              onChange={(e) => kiesModel(e.target.value as AiModel)}
              disabled={readOnly}
              title="Welk model deze lead gebruikt voor aanpassingen en hergeneraties."
              className="rounded-xl border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-700 outline-none focus:border-blue-400"
            >
              {AI_MODELLEN.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>

            <button
              type="button"
              onClick={() => setBronnenOpen(true)}
              title="De bestanden die in dit gesprek zijn toegevoegd"
              className="rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100"
            >
              Bronnen
            </button>

            <button
              type="button"
              onClick={bewaarAlsVersie}
              disabled={bezigMetVersie || !siteVersion || readOnly}
              title="Bewaart de site zoals hij nu is als een aparte versie, zodat je er altijd naar terug kan."
              className="rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50"
            >
              Bewaar als versie
            </button>

            <button
              type="button"
              onClick={() => setPubliceerOpen(true)}
              disabled={bezigMetVersie || !siteVersion || readOnly}
              title={
                !siteVersion
                  ? "Er is nog geen site om live te zetten."
                  : "Kies waar deze versie online komt, of haal de site offline."
              }
              className="rounded-xl bg-blue-600 px-3 py-1.5 text-xs font-medium text-white disabled:bg-slate-100 disabled:text-slate-400"
            >
              {liveVersion?.id === siteVersion?.id ? "Online beheren" : "Zet live"}
            </button>
          </div>
        </div>
        {melding ? <p className="mt-2 text-xs text-slate-600">{melding}</p> : null}
      </header>

      <div className="relative flex-1 overflow-y-auto px-4 py-5">
        {chat.berichten.length === 0 ? (
          <div className="text-sm text-slate-500">
            <p className="font-medium text-slate-700">Waar wil je aan werken?</p>
            <p className="mt-1">
              {siteVersion
                ? "Typ wat er moet veranderen. Bestanden mag je hierin slepen."
                : "Nog geen site. Wat je typt wordt de briefing voor de eerste versie."}
            </p>
          </div>
        ) : (
          <ul className="flex flex-col gap-4">
            {chat.berichten.map((bericht) => (
              <Bericht key={bericht.id} bericht={bericht} />
            ))}
            {bezig ? (
              <li className="flex items-center gap-2 px-1 text-xs text-slate-500">
                <span className="flex gap-0.5">
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400 [animation-delay:-0.3s]" />
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400 [animation-delay:-0.15s]" />
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400" />
                </span>
                {chat.uploadBezig ? "Bestand uitlezen…" : "Bezig met de site…"}
              </li>
            ) : null}
          </ul>
        )}
        <div ref={onderkant} />

        {sleeptOver ? (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-blue-600/10">
            <p className="rounded-2xl border-2 border-dashed border-blue-500 bg-white px-6 py-4 text-sm font-medium text-blue-700">
              Laat los om toe te voegen
            </p>
          </div>
        ) : null}
      </div>

      <footer className="border-t border-slate-200 bg-white px-4 py-3">
        <div className="flex flex-col gap-2">
          {chat.fout ? <p className="text-xs text-red-600">{chat.fout}</p> : null}
          {readOnly && readOnlyReden ? (
            <p className="text-xs text-amber-700">{readOnlyReden}</p>
          ) : null}

          <input
            ref={bestandInput}
            type="file"
            multiple
            accept="image/*,.pdf,.txt,.md,.csv"
            className="hidden"
            onChange={(e) => {
              verwerkBestanden(e.target.files);
              // Zodat hetzelfde bestand een tweede keer gekozen kan worden.
              e.target.value = "";
            }}
          />
          <textarea
            ref={invoerRef}
            rows={1}
            value={chat.invoer}
            onChange={(e) => chat.setInvoer(e.target.value)}
            disabled={readOnly}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                chat.verstuur();
              }
            }}
            placeholder={
              eersteVersie
                ? "Beschrijf de site — dit wordt de briefing voor de eerste versie"
                : "Wat moet er veranderen? (Enter om te versturen, Shift+Enter voor een nieuwe regel)"
            }
            className="w-full resize-none rounded-xl border border-slate-200 px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-200 disabled:bg-slate-50 disabled:text-slate-500"
          />
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => bestandInput.current?.click()}
              disabled={geblokkeerd}
              title="Voeg een logo, menukaart of foto toe"
              aria-label="Bestand toevoegen"
              className="rounded-xl border border-slate-200 px-3 py-2 text-slate-600 hover:bg-slate-100 disabled:opacity-50"
            >
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M21.44 11.05 12.25 20.24a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
              </svg>
            </button>

            {/* Bewust klein en achteraan: dit is de uitzondering, niet de
                gewone manier van werken. */}
            {magHergenereren && siteVersion ? (
              <button
                type="button"
                onClick={() => setHergenereerOpen(true)}
                disabled={geblokkeerd}
                className="text-xs text-slate-500 underline-offset-2 hover:text-slate-700 hover:underline disabled:opacity-50"
              >
                Hele site opnieuw genereren…
              </button>
            ) : null}

            <button
              type="button"
              onClick={chat.verstuur}
              disabled={geblokkeerd || !chat.invoer.trim()}
              className="ml-auto rounded-xl bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:bg-slate-100 disabled:text-slate-400"
            >
              {bezig ? "Bezig…" : eersteVersie ? "Eerste versie genereren" : "Doorvoeren"}
            </button>
          </div>
        </div>
      </footer>

      {hergenereerOpen && siteVersion ? (
        <HergenereerDialoog
          versienummer={siteVersion.versienummer}
          beginTekst={chat.invoer}
          onBevestig={(tekst) => {
            setHergenereerOpen(false);
            // Kwam de tekst uit het invoerveld, dan hoort die daar niet te
            // blijven staan na het versturen.
            if (tekst.trim() === chat.invoer.trim()) chat.setInvoer("");
            chat.genereerOpnieuw(tekst);
          }}
          onClose={() => setHergenereerOpen(false)}
        />
      ) : null}

      {publiceerOpen && siteVersion ? (
        <PubliceerDialoog
          leadId={lead.id}
          version={siteVersion}
          liveVersion={liveVersion}
          onKlaar={onChanged}
          onClose={() => setPubliceerOpen(false)}
        />
      ) : null}

      {bronnenOpen ? (
        <BronnenPaneel
          leadId={lead.id}
          onClose={() => setBronnenOpen(false)}
          onGewijzigd={onChanged}
        />
      ) : null}
    </div>
  );
}

/**
 * De bevestiging vóór een hergeneratie. Zegt wat er gebeurt vóór het gebeurt:
 * een nieuwe versie, de huidige blijft staan, en het duurt en kost meer dan een
 * aanpassing.
 */
function HergenereerDialoog({
  versienummer,
  beginTekst,
  onBevestig,
  onClose,
}: {
  versienummer: number;
  beginTekst: string;
  onBevestig: (tekst: string) => void;
  onClose: () => void;
}) {
  const [tekst, setTekst] = useState(beginTekst);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      // Enkel deze dialoog sluiten, niet ook de werkruimte eronder.
      e.stopImmediatePropagation();
      onClose();
    }
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/20 p-4 backdrop-blur-sm">
      <div className="w-full max-w-lg space-y-3 rounded-2xl bg-white p-5 shadow-xl">
        <h3 className="text-base font-semibold text-slate-900">Hele site opnieuw genereren</h3>
        <ul className="list-disc space-y-1 pl-5 text-sm text-slate-600">
          <li>
            Dit maakt een <strong>nieuwe versie</strong>. Versie {versienummer} blijft ongewijzigd staan en
            vind je terug in Versiegeschiedenis.
          </li>
          <li>Duurt enkele minuten en kost merkbaar meer dan een gerichte aanpassing.</li>
          <li>De worker moet draaien.</li>
        </ul>
        <label className="block space-y-1">
          <span className="text-xs text-slate-500">Extra briefing (mag leeg blijven)</span>
          <textarea
            value={tekst}
            onChange={(e) => setTekst(e.target.value)}
            rows={4}
            autoFocus
            placeholder="bv. rustiger kleurenpalet, en een aparte pagina voor de catering"
            className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-900 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-200"
          />
        </label>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-600 hover:bg-slate-100"
          >
            Annuleren
          </button>
          <button
            type="button"
            onClick={() => onBevestig(tekst)}
            className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            Nieuwe versie genereren
          </button>
        </div>
      </div>
    </div>
  );
}

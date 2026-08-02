"use client";

import { useEffect, useRef, useState } from "react";
import type { Lead, SiteVersion } from "@/lib/types";
import { afzenderLabel, type ChatBericht } from "./chat-geschiedenis";
import { useLeadChat } from "./use-lead-chat";

// The full-screen conversation about one lead's site.
//
// Same hook as the strip in the lead panel, so the two can't diverge — this is
// purely a roomier view: the whole transcript instead of the last few lines,
// and a drop zone covering the entire window rather than a "+" button.

const SOORT_LABEL: Record<ChatBericht["soort"], string> = {
  chat: "",
  patch: "aanpassing",
  regeneratie: "hergeneratie",
  upload: "bestand",
};

function Bericht({ bericht }: { bericht: ChatBericht }) {
  const vanMij = bericht.rol === "gebruiker";
  const label = SOORT_LABEL[bericht.soort];

  return (
    <li className={`flex ${vanMij ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[42rem] rounded-2xl px-4 py-2.5 ${
          vanMij
            ? "bg-blue-600 text-white"
            : bericht.rol === "ai"
              ? "bg-white text-slate-800 shadow-sm"
              : "bg-slate-100 text-slate-600"
        }`}
      >
        <p className={`text-xs font-medium ${vanMij ? "text-blue-100" : "text-slate-500"}`}>
          {afzenderLabel(bericht)}
          {label ? ` · ${label}` : ""}
          <span className={`ml-2 font-normal ${vanMij ? "text-blue-200" : "text-slate-400"}`}>
            {new Date(bericht.aangemaakt_op).toLocaleString("nl-BE", {
              day: "2-digit",
              month: "2-digit",
              hour: "2-digit",
              minute: "2-digit",
            })}
          </span>
        </p>
        <p className="mt-0.5 whitespace-pre-wrap text-sm">{bericht.bericht}</p>
      </div>
    </li>
  );
}

export function ChatVenster({
  lead,
  siteVersion,
  onChanged,
  onVersieGewijzigd,
  onClose,
}: {
  lead: Lead;
  siteVersion: SiteVersion;
  onChanged: () => void;
  onVersieGewijzigd?: () => void;
  onClose: () => void;
}) {
  const chat = useLeadChat(lead.id, siteVersion, onChanged, onVersieGewijzigd);
  const [sleeptOver, setSleeptOver] = useState(false);
  const bestandInput = useRef<HTMLInputElement>(null);
  const onderkant = useRef<HTMLDivElement>(null);

  // Follow the conversation as it grows, the way a chat should.
  useEffect(() => {
    onderkant.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [chat.berichten.length]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  function verwerkBestanden(bestanden: FileList | null) {
    for (const file of Array.from(bestanden ?? [])) chat.voegBestandToe(file);
  }

  return (
    <div
      className="fixed inset-0 z-30 flex flex-col bg-slate-50"
      // Drop anywhere in the window. dragover must be cancelled or the browser
      // navigates to the file instead of handing it over.
      onDragOver={(e) => {
        e.preventDefault();
        setSleeptOver(true);
      }}
      onDragLeave={(e) => {
        // Only when the pointer genuinely leaves the window — dragging across
        // a child element fires dragleave too, which would flicker the overlay.
        if (e.currentTarget === e.target) setSleeptOver(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setSleeptOver(false);
        verwerkBestanden(e.dataTransfer.files);
      }}
    >
      <header className="flex items-center justify-between border-b border-slate-200 bg-white px-6 py-3">
        <div>
          <h2 className="text-base font-semibold text-slate-900">{lead.bedrijfsnaam}</h2>
          <p className="text-xs text-slate-500">
            Versie {siteVersion.versienummer} · {siteVersion.status} · sleep bestanden hierheen om
            ze toe te voegen
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

      <div className="relative flex-1 overflow-y-auto px-6 py-4">
        {chat.berichten.length === 0 ? (
          <p className="text-sm text-slate-400">
            Nog geen berichten. Typ hieronder wat er aan de site moet veranderen, of sleep een
            menukaart of foto in dit venster.
          </p>
        ) : (
          <ul className="mx-auto flex max-w-4xl flex-col gap-3">
            {chat.berichten.map((bericht) => (
              <Bericht key={bericht.id} bericht={bericht} />
            ))}
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

      <footer className="border-t border-slate-200 bg-white px-6 py-3">
        <div className="mx-auto flex max-w-4xl flex-col gap-2">
          {chat.fout ? <p className="text-xs text-red-600">{chat.fout}</p> : null}
          {chat.uploadBezig ? (
            <p className="text-xs text-slate-400">Bestand uitlezen…</p>
          ) : chat.bezig ? (
            <p className="text-xs text-slate-400">Bezig…</p>
          ) : null}

          <div className="flex gap-2">
            <input
              ref={bestandInput}
              type="file"
              multiple
              className="hidden"
              onChange={(e) => verwerkBestanden(e.target.files)}
            />
            <button
              type="button"
              onClick={() => bestandInput.current?.click()}
              disabled={chat.bezig || chat.uploadBezig}
              aria-label="Bestand toevoegen"
              className="rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-600 hover:bg-slate-100 disabled:opacity-50"
            >
              +
            </button>
            <input
              value={chat.invoer}
              onChange={(e) => chat.setInvoer(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  chat.verstuur();
                }
              }}
              placeholder="bv. maak de hero donkerder — of sleep een menukaart in dit venster"
              className="flex-1 rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-900 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-200"
            />
            <button
              type="button"
              onClick={chat.verstuur}
              disabled={chat.bezig || chat.uploadBezig}
              className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              Verstuur
            </button>
          </div>

          <button
            type="button"
            onClick={chat.genereerOpnieuw}
            disabled={chat.bezig || chat.uploadBezig}
            className="self-start text-xs text-slate-500 hover:underline disabled:opacity-50"
          >
            {chat.invoer.trim()
              ? "Of: hele site opnieuw genereren met deze instructie"
              : "Of: hele site opnieuw genereren"}
          </button>
        </div>
      </footer>
    </div>
  );
}

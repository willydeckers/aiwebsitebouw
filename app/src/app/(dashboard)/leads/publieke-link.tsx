"use client";

import type { ReviewLogEntry } from "@/lib/types";
import { linkRendertInBrowser, lokaleLink } from "@/lib/demo-link";

/**
 * Waar de site te bekijken is. Gedeeld door de demo-preview in het leadpaneel
 * en de werkruimte.
 *
 * `versienummer`: toon ook de link naar precies díe versie op de lokale
 * hosting. Zonder nummer toont localhost de actieve versie (of de nieuwste), en
 * dat is niet noodzakelijk de versie waar je naar zit te kijken.
 */
export function PubliekeLinkInhoud({
  leadId,
  demoUrl,
  versienummer,
}: {
  leadId: string;
  demoUrl: string | null;
  versienummer?: number;
}) {
  return (
    <div className="space-y-2 rounded-xl border border-blue-100 p-2 text-xs">
      {demoUrl ? (
        <div>
          <p className="font-medium text-slate-700">Publieke link</p>
          <p className="break-all text-slate-600">{demoUrl}</p>
          {!linkRendertInBrowser() ? (
            <p className="mt-0.5 text-slate-500">
              Toont broncode in een browser — Supabase serveert alles op *.supabase.co als platte tekst. Wel
              bruikbaar voor de preview in de app en voor de review-loop.
            </p>
          ) : null}
        </div>
      ) : (
        <p className="text-slate-500">
          Nog geen publieke link: die bestaat pas als er een versie live staat.
        </p>
      )}

      {/* De enige link die vandaag écht een site toont. */}
      <div>
        <p className="font-medium text-slate-700">Om te tonen in een browser</p>
        <a href={lokaleLink(leadId)} target="_blank" rel="noreferrer" className="break-all text-blue-600 underline">
          {lokaleLink(leadId)}
        </a>
        {versienummer != null ? (
          <>
            <span className="text-slate-500"> — deze versie: </span>
            <a
              href={lokaleLink(leadId, versienummer)}
              target="_blank"
              rel="noreferrer"
              className="break-all text-blue-600 underline"
            >
              {lokaleLink(leadId, versienummer)}
            </a>
          </>
        ) : null}
        <p className="mt-0.5 text-slate-500">
          De worker serveert de site op deze machine. Werkt zolang die draait.
        </p>
      </div>
    </div>
  );
}

/** De laatste bevindingen van de review-loop en de chat. */
export function ReviewLogLijst({ reviewLog }: { reviewLog: ReviewLogEntry[] }) {
  if (reviewLog.length === 0) {
    return <p className="text-xs text-slate-500">Nog geen review-bevindingen.</p>;
  }
  return (
    <div className="space-y-1 rounded-xl border border-blue-100 p-2 text-sm">
      {reviewLog.map((entry) => (
        <p key={entry.id} className="text-slate-600">
          [{entry.bron}] {entry.instructie_of_bevinding ?? entry.resultaat ?? entry.error_message}
        </p>
      ))}
    </div>
  );
}

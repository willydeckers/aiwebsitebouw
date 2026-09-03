"use client";

import { useEffect, useState, useTransition } from "react";
import type { SiteVersion } from "@/lib/types";
import { createClient } from "@/lib/supabase/client";
import { activateVersion, deactivateVersion } from "./version-actions";
import { demoLink, linkRendertInBrowser } from "@/lib/demo-link";

// Wat er gebeurt als je op "Zet live" drukt, vóór het gebeurt.
//
// De knop deed dit eerst meteen en zonder uitleg, en dat is precies één vraag
// te weinig: live wáár? Een lead zonder klantrelatie komt op de demo-link
// terecht, een klant op zijn eigen domein — en welke van de twee het is, stond
// nergens op het moment dat je publiceerde. Wie dat mis had, zette een site
// live op een adres dat hij nooit doorgaf.

type Doel = {
  soort: "demo" | "bureau_subdomein" | "eigen_domein";
  url: string | null;
  domein: string | null;
};

export function PubliceerDialoog({
  leadId,
  version,
  liveVersion,
  onKlaar,
  onClose,
}: {
  leadId: string;
  version: SiteVersion;
  /** De versie die nu live staat, als die er is. */
  liveVersion: SiteVersion | null;
  onKlaar: () => void;
  onClose: () => void;
}) {
  const [doel, setDoel] = useState<Doel | null>(null);
  const [melding, setMelding] = useState<string | null>(null);
  const [bezig, start] = useTransition();

  useEffect(() => {
    const supabase = createClient();
    supabase
      .from("klanten")
      .select("definitief_domein, domein_type")
      .eq("lead_id", leadId)
      .maybeSingle()
      .then(({ data }) => {
        if (data?.definitief_domein) {
          setDoel({
            soort: data.domein_type === "eigen_domein" ? "eigen_domein" : "bureau_subdomein",
            url: `https://${data.definitief_domein}`,
            domein: data.definitief_domein,
          });
        } else {
          setDoel({ soort: "demo", url: demoLink(leadId), domein: null });
        }
      });
  }, [leadId]);

  const isLive = liveVersion?.id === version.id;

  function publiceer() {
    setMelding(null);
    start(async () => {
      const fout = await activateVersion(leadId, version.id);
      if (fout) {
        setMelding(fout);
        return;
      }
      onKlaar();
      onClose();
    });
  }

  function haalOffline() {
    if (!liveVersion) return;
    setMelding(null);
    start(async () => {
      const fout = await deactivateVersion(liveVersion.id);
      if (fout) {
        setMelding(fout);
        return;
      }
      onKlaar();
      onClose();
    });
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/20 p-4 backdrop-blur-sm">
      <div className="w-full max-w-lg space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-xl">
        <div>
          <h2 className="text-base font-semibold text-slate-900">
            {isLive ? "Deze versie staat live" : `Versie ${version.versienummer} live zetten`}
          </h2>
          <p className="mt-0.5 text-xs text-slate-500">
            {liveVersion
              ? isLive
                ? "Bezoekers zien op dit moment deze versie."
                : `Nu staat versie ${liveVersion.versienummer} live. Die wordt vervangen.`
              : "Er staat op dit moment niets online voor deze lead."}
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Komt online op</p>
          {!doel ? (
            <p className="mt-1 text-slate-500">Laden…</p>
          ) : doel.soort === "demo" ? (
            <>
              <p className="mt-1 break-all text-slate-800">{doel.url ?? "Geen Supabase-URL bekend"}</p>
              <p className="mt-1 text-xs text-slate-500">
                De demo-link. Deze lead heeft nog geen eigen domein — dat stel je in bij{" "}
                <span className="font-medium">Klant &amp; account → Pakket &amp; domein</span>, zodra
                het een klant is.
              </p>
              {doel.url && !linkRendertInBrowser() ? (
                <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900">
                  Let op: op dit adres toont een browser de broncode in plaats van de site. Supabase
                  serveert alles op <code>*.supabase.co</code> als platte tekst. De preview hier in
                  de app klopt wel — gebruik <span className="font-medium">Volledig scherm</span> om
                  de site te tonen. Zodra de hosting op een eigen domein staat, werkt deze link ook
                  in een browser.
                </p>
              ) : null}
            </>
          ) : (
            <>
              <p className="mt-1 break-all font-medium text-slate-800">{doel.url}</p>
              <p className="mt-1 text-xs text-slate-500">
                {doel.soort === "eigen_domein"
                  ? "Het eigen domein van de klant."
                  : "Een subdomein van het bureau."}{" "}
                De demo-link blijft daarnaast gewoon werken.
              </p>
            </>
          )}
        </div>

        {melding ? <p className="text-xs text-red-600">{melding}</p> : null}

        <div className="flex flex-wrap justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={bezig}
            className="rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-600 hover:bg-slate-100 disabled:opacity-50"
          >
            Annuleer
          </button>

          {liveVersion ? (
            <button
              type="button"
              onClick={haalOffline}
              disabled={bezig}
              title="Haalt de site offline. De versie blijft bewaard, dus online zetten is één klik terug."
              className="rounded-xl border border-red-200 px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
            >
              Offline halen
            </button>
          ) : null}

          {isLive ? null : (
            <button
              type="button"
              onClick={publiceer}
              disabled={bezig}
              className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {bezig ? "Bezig…" : liveVersion ? "Vervang wat live staat" : "Zet live"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

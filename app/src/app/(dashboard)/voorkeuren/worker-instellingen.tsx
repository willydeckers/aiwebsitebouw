"use client";

import { useState } from "react";
import {
  LEGE_WORKER_CONFIG,
  herstartWorker,
  isDesktopApp,
  leesWorkerConfig,
  leesWorkerLog,
  leesWorkerToestand,
  schrijfWorkerConfig,
  type WorkerConfig,
  type WorkerToestand,
} from "@/lib/desktop";

// Where the worker's secrets live in the installed app.
//
// They are deliberately not compiled into the installer: the service-role key
// bypasses row-level security entirely, so a shared setup file would hand
// whoever receives it full database access. Each machine fills these in once,
// into its own app-data directory.
//
// Only shown in the packaged app. Running from a checkout you start the worker
// yourself from worker/.env, and a settings screen that wrote a file nothing
// reads would be worse than none.

type Veld = {
  sleutel: keyof WorkerConfig;
  label: string;
  uitleg: string;
  vereist: boolean;
};

const VELDEN: Veld[] = [
  {
    sleutel: "supabase_url",
    label: "Supabase-URL",
    uitleg: "De project-URL, bv. https://xxxx.supabase.co",
    vereist: true,
  },
  {
    sleutel: "supabase_service_role_key",
    label: "Service-role-key",
    uitleg:
      "supabase projects api-keys --project-ref <ref>. Deze sleutel omzeilt alle toegangsregels — deel hem niet.",
    vereist: true,
  },
  {
    sleutel: "anthropic_api_key",
    label: "Anthropic-sleutel",
    uitleg: "Voor research, generatie en review.",
    vereist: true,
  },
  {
    sleutel: "shopify_partner_organization_id",
    label: "Shopify partner-organisatie-ID",
    uitleg: "Enkel nodig om Shopify-winkels aan te maken.",
    vereist: false,
  },
  {
    sleutel: "shopify_partner_access_token",
    label: "Shopify partner-token",
    uitleg: "Enkel nodig om Shopify-winkels aan te maken.",
    vereist: false,
  },
  {
    sleutel: "shopify_app_client_id",
    label: "Shopify app client-ID",
    uitleg: "Uit het Dev Dashboard; nodig om een winkel in te richten.",
    vereist: false,
  },
  {
    sleutel: "shopify_app_client_secret",
    label: "Shopify app client-secret",
    uitleg: "Uit het Dev Dashboard; nodig om een winkel in te richten.",
    vereist: false,
  },
];

export function WorkerInstellingen() {
  const [open, setOpen] = useState(false);
  const [config, setConfig] = useState<WorkerConfig>(LEGE_WORKER_CONFIG);
  const [toestand, setToestand] = useState<WorkerToestand | null>(null);
  const [bezig, setBezig] = useState(false);
  const [melding, setMelding] = useState<string | null>(null);
  const [logboek, setLogboek] = useState<string>("");

  if (!isDesktopApp()) return null;

  async function openen() {
    if (open) {
      setOpen(false);
      return;
    }
    setOpen(true);
    setConfig(await leesWorkerConfig());
    setToestand(await leesWorkerToestand());
    setLogboek(await leesWorkerLog());
  }

  async function bewaren() {
    setBezig(true);
    setMelding(null);
    try {
      const nieuw = await schrijfWorkerConfig(config);
      setToestand(nieuw);
      setLogboek(await leesWorkerLog());
      setMelding(nieuw.draait ? "Bewaard — de worker draait." : nieuw.reden || "Bewaard.");
    } catch (err) {
      setMelding(err instanceof Error ? err.message : String(err));
    } finally {
      setBezig(false);
    }
  }

  async function herstarten() {
    setBezig(true);
    setMelding(null);
    try {
      const nieuw = await herstartWorker();
      setToestand(nieuw);
      setLogboek(await leesWorkerLog());
      setMelding(nieuw.draait ? "De worker draait." : nieuw.reden);
    } finally {
      setBezig(false);
    }
  }

  return (
    <section className="mt-6 max-w-3xl rounded-3xl border border-white/60 bg-white/70 p-6 shadow-xl shadow-blue-200/40 backdrop-blur-xl">
      <button
        type="button"
        onClick={openen}
        className="flex w-full items-center justify-between text-left"
      >
        <span className="text-sm font-medium text-slate-700">
          Worker
          {toestand ? (
            <span
              className={`ml-2 text-xs font-normal ${toestand.draait ? "text-emerald-600" : "text-amber-600"}`}
            >
              {toestand.draait ? "draait" : "staat stil"}
            </span>
          ) : null}
        </span>
        <span className="text-xs text-slate-400">{open ? "verbergen" : "tonen"}</span>
      </button>

      {open ? (
        <div className="mt-3 space-y-4">
          <p className="text-xs text-slate-500">
            De worker doet research, genereert de sites, beoordeelt ze en bouwt de Shopify-winkels.
            Hij start mee met deze app en draait onzichtbaar op de achtergrond. Deze gegevens
            blijven op deze computer staan en zitten niet in het installatiebestand — de
            service-role-key geeft volledige toegang tot de database.
          </p>

          <div className="space-y-3">
            {VELDEN.map((veld) => (
              <label key={veld.sleutel} className="block">
                <span className="text-xs font-medium text-slate-600">
                  {veld.label}
                  {veld.vereist ? null : <span className="text-slate-400"> — optioneel</span>}
                </span>
                <input
                  type={veld.sleutel.includes("url") ? "text" : "password"}
                  value={config[veld.sleutel]}
                  onChange={(e) => setConfig({ ...config, [veld.sleutel]: e.target.value })}
                  className="mt-1 w-full rounded-xl border border-blue-200 px-3 py-2 text-sm text-slate-900 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-200"
                />
                <span className="text-[11px] text-slate-400">{veld.uitleg}</span>
              </label>
            ))}
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={bewaren}
              disabled={bezig}
              className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {bezig ? "Bezig..." : "Bewaren en herstarten"}
            </button>
            <button
              type="button"
              onClick={herstarten}
              disabled={bezig}
              className="rounded-xl border border-blue-200 px-4 py-2 text-sm text-slate-600 hover:bg-blue-50 disabled:opacity-50"
            >
              Herstarten
            </button>
          </div>

          {melding ? <p className="text-xs text-slate-600">{melding}</p> : null}

          {/* The worker has no console. Without this its output goes nowhere
              and a refusal to start is invisible. */}
          {logboek ? (
            <details>
              <summary className="cursor-pointer text-xs text-slate-500">
                Uitvoer van de worker
              </summary>
              <pre className="mt-2 max-h-64 overflow-auto rounded-xl bg-slate-900 p-3 text-[11px] leading-relaxed text-slate-100">
                {logboek}
              </pre>
            </details>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

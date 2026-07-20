"use client";

import { useEffect, useState } from "react";
import {
  fetchSourcingConfig,
  saveSourcingConfig,
  startSourcingRun,
  type SourcingConfig,
} from "./sourcing-actions";

function parseCommaList(value: string): string[] {
  return value
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
}

export function SourcingConfigDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [config, setConfig] = useState<SourcingConfig | null>(null);
  const [naceCodes, setNaceCodes] = useState("");
  const [postcodes, setPostcodes] = useState("");
  const [kwaliteitsdrempelMatig, setKwaliteitsdrempelMatig] = useState(true);
  const [maxLeadsPerRun, setMaxLeadsPerRun] = useState(20);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [runResult, setRunResult] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    if (!open) return;
    fetchSourcingConfig().then((data) => {
      setConfig(data);
      if (data) {
        setNaceCodes(data.nace_codes.join(", "));
        setPostcodes(data.postcodes.join(", "));
        setKwaliteitsdrempelMatig(data.kwaliteitsdrempel_matig);
        setMaxLeadsPerRun(data.max_leads_per_run);
      }
    });
  }, [open]);

  if (!open) return null;

  async function handleSave() {
    setSaveError(null);
    setSaving(true);
    const result = await saveSourcingConfig({
      id: config?.id,
      nace_codes: parseCommaList(naceCodes),
      postcodes: parseCommaList(postcodes),
      kwaliteitsdrempel_matig: kwaliteitsdrempelMatig,
      run_frequentie: config?.run_frequentie ?? null,
      max_leads_per_run: maxLeadsPerRun,
    });
    setSaving(false);
    if (result) setSaveError(result);
    else onClose();
  }

  async function handleRun() {
    setRunResult(null);
    setRunning(true);
    const result = await startSourcingRun();
    setRunning(false);
    setRunResult(result ?? "Sourcing-run gestart — nieuwe leads verschijnen via Realtime.");
  }

  return (
    <div className="fixed inset-0 z-20 flex items-center justify-center bg-slate-900/20 backdrop-blur-sm">
      <div className="w-full max-w-md space-y-3 rounded-3xl border border-white/60 bg-white/80 p-6 shadow-xl shadow-blue-200/40 backdrop-blur-xl">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-slate-900">Sourcing-configuratie (3.1a)</h2>
          <button type="button" onClick={onClose} className="text-sm text-slate-500 hover:text-slate-800">
            Sluiten
          </button>
        </div>

        <div className="space-y-1">
          <label htmlFor="nace-codes" className="text-sm text-slate-600">
            NACE-codes (komma-gescheiden)
          </label>
          <input
            id="nace-codes"
            value={naceCodes}
            onChange={(e) => setNaceCodes(e.target.value)}
            placeholder="bv. 47.910, 96.021"
            className="w-full rounded-xl border border-blue-200 bg-white/80 px-3 py-2 text-sm text-slate-900 outline-none placeholder:text-slate-400 focus:border-blue-400 focus:ring-2 focus:ring-blue-200"
          />
        </div>

        <div className="space-y-1">
          <label htmlFor="postcodes" className="text-sm text-slate-600">
            Postcodes (komma-gescheiden)
          </label>
          <input
            id="postcodes"
            value={postcodes}
            onChange={(e) => setPostcodes(e.target.value)}
            placeholder="bv. 3990, 3991"
            className="w-full rounded-xl border border-blue-200 bg-white/80 px-3 py-2 text-sm text-slate-900 outline-none placeholder:text-slate-400 focus:border-blue-400 focus:ring-2 focus:ring-blue-200"
          />
        </div>

        <div className="space-y-1">
          <label htmlFor="max-leads" className="text-sm text-slate-600">
            Max leads per run
          </label>
          <input
            id="max-leads"
            type="number"
            min={1}
            value={maxLeadsPerRun}
            onChange={(e) => setMaxLeadsPerRun(Number(e.target.value))}
            className="w-full rounded-xl border border-blue-200 bg-white/80 px-3 py-2 text-sm text-slate-900 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-200"
          />
        </div>

        <label className="flex items-center gap-2 text-sm text-slate-600">
          <input
            type="checkbox"
            checked={kwaliteitsdrempelMatig}
            onChange={(e) => setKwaliteitsdrempelMatig(e.target.checked)}
          />
          Ook &quot;matige&quot; websites als sourcing-doelwit (niet enkel geen/kapot)
        </label>

        {saveError ? <p className="text-sm text-red-600">{saveError}</p> : null}

        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="w-full rounded-xl bg-blue-600 px-3 py-2 text-sm font-medium text-white shadow-md shadow-blue-300/50 transition hover:bg-blue-500 disabled:opacity-50"
        >
          {saving ? "Bezig..." : "Opslaan"}
        </button>

        <div className="border-t border-slate-100 pt-3">
          {config?.laatst_uitgevoerd_op ? (
            <p className="text-xs text-slate-400">
              Laatst uitgevoerd: {new Date(config.laatst_uitgevoerd_op).toLocaleString("nl-BE")}
            </p>
          ) : null}
          <button
            type="button"
            onClick={handleRun}
            disabled={running || !config}
            className="mt-2 w-full rounded-xl border border-blue-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-blue-50 disabled:opacity-50"
          >
            {running ? "Bezig..." : "Start sourcing-run nu"}
          </button>
          {runResult ? <p className="mt-1 text-xs text-slate-500">{runResult}</p> : null}
        </div>
      </div>
    </div>
  );
}

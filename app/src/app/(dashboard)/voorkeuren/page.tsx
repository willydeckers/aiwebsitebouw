"use client";

import { useEffect, useState } from "react";
import {
  buildGmailAuthUrl,
  disconnectGmail,
  fetchOwnGmailKoppeling,
  type GmailKoppeling,
} from "./gmail-actions";

const STATUS_LABELS: Record<GmailKoppeling["status"], string> = {
  actief: "Gekoppeld",
  verlopen: "Verlopen — koppel opnieuw",
  niet_gekoppeld: "Niet gekoppeld",
};

export default function VoorkeurenPage() {
  const [koppeling, setKoppeling] = useState<GmailKoppeling | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    fetchOwnGmailKoppeling().then(setKoppeling);
  }, []);

  function handleConnect() {
    const redirectUri = `${window.location.origin}/gmail-callback`;
    window.location.href = buildGmailAuthUrl(redirectUri);
  }

  function handleDisconnect() {
    setError(null);
    setPending(true);
    disconnectGmail().then((result) => {
      setPending(false);
      if (result) setError(result);
      else fetchOwnGmailKoppeling().then(setKoppeling);
    });
  }

  return (
    <div>
      <h1 className="text-lg font-semibold text-slate-900">Voorkeuren</h1>

      <section className="mt-6 max-w-md space-y-2 rounded-3xl border border-white/60 bg-white/70 p-6 shadow-xl shadow-blue-200/40 backdrop-blur-xl">
        <h2 className="text-sm font-medium text-slate-700">Gmail-koppeling (spec 2/7)</h2>
        <p className="text-sm text-slate-600">
          Status: {koppeling ? STATUS_LABELS[koppeling.status] : "Laden..."}
        </p>
        {koppeling?.gekoppeld_op ? (
          <p className="text-xs text-slate-400">
            Gekoppeld op: {new Date(koppeling.gekoppeld_op).toLocaleString("nl-BE")}
          </p>
        ) : null}

        {error ? <p className="text-sm text-red-600">{error}</p> : null}

        {koppeling?.status === "actief" ? (
          <button
            type="button"
            onClick={handleDisconnect}
            disabled={pending}
            className="rounded-xl border border-red-200 px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
          >
            {pending ? "Bezig..." : "Ontkoppel"}
          </button>
        ) : (
          <button
            type="button"
            onClick={handleConnect}
            className="rounded-xl bg-blue-600 px-3 py-2 text-sm font-medium text-white shadow-md shadow-blue-300/50 transition hover:bg-blue-500"
          >
            Koppel Gmail
          </button>
        )}
      </section>

      <p className="mt-6 text-sm text-slate-500">
        Tabs Stijlvoorkeuren / Sectorkennis volgen (spec sectie 4.9).
      </p>
    </div>
  );
}

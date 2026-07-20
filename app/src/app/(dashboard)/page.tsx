"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type AuditEntry = {
  id: string;
  gebruiker: string;
  actie: string;
  lead_id: string | null;
  detail: Record<string, unknown> | null;
  timestamp: string;
};

const ACTIE_LABELS: Record<string, string> = {
  lead_aangemaakt: "Lead aangemaakt",
  lead_verwijderd: "Lead verwijderd",
  lead_geconverteerd: "Lead geconverteerd naar klant",
  lead_conversie_gestart: "Shopify-conversie gestart",
  lead_verstuurd: "Demo verstuurd naar lead",
  sourcing_run_afgerond: "Sourcing-run afgerond",
};

export default function OverzichtPage() {
  const [entries, setEntries] = useState<AuditEntry[] | null>(null);

  useEffect(() => {
    const supabase = createClient();

    function load() {
      supabase
        .from("audit_log")
        .select("*")
        .order("timestamp", { ascending: false })
        .limit(20)
        .then(({ data }) => setEntries((data as AuditEntry[]) ?? []));
    }

    load();

    const channel = supabase
      .channel("overzicht-audit-log")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "audit_log" }, () => load())
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  return (
    <div>
      <h1 className="text-lg font-semibold text-slate-900">Overzicht</h1>

      <section className="mt-6 max-w-2xl space-y-2">
        <h2 className="text-sm font-medium text-slate-700">Recente activiteit</h2>
        {entries === null ? (
          <p className="text-sm text-slate-500">Laden...</p>
        ) : entries.length === 0 ? (
          <p className="text-sm text-slate-500">Nog geen activiteit gelogd.</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {entries.map((entry) => (
              <li
                key={entry.id}
                className="rounded-xl border border-blue-100 bg-white/60 px-3 py-2 text-slate-700"
              >
                <span className="text-xs text-slate-400">
                  {new Date(entry.timestamp).toLocaleString("nl-BE")}
                </span>{" "}
                — {ACTIE_LABELS[entry.actie] ?? entry.actie} ({entry.gebruiker})
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

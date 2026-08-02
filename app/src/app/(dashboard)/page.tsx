"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import type { LeadStatus } from "@/lib/types";

type AuditEntry = {
  id: string;
  gebruiker: string;
  actie: string;
  lead_id: string | null;
  detail: Record<string, unknown> | null;
  timestamp: string;
  // Joined in so the log says WHICH company an action was about — "Lead
  // verwijderd" on its own tells you nothing you can act on.
  lead: { bedrijfsnaam: string } | null;
};

const ACTIE_LABELS: Record<string, string> = {
  lead_aangemaakt: "Lead aangemaakt",
  lead_verwijderd: "Lead verwijderd",
  lead_geconverteerd: "Lead geconverteerd naar klant",
  lead_conversie_gestart: "Shopify-conversie gestart",
  lead_verstuurd: "Demo verstuurd naar lead",
  sourcing_run_afgerond: "Sourcing-run afgerond",
};

const ACTIEF_STATUSSEN: LeadStatus[] = ["nieuw", "research", "genereren", "klaar"];
const WACHT_STATUSSEN: LeadStatus[] = ["verzonden", "geopend"];
const AANDACHT_STATUSSEN: LeadStatus[] = ["geblokkeerd", "budget_overschreden"];

type Tallies = { actief: number; wacht: number; klanten: number; aandacht: number };

/** A number you can't click is a dead end — each tile links to the list it
 *  counts, pre-filtered. */
function Tile({
  label,
  value,
  tint,
  href,
}: {
  label: string;
  value: number | null;
  tint: string;
  href: string;
}) {
  return (
    <Link
      href={href}
      className="glass-tile flex flex-col gap-1 px-5 py-4 transition hover:shadow-md hover:shadow-blue-200/50 focus:outline-none focus:ring-2 focus:ring-blue-300"
    >
      <span className="text-xs font-medium tracking-wide text-slate-500">{label}</span>
      <span className="text-2xl font-semibold" style={{ color: tint }}>
        {value === null ? "—" : value}
      </span>
    </Link>
  );
}

export default function OverzichtPage() {
  const [entries, setEntries] = useState<AuditEntry[] | null>(null);
  const [tallies, setTallies] = useState<Tallies | null>(null);

  useEffect(() => {
    const supabase = createClient();

    function load() {
      supabase
        .from("audit_log")
        .select("*, lead:leads(bedrijfsnaam)")
        .order("timestamp", { ascending: false })
        .limit(20)
        .then(({ data }) => setEntries((data as AuditEntry[]) ?? []));

      Promise.all([
        supabase.from("leads").select("status"),
        supabase.from("klanten").select("id", { count: "exact", head: true }),
      ]).then(([leadsResult, klantenResult]) => {
        const statuses = ((leadsResult.data ?? []) as { status: LeadStatus }[]).map((l) => l.status);
        setTallies({
          actief: statuses.filter((s) => ACTIEF_STATUSSEN.includes(s)).length,
          wacht: statuses.filter((s) => WACHT_STATUSSEN.includes(s)).length,
          klanten: klantenResult.count ?? 0,
          aandacht: statuses.filter((s) => AANDACHT_STATUSSEN.includes(s)).length,
        });
      });
    }

    load();

    const channel = supabase
      .channel("overzicht-audit-log")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "audit_log" }, () => load())
      .on("postgres_changes", { event: "*", schema: "public", table: "leads" }, () => load())
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  return (
    <div>
      <h1 className="text-lg font-semibold text-slate-900">Overzicht</h1>

      <section className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Tile label="Actieve leads" value={tallies?.actief ?? null} tint="#2563eb" href="/leads?status=actief" />
        <Tile label="In afwachting" value={tallies?.wacht ?? null} tint="#7c3aed" href="/verstuurd" />
        <Tile label="Klanten" value={tallies?.klanten ?? null} tint="#0d9488" href="/klanten" />
        <Tile label="Aandacht nodig" value={tallies?.aandacht ?? null} tint="#dc2626" href="/leads?status=aandacht" />
      </section>

      <section className="mt-6 max-w-2xl space-y-2">
        <h2 className="text-sm font-medium text-slate-700">Recente activiteit</h2>
        {entries === null ? (
          <p className="text-sm text-slate-500">Laden...</p>
        ) : entries.length === 0 ? (
          <p className="text-sm text-slate-500">Nog geen activiteit gelogd.</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {entries.map((entry) => (
              <li key={entry.id} className="glass-tile px-3 py-2 text-slate-700">
                <span className="text-xs text-slate-400">
                  {new Date(entry.timestamp).toLocaleString("nl-BE")}
                </span>{" "}
                — {ACTIE_LABELS[entry.actie] ?? entry.actie}
                {entry.lead?.bedrijfsnaam ? (
                  <>
                    {" "}
                    <span className="font-medium text-slate-900">{entry.lead.bedrijfsnaam}</span>
                  </>
                ) : null}{" "}
                <span className="text-slate-500">({entry.gebruiker})</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

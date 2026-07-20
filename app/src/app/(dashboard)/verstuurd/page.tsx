"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { StatusBadge } from "../leads/status-badge";
import type { Lead } from "@/lib/types";

type EmailEvent = { lead_id: string; type: "verzonden" | "geopend"; timestamp: string };

export default function VerstuurdPage() {
  const [leads, setLeads] = useState<Lead[] | null>(null);
  const [eventsByLead, setEventsByLead] = useState<Map<string, EmailEvent[]>>(new Map());
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createClient();

    async function load() {
      const { data: leadsData, error: leadsError } = await supabase
        .from("leads")
        .select("*")
        .in("status", ["verzonden", "geopend"])
        .order("laatst_bewerkt_op", { ascending: false });

      if (leadsError) {
        setError(leadsError.message);
        return;
      }

      setLeads(leadsData as Lead[]);

      const leadIds = (leadsData ?? []).map((l) => l.id);
      const { data: events } = leadIds.length
        ? await supabase
            .from("email_events")
            .select("lead_id, type, timestamp")
            .in("lead_id", leadIds)
            .order("timestamp", { ascending: true })
        : { data: [] as EmailEvent[] };

      const map = new Map<string, EmailEvent[]>();
      for (const event of (events ?? []) as EmailEvent[]) {
        const list = map.get(event.lead_id) ?? [];
        list.push(event);
        map.set(event.lead_id, list);
      }
      setEventsByLead(map);
    }

    load();

    const channel = supabase
      .channel("verstuurd-page")
      .on("postgres_changes", { event: "*", schema: "public", table: "email_events" }, load)
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  return (
    <div>
      <h1 className="text-lg font-semibold text-slate-900">Verstuurd</h1>

      {error ? (
        <p className="mt-4 text-sm text-red-600">Kon leads niet laden: {error}</p>
      ) : leads === null ? (
        <p className="mt-6 text-sm text-slate-500">Laden...</p>
      ) : leads.length === 0 ? (
        <p className="mt-6 text-sm text-slate-500">Nog niets verstuurd.</p>
      ) : (
        <table className="mt-4 w-full text-left text-sm">
          <thead>
            <tr className="border-b border-blue-100 text-slate-500">
              <th className="py-2 font-medium">Bedrijfsnaam</th>
              <th className="py-2 font-medium">Status</th>
              <th className="py-2 font-medium">Verzonden op</th>
              <th className="py-2 font-medium">Geopend?</th>
            </tr>
          </thead>
          <tbody>
            {leads.map((lead) => {
              const leadEvents = eventsByLead.get(lead.id) ?? [];
              const verzonden = leadEvents.find((e) => e.type === "verzonden");
              const geopend = leadEvents.find((e) => e.type === "geopend");

              return (
                <tr key={lead.id} className="border-b border-blue-50">
                  <td className="py-2 font-medium text-slate-900">{lead.bedrijfsnaam}</td>
                  <td className="py-2">
                    <StatusBadge status={lead.status} />
                  </td>
                  <td className="py-2 text-slate-600">
                    {verzonden ? new Date(verzonden.timestamp).toLocaleString("nl-BE") : "—"}
                  </td>
                  <td className="py-2 text-slate-600">
                    {geopend ? `Ja, ${new Date(geopend.timestamp).toLocaleString("nl-BE")}` : "Nog niet"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

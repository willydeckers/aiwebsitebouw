import { createClient } from "@/lib/supabase/server";
import { StatusBadge } from "../leads/status-badge";
import type { Lead } from "@/lib/types";

type EmailEvent = { lead_id: string; type: "verzonden" | "geopend"; timestamp: string };

export default async function VerstuurdPage() {
  const supabase = await createClient();

  const { data: leads, error } = await supabase
    .from("leads")
    .select("*")
    .in("status", ["verzonden", "geopend"])
    .order("laatste_update", { ascending: false });

  if (error) {
    return (
      <div>
        <h1 className="text-lg font-semibold text-neutral-900">Verstuurd</h1>
        <p className="mt-4 text-sm text-red-600">Kon leads niet laden: {error.message}</p>
      </div>
    );
  }

  const leadIds = (leads ?? []).map((l) => l.id);
  const { data: events } = leadIds.length
    ? await supabase
        .from("email_events")
        .select("lead_id, type, timestamp")
        .in("lead_id", leadIds)
        .order("timestamp", { ascending: true })
    : { data: [] as EmailEvent[] };

  const eventsByLead = new Map<string, EmailEvent[]>();
  for (const event of (events ?? []) as EmailEvent[]) {
    const list = eventsByLead.get(event.lead_id) ?? [];
    list.push(event);
    eventsByLead.set(event.lead_id, list);
  }

  return (
    <div>
      <h1 className="text-lg font-semibold text-neutral-900">Verstuurd</h1>

      {!leads || leads.length === 0 ? (
        <p className="mt-6 text-sm text-neutral-500">Nog niets verstuurd.</p>
      ) : (
        <table className="mt-4 w-full text-left text-sm">
          <thead>
            <tr className="border-b border-neutral-200 text-neutral-500">
              <th className="py-2 font-medium">Bedrijfsnaam</th>
              <th className="py-2 font-medium">Status</th>
              <th className="py-2 font-medium">Verzonden op</th>
              <th className="py-2 font-medium">Geopend?</th>
            </tr>
          </thead>
          <tbody>
            {(leads as Lead[]).map((lead) => {
              const leadEvents = eventsByLead.get(lead.id) ?? [];
              const verzonden = leadEvents.find((e) => e.type === "verzonden");
              const geopend = leadEvents.find((e) => e.type === "geopend");

              return (
                <tr key={lead.id} className="border-b border-neutral-100">
                  <td className="py-2 font-medium text-neutral-900">{lead.bedrijfsnaam}</td>
                  <td className="py-2">
                    <StatusBadge status={lead.status} />
                  </td>
                  <td className="py-2 text-neutral-600">
                    {verzonden ? new Date(verzonden.timestamp).toLocaleString("nl-BE") : "—"}
                  </td>
                  <td className="py-2 text-neutral-600">
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

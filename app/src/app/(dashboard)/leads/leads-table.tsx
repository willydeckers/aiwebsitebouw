"use client";

import { useRouter, useSearchParams } from "next/navigation";
import type { Lead } from "@/lib/types";
import { StatusBadge } from "./status-badge";

export function LeadsTable({ leads }: { leads: Lead[] }) {
  const router = useRouter();
  const searchParams = useSearchParams();

  function openLead(id: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("lead", id);
    router.push(`/leads?${params.toString()}`);
  }

  if (leads.length === 0) {
    // Deze lijst is al gefilterd door de pagina erboven. Zonder dat onderscheid
    // zou een filter zonder treffers eruitzien alsof er nog nooit een lead is
    // geweest, en zou de uitleg hieronder op het verkeerde moment komen.
    if (searchParams.get("status")) {
      return (
        <p className="mt-6 text-sm text-slate-500">
          Geen leads met deze status. Kies Alle statussen in de balk hierboven om alles te zien.
        </p>
      );
    }

    return (
      <div className="mt-6 space-y-2 text-sm text-slate-500">
        <p className="font-medium text-slate-700">Nog geen leads.</p>
        <p>
          Een lead komt hier op twee manieren binnen: met de knop Lead toevoegen hierboven
          typ je er zelf een in, en met het tandwiel ernaast laat je automatisch bedrijven
          opzoeken die bij je zoekprofiel passen.
        </p>
        <p>
          Het opzoeken en het bouwen van de site gebeuren daarna op de achtergrond in de
          worker. Draait die niet, dan blijft alles in de wachtrij staan en verschijnt er
          bovenaan een waarschuwing met de knop om hem te starten.
        </p>
      </div>
    );
  }

  return (
    <table className="mt-4 w-full text-left text-sm">
      <thead>
        <tr className="border-b border-blue-100 text-slate-500">
          <th className="py-2 font-medium">Bedrijfsnaam</th>
          <th className="py-2 font-medium">Sector</th>
          <th className="py-2 font-medium">Status</th>
          <th className="py-2 font-medium">Datum</th>
        </tr>
      </thead>
      <tbody>
        {leads.map((lead) => (
          <tr
            key={lead.id}
            onClick={() => openLead(lead.id)}
            className="cursor-pointer border-b border-blue-50 hover:bg-blue-50/60"
          >
            <td className="py-2 font-medium text-slate-900">
              {lead.bedrijfsnaam}
            </td>
            <td className="py-2 text-slate-600">{lead.sector}</td>
            <td className="py-2">
              <StatusBadge status={lead.status} />
            </td>
            <td className="py-2 text-slate-600">
              {new Date(lead.aangemaakt_op).toLocaleDateString("nl-BE")}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

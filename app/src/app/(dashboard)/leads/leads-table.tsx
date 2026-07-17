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
    return (
      <p className="mt-6 text-sm text-slate-500">Nog geen leads.</p>
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

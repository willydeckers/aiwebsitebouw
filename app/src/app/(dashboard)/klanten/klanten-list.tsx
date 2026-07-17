"use client";

import { useEffect, useState } from "react";
import { KlantenChatPanel } from "./klanten-chat-panel";
import { StaffInviteButton } from "./staff-invite-button";
import { CostSummaryView } from "../leads/cost-summary-view";
import { getCostSummary } from "../leads/cost-actions";
import type { CostSummary } from "@/lib/costs";

export type KlantRow = {
  id: string;
  type: "statisch" | "shopify";
  site_status: string | null;
  shopify_staff_account_status: string | null;
  shopify_domain: string | null;
  lead: { id: string; bedrijfsnaam: string } | null;
};

export function KlantenList({ klanten }: { klanten: KlantRow[] }) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [costSummary, setCostSummary] = useState<CostSummary | null>(null);
  const selected = klanten.find((k) => k.id === selectedId) ?? null;

  useEffect(() => {
    if (!selected?.lead) {
      return;
    }
    let cancelled = false;
    getCostSummary(selected.lead.id).then((summary) => {
      if (!cancelled) setCostSummary(summary);
    });
    return () => {
      cancelled = true;
    };
  }, [selected]);

  return (
    <div>
      <table className="mt-4 w-full text-left text-sm">
        <thead>
          <tr className="border-b border-neutral-200 text-neutral-500">
            <th className="py-2 font-medium">Klantnaam</th>
            <th className="py-2 font-medium">Type</th>
            <th className="py-2 font-medium">Site-status</th>
          </tr>
        </thead>
        <tbody>
          {klanten.map((klant) => (
            <tr
              key={klant.id}
              onClick={() => setSelectedId(klant.id)}
              className={`cursor-pointer border-b border-neutral-100 hover:bg-neutral-50 ${
                selectedId === klant.id ? "bg-neutral-50" : ""
              }`}
            >
              <td className="py-2 font-medium text-neutral-900">
                {klant.lead?.bedrijfsnaam ?? "Onbekend"}
              </td>
              <td className="py-2 text-neutral-600">{klant.type}</td>
              <td className="py-2 text-neutral-600">{klant.site_status ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {selected ? (
        <>
          {selected.type === "shopify" ? (
            <div className="mt-4 flex flex-wrap items-start gap-4">
              <StaffInviteButton
                klantId={selected.id}
                status={selected.shopify_staff_account_status}
              />
              {selected.shopify_domain ? (
                <a
                  href={`https://${selected.shopify_domain}/admin`}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-3 text-sm text-blue-600 underline"
                >
                  Open in Shopify admin
                </a>
              ) : null}
            </div>
          ) : null}
          <KlantenChatPanel
            klantId={selected.id}
            klantNaam={selected.lead?.bedrijfsnaam ?? "Onbekend"}
          />
          {costSummary ? <CostSummaryView summary={costSummary} /> : null}
        </>
      ) : null}
    </div>
  );
}

"use client";

import { useState } from "react";
import { KlantenChatPanel } from "./klanten-chat-panel";

export type KlantRow = {
  id: string;
  type: "statisch" | "shopify";
  site_status: string | null;
  lead: { bedrijfsnaam: string } | null;
};

export function KlantenList({ klanten }: { klanten: KlantRow[] }) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = klanten.find((k) => k.id === selectedId) ?? null;

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
        <KlantenChatPanel
          klantId={selected.id}
          klantNaam={selected.lead?.bedrijfsnaam ?? "Onbekend"}
        />
      ) : null}
    </div>
  );
}

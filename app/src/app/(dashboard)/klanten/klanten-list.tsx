"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { GEBRUIKER_COLORS, useKlantenPresence } from "./presence";

export type KlantRow = {
  id: string;
  type: "statisch" | "shopify";
  site_status: string | null;
  shopify_staff_account_status: string | null;
  shopify_domain: string | null;
  lead: { id: string; bedrijfsnaam: string } | null;
};

export function KlantenList({
  klanten,
  onSelect,
}: {
  klanten: KlantRow[];
  onSelect: (id: string) => void;
}) {
  const [email, setEmail] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data }) => setEmail(data.user?.email ?? null));
  }, []);

  // Not viewing any specific klant here, just watching the shared presence
  // map for the colored dot per row (spec-request: "zo zien we van elkaar
  // wie aan wat bezig is").
  const presence = useKlantenPresence(email, null);

  return (
    <table className="mt-4 w-full text-left text-sm">
      <thead>
        <tr className="border-b border-blue-100 text-slate-500">
          <th className="py-2 font-medium">Klantnaam</th>
          <th className="py-2 font-medium">Type</th>
          <th className="py-2 font-medium">Site-status</th>
        </tr>
      </thead>
      <tbody>
        {klanten.map((klant) => {
          const active = (presence[klant.id] ?? [])[0] ?? null;
          return (
            <tr
              key={klant.id}
              onClick={() => onSelect(klant.id)}
              className="cursor-pointer border-b border-blue-50 hover:bg-blue-50/60"
            >
              <td className="py-2 font-medium text-slate-900">
                <span className="flex items-center gap-2">
                  {active ? (
                    <span
                      className={`h-2 w-2 shrink-0 rounded-full ${GEBRUIKER_COLORS[active.gebruiker].dot}`}
                      title={`${GEBRUIKER_COLORS[active.gebruiker].label} is hier nu mee bezig`}
                    />
                  ) : null}
                  {klant.lead?.bedrijfsnaam ?? "Onbekend"}
                </span>
              </td>
              <td className="py-2 text-slate-600">{klant.type}</td>
              <td className="py-2 text-slate-600">{klant.site_status ?? "—"}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

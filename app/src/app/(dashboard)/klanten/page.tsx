"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { KlantenList, type KlantRow } from "./klanten-list";

export default function KlantenPage() {
  const [klanten, setKlanten] = useState<KlantRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    const supabase = createClient();
    supabase
      .from("klanten")
      .select(
        "id, type, site_status, shopify_staff_account_status, shopify_domain, lead:leads(id, bedrijfsnaam)",
      )
      .order("id", { ascending: false })
      .then(({ data, error }) => {
        if (error) setError(error.message);
        else {
          setError(null);
          setKlanten(data as unknown as KlantRow[]);
        }
      });
  }, []);

  useEffect(() => {
    load();
    const supabase = createClient();
    const channel = supabase
      .channel("klanten-page-jobs")
      .on("postgres_changes", { event: "*", schema: "public", table: "jobs" }, () => load())
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [load]);

  return (
    <div>
      <h1 className="text-lg font-semibold text-slate-900">Klanten</h1>

      {error ? (
        <p className="mt-4 text-sm text-red-600">Kon klanten niet laden: {error}</p>
      ) : klanten === null ? (
        <p className="mt-6 text-sm text-slate-500">Laden...</p>
      ) : klanten.length === 0 ? (
        <p className="mt-6 text-sm text-slate-500">
          Nog geen klanten — markeer een lead als klant via het detailpaneel (spec sectie 3.7).
        </p>
      ) : (
        <KlantenList klanten={klanten} onChanged={load} />
      )}
    </div>
  );
}

"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { KlantenList, type KlantRow } from "./klanten-list";
import { KlantDetailView } from "./klant-detail-view";

export default function KlantenPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const klantId = searchParams.get("klant");

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

  function openKlant(id: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("klant", id);
    router.push(`/klanten?${params.toString()}`);
  }

  function backToOverzicht() {
    router.push("/klanten");
  }

  if (klantId) {
    return <KlantDetailView klantId={klantId} onBack={backToOverzicht} />;
  }

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
        <KlantenList klanten={klanten} onSelect={openKlant} />
      )}
    </div>
  );
}

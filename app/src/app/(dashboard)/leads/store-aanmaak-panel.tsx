"use client";

import { useEffect, useState, useTransition } from "react";
import type { Job } from "@/lib/types";
import { createClient } from "@/lib/supabase/client";
import { LiveAutomatiseringView } from "./live-automatisering-view";
import {
  annuleerStoreAanmaak,
  fetchAutomatiseringLog,
  fetchShopifyStore,
  hervatStoreAanmaak,
  markeerAppGeinstalleerd,
  startStoreAanmaak,
  type AutomatiseringStap,
  type ShopifyStore,
} from "./store-automatisering-actions";

const RESULTAAT_KLEUR: Record<AutomatiseringStap["resultaat"], string> = {
  ok: "text-green-700",
  overgeslagen: "text-slate-400",
  mislukt: "text-red-600",
  wacht_op_mens: "text-amber-700",
};

/**
 * Shopify store creation: trigger, live view, step log, and the one manual
 * step that genuinely cannot be automated.
 *
 * Worth being upfront about in the UI, because it shapes what the user should
 * expect: creating the store is browser automation against the Partner
 * Dashboard (there is no API — the Partner API has one mutation and it isn't
 * this), while everything after it runs on the supported Admin API.
 */
export function StoreAanmaakPanel({
  leadId,
  klantType,
  onChanged,
}: {
  leadId: string;
  klantType: "statisch" | "shopify" | null;
  onChanged: () => void;
}) {
  const [job, setJob] = useState<Job | null>(null);
  const [stappen, setStappen] = useState<AutomatiseringStap[]>([]);
  const [store, setStore] = useState<ShopifyStore | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    const supabase = createClient();

    function laadJob() {
      supabase
        .from("jobs")
        .select("*")
        .eq("lead_id", leadId)
        .eq("type", "shopify_store_aanmaak")
        .order("aangemaakt_op", { ascending: false })
        .limit(1)
        .maybeSingle()
        .then(({ data }) => {
          const j = (data as Job | null) ?? null;
          setJob(j);
          if (j) fetchAutomatiseringLog(j.id).then(setStappen);
        });
    }

    laadJob();
    fetchShopifyStore(leadId).then(setStore);

    // Realtime on jobs is what makes "actie vereist" appear without the user
    // refreshing — which matters here, since the whole point is that someone
    // steps in within seconds.
    const channel = supabase
      .channel(`store-aanmaak-${leadId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "jobs", filter: `lead_id=eq.${leadId}` },
        () => laadJob(),
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [leadId]);

  // A paused job polls its own log so new steps show up while someone watches.
  useEffect(() => {
    if (!job || !["bezig", "wacht_op_mens"].includes(job.status)) return;
    const timer = setInterval(() => fetchAutomatiseringLog(job.id).then(setStappen), 2500);
    return () => clearInterval(timer);
  }, [job]);

  function doe(actie: () => Promise<string | null>) {
    setError(null);
    startTransition(async () => {
      const fout = await actie();
      if (fout) setError(fout);
      else {
        fetchShopifyStore(leadId).then(setStore);
        onChanged();
      }
    });
  }

  const loopt = job?.status === "bezig" || job?.status === "wachtrij";
  const wachtOpMens = job?.status === "wacht_op_mens";
  const actieVereist = wachtOpMens ? (job?.error_message ?? "Onbekende blokkade") : null;

  // Shopify is a one-way conversion (spec 3.7): offering this on a lead that's
  // already static would promise something the pipeline refuses to do.
  if (klantType === "statisch") return null;

  return (
    <section className="mt-6 space-y-3 text-sm">
      <div>
        <h3 className="font-medium text-slate-700">Shopify-winkel aanmaken</h3>
        <p className="mt-1 text-xs text-slate-400">
          Dit gebeurt via browserautomatisering op het Partner Dashboard — Shopify heeft geen API
          om een winkel aan te maken. Je kan live meekijken en ingrijpen als er een CAPTCHA komt.
          Vereist dat de worker draait op een machine waar jij bij kan.
        </p>
      </div>

      {error ? <p className="text-xs text-red-600">{error}</p> : null}

      {store ? (
        <div className="space-y-2 rounded-xl border border-blue-100 p-3">
          <p className="text-slate-700">
            Winkel: <span className="font-medium">{store.shop_domein}</span>
            <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
              {store.status}
            </span>
          </p>
          {store.fout_melding ? <p className="text-xs text-red-600">{store.fout_melding}</p> : null}

          {!store.app_geinstalleerd ? (
            <div className="rounded-lg bg-amber-50 p-2">
              <p className="text-xs text-amber-900">
                Laatste handmatige stap: installeer de agency-app één keer op deze winkel. Zonder
                installatie geeft Shopify geen token uit — daarna haalt de pipeline ze zelf op en
                vernieuwt ze automatisch (ze vervallen na 24 uur).
              </p>
              <button
                type="button"
                disabled={pending}
                onClick={() => doe(() => markeerAppGeinstalleerd(store.id))}
                className="mt-2 rounded-xl bg-blue-600 px-3 py-1 text-xs font-medium text-white disabled:opacity-50"
              >
                App is geïnstalleerd
              </button>
            </div>
          ) : (
            <p className="text-xs text-green-700">
              App geïnstalleerd — tokens worden automatisch opgehaald
              {store.toegang_scopes ? ` (scopes: ${store.toegang_scopes})` : ""}.
            </p>
          )}
        </div>
      ) : null}

      {job && (loopt || wachtOpMens) ? (
        <LiveAutomatiseringView
          jobId={job.id}
          // Only stream once the worker has actually picked the job up. While
          // it sits in the queue there is no browser and no frame to fetch, so
          // polling Storage twice a second would just be noise — and a job
          // that stays queued means the worker isn't running at all.
          actief={job.status === "bezig" || wachtOpMens}
          actieVereist={actieVereist}
        />
      ) : null}

      {stappen.length > 0 ? (
        <details className="rounded-xl border border-blue-100 p-2" open={wachtOpMens}>
          <summary className="cursor-pointer text-xs font-medium text-slate-600">
            Stappenlog ({stappen.length})
          </summary>
          <ul className="mt-2 space-y-1 text-xs">
            {stappen.map((s) => (
              <li key={s.id} className={RESULTAAT_KLEUR[s.resultaat]}>
                <span className="font-medium">{s.stap}</span> — {s.resultaat}
                {s.detail ? <span className="block text-slate-500">{s.detail}</span> : null}
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {wachtOpMens ? (
          <>
            <button
              type="button"
              disabled={pending}
              onClick={() => doe(() => hervatStoreAanmaak(job!.id))}
              className="rounded-xl bg-amber-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              Hervatten
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => doe(() => annuleerStoreAanmaak(job!.id))}
              className="rounded-xl border border-blue-200 px-3 py-2 text-sm text-slate-600 disabled:opacity-50"
            >
              Annuleren
            </button>
          </>
        ) : (
          <button
            type="button"
            disabled={pending || loopt || !!store}
            title={
              store
                ? "Er bestaat al een winkel voor deze lead."
                : loopt
                  ? "Er loopt al een aanmaakjob."
                  : undefined
            }
            onClick={() => doe(() => startStoreAanmaak(leadId))}
            className="rounded-xl bg-blue-600 px-3 py-2 text-sm font-medium text-white disabled:bg-blue-50 disabled:text-slate-500"
          >
            {job?.status === "wachtrij"
              ? "In wachtrij — draait de worker?"
              : loopt
                ? "Bezig met aanmaken…"
                : "Maak Shopify-winkel aan"}
          </button>
        )}
      </div>
    </section>
  );
}

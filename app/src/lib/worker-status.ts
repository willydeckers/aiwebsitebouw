import type { SupabaseClient } from "@supabase/supabase-js";

// Is anything actually processing jobs?
//
// Without this the dashboard cannot tell a busy queue from a dead one, and
// shows the same "in wachtrij" for both. Three Shopify store-creation jobs sat
// queued for three weeks that way — the automation had never run once, and
// nothing on screen said so.

/** A beat is written every 15s, so this allows for a few missed ones before
 *  calling it dead — a slow round trip shouldn't raise a false alarm. */
const DOOD_NA_MS = 60_000;

export type WorkerStatus = {
  draait: boolean;
  laatsteHartslag: string | null;
  huidigeJobId: string | null;
  secondenGeleden: number | null;
};

export async function fetchWorkerStatus(supabase: SupabaseClient): Promise<WorkerStatus> {
  const { data } = await supabase
    .from("worker_status")
    .select("laatste_hartslag, huidige_job_id")
    .eq("id", true)
    .maybeSingle();

  if (!data?.laatste_hartslag) {
    return { draait: false, laatsteHartslag: null, huidigeJobId: null, secondenGeleden: null };
  }

  const geleden = Date.now() - new Date(data.laatste_hartslag).getTime();
  return {
    draait: geleden < DOOD_NA_MS,
    laatsteHartslag: data.laatste_hartslag,
    huidigeJobId: data.huidige_job_id ?? null,
    secondenGeleden: Math.round(geleden / 1000),
  };
}

/** Human phrasing for how long the worker has been silent. */
export function stilteLabel(status: WorkerStatus): string {
  if (status.secondenGeleden === null) return "nog nooit gestart";
  const s = status.secondenGeleden;
  if (s < 120) return `${s} seconden geleden`;
  if (s < 7200) return `${Math.round(s / 60)} minuten geleden`;
  if (s < 172800) return `${Math.round(s / 3600)} uur geleden`;
  return `${Math.round(s / 86400)} dagen geleden`;
}

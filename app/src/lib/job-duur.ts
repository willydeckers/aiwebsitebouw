import type { SupabaseClient } from "@supabase/supabase-js";
import type { JobType } from "./types";

// How long does a pipeline step take? Measured, not guessed: the median of
// this project's own recent completed jobs, falling back to a default until
// there's enough history for a type.
//
// The defaults below are what these steps actually took on 2026-07-27, and
// they matter more than they look — the generatie figure is deliberately NOT
// the historical median. Most generatie rows in the table predate generation
// moving out of the Edge Function, when it was capped at ~150s and produced a
// single page; a real multi-page run takes about three minutes. Seeding the
// old number would tell the user "one minute" for something that takes three.
// As new jobs land, the measured median takes over on its own.
const STANDAARD_SECONDEN: Record<JobType, number> = {
  research: 80,
  generatie: 190,
  // No completed review job exists yet on the multi-page loop. One desktop
  // screenshot per page plus a mobile shot, then a vision call, then possibly
  // a full regeneration per rejected iteration — so this is a rough floor for
  // the happy path, not a promise.
  review: 240,
  shopify_opbouw: 20,
  // Browser automation through Shopify's signup flow. Wall-clock only —
  // the median will be dominated by however long a human takes to clear a
  // CAPTCHA, so treat this figure as "if nothing interrupts it".
  shopify_store_aanmaak: 90,
  sourcing_run: 30,
};

/** Fewer samples than this and the measured median is too noisy to trust. */
const MIN_METINGEN = 3;
/** Only recent jobs, so an architecture change works its way in by itself. */
const MAX_METINGEN = 10;

export type DuurSchatting = {
  seconden: number;
  /** True when this came from real jobs rather than the default. */
  gemeten: boolean;
  metingen: number;
};

export type DuurSchattingen = Partial<Record<JobType, DuurSchatting>>;

function mediaan(waarden: number[]): number {
  const gesorteerd = [...waarden].sort((a, b) => a - b);
  const midden = Math.floor(gesorteerd.length / 2);
  return gesorteerd.length % 2 === 0
    ? (gesorteerd[midden - 1] + gesorteerd[midden]) / 2
    : gesorteerd[midden];
}

export async function fetchDuurSchattingen(supabase: SupabaseClient): Promise<DuurSchattingen> {
  const { data } = await supabase
    .from("jobs")
    .select("type, status, gestart_op, afgerond_op")
    .eq("status", "klaar")
    .not("gestart_op", "is", null)
    .not("afgerond_op", "is", null)
    .order("aangemaakt_op", { ascending: false })
    .limit(120);

  const perType = new Map<JobType, number[]>();
  for (const job of (data ?? []) as { type: JobType; gestart_op: string; afgerond_op: string }[]) {
    const seconden = (new Date(job.afgerond_op).getTime() - new Date(job.gestart_op).getTime()) / 1000;
    // A job that "took" a negative time or over an hour is a clock artefact or
    // a hung run, not a measurement of the normal path.
    if (!(seconden > 0 && seconden < 3600)) continue;
    const lijst = perType.get(job.type) ?? [];
    if (lijst.length < MAX_METINGEN) lijst.push(seconden);
    perType.set(job.type, lijst);
  }

  const schattingen: DuurSchattingen = {};
  for (const type of Object.keys(STANDAARD_SECONDEN) as JobType[]) {
    const metingen = perType.get(type) ?? [];
    const genoeg = metingen.length >= MIN_METINGEN;
    schattingen[type] = {
      seconden: genoeg ? mediaan(metingen) : STANDAARD_SECONDEN[type],
      gemeten: genoeg,
      metingen: metingen.length,
    };
  }
  return schattingen;
}

/** "~3 min" / "~40 sec" — deliberately coarse; this is an estimate. */
export function formatteerDuur(seconden: number): string {
  if (seconden < 90) return `~${Math.max(10, Math.round(seconden / 10) * 10)} sec`;
  const minuten = seconden / 60;
  if (minuten < 10) return `~${Math.round(minuten * 2) / 2} min`.replace(".5", "½");
  return `~${Math.round(minuten)} min`;
}

/**
 * Remaining time for a job that's already running, or null once it's overdue —
 * better to say nothing than to keep promising a moment that has passed.
 *
 * `nu` is passed in rather than read from Date.now() so the caller's ticking
 * state is what drives the re-render; reading the clock inside would leave
 * React with no reason to redraw.
 */
export function resterendeTijd(gestartOp: string, schatting: number, nu: number): string | null {
  const verstreken = (nu - new Date(gestartOp).getTime()) / 1000;
  const resterend = schatting - verstreken;
  if (resterend <= 5) return null;
  return `nog ${formatteerDuur(resterend).replace("~", "±")}`;
}

export function formatteerVerstreken(gestartOp: string, nu: number): string {
  const seconden = Math.max(0, (nu - new Date(gestartOp).getTime()) / 1000);
  const minuten = Math.floor(seconden / 60);
  const rest = Math.floor(seconden % 60);
  return minuten > 0 ? `${minuten}m ${String(rest).padStart(2, "0")}s` : `${rest}s`;
}

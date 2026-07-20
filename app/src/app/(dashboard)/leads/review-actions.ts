import { createClient } from "@/lib/supabase/client";

/**
 * Spec section 2: review-loop (Playwright/ffmpeg) is a "zware taak" handled
 * by the separate hosted worker, not an Edge Function — Playwright can't
 * run in Deno's sandboxed Edge Function runtime anyway. This just enqueues
 * the job; the worker polls `jobs` for wachtrij-status 'review' rows, and
 * the UI picks up progress via the Realtime subscription on `jobs`.
 */
export async function startReview(leadId: string): Promise<string | null> {
  const supabase = createClient();

  const { data: siteVersion, error: versionError } = await supabase
    .from("site_versions")
    .select("id")
    .eq("lead_id", leadId)
    .order("versienummer", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (versionError || !siteVersion) {
    return "Genereer eerst een demo — de review-stap heeft een site-versie nodig.";
  }

  const { error: jobError } = await supabase
    .from("jobs")
    .insert({ lead_id: leadId, type: "review", status: "wachtrij" });

  if (jobError) {
    if (jobError.code === "23505") {
      return "Er loopt al een actieve job voor deze lead.";
    }
    return `Kon review-job niet aanmaken: ${jobError.message}`;
  }

  return null;
}

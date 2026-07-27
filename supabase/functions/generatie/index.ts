import { handleCorsPreflight, corsHeaders } from "../_shared/cors.ts";
import { requireUser } from "../_shared/supabase-clients.ts";

// Spec 3.3 — but only the *enqueue* half of it. The generation itself moved
// to the worker (worker/src/pipeline/generate-job.ts).
//
// Why: a multi-page site is several minutes of model output, and an Edge
// Function invocation on this project is killed well before that. Both a
// streaming and a non-streaming attempt died at ~150s flat with
// WORKER_RESOURCE_LIMIT, which is the platform's wall-clock cap, not
// something the prompt or the SDK can be tuned around. Spec section 2 already
// routes "zware taken" to the separate worker service; generation has become
// one of them.
//
// The call signature the app uses is unchanged (`invoke("generatie", { leadId,
// extraContext })`), so nothing in the UI had to move — generation is just
// asynchronous now, the way review already was, with the same Realtime
// subscriptions on `jobs`/`site_versions` reporting progress.
//
// NOTE: this means the worker has to be running for generation to happen at
// all. That was already true for review and Shopify builds.
Deno.serve(async (req) => {
  const preflight = handleCorsPreflight(req);
  if (preflight) return preflight;

  try {
    const { supabase } = await requireUser(req);
    const { leadId, extraContext } = await req.json();
    if (!leadId) throw new Error("leadId is verplicht.");

    const { data: lead, error: leadError } = await supabase
      .from("leads")
      .select("id")
      .eq("id", leadId)
      .maybeSingle();
    if (leadError || !lead) throw new Error(`Lead niet gevonden: ${leadError?.message}`);

    const { data: job, error: jobError } = await supabase
      .from("jobs")
      .insert({
        lead_id: leadId,
        type: "generatie",
        status: "wachtrij",
        payload: extraContext ? { extraContext } : null,
      })
      .select("id")
      .single();

    if (jobError) {
      if (jobError.code === "23505") {
        return new Response(
          JSON.stringify({ error: "Er loopt al een actieve job voor deze lead." }),
          { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      throw new Error(`Kon job niet aanmaken: ${jobError.message}`);
    }

    // The lead's own status is set by the worker when it picks the job up —
    // not here — so a queued-but-never-processed job (worker down) doesn't
    // leave the lead sitting on "genereren" with nothing behind it.
    return new Response(JSON.stringify({ ok: true, jobId: job.id }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ error: message }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

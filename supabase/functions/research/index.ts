import { handleCorsPreflight, corsHeaders } from "../_shared/cors.ts";
import { requireUser } from "../_shared/supabase-clients.ts";

// Spec 3.2 — but only the *enqueue* half. The research step itself moved to
// the worker (worker/src/pipeline/research-job.ts), for the same reason
// generation did.
//
// Why: this project's Edge Function invocations are killed at about 150
// seconds. Research does a web_search plus several web_fetch round-trips, each
// one a network fetch AND a full model turn; measured runs sat at 50-138s,
// right against that ceiling, and a lead whose website is hard to find goes
// over it. When it does, the platform terminates the process outright — there
// is no exception to catch, so the job row stays "bezig" forever and the UI
// shows a step that never finishes. That is exactly what happened to the MIKI
// TEA lead, whose only web presence is an Instagram profile.
//
// The call signature the app uses is unchanged (`invoke("research", { leadId
// })`), so nothing in the UI had to move — research is just asynchronous now,
// like generation and review, with the same Realtime subscription on `jobs`
// reporting progress.
//
// NOTE: this means the worker has to be running for research to happen.
Deno.serve(async (req) => {
  const preflight = handleCorsPreflight(req);
  if (preflight) return preflight;

  try {
    const { supabase } = await requireUser(req);
    const { leadId } = await req.json();
    if (!leadId) throw new Error("leadId is verplicht.");

    const { data: lead, error: leadError } = await supabase
      .from("leads")
      .select("id")
      .eq("id", leadId)
      .maybeSingle();
    if (leadError || !lead) throw new Error(`Lead niet gevonden: ${leadError?.message}`);

    const { data: job, error: jobError } = await supabase
      .from("jobs")
      .insert({ lead_id: leadId, type: "research", status: "wachtrij" })
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

    // The lead's status is set by the worker when it picks the job up, so a
    // queued-but-never-processed job (worker down) doesn't leave the lead
    // sitting on "research" with nothing behind it.
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

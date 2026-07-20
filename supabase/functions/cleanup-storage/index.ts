import { handleCorsPreflight, corsHeaders } from "../_shared/cors.ts";
import { requireUser } from "../_shared/supabase-clients.ts";

// Spec section 6/7/9: deleting a lead must also clean up its Storage
// objects — the `site_versions`/`jobs`/etc. DB rows cascade automatically
// (on delete cascade, see the v9 migration), but Storage is a separate
// system the DB cascade can't reach. Demo HTML is stored at
// `{leadId}/{versienummer}.html` (see generatie/index.ts), so removing
// everything under that prefix covers every version for the lead.
Deno.serve(async (req) => {
  const preflight = handleCorsPreflight(req);
  if (preflight) return preflight;

  try {
    const { supabase } = await requireUser(req);
    const { leadId } = await req.json();
    if (!leadId) throw new Error("leadId is verplicht.");

    const { data: files, error: listError } = await supabase.storage.from("demos").list(leadId);
    if (listError) throw new Error(`Kon Storage-bestanden niet ophalen: ${listError.message}`);

    if (files && files.length > 0) {
      const paths = files.map((f) => `${leadId}/${f.name}`);
      const { error: removeError } = await supabase.storage.from("demos").remove(paths);
      if (removeError) throw new Error(`Storage-opruiming mislukt: ${removeError.message}`);
    }

    const { error: deleteError } = await supabase.from("leads").delete().eq("id", leadId);
    if (deleteError) throw new Error(`Lead verwijderen mislukt: ${deleteError.message}`);

    return new Response(JSON.stringify({ ok: true }), {
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

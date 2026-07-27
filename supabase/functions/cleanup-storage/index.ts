import { handleCorsPreflight, corsHeaders } from "../_shared/cors.ts";
import { requireUser } from "../_shared/supabase-clients.ts";

// Spec section 6/7/9: deleting a lead must also clean up its Storage
// objects — the `site_versions`/`jobs`/etc. DB rows cascade automatically
// (on delete cascade, see the v9 migration), but Storage is a separate
// system the DB cascade can't reach.
//
// Multi-page versions live in a folder per version
// (`{leadId}/{versienummer}/index.html`, ...), older single-page ones as
// `{leadId}/{versienummer}.html` — so this has to walk the tree rather than
// list one level. Supabase Storage has no real directories: a "folder" row
// in a listing is a synthetic prefix entry (recognisable by a null `id`),
// and removing that prefix by name deletes nothing at all.
async function verzamelPaden(
  supabase: Awaited<ReturnType<typeof requireUser>>["supabase"],
  prefix: string,
): Promise<string[]> {
  const { data: entries, error } = await supabase.storage.from("demos").list(prefix, { limit: 1000 });
  if (error) throw new Error(`Kon Storage-bestanden niet ophalen: ${error.message}`);

  const paden: string[] = [];
  for (const entry of entries ?? []) {
    const pad = `${prefix}/${entry.name}`;
    if (entry.id === null) paden.push(...(await verzamelPaden(supabase, pad)));
    else paden.push(pad);
  }
  return paden;
}

Deno.serve(async (req) => {
  const preflight = handleCorsPreflight(req);
  if (preflight) return preflight;

  try {
    const { supabase } = await requireUser(req);
    const { leadId } = await req.json();
    if (!leadId) throw new Error("leadId is verplicht.");

    const paths = await verzamelPaden(supabase, leadId);

    if (paths.length > 0) {
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

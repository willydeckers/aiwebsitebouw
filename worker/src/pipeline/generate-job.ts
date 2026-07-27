import type { SupabaseClient } from "@supabase/supabase-js";
import { genereerSite } from "./generate-demo.js";
import { calculateKostEur } from "../shared/anthropic.js";
import type { GebouwdePagina, PaginaMeta, SiteBron } from "../shared/site-builder.js";

const PROMPT_VERSIE = "generatie-v9.1-multipage";

/**
 * Spec 3.3, run here rather than in the `generatie` Edge Function.
 *
 * Why it moved: a multi-page site is several minutes of model output, and an
 * Edge Function invocation on this project is killed well before that — every
 * attempt died at ~150s with WORKER_RESOURCE_LIMIT, streaming or not. Spec
 * section 2 already routes "zware taken" to this worker; generation has
 * simply become one. The Edge Function now only enqueues the job, so nothing
 * changes for the UI beyond generation being asynchronous like review already
 * was (Realtime on `jobs` and `site_versions` drives the panel either way).
 *
 * Everything else — the "één concept-versie" rule, the budget hardstop, the
 * don't-push-a-lead-backwards guard — is carried over from that function
 * unchanged.
 */
export async function processGenerateJob(
  supabase: SupabaseClient,
  jobId: string,
  leadId: string,
  payload: { extraContext?: string } | null,
) {
  const { data: lead, error: leadError } = await supabase.from("leads").select("*").eq("id", leadId).single();
  if (leadError || !lead) throw new Error(`Lead niet gevonden: ${leadError?.message}`);

  await supabase.from("leads").update({ status: "genereren" }).eq("id", leadId);

  const [{ data: stijlvoorkeuren }, { data: sectorKennis }, { data: bestaandConcept }] = await Promise.all([
    supabase.from("stijlvoorkeuren").select("regel, context"),
    supabase.from("sector_kennis").select("regel").eq("sector", lead.sector),
    supabase.from("site_versions").select("*").eq("lead_id", leadId).eq("status", "concept").maybeSingle(),
  ]);

  const { bron, paginas: gebouwd, usage } = await genereerSite(
    lead,
    stijlvoorkeuren ?? [],
    sectorKennis ?? [],
    payload?.extraContext
      ? `Dit is een herziening — verwerk expliciet de volgende extra instructies of feedback:\n${payload.extraContext}`
      : null,
  );

  const { data: budgetResult, error: budgetError } = await supabase.rpc("record_project_kost_if_under_budget", {
    p_lead_id: leadId,
    p_stap: "generatie",
    p_model: usage.model,
    p_tokens_in: usage.tokensIn,
    p_tokens_out: usage.tokensOut,
    p_kost_eur: calculateKostEur(usage.model, usage.tokensIn, usage.tokensOut),
    p_prompt_versie: PROMPT_VERSIE,
  });

  if (budgetError) throw new Error(`Budgetcontrole mislukt: ${budgetError.message}`);

  if (!budgetResult?.[0]?.toegestaan) {
    await supabase.from("leads").update({ status: "budget_overschreden" }).eq("id", leadId);
    return;
  }

  // "Eén concept-versie": edit the existing concept in place (same
  // versienummer) rather than creating a new one, until it's finalized.
  const versienummer: number = bestaandConcept
    ? bestaandConcept.versienummer
    : ((
        await supabase
          .from("site_versions")
          .select("versienummer")
          .eq("lead_id", leadId)
          .order("versienummer", { ascending: false })
          .limit(1)
          .maybeSingle()
      ).data?.versienummer ?? 0) + 1;

  const map = `${leadId}/${versienummer}`;
  await uploadSite(supabase, map, gebouwd, bron);

  // A re-generation into an existing concept folder can produce a different
  // set of page names; leftovers would otherwise stay served and reachable by
  // their old URL. Same for a pre-multi-page concept stored as a single file.
  const oudePaginas = (bestaandConcept?.paginas ?? []) as PaginaMeta[];
  const verouderd = oudePaginas
    .filter((p) => !gebouwd.some((g) => g.bestand === p.bestand))
    .map((p) => `${map}/${p.bestand}`);
  if (bestaandConcept && !bestaandConcept.paginas && bestaandConcept.content_referentie) {
    verouderd.push(bestaandConcept.content_referentie);
  }
  if (verouderd.length) await supabase.storage.from("demos").remove(verouderd);

  const velden = {
    content_referentie: `${map}/index.html`,
    paginas: bron.paginas,
    prompt_versie: PROMPT_VERSIE,
  };

  if (bestaandConcept) {
    await supabase.from("site_versions").update(velden).eq("id", bestaandConcept.id);
  } else {
    await supabase
      .from("site_versions")
      .insert({ lead_id: leadId, site_type: "demo", versienummer, status: "concept", ...velden });
  }

  // Regenerating for a lead that's already progressed past "klaar" (sent,
  // opened, or already a klant — spec 3.5's ongoing-maintenance path)
  // shouldn't push it backwards through the pipeline.
  if (!["klaar", "verzonden", "geopend", "klant"].includes(lead.status)) {
    await supabase.from("leads").update({ status: "klaar" }).eq("id", leadId);
  }
}

/** Writes every page plus the bron.json chat-edit patches through. */
export async function uploadSite(
  supabase: SupabaseClient,
  map: string,
  paginas: GebouwdePagina[],
  bron: SiteBron,
) {
  for (const pagina of paginas) {
    const { error } = await supabase.storage
      .from("demos")
      .upload(`${map}/${pagina.bestand}`, pagina.html, { contentType: "text/html", upsert: true });
    if (error) throw new Error(`Upload van ${pagina.bestand} mislukt: ${error.message}`);
  }

  const { error } = await supabase.storage
    .from("demos")
    .upload(`${map}/bron.json`, JSON.stringify(bron, null, 2), {
      contentType: "application/json",
      upsert: true,
    });
  if (error) throw new Error(`Upload van bron.json mislukt: ${error.message}`);
}

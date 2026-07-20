import type { SupabaseClient } from "@supabase/supabase-js";
import { takeScreenshot } from "../shared/screenshot.js";
import { reviewDemo } from "./review.js";
import { regenerateWithFeedback } from "./generate-demo.js";
import { calculateKostEur } from "../shared/anthropic.js";

const MAX_ITERATIONS = 5;
const PROMPT_VERSIE = "review-v9.0";

export async function processReviewJob(supabase: SupabaseClient, jobId: string, leadId: string) {
  const { data: lead, error: leadError } = await supabase
    .from("leads")
    .select("*")
    .eq("id", leadId)
    .single();
  if (leadError || !lead) throw new Error(`Lead niet gevonden: ${leadError?.message}`);

  const { data: siteVersion, error: versionError } = await supabase
    .from("site_versions")
    .select("*")
    .eq("lead_id", leadId)
    .eq("status", "concept")
    .maybeSingle();
  if (versionError || !siteVersion?.content_referentie) {
    throw new Error("Geen concept-versie om te reviewen.");
  }

  const { data: stijlvoorkeuren } = await supabase.from("stijlvoorkeuren").select("regel, context");

  for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
    // Private bucket (spec section 2 requires no raw Storage URL ever
    // reaches a lead) — a short-lived signed URL is fine for the worker's
    // own screenshot, and doesn't require the public hosting layer (task
    // "Build public demo-hosting + tracking Edge Function") to exist yet.
    const { data: signed, error: signError } = await supabase.storage
      .from("demos")
      .createSignedUrl(siteVersion.content_referentie, 60);
    if (signError || !signed) throw new Error(`Kon signed URL niet maken: ${signError?.message}`);

    const [desktopShot, mobielShot] = await Promise.all([
      takeScreenshot(signed.signedUrl, { width: 1280, height: 800 }),
      takeScreenshot(signed.signedUrl, { width: 375, height: 812 }),
    ]);

    const { result, usage } = await reviewDemo(
      desktopShot,
      mobielShot,
      { bedrijfsnaam: lead.bedrijfsnaam, sector: lead.sector, researchSamenvatting: lead.research_samenvatting },
      stijlvoorkeuren ?? [],
    );

    await supabase.rpc("record_project_kost_if_under_budget", {
      p_lead_id: leadId,
      p_stap: "review",
      p_model: usage.model,
      p_tokens_in: usage.tokensIn,
      p_tokens_out: usage.tokensOut,
      p_kost_eur: calculateKostEur(usage.model, usage.tokensIn, usage.tokensOut),
      p_prompt_versie: PROMPT_VERSIE,
    });

    await supabase.from("review_log").insert({
      lead_id: leadId,
      site_version_id: siteVersion.id,
      bron: "ai",
      instructie_of_bevinding: result.feedback,
      resultaat: result.goedgekeurd ? "goedgekeurd" : "afgekeurd",
      prompt_versie: PROMPT_VERSIE,
    });

    if (result.goedgekeurd) {
      // "Nooit automatisch gepubliceerd" (3.6/3.7/3.8) — approval finalizes
      // the version, it does not promote it to actief on its own.
      await supabase.from("site_versions").update({ status: "afgerond" }).eq("id", siteVersion.id);
      return;
    }

    if (iteration === MAX_ITERATIONS - 1) {
      await supabase.from("leads").update({ status: "geblokkeerd" }).eq("id", leadId);
      return;
    }

    const feedback = [
      result.feedback,
      result.mist.length ? `Ontbreekt: ${result.mist.join("; ")}` : null,
      result.klopt_niet.length ? `Klopt niet: ${result.klopt_niet.join("; ")}` : null,
    ]
      .filter(Boolean)
      .join("\n");

    const { data: sectorKennis } = await supabase
      .from("sector_kennis")
      .select("regel")
      .eq("sector", lead.sector);

    const { html, usage: generateUsage } = await regenerateWithFeedback(
      lead,
      stijlvoorkeuren ?? [],
      sectorKennis ?? [],
      feedback,
    );

    await supabase.rpc("record_project_kost_if_under_budget", {
      p_lead_id: leadId,
      p_stap: "generatie",
      p_model: generateUsage.model,
      p_tokens_in: generateUsage.tokensIn,
      p_tokens_out: generateUsage.tokensOut,
      p_kost_eur: calculateKostEur(generateUsage.model, generateUsage.tokensIn, generateUsage.tokensOut),
      p_prompt_versie: PROMPT_VERSIE,
    });

    const { error: uploadError } = await supabase.storage
      .from("demos")
      .upload(siteVersion.content_referentie, html, { contentType: "text/html", upsert: true });
    if (uploadError) throw new Error(`Upload mislukt: ${uploadError.message}`);
  }
}

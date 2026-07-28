import type { SupabaseClient } from "@supabase/supabase-js";
import { takeScreenshot } from "../shared/screenshot.js";
import { reviewDemo, type ReviewScreenshot } from "./review.js";
import { regenerateWithFeedback } from "./generate-demo.js";
import { uploadSite } from "./generate-job.js";
import { haalAfbeeldingenAlsDataUri, vervangBestandsverwijzingen } from "./media-ingest.js";
import { calculateKostEur } from "../shared/anthropic.js";
import type { PaginaMeta } from "../shared/site-builder.js";

const MAX_ITERATIONS = 5;
const PROMPT_VERSIE = "review-v9.1-multipage";

// A full-page screenshot of a real generated page is a large image, and the
// review call carries all of them at once. Every page gets looked at on
// desktop; the mobile check stays on the home page only, since the layout
// system (same Tailwind classes, same nav/footer markup) is shared across
// pages — a responsive break on one page shows up on the home page too. Above
// this many pages the tail is skipped rather than letting one call balloon
// past the €5-per-lead hardstop.
const MAX_PAGINAS_IN_REVIEW = 5;

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

  // A pre-multi-page version is a single file at content_referentie
  // (`{leadId}/{versienummer}.html`); a multi-page one is `<map>/index.html`
  // plus the siblings listed in `paginas`. Either way the version folder is
  // `{leadId}/{versienummer}`, which is where a regeneration below writes —
  // so an old single-file version upgrades into the new layout in place.
  let paginas: PaginaMeta[] = (siteVersion.paginas as PaginaMeta[] | null) ?? [];
  const map = paginas.length
    ? siteVersion.content_referentie.replace(/\/index\.html$/, "")
    : siteVersion.content_referentie.replace(/\.html$/, "");
  const padVan = (bestand: string) =>
    paginas.length ? `${map}/${bestand}` : siteVersion.content_referentie;

  // Inlined once, not per iteration: the lead's files don't change mid-review.
  const beelden = await haalAfbeeldingenAlsDataUri(supabase, leadId);

  for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
    const teBekijken = paginas.length
      ? paginas.slice(0, MAX_PAGINAS_IN_REVIEW)
      : [{ bestand: "index.html", titel: "Home", nav_label: "Home" }];

    // Fetch the HTML bytes directly rather than screenshotting a Storage
    // URL — see screenshot.ts for why (Supabase Storage never serves
    // stored objects as renderable text/html, signed or not).
    const paginaHtml: { pagina: PaginaMeta; html: string }[] = [];
    for (const pagina of teBekijken) {
      const { data: fileBlob, error: downloadError } = await supabase.storage
        .from("demos")
        .download(padVan(pagina.bestand));
      if (downloadError || !fileBlob) {
        throw new Error(`Kon ${pagina.bestand} niet downloaden: ${downloadError?.message}`);
      }
      // Inline the lead's own images: setContent() gives the page no origin,
      // so a relative "bestanden/..." src would render as a broken image and
      // the reviewer would reject a site that is actually fine.
      paginaHtml.push({ pagina, html: vervangBestandsverwijzingen(await fileBlob.text(), beelden) });
    }

    // Sequential, not Promise.all: this now launches a browser per page
    // rather than two total, and Chromium's launch is already the flakiest
    // thing in this worker under load (see screenshot.ts).
    const screenshots: ReviewScreenshot[] = [];
    for (const { pagina, html } of paginaHtml) {
      screenshots.push({
        label: `Desktop — ${pagina.titel} (${pagina.bestand})`,
        png: await takeScreenshot(html, { width: 1280, height: 800 }),
      });
    }
    screenshots.push({
      label: `Mobiel — ${paginaHtml[0].pagina.titel} (${paginaHtml[0].pagina.bestand})`,
      png: await takeScreenshot(paginaHtml[0].html, { width: 375, height: 812 }),
    });

    const { result, usage } = await reviewDemo(
      screenshots,
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
      // Spec 3.5: "Eén concept-versie + (na eerste afronding) één actieve
      // versie" — the very first approval for a lead has no existing
      // actief row to conflict with, so it becomes actief directly (that's
      // what makes the demo link send-email builds actually resolve to
      // something). Later approvals (an actief row already exists) land on
      // afgerond and wait for the explicit "Maak deze actief" action
      // (3.8) so publishing a revision is never automatic.
      const { data: existingActief } = await supabase
        .from("site_versions")
        .select("id")
        .eq("lead_id", leadId)
        .eq("status", "actief")
        .maybeSingle();

      const nieuweStatus = existingActief ? "afgerond" : "actief";
      await supabase.from("site_versions").update({ status: nieuweStatus }).eq("id", siteVersion.id);
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

    // Same download list the first generation got — without it a regeneration
    // could link a brochure that no longer exists and the build would fail
    // mid-loop instead of just not using it.
    const { data: bestandRijen } = await supabase
      .from("site_bestanden")
      .select("bestandsnaam")
      .eq("lead_id", leadId);

    const { bron, paginas: nieuwePaginas, usage: generateUsage } = await regenerateWithFeedback(
      lead,
      stijlvoorkeuren ?? [],
      sectorKennis ?? [],
      feedback,
      (bestandRijen ?? []).map((b: { bestandsnaam: string }) => b.bestandsnaam),
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

    // A regeneration can rename or drop pages, so the version folder is
    // rewritten as a whole: upload the new set, record the new manifest,
    // then delete whatever the previous iteration left behind. Deleting
    // last means a crash mid-way leaves a stale extra file rather than a
    // version whose index links to a page that no longer exists.
    await uploadSite(supabase, map, nieuwePaginas, bron);

    const nieuwManifest: PaginaMeta[] = bron.paginas;
    const { error: manifestError } = await supabase
      .from("site_versions")
      .update({ content_referentie: `${map}/index.html`, paginas: nieuwManifest })
      .eq("id", siteVersion.id);
    if (manifestError) throw new Error(`Kon paginamanifest niet bijwerken: ${manifestError.message}`);

    const verouderd = paginas
      .filter((oud) => !nieuwManifest.some((nieuw) => nieuw.bestand === oud.bestand))
      .map((oud) => `${map}/${oud.bestand}`);
    // A version that was still single-file before this iteration lived at
    // content_referentie itself, outside the folder.
    if (!paginas.length) verouderd.push(siteVersion.content_referentie);
    if (verouderd.length) await supabase.storage.from("demos").remove(verouderd);

    paginas = nieuwManifest;
    siteVersion.content_referentie = `${map}/index.html`;
  }
}

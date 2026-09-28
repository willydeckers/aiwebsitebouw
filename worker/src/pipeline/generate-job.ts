import type { SupabaseClient } from "@supabase/supabase-js";
import { genereerSite } from "./generate-demo.js";
import {
  ingestBriefingAfbeeldingen,
  leesAangeleverdeAfbeeldingen,
  vindMerkkleuren,
} from "./media-ingest.js";
import {
  MAX_TIER_ONDERSTEUNEND,
  calculateKostEur,
  createAnthropicClient,
  resolveModel,
} from "../shared/anthropic.js";
import { PRIVACY_BESTAND, type GebouwdePagina, type SiteBron } from "../shared/site-builder.js";
import { takeScreenshotMetContrast } from "../shared/screenshot.js";
import { beoordeel, beschrijf, type ContrastProbleem } from "../shared/contrast.js";

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

  // Spec 3.5 has an ongoing-maintenance path: a lead that is already sent,
  // opened or a customer can be regenerated without being dragged back through
  // the pipeline. Showing "genereren" on such a lead would be a lie about where
  // it stands, so only leads that have not got that far move.
  const VOORBIJ_GENEREREN = ["verzonden", "geopend", "klant"];
  const magStatusVolgen = !VOORBIJ_GENEREREN.includes(lead.status);
  if (magStatusVolgen) {
    await supabase.from("leads").update({ status: "genereren" }).eq("id", leadId);
  }

  const [{ data: stijlvoorkeuren }, { data: sectorKennis }, { data: bestaandConcept }, { data: bestandRijen }] =
    await Promise.all([
      supabase.from("stijlvoorkeuren").select("regel, context"),
      supabase.from("sector_kennis").select("regel").eq("sector", lead.sector),
      supabase.from("site_versions").select("*").eq("lead_id", leadId).eq("status", "concept").maybeSingle(),
      supabase.from("site_bestanden").select("bestandsnaam, omschrijving").eq("lead_id", leadId),
    ]);

  // Images the briefing links to are copied into our own Storage first, so the
  // generated site never points at a signed CDN URL that expires — see
  // media-ingest.ts. Runs before the file list is read so freshly imported
  // images are part of it.
  const merkkleuren = vindMerkkleuren(lead.notities);
  await ingestBriefingAfbeeldingen(supabase, leadId, lead.notities);

  // An uploaded menu photo is only useful if its content is readable — see
  // leesAangeleverdeAfbeeldingen. Cached per file, so a review loop that
  // regenerates five times still only reads each picture once.
  await leesAangeleverdeAfbeeldingen(supabase, leadId, async (base64, mediaType, prompt) => {
    const client = createAnthropicClient();
    const antwoord = await client.messages.create({
      // Uitlezen wat er op een foto staat is extractie, geen sitebouw — het
      // zwaarste model voegt hier niets toe, dus zelfde plafond als research.
      model: resolveModel(lead.ai_model, { maxTier: MAX_TIER_ONDERSTEUNEND }),
      max_tokens: 4000,
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: mediaType as never, data: base64 } },
            { type: "text", text: prompt },
          ],
        },
      ],
    });
    const blok = antwoord.content.find((b) => b.type === "text");
    return blok && blok.type === "text" ? blok.text : "";
  });

  const { data: bestandRijenNa } = await supabase
    .from("site_bestanden")
    .select("bestandsnaam, omschrijving, content_type, geextraheerde_tekst")
    .eq("lead_id", leadId);

  // Downloads can only point at files that actually exist, so the list is both
  // an input to the prompt and a hard check in the builder — the generator
  // can't invent a brochure the way it once invented Unsplash IDs.
  const bestandLijst = (bestandRijenNa ?? bestandRijen ?? []) as {
    bestandsnaam: string;
    omschrijving: string | null;
    content_type?: string | null;
    geextraheerde_tekst?: string | null;
  }[];
  const bestanden = bestandLijst.map((b) => b.bestandsnaam);
  const isAfbeelding = (b: { bestandsnaam: string; content_type?: string | null }) =>
    (b.content_type ?? "").startsWith("image/") || /\.(jpe?g|png|webp|gif)$/i.test(b.bestandsnaam);

  const afbeeldingen = bestandLijst.filter(isAfbeelding);
  const documenten = bestandLijst.filter((b) => !isAfbeelding(b));

  const bestandenBriefing = [
    afbeeldingen.length
      ? "Eigen afbeeldingen van deze klant. Gebruik ze met <img src=\"bestanden/<naam>\">. Dit zijn " +
        "ECHTE beelden van de klant en gaan altijd voor op een foto uit de afbeeldingenbank. Staat er " +
        "een logo bij, zet dat dan in de navigatiebalk en de footer in plaats van de bedrijfsnaam als " +
        "tekst:\n" +
        afbeeldingen.map((b) => `- ${b.bestandsnaam}${b.omschrijving ? ` — ${b.omschrijving}` : ""}`).join("\n")
      : null,
    documenten.length
      ? "Downloadbare documenten. Link ernaar met href=\"bestanden/<naam>\":\n" +
        documenten.map((b) => `- ${b.bestandsnaam}${b.omschrijving ? ` — ${b.omschrijving}` : ""}`).join("\n")
      : null,
    bestandLijst.length
      ? "Verwijs nooit naar een bestand dat niet in bovenstaande lijst staat — de build weigert dat."
      : "Er zijn geen eigen bestanden of afbeeldingen voor deze klant — gebruik geen downloads-blok.",
    // Transcribed uploads are the client's real product list, so they carry
    // the same weight as the research summary — more, really, since a
    // photographed menu came straight from the client.
    ...bestandLijst
      .filter((b) => (b.geextraheerde_tekst ?? "").trim().length > 0)
      .map(
        (b) =>
          `Inhoud van de aangeleverde afbeelding ${b.bestandsnaam}, letterlijk overgenomen. Dit is ` +
          `echte klantinformatie: neem ALLE items hieruit over op de site, met hun prijzen, en vul ` +
          `niets aan uit eigen fantasie.
${b.geextraheerde_tekst}`,
      ),
    // A briefing that names hex colours is naming the client's actual brand,
    // which beats the generic sector palette every time.
    merkkleuren.length
      ? `De klant heeft deze merkkleuren opgegeven: ${merkkleuren.join(", ")}. Bouw het kleurenschema ` +
        "hierop (met bijpassende neutralen en voldoende contrast), niet op de standaard sectorkleuren."
      : null,
  ]
    .filter(Boolean)
    .join("\n\n");

  const { bron, paginas: gebouwd, usage } = await genereerSite(
    lead,
    stijlvoorkeuren ?? [],
    sectorKennis ?? [],
    [
      bestandenBriefing,
      payload?.extraContext
        ? `Dit is een herziening — verwerk expliciet de volgende extra instructies of feedback:\n${payload.extraContext}`
        : null,
    ]
      .filter(Boolean)
      .join("\n\n"),
    bestanden,
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

  // Every generation is a NEW version (max + 1), never an overwrite.
  //
  // This used to regenerate into the existing concept in place — same folder,
  // same row — while the chat promised "levert een nieuwe versie op". In
  // practice that meant hergenereren silently threw away the version you were
  // looking at, including every chat-edit made on it. Regenerating is rare and
  // expensive; when it happens you want to compare, not lose.
  //
  // "Eén concept-versie" (the partial unique index) still holds: a concept that
  // already exists becomes 'afgerond' — kept, reachable in Versiegeschiedenis,
  // one click from live — but only AFTER the new site uploaded fine, so a
  // failed generation never demotes anything. The review loop is different on
  // purpose: its regenerations are retries of the same attempt and stay in
  // place (review-job.ts).
  const { data: laatste } = await supabase
    .from("site_versions")
    .select("versienummer")
    .eq("lead_id", leadId)
    .order("versienummer", { ascending: false })
    .limit(1)
    .maybeSingle();
  const versienummer: number = (laatste?.versienummer ?? 0) + 1;

  const map = `${leadId}/${versienummer}`;
  await uploadSite(supabase, map, gebouwd, bron);

  if (bestaandConcept) {
    const { error: afrondFout } = await supabase
      .from("site_versions")
      .update({ status: "afgerond" })
      .eq("id", bestaandConcept.id);
    if (afrondFout) throw new Error(`Kon het vorige concept niet afronden: ${afrondFout.message}`);
  }

  const { data: nieuweVersie, error: insertFout } = await supabase
    .from("site_versions")
    .insert({
      lead_id: leadId,
      site_type: "demo",
      versienummer,
      status: "concept",
      content_referentie: `${map}/index.html`,
      paginas: bron.paginas,
      prompt_versie: PROMPT_VERSIE,
    })
    .select("id")
    .single();
  if (insertFout) throw new Error(`Kon de nieuwe versie niet opslaan: ${insertFout.message}`);

  // Only leads this run actually moved to "genereren" get moved on to "klaar".
  //
  // This used to test lead.status against a list that included "klaar" — but
  // lead.status is the value read before this job set "genereren", so a lead
  // that was already klaar matched, the update was skipped, and it sat on
  // "genereren" forever with a finished, approved site. Hit for real by
  // Antwerp Fried Chicken's second generation.
  if (magStatusVolgen) {
    await supabase.from("leads").update({ status: "klaar" }).eq("id", leadId);
  }

  await meldContrast(supabase, leadId, nieuweVersie.id, versienummer, gebouwd);
}

/**
 * Meet het contrast van de nieuwe versie en zet wat niet leesbaar is in de
 * chat. Een hergeneratie vanuit de chat gaat niet door de review-loop, dus
 * zonder dit hoorde je pas van lichte tekst op wit als je het zelf zag.
 *
 * Best-effort: een mislukte meting (Chromium is op deze machine wankel) mag een
 * geslaagde generatie niet alsnog laten mislukken.
 */
async function meldContrast(
  supabase: SupabaseClient,
  leadId: string,
  versieId: string,
  versienummer: number,
  paginas: GebouwdePagina[],
) {
  try {
    const problemen: ContrastProbleem[] = [];
    for (const pagina of paginas.filter((p) => p.bestand !== PRIVACY_BESTAND).slice(0, 5)) {
      const { contrast } = await takeScreenshotMetContrast(pagina.html);
      problemen.push(...beoordeel(pagina.bestand, contrast));
    }
    if (!problemen.length) return;

    const lijst = problemen
      .sort((a, b) => a.verhouding - b.verhouding)
      .slice(0, 8)
      .map((p) => `- ${beschrijf(p)}`)
      .join("\n");
    await supabase.from("chat_berichten").insert({
      lead_id: leadId,
      rol: "systeem",
      afzender: null,
      soort: "regeneratie",
      site_version_id: versieId,
      bericht:
        `Versie ${versienummer}: tekst die slecht leesbaar is (licht op licht of donker op donker), gemeten ` +
        `in de browser:\n${lijst}\n\nVraag in de chat om die tekst donkerder te maken, of pas het aan in de editor.`,
    });
  } catch (err) {
    console.error(`Contrastmeting na generatie mislukt: ${err instanceof Error ? err.message : String(err)}`);
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

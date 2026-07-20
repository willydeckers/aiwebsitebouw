import { handleCorsPreflight, corsHeaders } from "../_shared/cors.ts";
import { requireUser } from "../_shared/supabase-clients.ts";
import { createAnthropicClient, calculateKostEur } from "../_shared/anthropic.ts";
import { findPlaceMatch } from "../_shared/places.ts";
import { checkWebsiteStatus, extractContactEmail, isPersoonsgebonden, type WebsiteStatus } from "../_shared/website-check.ts";

// Spec section 2: sourcing uses the cheap/fast model tier, not the
// generatie/research tier — this is what keeps the <€0,10/lead budget
// (3.1a) realistic.
const MODEL = Deno.env.get("MODEL_SOURCING") ?? "claude-haiku-4-5";
const SOURCING_BUDGET_EUR = 0.10;

const PITCH_SYSTEM_PROMPT = `Je schrijft een korte, persoonlijke openingszin (max 2 zinnen) voor een
eerste contactname met een Belgische KMO, als startwaarde voor het notities-veld van een lead
(spec sectie 3.1a stap 7). Baseer je uitsluitend op de meegegeven bedrijfsnaam, sector en
website-status. Verzin geen bedrijfsfeiten. Antwoord met platte tekst, geen aanhalingstekens.`;

async function generatePitch(bedrijfsnaam: string, sector: string, websiteStatus: WebsiteStatus) {
  const client = createAnthropicClient();
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 200,
    system: PITCH_SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: `Bedrijfsnaam: ${bedrijfsnaam}\nSector: ${sector}\nWebsite-status: ${websiteStatus}`,
      },
    ],
  });
  const textBlock = response.content.find((b) => b.type === "text");
  const pitch = textBlock?.type === "text" ? textBlock.text.trim() : "";
  return {
    pitch,
    usage: { tokensIn: response.usage.input_tokens, tokensOut: response.usage.output_tokens },
  };
}

Deno.serve(async (req) => {
  const preflight = handleCorsPreflight(req);
  if (preflight) return preflight;

  try {
    const { supabase, user } = await requireUser(req);

    const { data: config } = await supabase.from("sourcing_config").select("*").limit(1).maybeSingle();
    if (!config || config.nace_codes.length === 0 || config.postcodes.length === 0) {
      throw new Error("Sourcing-config ontbreekt of heeft geen NACE-codes/postcodes (tandwiel-icoon).");
    }

    const { data: job, error: jobError } = await supabase
      .from("jobs")
      .insert({ lead_id: null, type: "sourcing_run", status: "bezig", gestart_op: new Date().toISOString() })
      .select("id")
      .single();
    if (jobError) throw new Error(`Kon job niet aanmaken: ${jobError.message}`);

    // Step 1: candidates from the KBO Open Data staging table (see the
    // migration comment on kbo_ondernemingen — this is a local import of
    // that dataset, not a live API), already deduped against existing
    // leads.kbo_nummer via the anti-join below.
    const { data: existingLeads } = await supabase.from("leads").select("kbo_nummer").not("kbo_nummer", "is", null);
    const knownKboNummers = new Set((existingLeads ?? []).map((l) => l.kbo_nummer));

    const { data: candidates, error: candidatesError } = await supabase
      .from("kbo_ondernemingen")
      .select("*")
      .eq("actief", true)
      .in("nace_code", config.nace_codes)
      .in("postcode", config.postcodes)
      .limit(config.max_leads_per_run * 3); // overfetch: some will be filtered out below

    if (candidatesError) throw new Error(`Kon KBO-kandidaten niet ophalen: ${candidatesError.message}`);

    const eligibleStatussen: WebsiteStatus[] = config.kwaliteitsdrempel_matig
      ? ["geen", "kapot", "matig"]
      : ["geen", "kapot"];

    let aangemaakt = 0;
    for (const candidate of candidates ?? []) {
      if (aangemaakt >= config.max_leads_per_run) break;
      if (knownKboNummers.has(candidate.kbo_nummer)) continue; // dedupe (step 1)

      // Step 2: KBO-webveld-check (free) happens first — only fall back to
      // Places (step 3) when KBO itself has no website on file.
      let websiteUrl: string | null = candidate.website_url;
      let googlePlaceId: string | null = null;
      let bronMatch = "kbo";

      if (!websiteUrl) {
        const match = await findPlaceMatch(candidate.naam, candidate.postcode);
        if (match) {
          googlePlaceId = match.placeId; // "enkel google_place_id onbeperkt bewaard" (section 7)
          websiteUrl = match.websiteUri;
          bronMatch = "places";
        }
      }

      // Step 4: website-check.
      const { status: websiteStatus, html } = await checkWebsiteStatus(websiteUrl);

      // Step 5: filter (actief already true from the query above; sector
      // + regio already applied via nace_code/postcode in the query).
      if (!eligibleStatussen.includes(websiteStatus)) continue;

      // Step 6: enrichment from the company's own site, GDPR-flagged.
      const contactEmail = html ? extractContactEmail(html) : null;
      const contactEmailPersoonsgebonden = contactEmail ? isPersoonsgebonden(contactEmail) : null;

      // Step 7: personalization pitch -> starting value for `notities`.
      const { pitch, usage } = await generatePitch(candidate.naam, candidate.nace_code ?? "onbekend", websiteStatus);

      // Step 8: storage.
      const { data: newLead, error: insertError } = await supabase
        .from("leads")
        .insert({
          bedrijfsnaam: candidate.naam,
          sector: candidate.nace_code ?? "onbekend",
          adres: candidate.adres,
          notities: pitch || null,
          status: "nieuw",
          herkomst: "sourcing",
          kbo_nummer: candidate.kbo_nummer,
          rechtsvorm: candidate.rechtsvorm,
          nace_code: candidate.nace_code,
          oprichtingsdatum: candidate.oprichtingsdatum,
          google_place_id: googlePlaceId,
          website_status: websiteStatus,
          website_url: websiteUrl,
          website_url_bron: bronMatch,
          contact_email: contactEmail,
          contact_email_bron: contactEmail ? "eigen website" : null,
          contact_email_persoonsgebonden: contactEmailPersoonsgebonden,
          bron_match: bronMatch,
          laatst_bewerkt_door: user.email,
        })
        .select("id")
        .single();

      if (insertError) continue; // e.g. a concurrent run just took this kbo_nummer — skip, don't fail the whole run

      knownKboNummers.add(candidate.kbo_nummer);
      aangemaakt++;

      await supabase.rpc("record_project_kost_if_under_budget", {
        p_lead_id: newLead.id,
        p_stap: "sourcing",
        p_model: MODEL,
        p_tokens_in: usage.tokensIn,
        p_tokens_out: usage.tokensOut,
        p_kost_eur: calculateKostEur(MODEL, usage.tokensIn, usage.tokensOut),
        p_budget_eur: SOURCING_BUDGET_EUR,
      });
    }

    await supabase.from("sourcing_config").update({ laatst_uitgevoerd_op: new Date().toISOString() }).eq("id", config.id);
    await supabase.from("jobs").update({ status: "klaar", afgerond_op: new Date().toISOString() }).eq("id", job.id);

    return new Response(JSON.stringify({ ok: true, aangemaakt }), {
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

import { handleCorsPreflight, corsHeaders } from "../_shared/cors.ts";
import { createCallerClient, requireUser } from "../_shared/supabase-clients.ts";
import { createAnthropicClient, calculateKostEur } from "../_shared/anthropic.ts";
import { getSectorStyleGuidance } from "../_shared/sector-styles.ts";
import { IMAGE_BANK_PROMPT } from "../_shared/image-bank.ts";
import { MULTIPAGE_PROMPT, bouwSite, parseSiteBron } from "../_shared/site-builder.ts";

const MODEL = Deno.env.get("MODEL_KWALITEIT") ?? "claude-opus-4-8";
const PROMPT_VERSIE = "generatie-v9.1-multipage";

const SYSTEM_PROMPT = `Je bent de generatie-stap van een web agency dashboard (spec sectie 3.3).
Genereer een volledige meerpagina-demo-website, met Tailwind via CDN — geen build-stap, geen
externe bestanden buiten die CDN-link en publiek toegankelijke afbeeldingen-URL's.

${MULTIPAGE_PROMPT}

Het resultaat moet aanvoelen als een afgewerkt product, niet als een lege demo of teaser. Concreet,
niet onderhandelbaar:
- Als de research-samenvatting een lijst diensten/producten bevat: neem ALLE items op, niet een
  selectie van 3. Heeft het bedrijf al een bestaande site met bv. 8 diensten, dan heeft de nieuwe
  site ook 8 diensten — volledig uitgeschreven, niet ingekort. Onvolledigheid t.o.v. wat het
  bedrijf al zelf publiceert is de belangrijkste fout die je hier kan maken.
- Elke pagina is een volwaardige pagina: de home met hero en overzicht, een pagina met het
  volledige verhaal uit de research (niet een enkele zin), een pagina met het volledige aanbod,
  een contactpagina met alle gevonden contactgegevens. Voeg een realisaties/portfolio-pagina toe
  als de research daar materiaal voor geeft.
- Gebruik letterlijk de contactgegevens uit de research (exact adres, telefoonnummer, e-mail,
  openingsuren) — niet ingekort of samengevat.

${IMAGE_BANK_PROMPT}

Gebruik de meegegeven sectorstijl-richtlijn als leidraad voor kleuren/typografie/lay-out — verzin
geen eigen, afwijkend design. Gebruik de stijlvoorkeuren en sectorkennis hieronder als harde
regels, niet als suggesties. Vertrouw research-feiten en klantnotities volledig; verzin zelf geen
bedrijfsinformatie die niet is meegegeven, maar laat ook niets weg dat wél is meegegeven.`;

Deno.serve(async (req) => {
  const preflight = handleCorsPreflight(req);
  if (preflight) return preflight;

  let jobId: string | null = null;

  try {
    const { supabase, user } = await requireUser(req);
    const { leadId, extraContext } = await req.json();

    const { data: lead, error: leadError } = await supabase
      .from("leads")
      .select("*")
      .eq("id", leadId)
      .single();

    if (leadError || !lead) throw new Error(`Lead niet gevonden: ${leadError?.message}`);

    const { data: job, error: jobError } = await supabase
      .from("jobs")
      .insert({ lead_id: leadId, type: "generatie", status: "bezig", gestart_op: new Date().toISOString() })
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

    jobId = job.id;

    await supabase.from("leads").update({ status: "genereren" }).eq("id", leadId);

    const [{ data: stijlvoorkeuren }, { data: sectorKennis }, { data: bestaandConcept }] =
      await Promise.all([
        supabase.from("stijlvoorkeuren").select("regel, context"),
        supabase.from("sector_kennis").select("regel").eq("sector", lead.sector),
        supabase
          .from("site_versions")
          .select("*")
          .eq("lead_id", leadId)
          .eq("status", "concept")
          .maybeSingle(),
      ]);

    const userMessage = [
      `Bedrijfsnaam: ${lead.bedrijfsnaam}`,
      `Sector: ${lead.sector}`,
      lead.adres ? `Adres: ${lead.adres}` : null,
      lead.notities ? `Notities van de klant:\n${lead.notities}` : null,
      lead.research_samenvatting ? `Research-samenvatting:\n${lead.research_samenvatting}` : null,
      `Sectorstijl-richtlijn:\n${getSectorStyleGuidance(lead.sector)}`,
      `Stijlvoorkeuren:\n${
        stijlvoorkeuren?.length
          ? stijlvoorkeuren.map((r: { regel: string; context: string | null }) =>
              `- ${r.regel}${r.context ? ` (${r.context})` : ""}`).join("\n")
          : "Geen stijlvoorkeuren geregistreerd."
      }`,
      `Sectorkennis (${lead.sector}):\n${
        sectorKennis?.length
          ? sectorKennis.map((r: { regel: string }) => `- ${r.regel}`).join("\n")
          : "Geen sectorkennis geregistreerd voor deze sector."
      }`,
      extraContext
        ? `Dit is een herziening — verwerk expliciet de volgende extra instructies of feedback:\n${extraContext}`
        : null,
    ]
      .filter(Boolean)
      .join("\n\n");

    const client = createAnthropicClient();
    const response = await client.messages.create({
      model: MODEL,
      // A 4-6 page site is several times the output of the single-page
      // version this replaced (16000) — the old cap truncated mid-page,
      // which the builder then rejects as a missing ===PAGINA===-sectie.
      max_tokens: 48000,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userMessage }],
    });

    const textBlocks = response.content.filter((b) => b.type === "text");
    const lastText = textBlocks[textBlocks.length - 1];
    if (!lastText || lastText.type !== "text") {
      throw new Error("Geen antwoord ontvangen van generatie-call.");
    }
    if (response.stop_reason === "max_tokens") {
      throw new Error("Generatie-antwoord is afgekapt op max_tokens — site niet volledig.");
    }


    const { data: budgetResult, error: budgetError } = await supabase.rpc(
      "record_project_kost_if_under_budget",
      {
        p_lead_id: leadId,
        p_stap: "generatie",
        p_model: MODEL,
        p_tokens_in: response.usage.input_tokens,
        p_tokens_out: response.usage.output_tokens,
        p_kost_eur: calculateKostEur(MODEL, response.usage.input_tokens, response.usage.output_tokens),
        p_prompt_versie: PROMPT_VERSIE,
      },
    );

    if (budgetError) throw new Error(`Budgetcontrole mislukt: ${budgetError.message}`);

    if (!budgetResult?.[0]?.toegestaan) {
      await supabase.from("leads").update({ status: "budget_overschreden" }).eq("id", leadId);
      await supabase.from("jobs").update({ status: "klaar", afgerond_op: new Date().toISOString() }).eq("id", job.id);
      return new Response(JSON.stringify({ ok: true, budgetOverschreden: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Assembly runs after the budget call, not before: the tokens are spent
    // either way, so a generation that turns out to be unusable still has to
    // land in project_kosten rather than silently disappearing from the €5
    // accounting. A SiteBuildError here fails the job with the exact reason
    // (dead link, missing page, ...), which is what the review loop's
    // regenerate step and the UI both surface.
    const bron = parseSiteBron(lastText.text);
    const gebouwd = bouwSite(bron, lead.bedrijfsnaam);

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

    // One folder per version, entry page always index.html — see the
    // 20260727 migration for why content_referentie stays a file path
    // (every existing reader keeps resolving to the home page unchanged).
    const map = `${leadId}/${versienummer}`;
    const storagePath = `${map}/index.html`;

    for (const pagina of gebouwd) {
      const { error: uploadError } = await supabase.storage
        .from("demos")
        .upload(`${map}/${pagina.bestand}`, pagina.html, { contentType: "text/html", upsert: true });
      if (uploadError) throw new Error(`Upload van ${pagina.bestand} mislukt: ${uploadError.message}`);
    }

    // The parsed parts, stored next to the assembled pages so chat-edit can
    // patch the nav or footer once and have it re-applied to every page,
    // instead of having to repeat the same edit N times across N files.
    const { error: bronError } = await supabase.storage
      .from("demos")
      .upload(`${map}/bron.json`, JSON.stringify(bron, null, 2), {
        contentType: "application/json",
        upsert: true,
      });
    if (bronError) throw new Error(`Upload van bron.json mislukt: ${bronError.message}`);

    // A re-generation into an existing concept folder can produce a
    // different set of page names; leftovers from the previous run would
    // otherwise stay served and reachable by their old URL.
    const oudePaginas = (bestaandConcept?.paginas ?? []) as { bestand: string }[];
    const verouderd = oudePaginas
      .filter((p) => !gebouwd.some((g) => g.bestand === p.bestand))
      .map((p) => `${map}/${p.bestand}`);
    // ...including the single file a pre-multi-page concept for this same
    // versienummer was stored as (`{leadId}/{N}.html`, now `{leadId}/{N}/`).
    if (bestaandConcept && !bestaandConcept.paginas && bestaandConcept.content_referentie) {
      verouderd.push(bestaandConcept.content_referentie);
    }
    if (verouderd.length) await supabase.storage.from("demos").remove(verouderd);

    const paginaManifest = gebouwd.map((p) => {
      const meta = bron.paginas.find((m) => m.bestand === p.bestand)!;
      return { bestand: meta.bestand, titel: meta.titel, nav_label: meta.nav_label };
    });

    if (bestaandConcept) {
      await supabase
        .from("site_versions")
        .update({
          content_referentie: storagePath,
          paginas: paginaManifest,
          prompt_versie: PROMPT_VERSIE,
          laatst_bewerkt_door: user.email,
        })
        .eq("id", bestaandConcept.id);
    } else {
      await supabase.from("site_versions").insert({
        lead_id: leadId,
        site_type: "demo",
        versienummer,
        status: "concept",
        content_referentie: storagePath,
        paginas: paginaManifest,
        prompt_versie: PROMPT_VERSIE,
        laatst_bewerkt_door: user.email,
      });
    }

    // Regenerating content for a lead that's already progressed past "klaar"
    // (sent, opened, or already a klant — e.g. a klant asking to fill in
    // gaps missed the first time round, spec 3.5's ongoing-maintenance
    // path) shouldn't push it backwards through the pipeline. Only leads
    // still mid-pipeline actually move to "klaar" here.
    if (!["klaar", "verzonden", "geopend", "klant"].includes(lead.status)) {
      await supabase.from("leads").update({ status: "klaar" }).eq("id", leadId);
    }
    await supabase.from("jobs").update({ status: "klaar", afgerond_op: new Date().toISOString() }).eq("id", job.id);

    return new Response(JSON.stringify({ ok: true, versienummer, paginas: paginaManifest }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // See research/index.ts for why this matters: without it, a job that
    // fails after the "bezig" insert sits there forever instead of
    // reaching "mislukt".
    if (jobId) {
      try {
        await createCallerClient(req)
          .from("jobs")
          .update({ status: "mislukt", error_message: message, afgerond_op: new Date().toISOString() })
          .eq("id", jobId);
      } catch {
        // Best-effort — the error response below is what the caller sees regardless.
      }
    }
    return new Response(JSON.stringify({ error: message }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

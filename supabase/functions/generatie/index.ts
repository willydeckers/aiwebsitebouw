import { handleCorsPreflight, corsHeaders } from "../_shared/cors.ts";
import { requireUser } from "../_shared/supabase-clients.ts";
import { createAnthropicClient, calculateKostEur } from "../_shared/anthropic.ts";
import { getSectorStyleGuidance } from "../_shared/sector-styles.ts";

const MODEL = Deno.env.get("MODEL_KWALITEIT") ?? "claude-opus-4-8";
const PROMPT_VERSIE = "generatie-v9.0";

const SYSTEM_PROMPT = `Je bent de generatie-stap van een web agency dashboard (spec sectie 3.3).
Genereer één volledig zelfstandig HTML-bestand voor een koude demo-website, met Tailwind via CDN
(<script src="https://cdn.tailwindcss.com"></script>) — geen build-stap, geen externe bestanden
buiten die CDN-link en publiek toegankelijke afbeeldingen-URL's.

Gebruik de meegegeven sectorstijl-richtlijn als leidraad voor kleuren/typografie/lay-out — verzin
geen eigen, afwijkend design. Gebruik de stijlvoorkeuren en sectorkennis hieronder als harde
regels, niet als suggesties. Vertrouw research-feiten en klantnotities; verzin zelf geen
bedrijfsinformatie die niet is meegegeven.

Antwoord uitsluitend met de ruwe HTML, beginnend met <!DOCTYPE html>. Geen markdown-codeblock,
geen uitleg ervoor of erna.`;

Deno.serve(async (req) => {
  const preflight = handleCorsPreflight(req);
  if (preflight) return preflight;

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
      max_tokens: 16000,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userMessage }],
    });

    const textBlocks = response.content.filter((b) => b.type === "text");
    const lastText = textBlocks[textBlocks.length - 1];
    if (!lastText || lastText.type !== "text") {
      throw new Error("Geen HTML-antwoord ontvangen van generatie-call.");
    }

    const html = lastText.text.trim();
    if (!html.toLowerCase().startsWith("<!doctype")) {
      throw new Error("Generatie-output start niet met <!DOCTYPE html>.");
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

    const storagePath = `${leadId}/${versienummer}.html`;

    const { error: uploadError } = await supabase.storage
      .from("demos")
      .upload(storagePath, html, { contentType: "text/html", upsert: true });

    if (uploadError) throw new Error(`Upload naar storage mislukt: ${uploadError.message}`);

    if (bestaandConcept) {
      await supabase
        .from("site_versions")
        .update({ content_referentie: storagePath, prompt_versie: PROMPT_VERSIE, laatst_bewerkt_door: user.email })
        .eq("id", bestaandConcept.id);
    } else {
      await supabase.from("site_versions").insert({
        lead_id: leadId,
        site_type: "demo",
        versienummer,
        status: "concept",
        content_referentie: storagePath,
        prompt_versie: PROMPT_VERSIE,
        laatst_bewerkt_door: user.email,
      });
    }

    await supabase.from("leads").update({ status: "klaar" }).eq("id", leadId);
    await supabase.from("jobs").update({ status: "klaar", afgerond_op: new Date().toISOString() }).eq("id", job.id);

    return new Response(JSON.stringify({ ok: true, versienummer }), {
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

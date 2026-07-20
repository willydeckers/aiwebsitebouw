import { handleCorsPreflight, corsHeaders } from "../_shared/cors.ts";
import { requireUser } from "../_shared/supabase-clients.ts";
import { createAnthropicClient, calculateKostEur } from "../_shared/anthropic.ts";

// Spec section 2: model tier per step is configurable, not hard-coded —
// research needs the "kwalitatief sterker" tier (this determines demo
// quality, unlike sourcing's cheap/fast tier).
const MODEL = Deno.env.get("MODEL_KWALITEIT") ?? "claude-opus-4-8";

const SYSTEM_PROMPT = `Je bent de research-stap van een web agency dashboard (spec sectie 3.2).
Zoek publieke, betrouwbare informatie over het bedrijf dat de gebruiker beschrijft: logo,
publieke bedrijfsinfo, het "verhaal" van het bedrijf, sfeer-indicaties.

Regel: nooit verzinnen. Een feit dat je niet met een bron kan bevestigen, formuleer je als een
open vraag in plaats van te gokken — ook niet bij benadering (bv. een oprichtingsjaar).
Informatie die de gebruiker als notities/briefing meegeeft, mag je wél vertrouwen en gebruiken
zonder verificatie.

Antwoord uitsluitend met geldige JSON (geen markdown-codeblock, geen uitleg ervoor of erna) in
exact deze vorm:
{
  "bedrijfsverhaal": string of null,
  "kernfeiten": string[],
  "open_vragen": string of null,
  "logo_url": string of null
}`;

Deno.serve(async (req) => {
  const preflight = handleCorsPreflight(req);
  if (preflight) return preflight;

  try {
    const { supabase, user } = await requireUser(req);
    const { leadId } = await req.json();

    const { data: lead, error: leadError } = await supabase
      .from("leads")
      .select("*")
      .eq("id", leadId)
      .single();

    if (leadError || !lead) {
      throw new Error(`Lead niet gevonden: ${leadError?.message}`);
    }

    const { data: job, error: jobError } = await supabase
      .from("jobs")
      .insert({ lead_id: leadId, type: "research", status: "bezig", gestart_op: new Date().toISOString() })
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

    await supabase.from("leads").update({ status: "research" }).eq("id", leadId);

    const client = createAnthropicClient();
    const userMessage = [
      `Bedrijfsnaam: ${lead.bedrijfsnaam}`,
      `Sector: ${lead.sector}`,
      lead.adres ? `Adres: ${lead.adres}` : null,
      lead.notities ? `Notities van de klant:\n${lead.notities}` : null,
    ]
      .filter(Boolean)
      .join("\n");

    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 5 }],
      messages: [{ role: "user", content: userMessage }],
    });

    const textBlocks = response.content.filter((b) => b.type === "text");
    const lastText = textBlocks[textBlocks.length - 1];
    if (!lastText || lastText.type !== "text") {
      throw new Error("Geen tekstantwoord ontvangen van research-call.");
    }

    const parsed = JSON.parse(lastText.text);

    // Atomic, race-condition-free budget check (spec 3.3/7/9).
    const { data: budgetResult, error: budgetError } = await supabase.rpc(
      "record_project_kost_if_under_budget",
      {
        p_lead_id: leadId,
        p_stap: "research",
        p_model: MODEL,
        p_tokens_in: response.usage.input_tokens,
        p_tokens_out: response.usage.output_tokens,
        p_kost_eur: calculateKostEur(MODEL, response.usage.input_tokens, response.usage.output_tokens),
      },
    );

    if (budgetError) throw new Error(`Budgetcontrole mislukt: ${budgetError.message}`);

    const toegestaan = budgetResult?.[0]?.toegestaan;
    if (!toegestaan) {
      await supabase.from("leads").update({ status: "budget_overschreden" }).eq("id", leadId);
    } else {
      const samenvatting = [
        parsed.bedrijfsverhaal,
        Array.isArray(parsed.kernfeiten) && parsed.kernfeiten.length > 0
          ? parsed.kernfeiten.map((f: string) => `- ${f}`).join("\n")
          : null,
      ]
        .filter(Boolean)
        .join("\n\n");

      await supabase
        .from("leads")
        .update({
          open_vragen: parsed.open_vragen ?? null,
          research_samenvatting: samenvatting || null,
          laatst_bewerkt_door: user.email,
        })
        .eq("id", leadId);
    }

    await supabase
      .from("jobs")
      .update({ status: "klaar", afgerond_op: new Date().toISOString() })
      .eq("id", job.id);

    return new Response(JSON.stringify({ ok: true, bedrijfsverhaal: parsed.bedrijfsverhaal }), {
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

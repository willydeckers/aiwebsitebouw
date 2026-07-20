import Anthropic from "npm:@anthropic-ai/sdk@0.112.1";
import { handleCorsPreflight, corsHeaders } from "../_shared/cors.ts";
import { requireUser } from "../_shared/supabase-clients.ts";
import { createAnthropicClient, calculateKostEur } from "../_shared/anthropic.ts";
import { shopifyAdminGraphQL } from "../_shared/shopify.ts";

const MODEL = Deno.env.get("MODEL_KWALITEIT") ?? "claude-opus-4-8";
const PROMPT_VERSIE = "chat-edit-shopify-v9.0";
const MAX_TOOL_ITERATIONS = 6;

const SYSTEM_PROMPT = `Je bent de chat-based editor voor Shopify-klanten (spec sectie 3.5/3.9).
Warre of Garen typt een gerichte instructie (bv. "voeg product toe: Lentetaart, €18,50") en jij
voert die uit via de shopify_admin_graphql-tool met een gerichte GraphQL-mutation of -query op de
Shopify Admin API. Voer enkel uit wat gevraagd is — geen andere wijzigingen. Rond af zodra de
instructie is doorgevoerd en meld kort wat je deed.`;

const SHOPIFY_TOOL: Anthropic.Tool = {
  name: "shopify_admin_graphql",
  description: "Voert een GraphQL query of mutation uit tegen de Shopify Admin API van deze klant se winkel.",
  input_schema: {
    type: "object",
    properties: {
      query: { type: "string", description: "De GraphQL query of mutation." },
      variables: { type: "object", description: "Variabelen voor de query, indien nodig." },
    },
    required: ["query"],
  },
};

Deno.serve(async (req) => {
  const preflight = handleCorsPreflight(req);
  if (preflight) return preflight;

  try {
    const { supabase } = await requireUser(req);
    const { klantId, instruction } = await req.json();

    const { data: klant, error: klantError } = await supabase
      .from("klanten")
      .select("id, lead_id, shopify_domain, shopify_access_token")
      .eq("id", klantId)
      .single();

    if (klantError || !klant) throw new Error(`Klant niet gevonden: ${klantError?.message}`);
    if (!klant.shopify_domain || !klant.shopify_access_token) {
      throw new Error("Shopify-koppeling ontbreekt nog voor deze klant.");
    }

    const client = createAnthropicClient();
    let tokensIn = 0;
    let tokensOut = 0;
    let summary = "";

    const messages: Anthropic.MessageParam[] = [{ role: "user", content: `Instructie: ${instruction}` }];

    for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
      const response = await client.messages.create({
        model: MODEL,
        max_tokens: 4096,
        system: SYSTEM_PROMPT,
        tools: [SHOPIFY_TOOL],
        messages,
      });

      tokensIn += response.usage.input_tokens;
      tokensOut += response.usage.output_tokens;
      messages.push({ role: "assistant", content: response.content });

      const textBlock = response.content.find((b) => b.type === "text");
      if (textBlock && textBlock.type === "text") summary = textBlock.text;

      if (response.stop_reason !== "tool_use") break;

      const toolResults: Anthropic.ToolResultBlockParam[] = [];
      for (const block of response.content) {
        if (block.type !== "tool_use") continue;
        const input = block.input as { query: string; variables?: Record<string, unknown> };
        try {
          const result = await shopifyAdminGraphQL(
            klant.shopify_domain,
            klant.shopify_access_token,
            input.query,
            input.variables ?? {},
          );
          toolResults.push({ type: "tool_result", tool_use_id: block.id, content: JSON.stringify(result) });
        } catch (err) {
          toolResults.push({
            type: "tool_result",
            tool_use_id: block.id,
            content: err instanceof Error ? err.message : String(err),
            is_error: true,
          });
        }
      }
      messages.push({ role: "user", content: toolResults });
    }

    const { data: budgetResult, error: budgetError } = await supabase.rpc(
      "record_project_kost_if_under_budget",
      {
        p_lead_id: klant.lead_id,
        p_stap: "chat_edit",
        p_model: MODEL,
        p_tokens_in: tokensIn,
        p_tokens_out: tokensOut,
        p_kost_eur: calculateKostEur(MODEL, tokensIn, tokensOut),
        p_prompt_versie: PROMPT_VERSIE,
      },
    );

    if (budgetError) throw new Error(`Budgetcontrole mislukt: ${budgetError.message}`);
    if (!budgetResult?.[0]?.toegestaan) {
      return new Response(JSON.stringify({ error: "Budget overschreden — wijziging niet doorgevoerd." }), {
        status: 402,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    await supabase.from("review_log").insert({
      lead_id: klant.lead_id,
      bron: "chat-edit-shopify",
      instructie_of_bevinding: instruction,
      resultaat: summary || "toegepast",
      prompt_versie: PROMPT_VERSIE,
    });

    return new Response(JSON.stringify({ ok: true, summary }), {
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

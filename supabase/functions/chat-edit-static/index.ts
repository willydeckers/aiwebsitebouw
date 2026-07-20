import Anthropic from "npm:@anthropic-ai/sdk@0.112.1";
import { handleCorsPreflight, corsHeaders } from "../_shared/cors.ts";
import { requireUser } from "../_shared/supabase-clients.ts";
import { createAnthropicClient, calculateKostEur } from "../_shared/anthropic.ts";

const MODEL = Deno.env.get("MODEL_KWALITEIT") ?? "claude-opus-4-8";
const PROMPT_VERSIE = "chat-edit-static-v9.0";
const VIRTUAL_PATH = "/demo/index.html";
const MAX_TOOL_ITERATIONS = 6;

const SYSTEM_PROMPT = `Je bent de chat-based patch-editor van een web agency dashboard (spec sectie 3.5).
Je krijgt één bestaand HTML-bestand (op pad ${VIRTUAL_PATH}) en een gerichte instructie van
Warre of Garen (bv. "die kleur moet anders"). Dit is GEEN nieuwe generatie: herschrijf niet de
hele pagina. Gebruik uitsluitend str_replace of insert om precies het gevraagde te wijzigen en
niets anders. Rond af zodra de instructie is doorgevoerd.`;

function applyCommand(file: string, input: Record<string, unknown>): string {
  const command = input.command as string;

  if (command === "view") return file;

  if (command === "str_replace") {
    const oldStr = input.old_str as string;
    const newStr = input.new_str as string;
    const count = file.split(oldStr).length - 1;
    if (count === 0) throw new Error("old_str niet gevonden in bestand.");
    if (count > 1) throw new Error(`old_str komt ${count} keer voor — moet uniek zijn.`);
    return file.replace(oldStr, newStr);
  }

  if (command === "insert") {
    const insertLine = input.insert_line as number;
    const insertText = input.insert_text as string;
    const lines = file.split("\n");
    lines.splice(insertLine, 0, insertText);
    return lines.join("\n");
  }

  if (command === "create") return input.file_text as string;

  throw new Error(`Onbekend commando: ${command}`);
}

Deno.serve(async (req) => {
  const preflight = handleCorsPreflight(req);
  if (preflight) return preflight;

  try {
    const { supabase, user } = await requireUser(req);
    const { leadId, instruction } = await req.json();

    const { data: siteVersion, error: versionError } = await supabase
      .from("site_versions")
      .select("*")
      .eq("lead_id", leadId)
      .order("versienummer", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (versionError || !siteVersion?.content_referentie) {
      throw new Error("Geen site-versie om te bewerken.");
    }

    const { data: fileData, error: downloadError } = await supabase.storage
      .from("demos")
      .download(siteVersion.content_referentie);

    if (downloadError || !fileData) {
      throw new Error(`Kon huidig bestand niet ophalen: ${downloadError?.message}`);
    }

    let file = await fileData.text();
    let tokensIn = 0;
    let tokensOut = 0;

    const client = createAnthropicClient();
    const messages: Anthropic.MessageParam[] = [
      { role: "user", content: `Instructie: ${instruction}\n\nHet huidige bestand staat op ${VIRTUAL_PATH}.` },
    ];

    for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
      const response = await client.messages.create({
        model: MODEL,
        max_tokens: 8000,
        system: SYSTEM_PROMPT,
        tools: [{ type: "text_editor_20250728", name: "str_replace_based_edit_tool" }],
        messages,
      });

      tokensIn += response.usage.input_tokens;
      tokensOut += response.usage.output_tokens;
      messages.push({ role: "assistant", content: response.content });

      if (response.stop_reason !== "tool_use") break;

      const toolResults: Anthropic.ToolResultBlockParam[] = [];
      for (const block of response.content) {
        if (block.type !== "tool_use") continue;
        const input = block.input as Record<string, unknown>;
        try {
          const output = applyCommand(file, input);
          if (input.command !== "view") file = output;
          toolResults.push({
            type: "tool_result",
            tool_use_id: block.id,
            content: input.command === "view" ? output : "OK",
          });
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
        p_lead_id: leadId,
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
      await supabase.from("leads").update({ status: "budget_overschreden" }).eq("id", leadId);
      return new Response(JSON.stringify({ error: "Budget overschreden — wijziging niet doorgevoerd." }), {
        status: 402,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { error: uploadError } = await supabase.storage
      .from("demos")
      .upload(siteVersion.content_referentie, file, { contentType: "text/html", upsert: true });

    if (uploadError) throw new Error(`Upload mislukt: ${uploadError.message}`);

    await supabase
      .from("site_versions")
      .update({ laatst_bewerkt_door: user.email })
      .eq("id", siteVersion.id);

    await supabase.from("review_log").insert({
      lead_id: leadId,
      site_version_id: siteVersion.id,
      bron: "chat-edit",
      instructie_of_bevinding: instruction,
      resultaat: "toegepast",
      prompt_versie: PROMPT_VERSIE,
    });

    // Persist the correction for future generations (spec section 3.5).
    await supabase.from("stijlvoorkeuren").insert({
      regel: instruction,
      context: `Chat-edit op lead ${leadId}`,
      toegevoegd_door: user.email,
    });

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

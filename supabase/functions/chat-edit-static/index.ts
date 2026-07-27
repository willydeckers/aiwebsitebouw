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
niets anders. Rond af zodra de instructie is doorgevoerd.

Nadat je de wijziging hebt doorgevoerd: overweeg of dit een ALGEMENE, klant-onafhankelijke
stijl- of structuurvoorkeur is die voortaan voor ELKE toekomstige klant zou moeten gelden (bv.
"gebruik altijd afgeronde knoppen", "voorzie altijd een scroll-animatie bij ankerlinks in de
navigatie"). Zo ja: roep onthoud_als_algemene_stijlvoorkeur aan met een generieke, klant-
onafhankelijke formulering (geen bedrijfsnamen, URL's of andere klantspecifieke details). Is de
instructie net specifiek voor déze klant (verwijst naar hun eigen naam, sector, website of
content) — roep dit dan NIET aan; zulke instructies horen niet thuis in de stijl van andere
klanten.`;

const REMEMBER_TOOL: Anthropic.Tool = {
  name: "onthoud_als_algemene_stijlvoorkeur",
  description:
    "Onthoud de zojuist doorgevoerde wijziging als een algemene, klant-onafhankelijke stijl- of " +
    "structuurvoorkeur voor toekomstige generaties. Alleen aanroepen voor regels die voor élke " +
    "klant zouden moeten gelden — nooit voor iets specifiek aan deze klant.",
  input_schema: {
    type: "object",
    properties: {
      regel: {
        type: "string",
        description: "De regel, generiek en klant-onafhankelijk geformuleerd (geen bedrijfsnamen, URL's of klantspecifieke details).",
      },
    },
    required: ["regel"],
  },
};

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
    let editApplied = false;
    let antwoord = "";
    let algemeneRegel: string | null = null;

    const client = createAnthropicClient();
    const messages: Anthropic.MessageParam[] = [
      { role: "user", content: `Instructie: ${instruction}\n\nHet huidige bestand staat op ${VIRTUAL_PATH}.` },
    ];

    for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
      const response = await client.messages.create({
        model: MODEL,
        max_tokens: 8000,
        system: SYSTEM_PROMPT,
        tools: [{ type: "text_editor_20250728", name: "str_replace_based_edit_tool" }, REMEMBER_TOOL],
        messages,
      });

      tokensIn += response.usage.input_tokens;
      tokensOut += response.usage.output_tokens;
      messages.push({ role: "assistant", content: response.content });

      const textBlock = response.content.find((b) => b.type === "text");
      if (textBlock && textBlock.type === "text") antwoord = textBlock.text;

      // A turn with no tool_use means the model stopped editing — either
      // it's done, or (just as likely with an ambiguous instruction) it's
      // asking a clarifying question instead. Either way there's nothing
      // more to apply; `antwoord` carries whatever it actually said back
      // to the user rather than the UI silently assuming success.
      if (response.stop_reason !== "tool_use") break;

      const toolResults: Anthropic.ToolResultBlockParam[] = [];
      for (const block of response.content) {
        if (block.type !== "tool_use") continue;
        if (block.name === "onthoud_als_algemene_stijlvoorkeur") {
          algemeneRegel = (block.input as { regel: string }).regel;
          toolResults.push({
            type: "tool_result",
            tool_use_id: block.id,
            content: "OK, onthouden als algemene stijlvoorkeur.",
          });
          continue;
        }
        const input = block.input as Record<string, unknown>;
        try {
          const output = applyCommand(file, input);
          if (input.command !== "view") {
            file = output;
            editApplied = true;
          }
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

    if (editApplied) {
      const { error: uploadError } = await supabase.storage
        .from("demos")
        .upload(siteVersion.content_referentie, file, { contentType: "text/html", upsert: true });

      if (uploadError) throw new Error(`Upload mislukt: ${uploadError.message}`);

      await supabase
        .from("site_versions")
        .update({ laatst_bewerkt_door: user.email })
        .eq("id", siteVersion.id);

      // Persist the correction for future generations (spec section 3.5) —
      // but only the generalized rule the model explicitly flagged as
      // client-independent, not the raw instruction. Blindly persisting
      // every applied instruction verbatim leaked client-specific content
      // (e.g. "copy the services from <this client's own website>") into
      // every OTHER client's generation, since generatie applies every row
      // in this table to every lead unconditionally — caught live when a
      // flower shop's generated site started referencing a landscaping
      // company's reference site.
      if (algemeneRegel) {
        await supabase.from("stijlvoorkeuren").insert({
          regel: algemeneRegel,
          context: `Chat-edit op lead ${leadId} (gegeneraliseerd)`,
          toegevoegd_door: user.email,
        });
      }
    }

    await supabase.from("review_log").insert({
      lead_id: leadId,
      site_version_id: siteVersion.id,
      bron: "chat-edit",
      instructie_of_bevinding: instruction,
      resultaat: editApplied ? "toegepast" : "geen_wijziging",
      ai_antwoord: antwoord || null,
      prompt_versie: PROMPT_VERSIE,
    });

    return new Response(JSON.stringify({ ok: true, toegepast: editApplied, antwoord: antwoord || null }), {
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

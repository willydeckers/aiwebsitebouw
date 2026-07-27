import Anthropic from "npm:@anthropic-ai/sdk@0.112.1";
import { handleCorsPreflight, corsHeaders } from "../_shared/cors.ts";
import { requireUser } from "../_shared/supabase-clients.ts";
import { createAnthropicClient, calculateKostEur } from "../_shared/anthropic.ts";
import { SiteBuildError, bouwSite, parseSiteBron, type SiteBron } from "../_shared/site-builder.ts";

const MODEL = Deno.env.get("MODEL_KWALITEIT") ?? "claude-opus-4-8";
const PROMPT_VERSIE = "chat-edit-static-v9.1-multipage";
const VIRTUAL_DIR = "/demo";
const VIRTUAL_PATH = `${VIRTUAL_DIR}/index.html`;
const MAX_TOOL_ITERATIONS = 8;

const ONTHOUD_INSTRUCTIE = `Nadat je de wijziging hebt doorgevoerd: overweeg of dit een ALGEMENE,
klant-onafhankelijke stijl- of structuurvoorkeur is die voortaan voor ELKE toekomstige klant zou
moeten gelden (bv. "gebruik altijd afgeronde knoppen", "voorzie altijd een scroll-animatie bij
ankerlinks in de navigatie"). Zo ja: roep onthoud_als_algemene_stijlvoorkeur aan met een
generieke, klant-onafhankelijke formulering (geen bedrijfsnamen, URL's of andere klantspecifieke
details). Is de instructie net specifiek voor déze klant (verwijst naar hun eigen naam, sector,
website of content) — roep dit dan NIET aan; zulke instructies horen niet thuis in de stijl van
andere klanten.`;

// Multi-page versions are edited through their *source parts* (the bron.json
// generatie wrote next to the pages), not through the assembled files. That's
// what keeps "de nav is op elke pagina identiek" true after an edit: one patch
// to _navigatie.html is re-applied to every page by the builder, instead of the
// model having to make the same change in four files and getting one of them
// subtly wrong.
const SYSTEM_PROMPT_MULTIPAGE = `Je bent de chat-based patch-editor van een web agency dashboard
(spec sectie 3.5). Je krijgt de bronbestanden van een meerpagina-website en een gerichte
instructie van Warre of Garen (bv. "die kleur moet anders"). Dit is GEEN nieuwe generatie:
herschrijf niets dat de instructie niet raakt. Gebruik str_replace of insert om precies het
gevraagde te wijzigen. Rond af zodra de instructie is doorgevoerd.

De site bestaat NIET uit losse volledige HTML-bestanden. De code zet de pagina's samen uit deze
bronbestanden, dus:
- ${VIRTUAL_DIR}/_navigatie.html — de gedeelde navigatiebalk. Eén wijziging hier geldt meteen
  voor élke pagina. Bewerk nooit een nav per pagina.
- ${VIRTUAL_DIR}/_footer.html — de gedeelde footer, idem.
- ${VIRTUAL_DIR}/_head.html — gedeelde <head>-inhoud (fonts, tailwind.config, eigen <style>).
- ${VIRTUAL_DIR}/{bestand}.html — per pagina enkel de inhoud tússen nav en footer. Geen <html>,
  <head>, <body>, nav of footer in deze bestanden.
- ${VIRTUAL_DIR}/_paginas.json — de paginalijst. Wil je een pagina toevoegen of verwijderen, pas
  dan deze lijst aan én maak/verwijder het bijhorende ${VIRTUAL_DIR}/{bestand}.html, én zorg dat
  de navigatie in _navigatie.html naar exact die pagina's linkt.

Harde regels: interne links zijn altijd relatief (href="over-ons.html"), elke pagina uit
_paginas.json moet in de navigatie staan, en er mag geen link zijn naar een bestand dat niet in
_paginas.json staat. Zet zelf nooit aria-current — de code markeert de actieve pagina.

${ONTHOUD_INSTRUCTIE}`;

// Versions generated before multi-page support are still one standalone HTML
// file — they stay editable exactly as before rather than being force-migrated.
const SYSTEM_PROMPT_ENKELE_PAGINA = `Je bent de chat-based patch-editor van een web agency dashboard (spec sectie 3.5).
Je krijgt één bestaand HTML-bestand (op pad ${VIRTUAL_PATH}) en een gerichte instructie van
Warre of Garen (bv. "die kleur moet anders"). Dit is GEEN nieuwe generatie: herschrijf niet de
hele pagina. Gebruik uitsluitend str_replace of insert om precies het gevraagde te wijzigen en
niets anders. Rond af zodra de instructie is doorgevoerd.

${ONTHOUD_INSTRUCTIE}`;

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

/** Applies one text_editor command to `file`, returning the new contents. */
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

const PAGINAS_PAD = `${VIRTUAL_DIR}/_paginas.json`;
const HEAD_PAD = `${VIRTUAL_DIR}/_head.html`;
const NAV_PAD = `${VIRTUAL_DIR}/_navigatie.html`;
const FOOTER_PAD = `${VIRTUAL_DIR}/_footer.html`;

/** The parsed source of a multi-page site, exposed as the virtual file tree the
 *  text-editor tool edits. */
function bronNaarBestanden(bron: SiteBron): Record<string, string> {
  const bestanden: Record<string, string> = {
    [PAGINAS_PAD]: JSON.stringify(bron.paginas, null, 2),
    [HEAD_PAD]: bron.head,
    [NAV_PAD]: bron.nav,
    [FOOTER_PAD]: bron.footer,
  };
  for (const pagina of bron.paginas) {
    bestanden[`${VIRTUAL_DIR}/${pagina.bestand}`] = bron.bodies[pagina.bestand] ?? "";
  }
  return bestanden;
}

/** Inverse of bronNaarBestanden. Throws (as SiteBuildError, via parseSiteBron)
 *  when the model's edits left the site inconsistent — a page in the list with
 *  no body file, say — which is reported back as a failed edit rather than
 *  written to Storage. */
function bestandenNaarBron(bestanden: Record<string, string>): SiteBron {
  const paginas = JSON.parse(bestanden[PAGINAS_PAD]);
  const secties = [
    "===META===",
    JSON.stringify({ paginas }),
    "===HEAD===",
    bestanden[HEAD_PAD] ?? "",
    "===NAV===",
    bestanden[NAV_PAD] ?? "",
    "===FOOTER===",
    bestanden[FOOTER_PAD] ?? "",
  ];
  for (const pagina of paginas as { bestand: string }[]) {
    secties.push(`===PAGINA:${pagina.bestand}===`, bestanden[`${VIRTUAL_DIR}/${pagina.bestand}`] ?? "");
  }
  // Round-tripping through the same parser the generator uses keeps exactly
  // one definition of what a valid site is, instead of a second, drifting one
  // here.
  return parseSiteBron(secties.join("\n"));
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

    // Needed to re-render the per-page <title> when re-assembling below.
    const { data: lead } = await supabase
      .from("leads")
      .select("bedrijfsnaam")
      .eq("id", leadId)
      .maybeSingle();

    const isMultipage = Array.isArray(siteVersion.paginas) && siteVersion.paginas.length > 0;
    const map = siteVersion.content_referentie.replace(/\/index\.html$/, "");

    // Multi-page: edit the source parts (bron.json) and re-assemble.
    // Single page (pre-multi-page version): edit the one stored file directly.
    const bestanden: Record<string, string> = {};
    if (isMultipage) {
      const { data: bronData, error: bronDownloadError } = await supabase.storage
        .from("demos")
        .download(`${map}/bron.json`);
      if (bronDownloadError || !bronData) {
        throw new Error(`Kon bron.json niet ophalen: ${bronDownloadError?.message}`);
      }
      Object.assign(bestanden, bronNaarBestanden(JSON.parse(await bronData.text()) as SiteBron));
    } else {
      const { data: fileData, error: downloadError } = await supabase.storage
        .from("demos")
        .download(siteVersion.content_referentie);
      if (downloadError || !fileData) {
        throw new Error(`Kon huidig bestand niet ophalen: ${downloadError?.message}`);
      }
      bestanden[VIRTUAL_PATH] = await fileData.text();
    }

    let tokensIn = 0;
    let tokensOut = 0;
    let editApplied = false;
    let antwoord = "";
    let algemeneRegel: string | null = null;

    const bestandsoverzicht = Object.keys(bestanden)
      .map((pad) => `- ${pad}`)
      .join("\n");

    const client = createAnthropicClient();
    const messages: Anthropic.MessageParam[] = [
      {
        role: "user",
        content: isMultipage
          ? `Instructie: ${instruction}\n\nDe bronbestanden van deze site:\n${bestandsoverzicht}`
          : `Instructie: ${instruction}\n\nHet huidige bestand staat op ${VIRTUAL_PATH}.`,
      },
    ];

    for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
      const response = await client.messages.create({
        model: MODEL,
        max_tokens: 8000,
        system: isMultipage ? SYSTEM_PROMPT_MULTIPAGE : SYSTEM_PROMPT_ENKELE_PAGINA,
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
          const pad = isMultipage ? (input.path as string) : VIRTUAL_PATH;
          if (!pad) throw new Error("Geen path meegegeven.");
          if (bestanden[pad] === undefined && input.command !== "create") {
            throw new Error(
              `Bestand ${pad} bestaat niet. Beschikbaar:\n${Object.keys(bestanden).join("\n")}`,
            );
          }
          const output = applyCommand(bestanden[pad] ?? "", input);
          if (input.command !== "view") {
            bestanden[pad] = output;
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

    if (editApplied && isMultipage) {
      // Re-assembling from the edited parts is what re-applies a nav or
      // footer change to every page. It also re-validates the whole site, so
      // an edit that would leave a dead internal link is reported back
      // instead of being written.
      let nieuweBron: SiteBron;
      let gebouwd: { bestand: string; html: string }[];
      try {
        nieuweBron = bestandenNaarBron(bestanden);
        gebouwd = bouwSite(nieuweBron, lead?.bedrijfsnaam ?? "");
      } catch (err) {
        const reden = err instanceof SiteBuildError || err instanceof Error ? err.message : String(err);
        await supabase.from("review_log").insert({
          lead_id: leadId,
          site_version_id: siteVersion.id,
          bron: "chat-edit",
          instructie_of_bevinding: instruction,
          resultaat: "geweigerd",
          error_message: reden,
          prompt_versie: PROMPT_VERSIE,
        });
        return new Response(
          JSON.stringify({
            error: `Wijziging niet doorgevoerd — de site zou hierdoor stuk zijn: ${reden}`,
          }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      for (const pagina of gebouwd) {
        const { error: uploadError } = await supabase.storage
          .from("demos")
          .upload(`${map}/${pagina.bestand}`, pagina.html, { contentType: "text/html", upsert: true });
        if (uploadError) throw new Error(`Upload van ${pagina.bestand} mislukt: ${uploadError.message}`);
      }

      const { error: bronUploadError } = await supabase.storage
        .from("demos")
        .upload(`${map}/bron.json`, JSON.stringify(nieuweBron, null, 2), {
          contentType: "application/json",
          upsert: true,
        });
      if (bronUploadError) throw new Error(`Upload van bron.json mislukt: ${bronUploadError.message}`);

      const oudePaginas = siteVersion.paginas as { bestand: string }[];
      const verouderd = oudePaginas
        .filter((oud) => !gebouwd.some((p) => p.bestand === oud.bestand))
        .map((oud) => `${map}/${oud.bestand}`);
      if (verouderd.length) await supabase.storage.from("demos").remove(verouderd);

      await supabase
        .from("site_versions")
        .update({ paginas: nieuweBron.paginas, laatst_bewerkt_door: user.email })
        .eq("id", siteVersion.id);
    }

    if (editApplied && !isMultipage) {
      const { error: uploadError } = await supabase.storage
        .from("demos")
        .upload(siteVersion.content_referentie, bestanden[VIRTUAL_PATH], {
          contentType: "text/html",
          upsert: true,
        });

      if (uploadError) throw new Error(`Upload mislukt: ${uploadError.message}`);

      await supabase
        .from("site_versions")
        .update({ laatst_bewerkt_door: user.email })
        .eq("id", siteVersion.id);
    }

    if (editApplied) {
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

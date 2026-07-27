import { handleCorsPreflight, corsHeaders } from "../_shared/cors.ts";
import { createCallerClient, requireUser } from "../_shared/supabase-clients.ts";
import { createAnthropicClient, calculateKostEur } from "../_shared/anthropic.ts";

// Spec section 2: model tier per step is configurable, not hard-coded —
// research needs the "kwalitatief sterker" tier (this determines demo
// quality, unlike sourcing's cheap/fast tier).
const MODEL = Deno.env.get("MODEL_KWALITEIT") ?? "claude-opus-4-8";

const SYSTEM_PROMPT = `Je bent de research-stap van een web agency dashboard (spec sectie 3.2).
Het doel is niet een korte samenvatting — het is een volledig herbruikbare inventaris van alles
wat het bedrijf al publiceert, zodat de gegenereerde site straks minstens even compleet is als
hun bestaande site, gewoon beter vormgegeven. Onvolledigheid hier is de directe oorzaak van een
site die aanvoelt als een lege demo in plaats van een afgewerkt product — dat is onacceptabel.

Werkwijze, in deze volgorde:
1. Zoek eerst de EIGEN, officiële website van het bedrijf (niet een vermelding op een
   bedrijvengids of social media) via web_search.
2. Zodra je die URL hebt: haal de homepage op met web_fetch, en daarna ten hoogste 2 bijkomende
   pagina's die er rechtstreeks vanaf linken — kies de pagina's die het meest waarschijnlijk het
   volledige dienst/productaanbod en de contactgegevens bevatten (bv. "Diensten"/"Aanbod" en
   "Contact"; sla "Over ons" over als de homepage dat al grotendeels dekt). Je hebt een beperkt
   aantal fetches — kies gericht, niet lukraak. Zoeksnippets alleen zijn niet genoeg — je moet de
   daadwerkelijke paginatekst gezien hebben van in elk geval de homepage.
3. Geen eigen website gevonden? Val terug op web_search voor wat wél publiek vindbaar is
   (bedrijvengidsen, review-sites, social media), en meld dat expliciet in open_vragen.

Extraheer VOLLEDIG, niet samengevat:
- Elke dienst/product die ze vermelden, met de beschrijving zoals zij die zelf verwoorden — niet
  "3 voorbeelden", de volledige lijst.
- Het volledige bedrijfsverhaal/de "over ons"-tekst: geschiedenis, missie, waarden, team, wat hen
  onderscheidt.
- Exacte contactgegevens: adres, telefoon, e-mail, openingsuren, sociale kanalen — precies zoals
  vermeld, geen benaderingen.
- Certificeringen, partnerships, keurmerken, testimonials/reviews die ze zelf tonen.

Regel: nooit verzinnen. Een feit dat je niet met een bron kan bevestigen, formuleer je als een
open vraag in plaats van te gokken — ook niet bij benadering (bv. een oprichtingsjaar).
Informatie die de gebruiker als notities/briefing meegeeft, mag je wél vertrouwen en gebruiken
zonder verificatie.

Antwoord uitsluitend met geldige JSON (geen markdown-codeblock, geen uitleg ervoor of erna) in
exact deze vorm:
{
  "bedrijfsverhaal": string of null,
  "kernfeiten": string[],
  "diensten_of_producten": string[],
  "contactgegevens": string of null,
  "website_url": string of null,
  "open_vragen": string of null,
  "logo_url": string of null
}`;

// The system prompt asks for JSON with no surrounding prose, but with the
// web_search tool enabled the model sometimes still prefaces its answer
// with a sentence or two of reasoning anyway — a bare JSON.parse() on the
// full text then throws "Unexpected token" and the whole research-stap
// fails even though a valid JSON object is right there. Fall back to
// slicing out the first {...} block before giving up.
// deno-lint-ignore no-explicit-any
function extractJson(text: string): any {
  try {
    return JSON.parse(text.trim());
  } catch {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start === -1 || end === -1 || end < start) {
      throw new Error("Geen JSON-object gevonden in research-antwoord.");
    }
    return JSON.parse(text.slice(start, end + 1));
  }
}

Deno.serve(async (req) => {
  const preflight = handleCorsPreflight(req);
  if (preflight) return preflight;

  let jobId: string | null = null;

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

    jobId = job.id;

    // Same guard as generatie: re-running research on a lead that's already
    // moved further along the pipeline (e.g. a klant asking for a refresh)
    // shouldn't drag its status backwards.
    if (!["klaar", "verzonden", "geopend", "klant"].includes(lead.status)) {
      await supabase.from("leads").update({ status: "research" }).eq("id", leadId);
    }

    const client = createAnthropicClient();
    const userMessage = [
      `Bedrijfsnaam: ${lead.bedrijfsnaam}`,
      `Sector: ${lead.sector}`,
      lead.adres ? `Adres: ${lead.adres}` : null,
      lead.website_url ? `Reeds gekende website: ${lead.website_url} — haal deze zeker volledig op.` : null,
      lead.notities ? `Notities van de klant:\n${lead.notities}` : null,
    ]
      .filter(Boolean)
      .join("\n");

    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 8000,
      system: SYSTEM_PROMPT,
      tools: [
        { type: "web_search_20260209", name: "web_search", max_uses: 4 },
        // Kept deliberately small — Edge Functions have a hard wall-clock
        // execution limit, and web_fetch round-trips (network fetch + a
        // full model turn each) add up fast. 3 fetches x ~12k tokens each
        // is enough for a homepage + 2 subpages without risking a timeout
        // that silently kills the whole research-stap (no exception to
        // catch when the platform terminates the process outright).
        {
          type: "web_fetch_20260209",
          name: "web_fetch",
          max_uses: 3,
          max_content_tokens: 12000,
          // Without this, the API rejects every fetch with "does not
          // support programmatic tool calling" for some models — web_fetch
          // defaults to requiring an explicit caller declaration.
          allowed_callers: ["direct"],
        },
      ],
      messages: [{ role: "user", content: userMessage }],
    });

    const textBlocks = response.content.filter((b) => b.type === "text");
    const lastText = textBlocks[textBlocks.length - 1];
    if (!lastText || lastText.type !== "text") {
      throw new Error("Geen tekstantwoord ontvangen van research-call.");
    }

    const parsed = extractJson(lastText.text);

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
      // Every section here feeds straight into generatie's prompt — this is
      // the actual inventory of what the client already publishes, not a
      // condensed blurb, so nothing real gets lost between "what their old
      // site says" and "what generatie writes onto the new one".
      const samenvatting = [
        parsed.bedrijfsverhaal,
        Array.isArray(parsed.kernfeiten) && parsed.kernfeiten.length > 0
          ? `Kernfeiten:\n${parsed.kernfeiten.map((f: string) => `- ${f}`).join("\n")}`
          : null,
        Array.isArray(parsed.diensten_of_producten) && parsed.diensten_of_producten.length > 0
          ? `Diensten/producten (volledige lijst, allemaal opnemen):\n${parsed.diensten_of_producten
              .map((f: string) => `- ${f}`)
              .join("\n")}`
          : null,
        parsed.contactgegevens ? `Contactgegevens:\n${parsed.contactgegevens}` : null,
      ]
        .filter(Boolean)
        .join("\n\n");

      await supabase
        .from("leads")
        .update({
          open_vragen: parsed.open_vragen ?? null,
          research_samenvatting: samenvatting || null,
          website_url: parsed.website_url ?? lead.website_url ?? null,
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
    // Without this, a job that fails after the "bezig" insert (any error
    // below that point — API failure, budget RPC, bad JSON, ...) sits in
    // "bezig" forever: nothing else in the state machine ever moves it,
    // and the UI has no way to tell "still running" from "died silently".
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

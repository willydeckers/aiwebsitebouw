import type { SupabaseClient } from "@supabase/supabase-js";
import { createAnthropicClient, calculateKostEur } from "../shared/anthropic.js";

// Spec 3.2, moved out of the `research` Edge Function for the same reason
// generation was: this project's Edge Function invocations are killed at about
// 150 seconds, and research routinely runs longer. It does a web_search plus
// up to three web_fetch round-trips, each one a network fetch AND a full model
// turn. Measured runs sat at 50-138s — right against the ceiling — and a lead
// whose site is hard to find goes over it. When that happens the platform
// terminates the process outright, so there is no exception to catch: the job
// row stays "bezig" forever and the UI shows a step that never finishes. That
// is exactly what happened to the MIKI TEA lead.
//
// The fetch budget below is no longer constrained by that ceiling, but it is
// still deliberately small: each fetch costs a model turn, and the €0.10/lead
// sourcing budget and €5/lead project budget both come out of the same pot.

const MODEL = process.env.MODEL_KWALITEIT ?? "claude-opus-4-8";

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


type Lead = {
  id: string;
  bedrijfsnaam: string;
  sector: string;
  adres: string | null;
  website_url: string | null;
  notities: string | null;
  status: string;
};

export async function processResearchJob(supabase: SupabaseClient, jobId: string, leadId: string) {
  const { data: lead, error: leadError } = await supabase
    .from("leads")
    .select("*")
    .eq("id", leadId)
    .single();
  if (leadError || !lead) throw new Error(`Lead niet gevonden: ${leadError?.message}`);

  const typedLead = lead as Lead;

  // Same guard as generatie: re-running research on a lead that has already
  // moved further along the pipeline (a klant asking for a refresh) shouldn't
  // drag its status backwards.
  if (!["klaar", "verzonden", "geopend", "klant"].includes(typedLead.status)) {
    await supabase.from("leads").update({ status: "research" }).eq("id", leadId);
  }

  const client = createAnthropicClient();
  const userMessage = [
    `Bedrijfsnaam: ${typedLead.bedrijfsnaam}`,
    `Sector: ${typedLead.sector}`,
    typedLead.adres ? `Adres: ${typedLead.adres}` : null,
    typedLead.website_url
      ? `Reeds gekende website: ${typedLead.website_url} — haal deze zeker volledig op.`
      : null,
    typedLead.notities ? `Notities van de klant:\n${typedLead.notities}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 8000,
    system: SYSTEM_PROMPT,
    tools: [
      { type: "web_search_20260209", name: "web_search", max_uses: 4 },
      {
        type: "web_fetch_20260209",
        name: "web_fetch",
        max_uses: 4,
        max_content_tokens: 12000,
        // Without this the API rejects every fetch with "does not support
        // programmatic tool calling" — web_fetch defaults to requiring an
        // explicit caller declaration.
        allowed_callers: ["direct"],
      },
    ] as never,
    messages: [{ role: "user", content: userMessage }],
  });

  const textBlocks = response.content.filter((b) => b.type === "text");
  const lastText = textBlocks[textBlocks.length - 1];
  if (!lastText || lastText.type !== "text") {
    throw new Error("Geen tekstantwoord ontvangen van research-call.");
  }

  const parsed = extractJson(lastText.text);

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

  if (!budgetResult?.[0]?.toegestaan) {
    await supabase.from("leads").update({ status: "budget_overschreden" }).eq("id", leadId);
    return;
  }

  // Every section here feeds straight into generatie's prompt — this is the
  // actual inventory of what the client already publishes, not a condensed
  // blurb, so nothing real gets lost between "what their old site says" and
  // "what generatie writes onto the new one".
  const lijst = (items: string[]) => items.map((f) => `- ${f}`).join("\n");

  const samenvatting = [
    parsed.bedrijfsverhaal,
    Array.isArray(parsed.kernfeiten) && parsed.kernfeiten.length > 0
      ? `Kernfeiten:\n${lijst(parsed.kernfeiten)}`
      : null,
    Array.isArray(parsed.diensten_of_producten) && parsed.diensten_of_producten.length > 0
      ? `Diensten/producten (volledige lijst, allemaal opnemen):\n${lijst(parsed.diensten_of_producten)}`
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
      website_url: parsed.website_url ?? typedLead.website_url ?? null,
    })
    .eq("id", leadId);
}

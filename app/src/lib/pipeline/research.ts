import { createAnthropicClient } from "@/lib/anthropic/client";
import type { Lead, ResearchOutput } from "@/lib/types";

const RESEARCH_MODEL = "claude-opus-4-8";

const SYSTEM_PROMPT = `Je bent de research-stap van een web agency dashboard (spec sectie 3.2).
Zoek publieke, betrouwbare informatie over het bedrijf dat de gebruiker beschrijft: logo,
publieke bedrijfsinfo, het "verhaal" van het bedrijf, sfeer-indicaties.

Regel: nooit verzinnen. Een feit dat je niet met een bron kan bevestigen, laat je weg —
gok nooit, ook niet bij benadering (bv. een oprichtingsjaar). Informatie die de gebruiker
als "notities van de klant" meegeeft, mag je wél vertrouwen en gebruiken zonder verificatie.

Antwoord uitsluitend met geldige JSON (geen markdown-codeblock, geen uitleg ervoor of erna)
in exact deze vorm:
{
  "bedrijfsverhaal": string of null,
  "kernfeiten": string[],
  "bronnen": string[],
  "logo_url": string of null
}`;

export type ResearchUsage = {
  model: string;
  tokensIn: number;
  tokensOut: number;
};

export async function runResearch(
  lead: Lead,
): Promise<{ output: ResearchOutput; usage: ResearchUsage }> {
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
    model: RESEARCH_MODEL,
    max_tokens: 4096,
    system: SYSTEM_PROMPT,
    tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 5 }],
    messages: [{ role: "user", content: userMessage }],
  });

  const textBlocks = response.content.filter((block) => block.type === "text");
  const lastText = textBlocks[textBlocks.length - 1];

  if (!lastText || lastText.type !== "text") {
    throw new Error("Geen tekstantwoord ontvangen van research-call.");
  }

  let output: ResearchOutput;
  try {
    output = JSON.parse(lastText.text);
  } catch {
    throw new Error(`Kon research-output niet als JSON parsen: ${lastText.text.slice(0, 200)}`);
  }

  return {
    output,
    usage: {
      model: RESEARCH_MODEL,
      tokensIn: response.usage.input_tokens,
      tokensOut: response.usage.output_tokens,
    },
  };
}

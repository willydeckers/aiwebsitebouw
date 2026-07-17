import { createAnthropicClient } from "@/lib/anthropic/client";
import type { Lead } from "@/lib/types";
import { getSectorStyleGuidance } from "./sector-styles";

const GENERATION_MODEL = "claude-opus-4-8";

export type StijlVoorkeur = { regel: string; context: string | null };
export type SectorKennis = { regel: string };

const SYSTEM_PROMPT = `Je bent de generatie-stap van een web agency dashboard (spec sectie 3.3).
Genereer één volledig zelfstandig HTML-bestand voor een koude demo-website, met Tailwind
via CDN (<script src="https://cdn.tailwindcss.com"></script>) — geen build-stap, geen
externe bestanden buiten die CDN-link en publiek toegankelijke afbeeldingen-URL's.

Gebruik de meegegeven sectorstijl-richtlijn als leidraad voor kleuren/typografie/lay-out
— verzin geen eigen, afwijkend design. Gebruik de stijlvoorkeuren en sectorkennis hieronder
als harde regels, niet als suggesties. Vertrouw research-feiten en klantnotities; verzin
zelf geen bedrijfsinformatie die niet is meegegeven.

Antwoord uitsluitend met de ruwe HTML, beginnend met <!DOCTYPE html>. Geen markdown-
codeblock, geen uitleg ervoor of erna.`;

function formatStijlvoorkeuren(rows: StijlVoorkeur[]): string {
  if (rows.length === 0) return "Geen stijlvoorkeuren geregistreerd.";
  return rows.map((r) => `- ${r.regel}${r.context ? ` (${r.context})` : ""}`).join("\n");
}

function formatSectorKennis(rows: SectorKennis[]): string {
  if (rows.length === 0) return "Geen sectorkennis geregistreerd voor deze sector.";
  return rows.map((r) => `- ${r.regel}`).join("\n");
}

export type GenerateUsage = {
  model: string;
  tokensIn: number;
  tokensOut: number;
};

export async function runGenerateDemo(
  lead: Lead,
  stijlvoorkeuren: StijlVoorkeur[],
  sectorKennis: SectorKennis[],
  reviewFeedback?: string,
): Promise<{ html: string; usage: GenerateUsage }> {
  const client = createAnthropicClient();

  const userMessage = [
    `Bedrijfsnaam: ${lead.bedrijfsnaam}`,
    `Sector: ${lead.sector}`,
    lead.adres ? `Adres: ${lead.adres}` : null,
    lead.notities ? `Notities van de klant:\n${lead.notities}` : null,
    lead.research_output?.bedrijfsverhaal
      ? `Bedrijfsverhaal (research):\n${lead.research_output.bedrijfsverhaal}`
      : null,
    lead.research_output?.kernfeiten?.length
      ? `Kernfeiten (research):\n${lead.research_output.kernfeiten.map((f) => `- ${f}`).join("\n")}`
      : null,
    `Sectorstijl-richtlijn:\n${getSectorStyleGuidance(lead.sector)}`,
    `Stijlvoorkeuren:\n${formatStijlvoorkeuren(stijlvoorkeuren)}`,
    `Sectorkennis (${lead.sector}):\n${formatSectorKennis(sectorKennis)}`,
    reviewFeedback
      ? `Dit is een herziening na review-feedback (spec 3.4) — verwerk expliciet wat hieronder\nals ontbrekend of onjuist werd gemeld:\n${reviewFeedback}`
      : null,
  ]
    .filter(Boolean)
    .join("\n\n");

  const response = await client.messages.create({
    model: GENERATION_MODEL,
    max_tokens: 16000,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: userMessage }],
  });

  const textBlocks = response.content.filter((block) => block.type === "text");
  const lastText = textBlocks[textBlocks.length - 1];

  if (!lastText || lastText.type !== "text") {
    throw new Error("Geen HTML-antwoord ontvangen van generatie-call.");
  }

  const html = lastText.text.trim();
  if (!html.toLowerCase().startsWith("<!doctype")) {
    throw new Error("Generatie-output start niet met <!DOCTYPE html> — waarschijnlijk geen geldige HTML.");
  }

  return {
    html,
    usage: {
      model: GENERATION_MODEL,
      tokensIn: response.usage.input_tokens,
      tokensOut: response.usage.output_tokens,
    },
  };
}

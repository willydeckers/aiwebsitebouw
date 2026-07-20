import { createAnthropicClient } from "../shared/anthropic.js";

// Duplicated from supabase/functions/generatie/index.ts's prompt-building
// logic rather than shared across the Deno/Node runtime boundary — the
// review loop needs to regenerate-with-feedback locally in this worker
// (see the note in review-job.ts on why it doesn't call the Edge Function
// for this). Keep the two in sync by hand.

const MODEL = process.env.MODEL_KWALITEIT ?? "claude-opus-4-8";

const SECTOR_STYLES: { keywords: string[]; guidance: string }[] = [
  {
    keywords: ["bloem", "bakker", "slager", "ambacht", "traiteur", "chocolat"],
    guidance:
      "Ambacht-stijl: warme, aardse kleuren (terracotta, crème, donkergroen), " +
      "een serif-lettertype voor titels, veel witruimte, grote productfoto's " +
      "met ronde hoeken. Voelt handgemaakt en persoonlijk, niet corporate.",
  },
  {
    keywords: ["restaurant", "café", "cafe", "horeca", "bistro"],
    guidance:
      "Horeca-stijl: donkere, sfeervolle achtergrond met warme accentkleur " +
      "(bourgondischrood of amber), sober sans-serif lettertype, grote " +
      "sfeerfoto boven de vouw, menu/aanbod duidelijk in kaartjes.",
  },
  {
    keywords: ["dienst", "consult", "advocaat", "boekhoud", "kantoor"],
    guidance:
      "Diensten-stijl: rustig, zakelijk kleurenschema (marineblauw, grijs, " +
      "wit), strak sans-serif lettertype, duidelijke kopjes met USP's, " +
      "call-to-action-knop prominent bovenaan.",
  },
];

function getSectorStyleGuidance(sector: string): string {
  const normalized = sector.toLowerCase();
  const match = SECTOR_STYLES.find(({ keywords }) => keywords.some((k) => normalized.includes(k)));
  return match?.guidance ?? SECTOR_STYLES[0].guidance;
}

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

export type GenerateUsage = { model: string; tokensIn: number; tokensOut: number };

type Lead = {
  bedrijfsnaam: string;
  sector: string;
  adres: string | null;
  notities: string | null;
  research_samenvatting: string | null;
};

export async function regenerateWithFeedback(
  lead: Lead,
  stijlvoorkeuren: { regel: string; context: string | null }[],
  sectorKennis: { regel: string }[],
  feedback: string,
): Promise<{ html: string; usage: GenerateUsage }> {
  const client = createAnthropicClient();

  const userMessage = [
    `Bedrijfsnaam: ${lead.bedrijfsnaam}`,
    `Sector: ${lead.sector}`,
    lead.adres ? `Adres: ${lead.adres}` : null,
    lead.notities ? `Notities van de klant:\n${lead.notities}` : null,
    lead.research_samenvatting ? `Research-samenvatting:\n${lead.research_samenvatting}` : null,
    `Sectorstijl-richtlijn:\n${getSectorStyleGuidance(lead.sector)}`,
    `Stijlvoorkeuren:\n${
      stijlvoorkeuren.length
        ? stijlvoorkeuren.map((r) => `- ${r.regel}${r.context ? ` (${r.context})` : ""}`).join("\n")
        : "Geen stijlvoorkeuren geregistreerd."
    }`,
    `Sectorkennis (${lead.sector}):\n${
      sectorKennis.length ? sectorKennis.map((r) => `- ${r.regel}`).join("\n") : "Geen sectorkennis geregistreerd."
    }`,
    `Dit is een herziening na review-feedback (spec 3.4) — verwerk expliciet:\n${feedback}`,
  ]
    .filter(Boolean)
    .join("\n\n");

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

  return {
    html,
    usage: { model: MODEL, tokensIn: response.usage.input_tokens, tokensOut: response.usage.output_tokens },
  };
}

import { createAnthropicClient } from "../shared/anthropic.js";
import { bouwImageBankPrompt } from "../shared/image-bank.js";
import {
  MAX_OUTPUT_TOKENS,
  MULTIPAGE_PROMPT,
  bouwSite,
  knipNaLaatsteVolledigeSectie,
  parseSiteBron,
  type GebouwdePagina,
  type SiteBron,
} from "../shared/site-builder.js";

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

const bouwSystemPrompt = (sector: string, briefing: string | null) => `Je bent de generatie-stap van een web agency dashboard (spec sectie 3.3).
Genereer een volledige meerpagina-demo-website, met Tailwind via CDN — geen build-stap, geen
externe bestanden buiten die CDN-link en publiek toegankelijke afbeeldingen-URL's.

${MULTIPAGE_PROMPT}

${bouwImageBankPrompt(sector, briefing)}

Gebruik de meegegeven sectorstijl-richtlijn als leidraad voor kleuren/typografie/lay-out — verzin
geen eigen, afwijkend design. Gebruik de stijlvoorkeuren en sectorkennis hieronder als harde
regels, niet als suggesties. Vertrouw research-feiten en klantnotities; verzin zelf geen
bedrijfsinformatie die niet is meegegeven.`;

export type GenerateUsage = { model: string; tokensIn: number; tokensOut: number };

export type Lead = {
  bedrijfsnaam: string;
  sector: string;
  adres: string | null;
  notities: string | null;
  research_samenvatting: string | null;
};

export type GenerateResult = { bron: SiteBron; paginas: GebouwdePagina[]; usage: GenerateUsage };

/** Review-loop path (spec 3.4): regenerate the whole site with the reviewer's
 *  findings as extra instructions. */
export function regenerateWithFeedback(
  lead: Lead,
  stijlvoorkeuren: { regel: string; context: string | null }[],
  sectorKennis: { regel: string }[],
  feedback: string,
  bestanden: string[] = [],
): Promise<GenerateResult> {
  return genereerSite(
    lead,
    stijlvoorkeuren,
    sectorKennis,
    `Dit is een herziening na review-feedback (spec 3.4) — verwerk expliciet:\n${feedback}`,
  );
}

/**
 * The generation step itself (spec 3.3). Lives here rather than in the
 * `generatie` Edge Function because a real multi-page site takes minutes of
 * model output and an Edge Function invocation is capped well below that —
 * see generate-job.ts.
 */
export async function genereerSite(
  lead: Lead,
  stijlvoorkeuren: { regel: string; context: string | null }[],
  sectorKennis: { regel: string }[],
  extraInstructies: string | null,
  bestanden: string[] = [],
): Promise<GenerateResult> {
  const client = createAnthropicClient();
  const systemPrompt = bouwSystemPrompt(lead.sector, `${lead.notities ?? ""}
${lead.research_samenvatting ?? ""}`);

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
    extraInstructies,
  ]
    .filter(Boolean)
    .join("\n\n");

  // Same non-streaming + continuation loop as generatie/index.ts (see the
  // comment there): a multi-page site doesn't reliably fit in one answer, and
  // a truncated one is resumed from an assistant prefill rather than raising
  // max_tokens into streaming-only territory.
  let verzameld = "";
  let tokensIn = 0;
  let tokensOut = 0;

  for (let poging = 0; poging < 3; poging++) {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: MAX_OUTPUT_TOKENS,
      system: systemPrompt,
      messages: verzameld
        ? [
            { role: "user", content: userMessage },
            { role: "assistant", content: verzameld },
          ]
        : [{ role: "user", content: userMessage }],
    });

    tokensIn += response.usage.input_tokens;
    tokensOut += response.usage.output_tokens;

    const textBlocks = response.content.filter((b) => b.type === "text");
    const lastText = textBlocks[textBlocks.length - 1];
    if (!lastText || lastText.type !== "text") {
      throw new Error("Geen antwoord ontvangen van generatie-call.");
    }

    verzameld += lastText.text;
    if (response.stop_reason !== "max_tokens") break;
    verzameld = knipNaLaatsteVolledigeSectie(verzameld);

    if (poging === 2) {
      throw new Error("Generatie bleef afgekapt na 3 pogingen — site niet volledig.");
    }
  }

  const bron = parseSiteBron(verzameld);

  return {
    bron,
    paginas: bouwSite(bron, lead.bedrijfsnaam, { bestanden }),
    usage: { model: MODEL, tokensIn, tokensOut },
  };
}

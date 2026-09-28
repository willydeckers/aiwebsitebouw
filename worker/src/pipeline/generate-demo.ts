import { createAnthropicClient, resolveModel } from "../shared/anthropic.js";
import { bouwImageBankPrompt, standaardOgAfbeelding } from "../shared/image-bank.js";
import {
  MAX_OUTPUT_TOKENS,
  MULTIPAGE_PROMPT,
  bouwSite,
  parseSiteBron,
  type AnalyticsGegevens,
  type GebouwdePagina,
  type SeoGegevens,
  type SiteBron,
} from "../shared/site-builder.js";

// Duplicated from supabase/functions/generatie/index.ts's prompt-building
// logic rather than shared across the Deno/Node runtime boundary — the
// review loop needs to regenerate-with-feedback locally in this worker
// (see the note in review-job.ts on why it doesn't call the Edge Function
// for this). Keep the two in sync by hand.

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
bedrijfsinformatie die niet is meegegeven.

Leesbaarheid is een harde regel, en de code meet ze na: zet nooit lichte tekst op een licht vlak of
donkere tekst op een donker vlak. Op wit of een lichte achtergrond (bg-white, bg-*-50 t/m bg-*-200,
een lichte eigen kleur) is tekst minstens *-700, ook voor bijschriften, footertekst en kleine
labels — geen *-300 of *-400 op wit. Witte of lichte tekst hoort enkel op een donker vlak, of op een
foto met een donkere overlay erover. Een lichte of pastel merkkleur gebruik je voor vlakken,
randen en accenten, niet als tekstkleur op wit. Tekst die puur decoratief is (een groot "01" op
de achtergrond) krijgt aria-hidden="true".`;

export type GenerateUsage = { model: string; tokensIn: number; tokensOut: number };

export type Lead = {
  id: string;
  bedrijfsnaam: string;
  sector: string;
  adres: string | null;
  telefoon: string | null;
  notities: string | null;
  research_samenvatting: string | null;
  ai_model: string | null;
};

export type GenerateResult = { bron: SiteBron; paginas: GebouwdePagina[]; usage: GenerateUsage };

/**
 * Canonical/OG/JSON-LD kunnen enkel absolute URL's bevatten, dus zonder
 * DEMO_HOSTING_URL blijven die tags weg in plaats van half ingevuld te zijn.
 * Een eigen logo is het beste deelbeeld; anders een passende bankfoto.
 */
export function bouwSeoGegevens(lead: Lead, bestanden: string[]): SeoGegevens | undefined {
  const hostingBase = (process.env.DEMO_HOSTING_URL ?? "").replace(/\/$/, "");
  if (!hostingBase) return undefined;

  const logo = bestanden.find((b) => /^logo\./i.test(b));
  const briefing = `${lead.notities ?? ""} ${lead.research_samenvatting ?? ""}`;

  return {
    leadId: lead.id,
    hostingBase,
    sector: lead.sector,
    adres: lead.adres,
    telefoon: lead.telefoon,
    ogAfbeelding: logo
      ? `${hostingBase}/${lead.id}/bestanden/${encodeURIComponent(logo)}`
      : standaardOgAfbeelding(lead.sector, briefing),
  };
}

/**
 * Bezoekerscijfers zijn een keuze van het bureau, niet van de klant, dus één
 * omgevingsvariabele in plaats van een kolom per lead: het meetscript koppelt
 * een bezoek aan de hostnaam waar het draait (zie bouwConsentRuntime), en die
 * verschilt vanzelf per klant zodra hun eigen domein gekoppeld is.
 *
 * Staat de variabele niet ingesteld, dan komt er geen meetscript op de site en
 * dus ook geen cookiemelding — precies dezelfde alles-of-niets-lijn als bij
 * DEMO_HOSTING_URL hierboven.
 */
export function bouwAnalyticsGegevens(): AnalyticsGegevens | undefined {
  const scriptUrl = (process.env.ANALYTICS_SCRIPT_URL ?? "").trim();
  return scriptUrl ? { scriptUrl } : undefined;
}

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
    bestanden,
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

  // Streamend, in één antwoord: MAX_OUTPUT_TOKENS is ruim genoeg voor een
  // volledige site, en de SDK laat zo'n plafond enkel streamend toe.
  const model = resolveModel(lead.ai_model);
  const stream = client.messages.stream({
    model,
    max_tokens: MAX_OUTPUT_TOKENS,
    system: systemPrompt,
    messages: [{ role: "user", content: userMessage }],
  });

  const response = await stream.finalMessage();

  if (response.stop_reason === "refusal") {
    throw new Error("De generatie werd door het model geweigerd (stop_reason: refusal).");
  }
  if (response.stop_reason === "max_tokens") {
    throw new Error(
      `Generatie afgekapt op max_tokens (${MAX_OUTPUT_TOKENS}) — site niet volledig.`,
    );
  }

  const textBlocks = response.content.filter((b) => b.type === "text");
  const lastText = textBlocks[textBlocks.length - 1];
  if (!lastText || lastText.type !== "text") {
    throw new Error("Geen antwoord ontvangen van generatie-call.");
  }

  const bron = parseSiteBron(lastText.text);

  return {
    bron,
    paginas: bouwSite(bron, lead.bedrijfsnaam, {
      bestanden,
      seo: bouwSeoGegevens(lead, bestanden),
      analytics: bouwAnalyticsGegevens(),
    }),
    usage: {
      model,
      tokensIn: response.usage.input_tokens,
      tokensOut: response.usage.output_tokens,
    },
  };
}

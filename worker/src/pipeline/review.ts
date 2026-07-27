import { z } from "zod";
import { createAnthropicClient } from "../shared/anthropic.js";

// Spec section 2: review-beoordeling must use a vision-capable model at
// the same tier as generation.
const MODEL = process.env.MODEL_KWALITEIT ?? "claude-opus-4-8";

const ReviewSchema = z.object({
  goedgekeurd: z.boolean(),
  feedback: z.string(),
  mist: z.array(z.string()),
  klopt_niet: z.array(z.string()),
});

export type ReviewResult = z.infer<typeof ReviewSchema>;
export type ReviewUsage = { model: string; tokensIn: number; tokensOut: number };

const SYSTEM_PROMPT = `Je bent de visuele review-stap van een web agency dashboard (spec sectie 3.4).
Beoordeel de bijgevoegde screenshots van een gegenereerde meerpagina-demo-website tegen de
stijlvoorkeuren en de research-samenvatting hieronder. Elke screenshot is gelabeld met de pagina
en het formaat waar hij bij hoort.

Controleer:
- Klopt de getoonde bedrijfsinfo met de research-samenvatting? (geen verzonnen feiten)
- Volgt de site de stijlvoorkeuren?
- Oogt elke pagina professioneel en compleet (geen kapotte lay-out, lege secties,
  placeholder-tekst), zowel op desktop als op mobiel?
- Is elke pagina een volwaardige pagina met eigen inhoud, en niet een bijna lege doorverwijzing?

De navigatiebalk en de footer worden door de code op elke pagina identiek gezet, en de actieve
pagina wordt daar automatisch in gemarkeerd — beoordeel het ontwerp ervan gerust, maar meld geen
verschillen in nav/footer tussen pagina's: die kunnen niet bestaan.

Keur enkel goed als er niets substantieels op aan te merken is op geen enkele screenshot.`;

export type ReviewScreenshot = { label: string; png: Buffer };

export async function reviewDemo(
  screenshots: ReviewScreenshot[],
  context: { bedrijfsnaam: string; sector: string; researchSamenvatting: string | null },
  stijlvoorkeuren: { regel: string }[],
): Promise<{ result: ReviewResult; usage: ReviewUsage }> {
  const client = createAnthropicClient();

  const contextText = [
    `Bedrijfsnaam: ${context.bedrijfsnaam}`,
    `Sector: ${context.sector}`,
    context.researchSamenvatting
      ? `Research-samenvatting:\n${context.researchSamenvatting}`
      : "Geen research-samenvatting beschikbaar.",
    stijlvoorkeuren.length
      ? `Stijlvoorkeuren:\n${stijlvoorkeuren.map((r) => `- ${r.regel}`).join("\n")}`
      : "Geen stijlvoorkeuren geregistreerd.",
  ]
    .filter(Boolean)
    .join("\n\n");

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 2048,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: [
          ...screenshots.flatMap((shot) => [
            { type: "text" as const, text: `${shot.label}:` },
            {
              type: "image" as const,
              source: { type: "base64" as const, media_type: "image/png" as const, data: shot.png.toString("base64") },
            },
          ]),
          { type: "text", text: contextText },
          {
            type: "text",
            text:
              'Antwoord uitsluitend met geldige JSON in exact deze vorm, geen markdown-codeblock: ' +
              '{"goedgekeurd": boolean, "feedback": string, "mist": string[], "klopt_niet": string[]}',
          },
        ],
      },
    ],
  });

  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("Review-call gaf geen tekstantwoord terug.");
  }

  const parsed = ReviewSchema.parse(JSON.parse(textBlock.text));

  return {
    result: parsed,
    usage: { model: MODEL, tokensIn: response.usage.input_tokens, tokensOut: response.usage.output_tokens },
  };
}

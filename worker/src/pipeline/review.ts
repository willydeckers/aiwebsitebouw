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
Beoordeel de bijgevoegde screenshots (desktop + mobiel) van een gegenereerde demo-website tegen
de stijlvoorkeuren en de research-samenvatting hieronder.

Controleer:
- Klopt de getoonde bedrijfsinfo met de research-samenvatting? (geen verzonnen feiten)
- Volgt de site de stijlvoorkeuren?
- Oogt de site professioneel en compleet op beide formaten (geen kapotte lay-out, lege secties,
  placeholder-tekst)?

Keur enkel goed als er niets substantieels op aan te merken is op beide screenshots.`;

export async function reviewDemo(
  desktopScreenshot: Buffer,
  mobielScreenshot: Buffer,
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
          { type: "text", text: "Desktop-screenshot:" },
          {
            type: "image",
            source: { type: "base64", media_type: "image/png", data: desktopScreenshot.toString("base64") },
          },
          { type: "text", text: "Mobiel-screenshot:" },
          {
            type: "image",
            source: { type: "base64", media_type: "image/png", data: mobielScreenshot.toString("base64") },
          },
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

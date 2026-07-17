import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { createAnthropicClient } from "@/lib/anthropic/client";
import type { Lead } from "@/lib/types";
import type { StijlVoorkeur } from "./generate-demo";

const REVIEW_MODEL = "claude-opus-4-8";

const ReviewSchema = z.object({
  goedgekeurd: z.boolean(),
  feedback: z.string(),
  mist: z.array(z.string()),
  klopt_niet: z.array(z.string()),
});

export type ReviewResult = z.infer<typeof ReviewSchema>;

export type ReviewUsage = {
  model: string;
  tokensIn: number;
  tokensOut: number;
};

const SYSTEM_PROMPT = `Je bent de visuele review-stap van een web agency dashboard (spec sectie 3.4).
Beoordeel de bijgevoegde screenshot van een gegenereerde demo-website tegen de
stijlvoorkeuren en de research-output hieronder.

Controleer:
- Klopt de getoonde bedrijfsinfo met de research-output? (geen verzonnen feiten)
- Volgt de site de stijlvoorkeuren?
- Oogt de site professioneel en compleet (geen kapotte lay-out, lege secties, placeholder-tekst)?

Keur enkel goed als er niets substantieels op aan te merken is.`;

export async function reviewDemo(
  screenshot: Buffer,
  lead: Lead,
  stijlvoorkeuren: StijlVoorkeur[],
): Promise<{ result: ReviewResult; usage: ReviewUsage }> {
  const client = createAnthropicClient();

  const contextText = [
    `Bedrijfsnaam: ${lead.bedrijfsnaam}`,
    `Sector: ${lead.sector}`,
    lead.research_output?.bedrijfsverhaal
      ? `Bedrijfsverhaal (research):\n${lead.research_output.bedrijfsverhaal}`
      : "Geen research-output beschikbaar.",
    lead.research_output?.kernfeiten?.length
      ? `Kernfeiten (research):\n${lead.research_output.kernfeiten.map((f) => `- ${f}`).join("\n")}`
      : null,
    stijlvoorkeuren.length > 0
      ? `Stijlvoorkeuren:\n${stijlvoorkeuren.map((r) => `- ${r.regel}`).join("\n")}`
      : "Geen stijlvoorkeuren geregistreerd.",
  ]
    .filter(Boolean)
    .join("\n\n");

  const response = await client.messages.parse({
    model: REVIEW_MODEL,
    max_tokens: 2048,
    system: SYSTEM_PROMPT,
    output_config: { format: zodOutputFormat(ReviewSchema) },
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: {
              type: "base64",
              media_type: "image/png",
              data: screenshot.toString("base64"),
            },
          },
          { type: "text", text: contextText },
        ],
      },
    ],
  });

  if (!response.parsed_output) {
    throw new Error("Review-call gaf geen geldige gestructureerde output terug.");
  }

  return {
    result: response.parsed_output,
    usage: {
      model: REVIEW_MODEL,
      tokensIn: response.usage.input_tokens,
      tokensOut: response.usage.output_tokens,
    },
  };
}

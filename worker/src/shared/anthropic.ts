import Anthropic from "@anthropic-ai/sdk";

export function createAnthropicClient() {
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
}

const USD_PER_MILLION_TOKENS: Record<string, { input: number; output: number }> = {
  "claude-opus-4-8": { input: 5.0, output: 25.0 },
  "claude-haiku-4-5": { input: 1.0, output: 5.0 },
};

const USD_TO_EUR = 0.92;

export function calculateKostEur(model: string, tokensIn: number, tokensOut: number): number {
  const pricing = USD_PER_MILLION_TOKENS[model];
  if (!pricing) {
    throw new Error(`Onbekend model voor kostberekening: ${model}`);
  }
  const usd = (tokensIn / 1_000_000) * pricing.input + (tokensOut / 1_000_000) * pricing.output;
  return usd * USD_TO_EUR;
}

import Anthropic from "npm:@anthropic-ai/sdk@0.112.1";

export function createAnthropicClient() {
  return new Anthropic({ apiKey: Deno.env.get("ANTHROPIC_API_KEY") });
}

// USD price per 1M tokens. Keep in sync met de kopie in
// worker/src/shared/anthropic.ts — elk model dat resolveModel() kan
// teruggeven moet hier staan, anders gooit calculateKostEur() midden in een job.
const USD_PER_MILLION_TOKENS: Record<string, { input: number; output: number }> = {
  "claude-opus-4-8": { input: 5.0, output: 25.0 },
  "claude-sonnet-5": { input: 2.0, output: 10.0 },
  "claude-fable-5": { input: 10.0, output: 50.0 },
  "claude-haiku-4-5": { input: 1.0, output: 5.0 },
};

/**
 * Oplopend naar prijs/zwaarte. Gebruikt om een per-lead keuze terug te schalen
 * voor stappen waar het zwaarste model niet gerechtvaardigd is — zie maxTier.
 */
const MODEL_RANG: Record<string, number> = {
  "claude-haiku-4-5": 0,
  "claude-sonnet-5": 1,
  "claude-opus-4-8": 2,
  "claude-fable-5": 3,
};

/** Zwaarste model dat research/review/chat-edit mogen gebruiken. */
export const MAX_TIER_ONDERSTEUNEND = "claude-opus-4-8";

export function resolveModel(aiModel?: string | null, opties?: { maxTier?: string }): string {
  const gekozen = aiModel || Deno.env.get("MODEL_KWALITEIT") || "claude-opus-4-8";
  const plafond = opties?.maxTier;
  if (plafond && (MODEL_RANG[gekozen] ?? 0) > (MODEL_RANG[plafond] ?? 0)) {
    return plafond;
  }
  return gekozen;
}

const USD_TO_EUR = 0.92;

export function calculateKostEur(model: string, tokensIn: number, tokensOut: number): number {
  const pricing = USD_PER_MILLION_TOKENS[model];
  if (!pricing) {
    throw new Error(`Onbekend model voor kostberekening: ${model}`);
  }
  const usd = (tokensIn / 1_000_000) * pricing.input + (tokensOut / 1_000_000) * pricing.output;
  return usd * USD_TO_EUR;
}

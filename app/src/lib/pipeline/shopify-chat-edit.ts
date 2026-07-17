import Anthropic from "@anthropic-ai/sdk";
import { createAnthropicClient } from "@/lib/anthropic/client";
import { shopifyAdminGraphQL } from "@/lib/shopify/admin-client";

const CHAT_MODEL = "claude-opus-4-8";
const MAX_TOOL_ITERATIONS = 6;

const SYSTEM_PROMPT = `Je bent de chat-based editor voor Shopify-klanten (spec sectie 3.5/3.9).
Warre of Garen typt een gerichte instructie (bv. "voeg product toe: Lentetaart, €18,50") en jij
voert die uit via de shopify_admin_graphql-tool met een gerichte GraphQL-mutation of -query op
de Shopify Admin API. Voer enkel uit wat gevraagd is — geen andere wijzigingen. Rond af zodra de
instructie is doorgevoerd en meld kort wat je deed.`;

const SHOPIFY_TOOL: Anthropic.Tool = {
  name: "shopify_admin_graphql",
  description:
    "Voert een GraphQL query of mutation uit tegen de Shopify Admin API van deze klant se winkel.",
  input_schema: {
    type: "object",
    properties: {
      query: { type: "string", description: "De GraphQL query of mutation." },
      variables: { type: "object", description: "Variabelen voor de query, indien nodig." },
    },
    required: ["query"],
  },
};

export type ShopifyChatUsage = {
  model: string;
  tokensIn: number;
  tokensOut: number;
};

export async function runShopifyChatEdit(
  instruction: string,
  shopDomain: string,
  accessToken: string,
): Promise<{ summary: string; usage: ShopifyChatUsage }> {
  const client = createAnthropicClient();
  let tokensIn = 0;
  let tokensOut = 0;
  let summary = "";

  const messages: Anthropic.MessageParam[] = [
    { role: "user", content: `Instructie: ${instruction}` },
  ];

  for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
    const response = await client.messages.create({
      model: CHAT_MODEL,
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      tools: [SHOPIFY_TOOL],
      messages,
    });

    tokensIn += response.usage.input_tokens;
    tokensOut += response.usage.output_tokens;

    messages.push({ role: "assistant", content: response.content });

    const textBlock = response.content.find((block) => block.type === "text");
    if (textBlock && textBlock.type === "text") {
      summary = textBlock.text;
    }

    if (response.stop_reason !== "tool_use") {
      break;
    }

    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const block of response.content) {
      if (block.type !== "tool_use") continue;
      const input = block.input as { query: string; variables?: Record<string, unknown> };

      try {
        const result = await shopifyAdminGraphQL(
          shopDomain,
          accessToken,
          input.query,
          input.variables ?? {},
        );
        toolResults.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: JSON.stringify(result),
        });
      } catch (err) {
        toolResults.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: err instanceof Error ? err.message : String(err),
          is_error: true,
        });
      }
    }

    messages.push({ role: "user", content: toolResults });
  }

  return { summary, usage: { model: CHAT_MODEL, tokensIn, tokensOut } };
}

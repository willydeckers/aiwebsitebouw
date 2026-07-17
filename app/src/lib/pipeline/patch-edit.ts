import Anthropic from "@anthropic-ai/sdk";
import { createAnthropicClient } from "@/lib/anthropic/client";

const PATCH_MODEL = "claude-opus-4-8";
const VIRTUAL_PATH = "/demo/index.html";
const MAX_TOOL_ITERATIONS = 6;

const SYSTEM_PROMPT = `Je bent de chat-based patch-editor van een web agency dashboard (spec sectie 3.5).
Je krijgt één bestaand HTML-bestand (op pad ${VIRTUAL_PATH}) en een gerichte instructie van
Warre of Garen (bv. "die kleur moet anders"). Dit is GEEN nieuwe generatie: herschrijf niet de
hele pagina. Gebruik uitsluitend str_replace of insert om precies het gevraagde te wijzigen en
niets anders. Rond af zodra de instructie is doorgevoerd.`;

export type PatchUsage = {
  model: string;
  tokensIn: number;
  tokensOut: number;
};

function applyCommand(file: string, input: Record<string, unknown>): string {
  const command = input.command as string;

  if (command === "view") {
    return file;
  }

  if (command === "str_replace") {
    const oldStr = input.old_str as string;
    const newStr = input.new_str as string;
    const count = file.split(oldStr).length - 1;
    if (count === 0) throw new Error("old_str niet gevonden in bestand.");
    if (count > 1) throw new Error(`old_str komt ${count} keer voor — moet uniek zijn.`);
    return file.replace(oldStr, newStr);
  }

  if (command === "insert") {
    const insertLine = input.insert_line as number;
    const insertText = input.insert_text as string;
    const lines = file.split("\n");
    lines.splice(insertLine, 0, insertText);
    return lines.join("\n");
  }

  if (command === "create") {
    return input.file_text as string;
  }

  throw new Error(`Onbekend commando: ${command}`);
}

export async function runPatchEdit(
  currentHtml: string,
  instruction: string,
): Promise<{ html: string; usage: PatchUsage }> {
  const client = createAnthropicClient();
  let file = currentHtml;
  let tokensIn = 0;
  let tokensOut = 0;

  const messages: Anthropic.MessageParam[] = [
    {
      role: "user",
      content: `Instructie: ${instruction}\n\nHet huidige bestand staat op ${VIRTUAL_PATH}.`,
    },
  ];

  for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
    const response = await client.messages.create({
      model: PATCH_MODEL,
      max_tokens: 8000,
      system: SYSTEM_PROMPT,
      tools: [{ type: "text_editor_20250728", name: "str_replace_based_edit_tool" }],
      messages,
    });

    tokensIn += response.usage.input_tokens;
    tokensOut += response.usage.output_tokens;

    messages.push({ role: "assistant", content: response.content });

    if (response.stop_reason !== "tool_use") {
      break;
    }

    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const block of response.content) {
      if (block.type !== "tool_use") continue;
      const input = block.input as Record<string, unknown>;

      try {
        const output = applyCommand(file, input);
        if (input.command !== "view") {
          file = output;
        }
        toolResults.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: input.command === "view" ? output : "OK",
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

  return { html: file, usage: { model: PATCH_MODEL, tokensIn, tokensOut } };
}

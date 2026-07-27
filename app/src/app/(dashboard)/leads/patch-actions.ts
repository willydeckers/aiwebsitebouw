import { createClient } from "@/lib/supabase/client";
import { describeFunctionError } from "@/lib/supabase/function-error";

export type PatchEditResult = {
  error: string | null;
  antwoord: string | null;
  toegepast: boolean;
};

export async function startPatchEdit(leadId: string, instruction: string): Promise<PatchEditResult> {
  const supabase = createClient();
  const { data, error } = await supabase.functions.invoke("chat-edit-static", {
    body: { leadId, instruction },
  });

  if (error) {
    return { error: `Patch-edit mislukt: ${await describeFunctionError(error)}`, antwoord: null, toegepast: false };
  }
  if (data?.error) {
    return { error: data.error as string, antwoord: null, toegepast: false };
  }

  return { error: null, antwoord: (data?.antwoord as string | null) ?? null, toegepast: Boolean(data?.toegepast) };
}

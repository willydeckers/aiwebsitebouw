import { createClient } from "@/lib/supabase/client";
import { describeFunctionError } from "@/lib/supabase/function-error";

export async function startGeneration(
  leadId: string,
  extraInstructies?: string,
): Promise<string | null> {
  const supabase = createClient();
  const { data, error } = await supabase.functions.invoke("generatie", {
    body: { leadId, extraContext: extraInstructies },
  });

  if (error) {
    return `Generatie mislukt: ${await describeFunctionError(error)}`;
  }
  if (data?.error) {
    return data.error as string;
  }

  return null;
}

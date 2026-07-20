import { createClient } from "@/lib/supabase/client";

export async function startGeneration(
  leadId: string,
  extraInstructies?: string,
): Promise<string | null> {
  const supabase = createClient();
  const { data, error } = await supabase.functions.invoke("generatie", {
    body: { leadId, extraContext: extraInstructies },
  });

  if (error) {
    return `Generatie mislukt: ${error.message}`;
  }
  if (data?.error) {
    return data.error as string;
  }

  return null;
}

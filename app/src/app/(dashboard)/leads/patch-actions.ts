import { createClient } from "@/lib/supabase/client";

export async function startPatchEdit(leadId: string, instruction: string): Promise<string | null> {
  const supabase = createClient();
  const { data, error } = await supabase.functions.invoke("chat-edit-static", {
    body: { leadId, instruction },
  });

  if (error) {
    return `Patch-edit mislukt: ${error.message}`;
  }
  if (data?.error) {
    return data.error as string;
  }

  return null;
}

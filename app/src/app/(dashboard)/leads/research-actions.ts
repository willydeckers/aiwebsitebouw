import { createClient } from "@/lib/supabase/client";
import { describeFunctionError } from "@/lib/supabase/function-error";

export async function startResearch(leadId: string): Promise<string | null> {
  const supabase = createClient();
  const { data, error } = await supabase.functions.invoke("research", {
    body: { leadId },
  });

  if (error) {
    return `Research mislukt: ${await describeFunctionError(error)}`;
  }
  if (data?.error) {
    return data.error as string;
  }

  return null;
}

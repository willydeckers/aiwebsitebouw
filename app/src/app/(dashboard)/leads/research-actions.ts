import { createClient } from "@/lib/supabase/client";

export async function startResearch(leadId: string): Promise<string | null> {
  const supabase = createClient();
  const { data, error } = await supabase.functions.invoke("research", {
    body: { leadId },
  });

  if (error) {
    return `Research mislukt: ${error.message}`;
  }
  if (data?.error) {
    return data.error as string;
  }

  return null;
}

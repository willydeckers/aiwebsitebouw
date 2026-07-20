import { createClient } from "@/lib/supabase/client";

export async function sendDemoEmail(
  leadId: string,
  subject: string,
  body: string,
): Promise<string | null> {
  const supabase = createClient();
  const { data, error } = await supabase.functions.invoke("send-email", {
    body: { leadId, subject, body },
  });

  if (error) {
    return `Versturen mislukt: ${error.message}`;
  }
  if (data?.error) {
    return data.error as string;
  }

  return null;
}

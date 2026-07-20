import { createClient } from "@/lib/supabase/client";

export async function generateStaffInvite(klantId: string): Promise<string | null> {
  const supabase = createClient();
  const { data, error } = await supabase.functions.invoke("shopify-staff-invite", {
    body: { klantId, includeOrders: false },
  });

  if (error) {
    return `Uitnodigen mislukt: ${error.message}`;
  }
  if (data?.error) {
    return data.error as string;
  }

  return null;
}

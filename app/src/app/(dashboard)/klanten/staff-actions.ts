import { createClient } from "@/lib/supabase/client";
import { describeFunctionError } from "@/lib/supabase/function-error";

export async function generateStaffInvite(klantId: string): Promise<string | null> {
  const supabase = createClient();
  const { data, error } = await supabase.functions.invoke("shopify-staff-invite", {
    body: { klantId, includeOrders: false },
  });

  if (error) {
    return `Uitnodigen mislukt: ${await describeFunctionError(error)}`;
  }
  if (data?.error) {
    return data.error as string;
  }

  return null;
}

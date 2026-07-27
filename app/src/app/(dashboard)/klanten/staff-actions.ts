import { createClient } from "@/lib/supabase/client";
import { describeFunctionError } from "@/lib/supabase/function-error";

export type StaffInviteResultaat =
  | { soort: "fout"; bericht: string }
  | { soort: "handmatig"; reden: string; instructies: string[] }
  | { soort: "genoteerd" };

/**
 * Two-step, because Shopify has no API for this: the Admin API exposes no
 * staff-invite mutation at any plan level (validated against the live schema
 * on 2026-07-27). The first call returns the steps to take in the Shopify
 * admin; the second records that they were taken. Flipping the klant to
 * "Uitgenodigd" without anyone having actually invited them would put a lie in
 * the dashboard.
 */
export async function generateStaffInvite(
  klantId: string,
  includeOrders = false,
  bevestigdHandmatigVerstuurd = false,
): Promise<StaffInviteResultaat> {
  const supabase = createClient();
  const { data, error } = await supabase.functions.invoke("shopify-staff-invite", {
    body: { klantId, includeOrders, bevestigdHandmatigVerstuurd },
  });

  if (error) {
    return { soort: "fout", bericht: `Uitnodigen mislukt: ${await describeFunctionError(error)}` };
  }
  if (data?.error) {
    return { soort: "fout", bericht: data.error as string };
  }
  if (data?.ok === false && data?.handmatig) {
    return {
      soort: "handmatig",
      reden: data.reden as string,
      instructies: (data.instructies ?? []) as string[],
    };
  }

  return { soort: "genoteerd" };
}

"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { inviteStaffMember } from "@/lib/shopify/invite-staff";
import type { Lead } from "@/lib/types";

type KlantWithLead = {
  id: string;
  type: "statisch" | "shopify";
  shopify_domain: string | null;
  shopify_access_token: string | null;
  lead: Lead;
};

export async function generateStaffInvite(klantId: string): Promise<string | null> {
  const supabase = await createClient();

  const { data: klantRow, error } = await supabase
    .from("klanten")
    .select("id, type, shopify_domain, shopify_access_token, lead:leads(*)")
    .eq("id", klantId)
    .single();

  if (error || !klantRow) {
    return `Klant niet gevonden: ${error?.message}`;
  }

  const klant = klantRow as unknown as KlantWithLead;

  if (klant.type !== "shopify") {
    return "Staff-uitnodigingen zijn enkel voor shopify-klanten.";
  }

  if (!klant.shopify_domain || !klant.shopify_access_token) {
    return "Shopify-koppeling ontbreekt nog voor deze klant.";
  }

  if (!klant.lead.contact_email) {
    return "Deze klant heeft geen contact e-mailadres om naartoe uit te nodigen.";
  }

  try {
    await inviteStaffMember(
      klant.shopify_domain,
      klant.shopify_access_token,
      klant.lead.contact_email,
      false,
    );

    await supabase
      .from("klanten")
      .update({ shopify_staff_account_status: "Uitgenodigd" })
      .eq("id", klantId);
  } catch (err) {
    return `Uitnodigen mislukt: ${err instanceof Error ? err.message : String(err)}`;
  }

  revalidatePath("/klanten");
  return null;
}

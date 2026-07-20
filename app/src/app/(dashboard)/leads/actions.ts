import { createClient } from "@/lib/supabase/client";
import { logAudit } from "@/lib/audit";

export async function createLead(_prevState: string | null, formData: FormData) {
  const bedrijfsnaam = (formData.get("bedrijfsnaam") as string)?.trim();
  const sector = (formData.get("sector") as string)?.trim();
  const adres = (formData.get("adres") as string)?.trim() || null;
  const contact_email = (formData.get("contact_email") as string)?.trim() || null;
  const contact_naam = (formData.get("contact_naam") as string)?.trim() || null;
  const notities = (formData.get("notities") as string)?.trim() || null;

  if (!bedrijfsnaam || !sector) {
    return "Bedrijfsnaam en sector zijn verplicht.";
  }

  const supabase = createClient();
  const { data, error } = await supabase
    .from("leads")
    .insert({
      bedrijfsnaam,
      sector,
      adres,
      contact_email,
      contact_naam,
      notities,
      herkomst: "manueel",
    })
    .select("id")
    .single();

  if (error) {
    return `Aanmaken mislukt: ${error.message}`;
  }

  await logAudit("lead_aangemaakt", data.id, { bedrijfsnaam });

  return null;
}

export async function updateLeadNotities(leadId: string, notities: string) {
  const supabase = createClient();
  const { error } = await supabase
    .from("leads")
    .update({ notities })
    .eq("id", leadId);

  if (error) {
    return `Opslaan mislukt: ${error.message}`;
  }

  return null;
}

// Storage cleanup (spec section 6/7/9) can't happen from the client — it
// needs to list+remove every Storage object for this lead before the row
// itself goes away, so this delegates to the cleanup-storage Edge Function
// rather than a plain `.delete()` call.
export async function deleteLead(leadId: string, bedrijfsnaam: string): Promise<string | null> {
  // Logged before the delete: audit_log.lead_id references leads(id), and
  // that row won't exist anymore once cleanup-storage succeeds (the FK's
  // "on delete set null" then nulls this row out automatically, keeping
  // the audit trail without a dangling reference).
  await logAudit("lead_verwijderd", leadId, { bedrijfsnaam });

  const supabase = createClient();
  const { data, error } = await supabase.functions.invoke("cleanup-storage", {
    body: { leadId },
  });

  if (error) {
    return `Verwijderen mislukt: ${error.message}`;
  }
  if (data?.error) {
    return data.error as string;
  }

  return null;
}

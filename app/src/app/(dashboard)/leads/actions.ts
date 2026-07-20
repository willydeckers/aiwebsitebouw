import { createClient } from "@/lib/supabase/client";

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
  const { error } = await supabase.from("leads").insert({
    bedrijfsnaam,
    sector,
    adres,
    contact_email,
    contact_naam,
    notities,
    herkomst: "manueel",
  });

  if (error) {
    return `Aanmaken mislukt: ${error.message}`;
  }

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

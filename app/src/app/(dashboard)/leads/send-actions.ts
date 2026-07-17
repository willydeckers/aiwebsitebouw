"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { sendEmail } from "@/lib/gmail/client";
import type { Lead } from "@/lib/types";

export async function sendDemoEmail(
  leadId: string,
  subject: string,
  body: string,
): Promise<string | null> {
  const supabase = await createClient();

  const { data: leadRow, error } = await supabase
    .from("leads")
    .select("*")
    .eq("id", leadId)
    .single();

  if (error || !leadRow) {
    return `Lead niet gevonden: ${error?.message}`;
  }

  const lead = leadRow as Lead;

  if (!lead.contact_email) {
    return "Deze lead heeft geen contact e-mailadres.";
  }

  if (lead.status !== "klaar") {
    return "Enkel leads met status 'Klaar' kunnen verstuurd worden.";
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const trackingUrl = `${appUrl}/api/track/${leadId}`;

  const html = `${body}\n\n<p><a href="${trackingUrl}">Bekijk je website</a></p>`;

  try {
    await sendEmail({ to: lead.contact_email, subject, html });
  } catch (err) {
    return `Versturen mislukt: ${err instanceof Error ? err.message : String(err)}`;
  }

  await supabase.from("email_events").insert({ lead_id: leadId, type: "verzonden" });
  await supabase.from("leads").update({ status: "verzonden" }).eq("id", leadId);

  revalidatePath("/leads");
  revalidatePath("/verstuurd");
  return null;
}

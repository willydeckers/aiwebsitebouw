import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { sendEmail } from "@/lib/gmail/client";

// Public, unauthenticated endpoint — a lead's email client hits this link.
// Redirect target always comes from the lead row we fetch server-side
// (never from a client-supplied param), and is whitelisted against our own
// Supabase Storage origin, so there is no open-redirect surface (spec
// section 6).
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ leadId: string }> },
) {
  const { leadId } = await params;
  const supabase = createServiceClient();

  const { data: lead } = await supabase
    .from("leads")
    .select("*")
    .eq("id", leadId)
    .single();

  if (!lead?.demo_url) {
    return NextResponse.json({ error: "Onbekende of ongeldige tracking-link." }, { status: 404 });
  }

  const allowedOrigin = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!).origin;
  const demoOrigin = new URL(lead.demo_url).origin;
  if (demoOrigin !== allowedOrigin) {
    return NextResponse.json({ error: "Demo-domein niet toegestaan." }, { status: 400 });
  }

  await supabase.from("email_events").insert({ lead_id: leadId, type: "geopend" });
  await supabase.from("leads").update({ status: "geopend" }).eq("id", leadId);

  const internalRecipient = process.env.GMAIL_SENDER_EMAIL;
  if (internalRecipient) {
    try {
      await sendEmail({
        to: internalRecipient,
        subject: `${lead.bedrijfsnaam} heeft je website geopend`,
        html: `<p><strong>${lead.bedrijfsnaam}</strong> heeft de demo geopend.</p>`,
      });
    } catch {
      // Notification failure shouldn't block the lead's redirect to the demo.
    }
  }

  return NextResponse.redirect(lead.demo_url);
}

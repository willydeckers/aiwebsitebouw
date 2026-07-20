import { handleCorsPreflight, corsHeaders } from "../_shared/cors.ts";
import { requireUser } from "../_shared/supabase-clients.ts";
import { decryptToken } from "../_shared/crypto.ts";
import { sendGmail } from "../_shared/gmail.ts";
import { gebruikerFromEmail } from "../_shared/gebruiker.ts";

Deno.serve(async (req) => {
  const preflight = handleCorsPreflight(req);
  if (preflight) return preflight;

  try {
    const { supabase, user } = await requireUser(req);
    const { leadId, subject, body } = await req.json();

    const { data: lead, error: leadError } = await supabase
      .from("leads")
      .select("*")
      .eq("id", leadId)
      .single();

    if (leadError || !lead) throw new Error(`Lead niet gevonden: ${leadError?.message}`);
    if (!lead.contact_email) throw new Error("Deze lead heeft geen contact e-mailadres.");
    if (lead.status !== "klaar") throw new Error("Enkel leads met status 'Klaar' kunnen verstuurd worden.");

    const gebruiker = gebruikerFromEmail(user.email);
    const { data: koppeling, error: koppelingError } = await supabase
      .from("gmail_koppeling")
      .select("*")
      .eq("gebruiker", gebruiker)
      .maybeSingle();

    if (koppelingError || !koppeling || koppeling.status !== "actief" || !koppeling.refresh_token) {
      throw new Error(
        `Gmail is nog niet gekoppeld voor ${gebruiker} (spec 2/7) — koppel dit eerst via Voorkeuren.`,
      );
    }

    const refreshToken = await decryptToken(new Uint8Array(koppeling.refresh_token));

    const hostingBase = Deno.env.get("DEMO_HOSTING_URL") ?? "";
    const trackingUrl = `${hostingBase}/t/${leadId}`;
    const html = `${body}\n\n<p><a href="${trackingUrl}">Bekijk je website</a></p>`;

    await sendGmail({ refreshToken, from: user.email!, to: lead.contact_email, subject, html });

    await supabase.from("email_events").insert({ lead_id: leadId, type: "verzonden" });
    await supabase
      .from("leads")
      .update({ status: "verzonden", laatst_bewerkt_door: user.email })
      .eq("id", leadId);

    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ error: message }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

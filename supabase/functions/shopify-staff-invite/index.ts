import { handleCorsPreflight, corsHeaders } from "../_shared/cors.ts";
import { requireUser } from "../_shared/supabase-clients.ts";

// Spec section 4: "Shopify staff-account, rechten beperkt tot Producten
// (+ optioneel Bestellingen)". That cannot be automated.
//
// A `staffMemberInvite` mutation used to live here, written from recollection
// and flagged as unverified. Validated against the live Admin API schema on
// 2026-07-27: the mutation does not exist. `StaffMember` is a read-only type,
// and even reading it needs the `read_users` scope, which Shopify only grants
// to finance embedded apps or apps on Plus/Advanced stores. There is no
// invite endpoint at any plan level.
//
// Inviting staff is done in the Shopify admin (Settings > Users). This
// function therefore records that the invite was sent by hand, so the
// klanten row still reflects reality, instead of pretending to send one.

Deno.serve(async (req) => {
  const preflight = handleCorsPreflight(req);
  if (preflight) return preflight;

  try {
    const { supabase } = await requireUser(req);
    const { klantId, includeOrders, bevestigdHandmatigVerstuurd } = await req.json();

    const { data: klant, error } = await supabase
      .from("klanten")
      .select("id, type, lead_id, shopify_domain, lead:leads(contact_email)")
      .eq("id", klantId)
      .single();

    if (error || !klant) throw new Error(`Klant niet gevonden: ${error?.message}`);
    if (klant.type !== "shopify") throw new Error("Staff-uitnodigingen zijn enkel voor shopify-klanten.");
    if (!klant.shopify_domain) {
      throw new Error("Shopify-koppeling ontbreekt nog voor deze klant.");
    }

    const contactEmail = (klant.lead as unknown as { contact_email: string | null })?.contact_email;
    if (!contactEmail) throw new Error("Deze klant heeft geen contact e-mailadres om naartoe uit te nodigen.");

    const rechten = includeOrders ? "Producten en Bestellingen" : "Producten";
    const instructies = [
      `Open https://${klant.shopify_domain}/admin/settings/account`,
      `Klik "Add staff" en nodig ${contactEmail} uit.`,
      `Vink enkel de rechten aan voor: ${rechten}.`,
    ];

    // Two-step on purpose: the first call returns what to do, the second
    // records that it was done. Marking the klant as "Uitgenodigd" without
    // anyone actually having invited them would be a lie in the dashboard.
    if (!bevestigdHandmatigVerstuurd) {
      return new Response(
        JSON.stringify({
          ok: false,
          handmatig: true,
          reden:
            "De Shopify Admin API heeft geen mutation om staff uit te nodigen — dat kan enkel via de " +
            "Shopify-beheerder zelf.",
          instructies,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    await supabase.from("klanten").update({ shopify_staff_account_status: "Uitgenodigd" }).eq("id", klantId);

    return new Response(JSON.stringify({ ok: true, handmatig: true }), {
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

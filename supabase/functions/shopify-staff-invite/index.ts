import { handleCorsPreflight, corsHeaders } from "../_shared/cors.ts";
import { requireUser } from "../_shared/supabase-clients.ts";
import { shopifyAdminGraphQL } from "../_shared/shopify.ts";

// NOTE: same caveat as the Node version this replaces — the exact
// staffMemberInvite mutation shape is written from best-effort recollection,
// not verified against live Shopify Admin API docs. Confirm before relying
// on this in production.
const STAFF_INVITE_MUTATION = `
  mutation StaffMemberInvite($email: String!, $permissions: [StaffMemberPermission!]!) {
    staffMemberInvite(email: $email, permissions: $permissions) {
      staffMemberInvite { id }
      userErrors { field message }
    }
  }
`;

Deno.serve(async (req) => {
  const preflight = handleCorsPreflight(req);
  if (preflight) return preflight;

  try {
    const { supabase } = await requireUser(req);
    const { klantId, includeOrders } = await req.json();

    const { data: klant, error } = await supabase
      .from("klanten")
      .select("id, type, shopify_domain, shopify_access_token, lead:leads(contact_email)")
      .eq("id", klantId)
      .single();

    if (error || !klant) throw new Error(`Klant niet gevonden: ${error?.message}`);
    if (klant.type !== "shopify") throw new Error("Staff-uitnodigingen zijn enkel voor shopify-klanten.");
    if (!klant.shopify_domain || !klant.shopify_access_token) {
      throw new Error("Shopify-koppeling ontbreekt nog voor deze klant.");
    }

    const contactEmail = (klant.lead as unknown as { contact_email: string | null })?.contact_email;
    if (!contactEmail) throw new Error("Deze klant heeft geen contact e-mailadres om naartoe uit te nodigen.");

    const permissions = includeOrders ? ["PRODUCTS", "ORDERS"] : ["PRODUCTS"];

    const data = await shopifyAdminGraphQL<{
      staffMemberInvite: { staffMemberInvite: { id: string } | null; userErrors: { message: string }[] };
    }>(klant.shopify_domain, klant.shopify_access_token, STAFF_INVITE_MUTATION, {
      email: contactEmail,
      permissions,
    });

    if (data.staffMemberInvite.userErrors.length > 0) {
      throw new Error(
        `Kon staff-uitnodiging niet versturen: ${data.staffMemberInvite.userErrors.map((e) => e.message).join("; ")}`,
      );
    }

    await supabase.from("klanten").update({ shopify_staff_account_status: "Uitgenodigd" }).eq("id", klantId);

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

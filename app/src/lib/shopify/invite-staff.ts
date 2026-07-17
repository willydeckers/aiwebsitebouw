import { shopifyAdminGraphQL } from "./admin-client";

// NOTE: same caveat as create-dev-store.ts — the exact staffMemberInvite
// mutation shape (name, permission enum values) is written from best-effort
// recollection, not verified against live Shopify Admin API docs. Confirm
// against https://shopify.dev/docs/api/admin-graphql before relying on this.
const STAFF_INVITE_MUTATION = `
  mutation StaffMemberInvite($email: String!, $permissions: [StaffMemberPermission!]!) {
    staffMemberInvite(email: $email, permissions: $permissions) {
      staffMemberInvite {
        id
      }
      userErrors {
        field
        message
      }
    }
  }
`;

type StaffMemberInviteResponse = {
  staffMemberInvite: {
    staffMemberInvite: { id: string } | null;
    userErrors: { field: string[]; message: string }[];
  };
};

/**
 * Spec section 3.9: scoped to Products (+ optional Orders), never full
 * access — this is the only form of "customer access" that exists, and it
 * runs through Shopify itself, not this dashboard.
 */
export async function inviteStaffMember(
  shopDomain: string,
  accessToken: string,
  email: string,
  includeOrders: boolean,
): Promise<{ inviteId: string }> {
  const permissions = includeOrders ? ["PRODUCTS", "ORDERS"] : ["PRODUCTS"];

  const data = await shopifyAdminGraphQL<StaffMemberInviteResponse>(
    shopDomain,
    accessToken,
    STAFF_INVITE_MUTATION,
    { email, permissions },
  );

  const { staffMemberInvite, userErrors } = data.staffMemberInvite;

  if (userErrors.length > 0) {
    throw new Error(
      `Kon staff-uitnodiging niet versturen: ${userErrors.map((e) => e.message).join("; ")}`,
    );
  }

  if (!staffMemberInvite) {
    throw new Error("Geen uitnodiging teruggekregen van de Admin API.");
  }

  return { inviteId: staffMemberInvite.id };
}

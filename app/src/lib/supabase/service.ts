import { createClient } from "@supabase/supabase-js";

/**
 * Service-role client — bypasses RLS. Only for server-only code that must
 * run without an authenticated dashboard session, like the public tracking
 * redirect a lead's email client hits (spec section 6: writes stay
 * server-side; this key must never reach the browser bundle).
 */
export function createServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

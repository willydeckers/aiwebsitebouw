import type { SupabaseClient } from "@supabase/supabase-js";

// Who is logged in, read locally.
//
// This exists to replace auth.getUser() on paths that only want an email to
// stamp on a row. getUser() is a network call that validates the token with
// Supabase, and when the refresh behind it fails, supabase-js drops the
// session and emits SIGNED_OUT — which logs the user out. Doing that eight
// times per interaction, purely to learn an address we already hold, is eight
// chances to be thrown out of the app mid-click for no reason the user can see.
//
// getSession() reads what is already in storage. Use getUser() only where the
// point IS to verify the token server-side; nothing here does.
export async function huidigEmail(supabase: SupabaseClient): Promise<string | null> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  return session?.user.email ?? null;
}

import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

// One client for the whole tab.
//
// createBrowserClient is singleton-by-default in the browser, but 32 call
// sites relying on that implicitly is a lot of trust to place in a default
// that can change. Holding the instance here makes it explicit, and rules out
// two clients ever running their own token-refresh timers against the same
// refresh token — which ends with one of them getting
// "refresh_token_already_used" and signing the user out mid-session.
let client: SupabaseClient | null = null;

export function createClient(): SupabaseClient {
  if (!client) {
    client = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    );
  }
  return client;
}

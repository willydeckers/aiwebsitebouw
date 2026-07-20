import { createClient } from "@supabase/supabase-js";

// The worker is a trusted backend process (not a per-user session), so it
// uses the service-role key directly — there's no RLS-scoped caller here
// the way there is in an Edge Function invoked from the app.
export function createWorkerClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("SUPABASE_URL en SUPABASE_SERVICE_ROLE_KEY zijn verplicht.");
  }
  return createClient(url, key);
}

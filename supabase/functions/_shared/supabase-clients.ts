import { createClient } from "npm:@supabase/supabase-js@2";

/**
 * Client scoped to the caller's own JWT (forwarded by supabase-js's
 * functions.invoke() automatically) — respects RLS exactly like the old
 * Next.js server-side client did. Use this for everything by default.
 */
export function createCallerClient(req: Request) {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    throw new Error("Ontbrekende Authorization-header — niet ingelogd?");
  }

  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } },
  );
}

/**
 * Service-role client — bypasses RLS. Only for operations RLS genuinely
 * can't express (Storage object management, auth admin calls). Never
 * expose this key outside an Edge Function.
 */
export function createServiceClient() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
}

export async function requireUser(req: Request) {
  const supabase = createCallerClient(req);
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error("Niet geauthenticeerd.");
  }

  return { supabase, user };
}

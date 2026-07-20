import { handleCorsPreflight, corsHeaders } from "../_shared/cors.ts";
import { requireUser } from "../_shared/supabase-clients.ts";
import { encryptToken } from "../_shared/crypto.ts";
import { gebruikerFromEmail } from "../_shared/gebruiker.ts";

// Spec section 2: "aparte OAuth-koppeling per gebruiker, scope gmail.send."
// The authorization-code exchange needs GOOGLE_OAUTH_CLIENT_SECRET, which
// must stay server-side — this is why the static app's /gmail-callback
// page hands the raw `code` off to this function instead of exchanging it
// directly in the browser.
Deno.serve(async (req) => {
  const preflight = handleCorsPreflight(req);
  if (preflight) return preflight;

  try {
    const { supabase, user } = await requireUser(req);
    const { code, redirectUri } = await req.json();
    if (!code || !redirectUri) throw new Error("code en redirectUri zijn verplicht.");

    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: Deno.env.get("GOOGLE_OAUTH_CLIENT_ID")!,
        client_secret: Deno.env.get("GOOGLE_OAUTH_CLIENT_SECRET")!,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }),
    });

    const tokenJson = await tokenResponse.json();
    if (!tokenResponse.ok) {
      throw new Error(`Gmail-koppeling mislukt: ${JSON.stringify(tokenJson)}`);
    }
    if (!tokenJson.refresh_token) {
      // Google only returns a refresh_token on the *first* consent (or
      // when prompt=consent forces re-consent) — the /gmail-callback page
      // always requests access_type=offline&prompt=consent for exactly
      // this reason, but a stale/replayed code could still land here.
      throw new Error(
        "Geen refresh_token ontvangen van Google — koppel opnieuw (prompt=consent zorgt normaal voor een refresh_token).",
      );
    }

    const encrypted = await encryptToken(tokenJson.refresh_token as string);
    const gebruiker = gebruikerFromEmail(user.email);

    const { error } = await supabase
      .from("gmail_koppeling")
      .upsert(
        { gebruiker, refresh_token: encrypted, gekoppeld_op: new Date().toISOString(), status: "actief" },
        { onConflict: "gebruiker" },
      );
    if (error) throw new Error(`Kon koppeling niet opslaan: ${error.message}`);

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

import { createServiceClient } from "../_shared/supabase-clients.ts";
import { decryptToken } from "../_shared/crypto.ts";
import { sendGmail } from "../_shared/gmail.ts";
import { gebruikerFromEmail } from "../_shared/gebruiker.ts";

// Spec section 2: the public hosting layer. No auth, no CORS preflight
// needed — this is loaded directly by a lead's browser, not called via
// supabase-js from the app. Routes, distinguished by path:
//   /{leadId}/               -> serve index.html of the actieve site_versions
//   /{leadId}/{bestand}.html -> serve that page of the same version
//   /t/{leadId}              -> log the open, notify Warre/Garen once, redirect above
//
// The trailing slash on the first route is load-bearing, not cosmetic: the
// generated pages link to each other with plain relative hrefs
// ("over-ons.html") so the same files also work opened straight from disk or
// on any static host. A browser resolves those against the *directory* of the
// current URL — from `/{leadId}` that's the parent, giving a 404, while from
// `/{leadId}/` it's exactly the folder the other pages live in. So a request
// without the slash gets redirected to add it.

async function notifyOpened(
  supabase: ReturnType<typeof createServiceClient>,
  lead: { bedrijfsnaam: string },
  leadId: string,
) {
  const { data: users } = await supabase.auth.admin.listUsers();
  const recipients = (users?.users ?? []).map((u) => u.email).filter((e): e is string => !!e);
  if (recipients.length === 0) return;

  const { data: koppeling } = await supabase
    .from("gmail_koppeling")
    .select("*")
    .eq("status", "actief")
    .not("refresh_token", "is", null)
    .limit(1)
    .maybeSingle();
  if (!koppeling) return; // No connected Gmail account yet (task: OAuth linking) — skip notification, don't fail the redirect.

  const sender = (users?.users ?? []).find((u) => gebruikerFromEmail(u.email) === koppeling.gebruiker);
  if (!sender?.email) return;

  const refreshToken = await decryptToken(new Uint8Array(koppeling.refresh_token));
  const hostingBase = Deno.env.get("DEMO_HOSTING_URL") ?? "";

  await sendGmail({
    refreshToken,
    from: sender.email,
    to: recipients.join(", "),
    subject: `Geopend: ${lead.bedrijfsnaam}`,
    html: `<p>${lead.bedrijfsnaam} heeft net de demo geopend.</p><p><a href="${hostingBase}/${leadId}/">Bekijk de demo</a></p>`,
  });
}

async function handleTrack(
  supabase: ReturnType<typeof createServiceClient>,
  leadId: string,
  url: URL,
): Promise<Response> {
  const { data: lead } = await supabase
    .from("leads")
    .select("bedrijfsnaam, status")
    .eq("id", leadId)
    .maybeSingle();

  if (lead) {
    await supabase.from("email_events").insert({ lead_id: leadId, type: "geopend" });

    // Only transition + notify on the first open — status is 'verzonden'
    // exactly once; every open thereafter still logs an email_events row
    // above but doesn't re-fire the notification.
    if (lead.status === "verzonden") {
      await supabase.from("leads").update({ status: "geopend" }).eq("id", leadId);
      await notifyOpened(supabase, lead, leadId);
    }
  }

  const newPath = url.pathname.replace(/\/t\/[^/]+\/?$/, `/${leadId}/`);
  return Response.redirect(`${url.origin}${newPath}`, 302);
}

async function handleServe(
  supabase: ReturnType<typeof createServiceClient>,
  leadId: string,
  bestand: string | null,
): Promise<Response> {
  const { data: lead } = await supabase
    .from("leads")
    .select("klant_type")
    .eq("id", leadId)
    .maybeSingle();

  if (!lead) return new Response("Lead niet gevonden.", { status: 404 });
  if (lead.klant_type === "shopify") {
    // Spec section 2: "Voor shopify-klanten is deze laag niet nodig" —
    // Shopify serves its own store domain directly, this route should
    // never actually be linked for them.
    return new Response("Shopify-klanten worden rechtstreeks door Shopify bediend.", { status: 404 });
  }

  const { data: siteVersion } = await supabase
    .from("site_versions")
    .select("content_referentie, paginas")
    .eq("lead_id", leadId)
    .eq("status", "actief")
    .maybeSingle();

  if (!siteVersion?.content_referentie) {
    return new Response("Nog geen actieve versie beschikbaar voor deze lead.", { status: 404 });
  }

  const paginas = (siteVersion.paginas ?? []) as { bestand: string }[];
  let pad = siteVersion.content_referentie;

  if (bestand && bestand !== "index.html") {
    // Only files this version actually declares are servable — no arbitrary
    // path lands in a Storage download call from a public, unauthenticated
    // route, and a stale link to a page a re-generation dropped 404s
    // instead of leaking whatever else happens to sit in the bucket.
    if (!paginas.some((p) => p.bestand === bestand)) {
      return new Response("Pagina niet gevonden.", { status: 404 });
    }
    pad = `${siteVersion.content_referentie.replace(/\/index\.html$/, "")}/${bestand}`;
  }

  const { data: file, error } = await supabase.storage.from("demos").download(pad);
  if (error || !file) {
    return new Response(`Kon demo-bestand niet ophalen: ${error?.message}`, { status: 500 });
  }

  return new Response(await file.text(), { headers: { "Content-Type": "text/html; charset=utf-8" } });
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const segments = url.pathname.split("/").filter((s) => s && s !== "track-and-serve");

  const supabase = createServiceClient();

  try {
    if (segments[0] === "t" && segments[1]) {
      return await handleTrack(supabase, segments[1], url);
    }
    if (segments[0]) {
      // `/{leadId}` (no trailing slash, no page) can't serve the site
      // directly — see the header comment on relative-link resolution.
      if (!segments[1] && !url.pathname.endsWith("/")) {
        return Response.redirect(`${url.origin}${url.pathname}/${url.search}`, 302);
      }
      return await handleServe(supabase, segments[0], segments[1] ?? null);
    }
    return new Response("Not found", { status: 404 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return new Response(message, { status: 500 });
  }
});

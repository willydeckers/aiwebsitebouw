import { createServiceClient } from "../_shared/supabase-clients.ts";
import { decryptToken } from "../_shared/crypto.ts";
import { sendGmail } from "../_shared/gmail.ts";
import { gebruikerFromEmail } from "../_shared/gebruiker.ts";
import {
  hashCode,
  heeftToegang,
  toegangCookieHeader,
  toegangFormulier,
} from "../_shared/site-toegang.ts";

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

type Pagina = { bestand: string; toegang?: "publiek" | "beveiligd" };

const JSON_HEADERS = { "Content-Type": "application/json; charset=utf-8" };

/** Salted hash of the caller's address: enough to rate-limit one flooding
 *  source, not enough to identify a visitor afterwards. */
async function afzenderHash(req: Request, leadId: string): Promise<string> {
  const adres =
    req.headers.get("cf-connecting-ip") ??
    req.headers.get("x-forwarded-for")?.split(",")[0].trim() ??
    "onbekend";
  return await hashCode(adres, `afzender:${leadId}`);
}

// ─────────────────────────────────────────────────────────────────────────
// Form submissions from a generated site
// ─────────────────────────────────────────────────────────────────────────
const MAX_INZENDINGEN_PER_UUR = 5;
const VELD_MAX = 5000;

async function handleFormulier(
  supabase: ReturnType<typeof createServiceClient>,
  req: Request,
  leadId: string,
): Promise<Response> {
  const { data: lead } = await supabase.from("leads").select("id").eq("id", leadId).maybeSingle();
  if (!lead) return new Response(JSON.stringify({ error: "Onbekende site." }), { status: 404, headers: JSON_HEADERS });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Ongeldige inzending." }), { status: 400, headers: JSON_HEADERS });
  }

  // Honeypot: a real visitor never fills a field that's positioned off-screen
  // and marked aria-hidden. Answer 200 anyway — telling a bot it was detected
  // just teaches it to skip the field next time.
  if (typeof body.website === "string" && body.website.trim() !== "") {
    return new Response(JSON.stringify({ ok: true }), { headers: JSON_HEADERS });
  }

  const soort = ["contact", "offerte", "review"].includes(String(body.soort)) ? String(body.soort) : "contact";
  const tekst = (sleutel: string): string | null => {
    const waarde = body[sleutel];
    if (typeof waarde !== "string") return null;
    const schoon = waarde.trim().slice(0, VELD_MAX);
    return schoon === "" ? null : schoon;
  };

  const bericht = tekst("bericht") ?? tekst("boodschap") ?? tekst("vraag");
  if (!bericht && soort !== "review") {
    return new Response(JSON.stringify({ error: "Vul een bericht in." }), { status: 400, headers: JSON_HEADERS });
  }

  const hash = await afzenderHash(req, leadId);
  const sinds = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { count } = await supabase
    .from("site_inzendingen")
    .select("id", { count: "exact", head: true })
    .eq("lead_id", leadId)
    .eq("afzender_hash", hash)
    .gte("aangemaakt_op", sinds);

  if ((count ?? 0) >= MAX_INZENDINGEN_PER_UUR) {
    return new Response(JSON.stringify({ error: "Te veel inzendingen. Probeer het later opnieuw." }), {
      status: 429,
      headers: JSON_HEADERS,
    });
  }

  const scoreRuw = Number(body.score);
  const bekend = new Set(["naam", "email", "bericht", "boodschap", "vraag", "score", "soort", "website"]);
  const extra = Object.fromEntries(
    Object.entries(body)
      .filter(([sleutel, waarde]) => !bekend.has(sleutel) && typeof waarde === "string")
      .map(([sleutel, waarde]) => [sleutel, String(waarde).slice(0, VELD_MAX)]),
  );

  const { error } = await supabase.from("site_inzendingen").insert({
    lead_id: leadId,
    soort,
    naam: tekst("naam"),
    email: tekst("email"),
    bericht,
    score: Number.isInteger(scoreRuw) && scoreRuw >= 1 && scoreRuw <= 5 ? scoreRuw : null,
    extra: Object.keys(extra).length ? extra : null,
    afzender_hash: hash,
  });

  if (error) {
    return new Response(JSON.stringify({ error: "Kon de inzending niet bewaren." }), {
      status: 500,
      headers: JSON_HEADERS,
    });
  }

  return new Response(JSON.stringify({ ok: true }), { headers: JSON_HEADERS });
}

/** Approved reviews only — a submitted review is never publicly visible until
 *  Warre or Garen approves it in the app. */
async function handleReviews(
  supabase: ReturnType<typeof createServiceClient>,
  leadId: string,
): Promise<Response> {
  const { data } = await supabase
    .from("site_inzendingen")
    .select("naam, bericht, score, aangemaakt_op")
    .eq("lead_id", leadId)
    .eq("soort", "review")
    .eq("status", "goedgekeurd")
    .order("aangemaakt_op", { ascending: false })
    .limit(20);

  const reviews = (data ?? []).map((r) => ({
    naam: r.naam,
    tekst: r.bericht,
    score: r.score ?? 5,
    datum: r.aangemaakt_op,
  }));

  return new Response(JSON.stringify({ reviews }), {
    headers: { ...JSON_HEADERS, "Cache-Control": "public, max-age=300" },
  });
}

/** A file the user uploaded for this lead. Only names registered in
 *  site_bestanden resolve, so no path from a visitor reaches Storage. */
async function handleBestand(
  supabase: ReturnType<typeof createServiceClient>,
  leadId: string,
  naam: string,
): Promise<Response> {
  const { data: rij } = await supabase
    .from("site_bestanden")
    .select("opslag_pad, content_type, bestandsnaam")
    .eq("lead_id", leadId)
    .eq("bestandsnaam", decodeURIComponent(naam))
    .maybeSingle();

  if (!rij) return new Response("Bestand niet gevonden.", { status: 404 });

  const { data: blob, error } = await supabase.storage.from("demos").download(rij.opslag_pad);
  if (error || !blob) return new Response("Kon bestand niet ophalen.", { status: 500 });

  return new Response(await blob.arrayBuffer(), {
    headers: {
      "Content-Type": rij.content_type ?? "application/octet-stream",
      // Downloads, not inline rendering: Storage's own text/plain sandboxing
      // doesn't apply here, and an uploaded HTML file must never execute on
      // this origin.
      "Content-Disposition": `attachment; filename="${rij.bestandsnaam.replace(/"/g, "")}"`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "public, max-age=3600",
    },
  });
}

/** POST target of the access-code prompt. */
async function handleToegang(
  supabase: ReturnType<typeof createServiceClient>,
  req: Request,
  leadId: string,
  basisPad: string,
): Promise<Response> {
  const formulier = await req.formData();
  const code = String(formulier.get("code") ?? "");
  const doel = String(formulier.get("doel") ?? "");

  const { data: toegang } = await supabase
    .from("site_toegang")
    .select("code_hash, salt, hint")
    .eq("lead_id", leadId)
    .maybeSingle();
  const { data: lead } = await supabase.from("leads").select("bedrijfsnaam").eq("id", leadId).maybeSingle();

  const juist = toegang ? (await hashCode(code, toegang.salt)) === toegang.code_hash : false;

  if (!juist) {
    return new Response(
      toegangFormulier({
        bedrijfsnaam: lead?.bedrijfsnaam ?? "",
        hint: toegang?.hint ?? null,
        fout: true,
        actie: `${basisPad}toegang`,
        doel,
      }),
      { status: 401, headers: { "Content-Type": "text/html; charset=utf-8" } },
    );
  }

  // Only ever redirect to a page of this same site, never to whatever the
  // form field happened to contain.
  const veiligDoel = /^[a-z0-9-]+\.html$/.test(doel) ? doel : "";
  return new Response(null, {
    status: 303,
    headers: {
      Location: `${basisPad}${veiligDoel}`,
      "Set-Cookie": await toegangCookieHeader(leadId, toegang!.code_hash, basisPad),
    },
  });
}

async function handleServe(
  supabase: ReturnType<typeof createServiceClient>,
  req: Request,
  leadId: string,
  bestand: string | null,
  basisPad: string,
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

  const paginas = (siteVersion.paginas ?? []) as Pagina[];
  const gevraagd = bestand ?? "index.html";
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

  // Gating happens here, before the file is read — a protected page's HTML
  // never leaves the server without the code. Hiding it client-side would
  // ship the content to every visitor and call that "gated".
  if (paginas.find((p) => p.bestand === gevraagd)?.toegang === "beveiligd") {
    const { data: toegang } = await supabase
      .from("site_toegang")
      .select("code_hash, hint")
      .eq("lead_id", leadId)
      .maybeSingle();

    if (!toegang) {
      // Marked protected but no code was ever set: refuse rather than serve
      // it, so a half-finished setup never leaks the content.
      return new Response("Deze pagina is afgeschermd, maar er is nog geen toegangscode ingesteld.", { status: 403 });
    }
    if (!(await heeftToegang(req, leadId, toegang.code_hash))) {
      const { data: bedrijf } = await supabase
        .from("leads")
        .select("bedrijfsnaam")
        .eq("id", leadId)
        .maybeSingle();
      return new Response(
        toegangFormulier({
          bedrijfsnaam: bedrijf?.bedrijfsnaam ?? "",
          hint: toegang.hint,
          fout: false,
          actie: `${basisPad}toegang`,
          doel: gevraagd,
        }),
        { status: 401, headers: { "Content-Type": "text/html; charset=utf-8" } },
      );
    }
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
      const leadId = segments[0];
      // Everything the generated pages call back into lives under the same
      // /{leadId}/ prefix, so one base path covers pages, uploads, the form
      // endpoint and the access gate.
      const basisPad = url.pathname.slice(0, url.pathname.indexOf(leadId) + leadId.length) + "/";

      if (segments[1] === "formulier" && req.method === "POST") {
        return await handleFormulier(supabase, req, leadId);
      }
      if (segments[1] === "reviews") {
        return await handleReviews(supabase, leadId);
      }
      if (segments[1] === "toegang" && req.method === "POST") {
        return await handleToegang(supabase, req, leadId, basisPad);
      }
      if (segments[1] === "bestanden" && segments[2]) {
        return await handleBestand(supabase, leadId, segments[2]);
      }

      // `/{leadId}` (no trailing slash, no page) can't serve the site
      // directly — see the header comment on relative-link resolution.
      if (!segments[1] && !url.pathname.endsWith("/")) {
        return Response.redirect(`${url.origin}${url.pathname}/${url.search}`, 302);
      }
      return await handleServe(supabase, req, leadId, segments[1] ?? null, basisPad);
    }
    return new Response("Not found", { status: 404 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return new Response(message, { status: 500 });
  }
});

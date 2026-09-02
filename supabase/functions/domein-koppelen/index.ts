import { handleCorsPreflight, corsHeaders } from "../_shared/cors.ts";
import { requireUser } from "../_shared/supabase-clients.ts";

// Een gegenereerde site op een echt domein zetten, in de twee vormen die het
// verkoopmodel kent:
//
//   bureau_subdomein  {naam}.yudexstudios.com — valt onder ons eigen wildcard
//                     DNS-record. Er is hier niets aan te vragen: zodra de rij
//                     bestaat, herkent track-and-serve de Host-header.
//                     Cloudflare wordt niet aangeroepen, en dat is geen
//                     vergetelheid maar de reden dat deze vorm meteen werkt.
//
//   eigen_domein      de klant zet een CNAME naar ons CNAME-doel. Daarvoor moet
//                     het domein als "custom hostname" bij Cloudflare bekend
//                     zijn (Cloudflare for SaaS), anders weet hun edge niet dat
//                     dit verkeer van ons is en komt er nooit een certificaat.
//
// Waarom niet gewoon één wildcard voor alles: een wildcard-certificaat dekt
// enkel onze eigen zone. Het domein van de klant is een andere zone, waar wij
// geen DNS-controle over hebben — het certificaat daarvoor kan enkel bestaan
// als de eigenaar aantoonbaar meewerkt. Dat is precies wat een custom hostname
// met domeinvalidatie regelt.
//
// NIET LIVE GEDRAAID. De aanroepen hieronder zijn geschreven tegen Cloudflare's
// gedocumenteerde v4-API voor custom hostnames, maar er is in deze omgeving
// geen Cloudflare-account met for-SaaS ingeschakeld om ze tegen te draaien.
// Reken op één ronde bijstellen bij de eerste echte koppeling; daarom wordt een
// foutantwoord integraal doorgegeven in plaats van samengevat.

const CF_API = "https://api.cloudflare.com/client/v4";

type CfHostname = {
  id: string;
  hostname: string;
  status?: string;
  ssl?: { status?: string; validation_errors?: { message: string }[] };
  verification_errors?: string[];
};

type CfRespons = {
  success: boolean;
  errors?: { code: number; message: string }[];
  result?: CfHostname | CfHostname[];
};

function omgeving() {
  const token = Deno.env.get("CLOUDFLARE_API_TOKEN");
  const zoneId = Deno.env.get("CLOUDFLARE_ZONE_ID");
  // Waar de klant zijn CNAME naartoe wijst: een hostname in onze eigen zone.
  // Bewust instelbaar — welke dat is hangt af van hoe de zone is opgezet, en
  // een gok hier laat de klant een record maken dat nergens op uitkomt. Dat
  // merk je pas uren later, als de fout al bij de klant ligt.
  const cnameDoel = Deno.env.get("CLOUDFLARE_CNAME_DOEL");

  if (!token || !zoneId || !cnameDoel) {
    const ontbreekt = [
      !token && "CLOUDFLARE_API_TOKEN",
      !zoneId && "CLOUDFLARE_ZONE_ID",
      !cnameDoel && "CLOUDFLARE_CNAME_DOEL",
    ].filter(Boolean);
    throw new Error(
      `Cloudflare is nog niet geconfigureerd (${ontbreekt.join(", ")} ontbreekt). ` +
        "Een eigen klantdomein kan pas gekoppeld worden zodra die secrets gezet zijn; " +
        "een subdomein van ons werkt wel zonder.",
    );
  }
  return { token, zoneId, cnameDoel };
}

async function cfRoep(pad: string, init: RequestInit & { token: string }): Promise<CfRespons> {
  const { token, ...rest } = init;
  const res = await fetch(`${CF_API}${pad}`, {
    ...rest,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  });

  const tekst = await res.text();
  let body: CfRespons;
  try {
    body = JSON.parse(tekst);
  } catch {
    // Een niet-JSON-antwoord is bijna altijd een verkeerde URL of een
    // gateway-pagina — de ruwe tekst zegt dan meer dan "parse error".
    throw new Error(`Onverwacht antwoord van Cloudflare (${res.status}): ${tekst.slice(0, 500)}`);
  }

  if (!body.success) {
    const fouten = (body.errors ?? []).map((e) => `${e.code}: ${e.message}`).join("; ");
    throw new Error(`Cloudflare weigerde de aanvraag (${res.status}): ${fouten || tekst.slice(0, 500)}`);
  }
  return body;
}

function eersteHostname(body: CfRespons): CfHostname | undefined {
  const r = body.result;
  return Array.isArray(r) ? r[0] : r;
}

function foutTeksten(cf: CfHostname | undefined): string[] {
  return [
    ...(cf?.verification_errors ?? []),
    ...(cf?.ssl?.validation_errors ?? []).map((e) => e.message),
  ];
}

/** Cloudflare's statussen samengevat tot de drie die de app toont. */
function vertaalStatus(cf: CfHostname | undefined): "in_aanvraag" | "actief" | "mislukt" {
  if (cf?.status === "active" && cf?.ssl?.status === "active") return "actief";

  // Een fout die vanzelf verdwijnt zodra de klant zijn CNAME zet, is geen
  // mislukking. Enkel een expliciete afwijzing van Cloudflare is dat — anders
  // ziet elke koppeling er in het eerste half uur uit alsof ze stuk is.
  if (
    cf?.status === "moved" ||
    cf?.status === "deleted" ||
    foutTeksten(cf).some((f) => /not authorized|blocked|forbidden/i.test(f))
  ) {
    return "mislukt";
  }
  return "in_aanvraag";
}

function verificatieUit(cf: CfHostname | undefined, cnameDoel: string, domein: string) {
  const fouten = foutTeksten(cf);
  return {
    cname_naam: domein,
    cname_waarde: cnameDoel,
    ssl_status: cf?.ssl?.status ?? null,
    fout: fouten.length ? fouten.join("; ") : null,
  };
}

Deno.serve(async (req) => {
  const preflight = handleCorsPreflight(req);
  if (preflight) return preflight;

  try {
    const { supabase } = await requireUser(req);
    const { klantId, actie } = await req.json();

    const { data: klant, error } = await supabase
      .from("klanten")
      .select("id, definitief_domein, domein_type, cloudflare_hostname_id, domein_status")
      .eq("id", klantId)
      .single();

    if (error || !klant) throw new Error(`Klant niet gevonden: ${error?.message}`);

    // ── ontkoppelen ──────────────────────────────────────────────────────
    if (actie === "ontkoppel") {
      if (klant.cloudflare_hostname_id) {
        const { token, zoneId } = omgeving();
        await cfRoep(`/zones/${zoneId}/custom_hostnames/${klant.cloudflare_hostname_id}`, {
          method: "DELETE",
          token,
        });
      }
      await supabase
        .from("klanten")
        .update({
          definitief_domein: null,
          domein_type: null,
          domein_status: null,
          cloudflare_hostname_id: null,
          domein_verificatie: null,
          domein_gekoppeld_op: null,
        })
        .eq("id", klantId);

      return new Response(JSON.stringify({ ok: true, status: null }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!klant.definitief_domein || !klant.domein_type) {
      throw new Error("Deze klant heeft nog geen domein ingesteld.");
    }

    // ── bureau-subdomein: niets aan te vragen ────────────────────────────
    if (klant.domein_type === "bureau_subdomein") {
      await supabase
        .from("klanten")
        .update({
          domein_status: "actief",
          domein_gekoppeld_op: new Date().toISOString(),
          domein_verificatie: null,
        })
        .eq("id", klantId);

      return new Response(
        JSON.stringify({
          ok: true,
          status: "actief",
          instructie:
            `${klant.definitief_domein} valt onder ons wildcard-record voor de bureauzone. ` +
            "Er hoeft niets aangevraagd te worden; de site is bereikbaar zodra er een actieve versie is.",
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // ── eigen domein: custom hostname bij Cloudflare ─────────────────────
    const { token, zoneId, cnameDoel } = omgeving();

    let hostname: CfHostname | undefined;
    if (actie === "status" && klant.cloudflare_hostname_id) {
      hostname = eersteHostname(
        await cfRoep(`/zones/${zoneId}/custom_hostnames/${klant.cloudflare_hostname_id}`, {
          method: "GET",
          token,
        }),
      );
    } else {
      // Eerst zoeken, dan pas aanmaken: een tweede klik op "Koppelen" mag geen
      // tweede custom hostname opleveren. Cloudflare weigert dat met een
      // generieke fout die niet uitlegt dat het dubbel is.
      hostname = eersteHostname(
        await cfRoep(
          `/zones/${zoneId}/custom_hostnames?hostname=${encodeURIComponent(klant.definitief_domein)}`,
          { method: "GET", token },
        ),
      );

      if (!hostname) {
        hostname = eersteHostname(
          await cfRoep(`/zones/${zoneId}/custom_hostnames`, {
            method: "POST",
            token,
            body: JSON.stringify({
              hostname: klant.definitief_domein,
              // http-validatie rondt vanzelf af zodra de CNAME van de klant
              // live is — geen tweede record dat hij moet zetten en vergeten.
              ssl: { method: "http", type: "dv", settings: { min_tls_version: "1.2" } },
            }),
          }),
        );
      }
    }

    const status = vertaalStatus(hostname);
    const verificatie = verificatieUit(hostname, cnameDoel, klant.definitief_domein);

    await supabase
      .from("klanten")
      .update({
        cloudflare_hostname_id: hostname?.id ?? klant.cloudflare_hostname_id,
        domein_status: status,
        domein_verificatie: verificatie,
        domein_gekoppeld_op: status === "actief" ? new Date().toISOString() : null,
      })
      .eq("id", klantId);

    return new Response(
      JSON.stringify({
        ok: true,
        status,
        verificatie,
        instructie:
          status === "actief"
            ? null
            : `Laat de klant bij zijn domeinregistrar een CNAME zetten: ${klant.definitief_domein} → ${cnameDoel}. ` +
              "Zodra dat record wereldwijd zichtbaar is, rondt Cloudflare het certificaat vanzelf af " +
              "(minuten tot enkele uren). Klik daarna op Status verversen.",
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ error: message }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

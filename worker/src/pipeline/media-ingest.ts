import type { SupabaseClient } from "@supabase/supabase-js";

// Pulls images that a briefing links to into our own Storage, once, and hands
// the generator a stable local path instead of the original URL.
//
// Why this exists: a briefing typically links a logo straight from wherever
// the client already has it — an Instagram or Facebook CDN URL. Those URLs are
// signed and expire. The MIKI TEA logo that prompted this carried
// `oe=6A6D5401`, i.e. valid for under four days. Embedding it in a generated
// site produces a logo that works in the review screenshot, works in the demo
// you send, and is a broken image by the time the lead clicks it a week later.
// That is the same class of failure as the invented Unsplash IDs, except it
// fails on a delay, which makes it worse.
//
// So: fetch once at generation time, store under the lead's own files, and let
// track-and-serve deliver it. The demo then has no dependency on a third-party
// CDN at all.

const MAX_BYTES = 8 * 1024 * 1024;
const TOEGESTANE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif", "image/svg+xml"];
const EXTENSIE: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/svg+xml": "svg",
};

export type IngestResultaat = {
  bestandsnaam: string;
  omschrijving: string;
  bron: string;
};

/** Labels a URL by what the line it sits on calls it, so a logo ends up named
 *  "logo" rather than "afbeelding-3" and the prompt can say what it is. */
function labelVoor(regel: string, index: number): { naam: string; omschrijving: string } | null {
  const laag = regel.toLowerCase();
  if (laag.includes("logo")) return { naam: "logo", omschrijving: "Logo van de klant" };
  if (laag.includes("menu") || laag.includes("kaart")) return { naam: "menu", omschrijving: "Menu/kaart van de klant" };
  if (laag.includes("banner") || laag.includes("hero")) return { naam: "hero", omschrijving: "Sfeer-/bannerbeeld" };
  if (laag.includes("foto") || laag.includes("afbeelding") || laag.includes("beeld")) {
    return { naam: `foto-${index}`, omschrijving: "Foto uit de briefing" };
  }
  return null;
}

const URL_PATROON = /https?:\/\/[^\s<>"')]+/g;
// Hosts that serve images without an image extension in the path. Without
// this, a signed Instagram/Facebook CDN URL is skipped for looking like a
// regular link.
const BEELD_HOSTS = /(cdninstagram\.com|fbcdn\.net|scontent|cloudinary\.com|imgix\.net|squarespace-cdn\.com)/i;
const BEELD_EXTENSIE = /\.(jpe?g|png|webp|gif|svg)(\?|$)/i;

/**
 * Finds image URLs in a briefing and copies them into `{leadId}/bestanden/`.
 * Best-effort per URL: one unreachable image must not fail a generation, it
 * just doesn't become available to the prompt.
 */
export async function ingestBriefingAfbeeldingen(
  supabase: SupabaseClient,
  leadId: string,
  briefing: string | null,
): Promise<IngestResultaat[]> {
  if (!briefing) return [];

  const kandidaten: { url: string; naam: string; omschrijving: string }[] = [];
  let teller = 0;

  for (const regel of briefing.split("\n")) {
    for (const url of regel.match(URL_PATROON) ?? []) {
      if (!BEELD_EXTENSIE.test(url) && !BEELD_HOSTS.test(url)) continue;
      teller++;
      const label = labelVoor(regel, teller) ?? {
        naam: `afbeelding-${teller}`,
        omschrijving: "Afbeelding uit de briefing",
      };
      // First label wins: a briefing that mentions the logo once shouldn't
      // end up with logo, logo-2, logo-3 across regenerations.
      if (kandidaten.some((k) => k.naam === label.naam)) continue;
      kandidaten.push({ url, ...label });
    }
  }

  const resultaten: IngestResultaat[] = [];

  for (const kandidaat of kandidaten) {
    try {
      const response = await fetch(kandidaat.url, {
        headers: { "User-Agent": "Mozilla/5.0", Accept: "image/*" },
        signal: AbortSignal.timeout(20000),
      });
      if (!response.ok) {
        console.warn(`media-ingest: ${kandidaat.naam} gaf ${response.status}, overgeslagen`);
        continue;
      }

      const type = (response.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
      if (!TOEGESTANE_TYPES.includes(type)) {
        console.warn(`media-ingest: ${kandidaat.naam} is geen afbeelding (${type}), overgeslagen`);
        continue;
      }

      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.byteLength > MAX_BYTES || bytes.byteLength === 0) {
        console.warn(`media-ingest: ${kandidaat.naam} is ${bytes.byteLength} bytes, overgeslagen`);
        continue;
      }

      const bestandsnaam = `${kandidaat.naam}.${EXTENSIE[type]}`;
      const opslagPad = `${leadId}/bestanden/${bestandsnaam}`;

      // Remove first rather than relying on upsert. Observed on 2026-07-28:
      // an upsert reported success but a subsequent download still returned
      // the previous bytes, so a client who swapped their logo would keep
      // seeing the old one with nothing to indicate why.
      await supabase.storage.from("demos").remove([opslagPad]);
      const { error: uploadError } = await supabase.storage
        .from("demos")
        .upload(opslagPad, bytes, { contentType: type });
      if (uploadError) {
        console.warn(`media-ingest: upload van ${bestandsnaam} mislukt: ${uploadError.message}`);
        continue;
      }

      const { error: rijError } = await supabase.from("site_bestanden").upsert(
        {
          lead_id: leadId,
          bestandsnaam,
          opslag_pad: opslagPad,
          content_type: type,
          grootte_bytes: bytes.byteLength,
          omschrijving: `${kandidaat.omschrijving} (opgehaald uit de briefing)`,
          toegevoegd_door: "briefing-import",
        },
        { onConflict: "lead_id,bestandsnaam" },
      );
      if (rijError) {
        console.warn(`media-ingest: registratie van ${bestandsnaam} mislukt: ${rijError.message}`);
        continue;
      }

      resultaten.push({ bestandsnaam, omschrijving: kandidaat.omschrijving, bron: kandidaat.url });
      console.log(`media-ingest: ${bestandsnaam} opgeslagen (${bytes.byteLength} bytes)`);
    } catch (err) {
      console.warn(`media-ingest: ${kandidaat.naam} mislukt: ${err instanceof Error ? err.message : err}`);
    }
  }

  return resultaten;
}

/**
 * The lead's own images as data: URIs, keyed by file name.
 *
 * The review loop screenshots pages with `page.setContent(html)`, which gives
 * the document no origin and no directory — so `<img src="bestanden/logo.jpg">`
 * resolves to nothing and the reviewer sees a broken image where the client's
 * logo should be. It would then reject the page, correctly by its own lights,
 * and the loop would regenerate a site that was never actually broken. That is
 * the same shape of bug as the review-loop screenshotting raw HTML source back
 * in July, and it costs a full regeneration cycle every time.
 */
export async function haalAfbeeldingenAlsDataUri(
  supabase: SupabaseClient,
  leadId: string,
): Promise<Record<string, string>> {
  const { data: rijen } = await supabase
    .from("site_bestanden")
    .select("bestandsnaam, opslag_pad, content_type")
    .eq("lead_id", leadId);

  const beelden: Record<string, string> = {};
  for (const rij of (rijen ?? []) as {
    bestandsnaam: string;
    opslag_pad: string;
    content_type: string | null;
  }[]) {
    if (!(rij.content_type ?? "").startsWith("image/")) continue;
    const { data } = await supabase.storage.from("demos").download(rij.opslag_pad);
    if (!data) continue;
    const bytes = Buffer.from(await data.arrayBuffer());
    if (bytes.byteLength > 2 * 1024 * 1024) continue;
    beelden[rij.bestandsnaam] = `data:${rij.content_type};base64,${bytes.toString("base64")}`;
  }
  return beelden;
}

/** Replaces `bestanden/<naam>` references with the inlined data: URI. */
export function vervangBestandsverwijzingen(html: string, beelden: Record<string, string>): string {
  return html.replace(
    /(["'(])\.?\/?bestanden\/([^"')?#]+)/gi,
    (volledig, opening: string, naam: string) => {
      const dataUri = beelden[decodeURIComponent(naam)];
      return dataUri ? `${opening}${dataUri}` : volledig;
    },
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Reading uploaded images
// ─────────────────────────────────────────────────────────────────────────

/** Cost guard: a lead with a dozen photos shouldn't run a dozen vision calls. */
const MAX_TE_LEZEN = 4;

const LEESBAAR_PATROON = /(menu|kaart|prijs|tarief|folder|brochure|flyer|aanbod|assortiment)/i;

const LEES_PROMPT = `Je krijgt een foto die een klant heeft aangeleverd, meestal van een menukaart,
prijslijst of folder. Transcribeer wat er letterlijk op staat, zo volledig mogelijk en in dezelfde
taal als op de foto.

Regels:
- Neem ALLE items over, met hun prijzen en eventuele beschrijvingen. Sla niets over omdat het
  onbelangrijk lijkt; dit is de productlijst waarmee de website gebouwd wordt.
- PRIJZEN ZIJN VERPLICHT. Op een menukaart staat de prijs bijna altijd rechts uitgelijnd op
  dezelfde regel als het item, soms met puntjes of veel witruimte ertussen. Die hoort bij dat
  item — schrijf hem er pal achter, als "Item — € 4,20". Een item zonder prijs overnemen terwijl
  er wel een op de foto staat, is de ergste fout die je hier kan maken. Staat er echt nergens een
  prijs, laat het dan weg.
- Behoud de groepering (bv. "Warme dranken", "Koude dranken") als kopjes.
- Verzin NIETS. Kan je een woord of prijs niet met zekerheid lezen, zet er dan [onleesbaar]
  achter in plaats van te gokken.
- Is dit duidelijk geen menu/prijslijst/folder maar bijvoorbeeld een sfeerfoto of een logo,
  antwoord dan exact: GEEN_TEKST`;

/**
 * Transcribes uploaded images so a photographed menu becomes usable content.
 *
 * Uploading a menu photo was already possible; it just ended up as a file the
 * site could link to, while the generator still had no idea what the client
 * actually sells. For MIKI TEA that showed up as invented products on the
 * demo — the model had a "menu" page to fill and no menu.
 *
 * Results are cached on the row: the review loop can regenerate five times per
 * lead and the picture doesn't change between them.
 */
export async function leesAangeleverdeAfbeeldingen(
  supabase: SupabaseClient,
  leadId: string,
  leesAfbeelding: (base64: string, mediaType: string, prompt: string) => Promise<string>,
): Promise<void> {
  const { data: rijen } = await supabase
    .from("site_bestanden")
    .select("id, bestandsnaam, opslag_pad, content_type, omschrijving, geextraheerde_tekst")
    .eq("lead_id", leadId);

  const kandidaten = ((rijen ?? []) as {
    id: string;
    bestandsnaam: string;
    opslag_pad: string;
    content_type: string | null;
    omschrijving: string | null;
    geextraheerde_tekst: string | null;
  }[])
    .filter((r) => (r.content_type ?? "").startsWith("image/") && r.content_type !== "image/svg+xml")
    // Already read, or obviously not worth reading: a logo has nothing to say.
    .filter((r) => r.geextraheerde_tekst === null)
    .filter((r) => !/^logo\./i.test(r.bestandsnaam))
    // Anything the user labelled as a menu/price list first; then the rest,
    // because a photo someone bothered to upload usually has a reason.
    .sort((a, b) => {
      const score = (r: typeof a) => (LEESBAAR_PATROON.test(`${r.bestandsnaam} ${r.omschrijving ?? ""}`) ? 0 : 1);
      return score(a) - score(b);
    })
    .slice(0, MAX_TE_LEZEN);

  for (const rij of kandidaten) {
    try {
      const { data } = await supabase.storage.from("demos").download(rij.opslag_pad);
      if (!data) continue;
      const bytes = Buffer.from(await data.arrayBuffer());
      // Vision inputs are capped by the API; a phone photo can exceed it.
      if (bytes.byteLength > 5 * 1024 * 1024) {
        console.warn(`beeldlezer: ${rij.bestandsnaam} is te groot (${bytes.byteLength} bytes), overgeslagen`);
        continue;
      }

      const tekst = (await leesAfbeelding(bytes.toString("base64"), rij.content_type!, LEES_PROMPT)).trim();
      const bruikbaar = tekst && !/^GEEN_TEKST$/i.test(tekst);

      await supabase
        .from("site_bestanden")
        .update({
          // Store the empty result too, so a sfeerfoto isn't re-read on every
          // single regeneration.
          geextraheerde_tekst: bruikbaar ? tekst : "",
          tekst_geextraheerd_op: new Date().toISOString(),
        })
        .eq("id", rij.id);

      console.log(
        bruikbaar
          ? `beeldlezer: ${rij.bestandsnaam} gelezen (${tekst.length} tekens)`
          : `beeldlezer: ${rij.bestandsnaam} bevat geen bruikbare tekst`,
      );
    } catch (err) {
      console.warn(`beeldlezer: ${rij.bestandsnaam} mislukt: ${err instanceof Error ? err.message : err}`);
    }
  }
}

/** Hex colours a briefing names, so the generator uses the client's actual
 *  palette instead of the generic sector styling. */
export function vindMerkkleuren(briefing: string | null): string[] {
  if (!briefing) return [];
  const kleuren = briefing.match(/#[0-9a-fA-F]{6}\b/g) ?? [];
  return [...new Set(kleuren.map((k) => k.toUpperCase()))].slice(0, 6);
}

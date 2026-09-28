import { createClient } from "@/lib/supabase/client";
import type { SiteVersion } from "@/lib/types";

// Zelfde vaste naam als PRIVACY_BESTAND in de site-builder; die leeft in de
// worker en de Edge Functions, niet in de app.
const PRIVACY_BESTAND = "privacybeleid.html";

// Fetches the HTML itself rather than a Storage URL: Supabase Storage
// always serves stored objects as `text/plain` with a locked-down sandbox
// CSP (a deliberate anti-XSS measure — it never serves arbitrary stored
// content as live, renderable text/html, signed URL or not). Navigating a
// preview iframe/window there shows raw source, not the rendered page. The
// caller loads this string directly (`srcdoc` / `document.write`) instead.
//
// En altijd de HUIDIGE inhoud, wat een gewone download() niet garandeert.
// Chat-edit, de review-loop en de editor-sync overschrijven telkens dezelfde
// paden, en daar zitten twee caches tussen die elk de vorige versie bleven
// tonen ("op localhost zie ik de aanpassing wel, in de app niet"):
//  - de HTTP-cache van de browser/WebView2: supabase-js uploadt met
//    `Cache-Control: max-age=3600` → `cache: "no-store"`;
//  - de CDN van Supabase: vlak na een overschrijving een cache-HIT met oude
//    bytes, gemeten op 2026-09-27, ook met een nieuwe `cacheNonce` (die telt
//    niet mee in de cachesleutel). Een ondertekende URL wordt daar niet
//    gecachet (altijd MISS) → via createSignedUrl.
// De worker had het eerste probleem nooit (Node's fetch heeft geen cache) —
// vandaar dat localhost het wél toonde.
const GEEN_CACHE = { cache: "no-store" } as const;

/** De huidige inhoud van een bestand in `demos`, of null. Zie hierboven. */
export async function leesVers(path: string): Promise<Blob | null> {
  const supabase = createClient();
  const { data, error } = await supabase.storage.from("demos").createSignedUrl(path, 60);
  if (error || !data) return null;
  const antwoord = await fetch(data.signedUrl, GEEN_CACHE);
  return antwoord.ok ? await antwoord.blob() : null;
}

export async function fetchDemoHtml(path: string): Promise<string | null> {
  const blob = await leesVers(path);
  return blob ? await blob.text() : null;
}

/** bestand -> HTML for every page of a version. Single-file versions from
 *  before multi-page support come back as a one-entry map keyed "index.html",
 *  so preview code has one shape to deal with. */
export type DemoSite = Record<string, string>;

/**
 * The lead's own images, as data: URIs keyed by file name.
 *
 * Needed because a preview renders through `srcdoc`, which has no origin and
 * no directory — so `<img src="bestanden/logo.jpg">`, which resolves perfectly
 * on the real hosting route, resolves to nothing here and shows a broken
 * image. Inlining the bytes sidesteps that entirely, the same way the HTML
 * itself is inlined rather than loaded from a URL.
 */
async function fetchAfbeeldingenAlsDataUri(leadId: string): Promise<Record<string, string>> {
  const supabase = createClient();
  const { data: rijen } = await supabase
    .from("site_bestanden")
    .select("bestandsnaam, opslag_pad, content_type")
    .eq("lead_id", leadId);

  const beelden: Record<string, string> = {};
  for (const rij of (rijen ?? []) as { bestandsnaam: string; opslag_pad: string; content_type: string | null }[]) {
    if (!(rij.content_type ?? "").startsWith("image/")) continue;
    const ruw = await leesVers(rij.opslag_pad);
    if (!ruw) continue;
    // Het type uit de tabel, niet uit het antwoord: data: URI's hebben het
    // echte beeldtype nodig.
    const data = new Blob([ruw], { type: rij.content_type ?? ruw.type });
    // Logos and the like are a few kB; anything genuinely large would bloat
    // every page of the preview, so it keeps its (broken-in-preview) path
    // rather than being inlined N times.
    if (data.size > 2 * 1024 * 1024) continue;
    beelden[rij.bestandsnaam] = await new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.readAsDataURL(data);
    });
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

export async function fetchDemoSite(version: SiteVersion): Promise<DemoSite | null> {
  if (!version.content_referentie) return null;

  const beelden = await fetchAfbeeldingenAlsDataUri(version.lead_id);

  if (!version.paginas?.length) {
    const html = await fetchDemoHtml(version.content_referentie);
    return html ? { "index.html": vervangBestandsverwijzingen(html, beelden) } : null;
  }

  const map = version.content_referentie.replace(/\/index\.html$/, "");
  const entries = await Promise.all(
    version.paginas.map(async (pagina) => [pagina.bestand, await fetchDemoHtml(`${map}/${pagina.bestand}`)] as const),
  );

  const site: DemoSite = {};
  for (const [bestand, html] of entries) {
    // A page that fails to download is left out rather than failing the whole
    // preview — the rest of the site is still worth looking at, and the
    // preview reports the missing page when a link leads to it.
    if (html !== null) site[bestand] = vervangBestandsverwijzingen(html, beelden);
  }
  return site["index.html"] ? site : null;
}

// Spec 3.8: "Maak deze actief publiceert zonder de live site te verstoren."
// The one-actief-per-lead partial unique index means only one row can be
// 'actief' at a time, so the previous one is demoted to 'afgerond' first —
// briefly zero actief rows is fine (nothing enforces "exactly one"), but
// briefly two would violate the constraint.
export async function activateVersion(leadId: string, versionId: string): Promise<string | null> {
  const supabase = createClient();

  const { data: currentActief } = await supabase
    .from("site_versions")
    .select("id")
    .eq("lead_id", leadId)
    .eq("status", "actief")
    .maybeSingle();

  if (currentActief && currentActief.id !== versionId) {
    const { error: demoteError } = await supabase
      .from("site_versions")
      .update({ status: "afgerond" })
      .eq("id", currentActief.id);
    if (demoteError) return `Kon huidige actieve versie niet afronden: ${demoteError.message}`;
  }

  const { error: activateError } = await supabase
    .from("site_versions")
    .update({ status: "actief" })
    .eq("id", versionId);
  if (activateError) return `Activeren mislukt: ${activateError.message}`;

  return null;
}

/**
 * Haalt de site offline: de actieve versie wordt weer 'afgerond'.
 *
 * Er is bewust geen aparte "offline"-status. `track-and-serve` serveert wat op
 * 'actief' staat en niets anders, dus geen actieve versie betekent al dat er
 * niets bereikbaar is — een derde status erbij zou hetzelfde betekenen maar op
 * twee plekken bijgehouden moeten worden. De versie zelf blijft staan, dus
 * online zetten is één klik terug.
 */
export async function deactivateVersion(versionId: string): Promise<string | null> {
  const supabase = createClient();
  const { error } = await supabase
    .from("site_versions")
    .update({ status: "afgerond" })
    .eq("id", versionId);
  return error ? `Offline halen mislukt: ${error.message}` : null;
}

// Spec 3.5: "Teruggaan naar een oudere versie maakt een nieuwe versie als
// kopie" — non-destructive, so this always inserts a new row rather than
// touching the source version or any existing concept row. Content was
// already approved once (that's why it exists as a real version), so the
// copy lands on 'afgerond' — one explicit "Maak deze actief" click away
// from going live, same as any other finished version (3.8).
export async function revertToVersion(leadId: string, source: SiteVersion): Promise<string | null> {
  return (await kopieerVersie(leadId, source)).fout;
}

/**
 * De kopie zelf, met de nieuwe rij erbij — "Openen in editor" op de live
 * versie heeft die nodig om meteen de kopie te openen in plaats van de live
 * site onder je handen te bewerken.
 */
export async function kopieerVersie(
  leadId: string,
  source: SiteVersion,
): Promise<{ fout: string | null; versie: SiteVersion | null }> {
  if (!source.content_referentie) {
    return { fout: "Deze versie heeft geen opgeslagen inhoud om te herstellen.", versie: null };
  }

  const supabase = createClient();

  const { data: latest } = await supabase
    .from("site_versions")
    .select("versienummer")
    .eq("lead_id", leadId)
    .order("versienummer", { ascending: false })
    .limit(1)
    .maybeSingle();

  const versienummer = (latest?.versienummer ?? 0) + 1;

  // A multi-page version is a whole folder (every page plus the bron.json
  // chat-edit patches through), so the copy has to be folder-to-folder. A
  // single-file version from before multi-page support is copied into the new
  // folder layout as its index.html, which is also what makes it editable and
  // extendable as a multi-page site from here on.
  const bronMap = source.content_referentie.replace(/\/index\.html$/, "").replace(/\.html$/, "");
  const doelMap = `${leadId}/${versienummer}`;
  const teKopieren = source.paginas?.length
    ? [...source.paginas.map((p) => p.bestand), "bron.json"]
    : ["index.html"];

  for (const bestand of teKopieren) {
    const bronPad = source.paginas?.length ? `${bronMap}/${bestand}` : source.content_referentie;
    // Vers gelezen: een kopie vlak na een bewerking mag niet de vorige inhoud
    // bevatten.
    const fileData = await leesVers(bronPad);
    if (!fileData) return { fout: `Kon ${bestand} niet ophalen.`, versie: null };

    const { error: uploadError } = await supabase.storage
      .from("demos")
      .upload(`${doelMap}/${bestand}`, fileData, {
        contentType: bestand.endsWith(".json") ? "application/json" : "text/html",
      });
    if (uploadError) return { fout: `Kon herstelde versie niet opslaan: ${uploadError.message}`, versie: null };
  }

  // De privacypagina staat bewust niet in `paginas` (zie site-builder), dus
  // de lus hierboven sloeg ze over. Zet iemand zo'n kopie live, dan laat
  // track-and-serve dat bestand toe maar vindt het niet: een 500 op de
  // privacylink. Oudere versies hebben er nog geen — dan is er niets te kopiëren.
  if (source.paginas?.length) {
    const privacy = await leesVers(`${bronMap}/${PRIVACY_BESTAND}`);
    if (privacy) {
      await supabase.storage
        .from("demos")
        .upload(`${doelMap}/${PRIVACY_BESTAND}`, privacy, { contentType: "text/html" });
    }
  }

  const { data: nieuw, error: insertError } = await supabase
    .from("site_versions")
    .insert({
      lead_id: leadId,
      site_type: source.site_type,
      versienummer,
      status: "afgerond",
      content_referentie: `${doelMap}/index.html`,
      paginas: source.paginas,
      prompt_versie: source.prompt_versie,
    })
    .select("*")
    .single();
  if (insertError) return { fout: `Kon nieuwe versie niet aanmaken: ${insertError.message}`, versie: null };

  return { fout: null, versie: nieuw as SiteVersion };
}

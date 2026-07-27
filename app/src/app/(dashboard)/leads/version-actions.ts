import { createClient } from "@/lib/supabase/client";
import type { SiteVersion } from "@/lib/types";

// Fetches the HTML itself rather than a Storage URL: Supabase Storage
// always serves stored objects as `text/plain` with a locked-down sandbox
// CSP (a deliberate anti-XSS measure — it never serves arbitrary stored
// content as live, renderable text/html, signed URL or not). Navigating a
// preview iframe/window there shows raw source, not the rendered page. The
// caller loads this string directly (`srcdoc` / `document.write`) instead.
export async function fetchDemoHtml(path: string): Promise<string | null> {
  const supabase = createClient();
  const { data, error } = await supabase.storage.from("demos").download(path);
  if (error || !data) return null;
  return await data.text();
}

/** bestand -> HTML for every page of a version. Single-file versions from
 *  before multi-page support come back as a one-entry map keyed "index.html",
 *  so preview code has one shape to deal with. */
export type DemoSite = Record<string, string>;

export async function fetchDemoSite(version: SiteVersion): Promise<DemoSite | null> {
  if (!version.content_referentie) return null;

  if (!version.paginas?.length) {
    const html = await fetchDemoHtml(version.content_referentie);
    return html ? { "index.html": html } : null;
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
    if (html !== null) site[bestand] = html;
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

// Spec 3.5: "Teruggaan naar een oudere versie maakt een nieuwe versie als
// kopie" — non-destructive, so this always inserts a new row rather than
// touching the source version or any existing concept row. Content was
// already approved once (that's why it exists as a real version), so the
// copy lands on 'afgerond' — one explicit "Maak deze actief" click away
// from going live, same as any other finished version (3.8).
export async function revertToVersion(leadId: string, source: SiteVersion): Promise<string | null> {
  if (!source.content_referentie) return "Deze versie heeft geen opgeslagen inhoud om te herstellen.";

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
    const { data: fileData, error: downloadError } = await supabase.storage.from("demos").download(bronPad);
    if (downloadError || !fileData) return `Kon ${bestand} niet ophalen: ${downloadError?.message}`;

    const { error: uploadError } = await supabase.storage
      .from("demos")
      .upload(`${doelMap}/${bestand}`, fileData, {
        contentType: bestand.endsWith(".json") ? "application/json" : "text/html",
      });
    if (uploadError) return `Kon herstelde versie niet opslaan: ${uploadError.message}`;
  }

  const { error: insertError } = await supabase.from("site_versions").insert({
    lead_id: leadId,
    site_type: source.site_type,
    versienummer,
    status: "afgerond",
    content_referentie: `${doelMap}/index.html`,
    paginas: source.paginas,
    prompt_versie: source.prompt_versie,
  });
  if (insertError) return `Kon nieuwe versie niet aanmaken: ${insertError.message}`;

  return null;
}

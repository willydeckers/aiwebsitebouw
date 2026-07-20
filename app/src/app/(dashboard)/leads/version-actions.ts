import { createClient } from "@/lib/supabase/client";
import type { SiteVersion } from "@/lib/types";

// Bucket is private (spec section 2 — no raw Storage URL ever reaches a
// lead), but an authenticated app session can read it directly under the
// "authenticated full access" storage policy, so a short-lived signed URL
// is enough to preview an older, non-actief version inline.
export async function fetchSignedDemoUrl(path: string): Promise<string | null> {
  const supabase = createClient();
  const { data, error } = await supabase.storage.from("demos").createSignedUrl(path, 60);
  if (error || !data) return null;
  return data.signedUrl;
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

  const { data: fileData, error: downloadError } = await supabase.storage
    .from("demos")
    .download(source.content_referentie);
  if (downloadError || !fileData) return `Kon versie-inhoud niet ophalen: ${downloadError?.message}`;

  const { data: latest } = await supabase
    .from("site_versions")
    .select("versienummer")
    .eq("lead_id", leadId)
    .order("versienummer", { ascending: false })
    .limit(1)
    .maybeSingle();

  const versienummer = (latest?.versienummer ?? 0) + 1;
  const storagePath = `${leadId}/${versienummer}.html`;

  const { error: uploadError } = await supabase.storage
    .from("demos")
    .upload(storagePath, fileData, { contentType: "text/html" });
  if (uploadError) return `Kon herstelde versie niet opslaan: ${uploadError.message}`;

  const { error: insertError } = await supabase.from("site_versions").insert({
    lead_id: leadId,
    site_type: source.site_type,
    versienummer,
    status: "afgerond",
    content_referentie: storagePath,
    prompt_versie: source.prompt_versie,
  });
  if (insertError) return `Kon nieuwe versie niet aanmaken: ${insertError.message}`;

  return null;
}

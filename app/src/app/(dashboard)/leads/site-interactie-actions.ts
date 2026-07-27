import { createClient } from "@/lib/supabase/client";
import { logAudit } from "@/lib/audit";
import type { SiteBestand, SiteInzending, SiteToegang } from "@/lib/types";

// Downloads, form/review submissions and the access code for gated pages.
// All three are read here with the app's own (RLS-protected) session; the
// public side of the same data is served by track-and-serve with the
// service-role client.

export async function fetchInzendingen(leadId: string): Promise<SiteInzending[]> {
  const supabase = createClient();
  const { data } = await supabase
    .from("site_inzendingen")
    .select("*")
    .eq("lead_id", leadId)
    .order("aangemaakt_op", { ascending: false })
    .limit(50);
  return (data as SiteInzending[] | null) ?? [];
}

export async function setInzendingStatus(
  id: string,
  status: SiteInzending["status"],
): Promise<string | null> {
  const supabase = createClient();
  const { error } = await supabase.from("site_inzendingen").update({ status }).eq("id", id);
  return error ? `Kon status niet bijwerken: ${error.message}` : null;
}

export async function deleteInzending(id: string): Promise<string | null> {
  const supabase = createClient();
  const { error } = await supabase.from("site_inzendingen").delete().eq("id", id);
  return error ? `Verwijderen mislukt: ${error.message}` : null;
}

// ── Downloads ────────────────────────────────────────────────────────────

export async function fetchBestanden(leadId: string): Promise<SiteBestand[]> {
  const supabase = createClient();
  const { data } = await supabase
    .from("site_bestanden")
    .select("*")
    .eq("lead_id", leadId)
    .order("aangemaakt_op", { ascending: false });
  return (data as SiteBestand[] | null) ?? [];
}

const MAX_BESTAND_BYTES = 25 * 1024 * 1024;

export async function uploadBestand(
  leadId: string,
  file: File,
  omschrijving: string,
): Promise<string | null> {
  if (file.size > MAX_BESTAND_BYTES) {
    return `Bestand is te groot (${Math.round(file.size / 1024 / 1024)} MB, max 25 MB).`;
  }

  // The generator links downloads by name, so the name has to survive a URL
  // round-trip and stay stable. Anything outside this set is renamed rather
  // than rejected — a user shouldn't have to think about it.
  const veiligeNaam = file.name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100);
  if (!veiligeNaam) return "Ongeldige bestandsnaam.";

  const supabase = createClient();
  // Beside the version folders, not inside one: a brochure outlives any
  // single site version and shouldn't be copied on every regeneration.
  const opslagPad = `${leadId}/bestanden/${veiligeNaam}`;

  const { error: uploadError } = await supabase.storage
    .from("demos")
    .upload(opslagPad, file, { contentType: file.type || "application/octet-stream", upsert: true });
  if (uploadError) return `Upload mislukt: ${uploadError.message}`;

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { error } = await supabase.from("site_bestanden").upsert(
    {
      lead_id: leadId,
      bestandsnaam: veiligeNaam,
      opslag_pad: opslagPad,
      content_type: file.type || null,
      grootte_bytes: file.size,
      omschrijving: omschrijving.trim() || null,
      toegevoegd_door: user?.email ?? null,
    },
    { onConflict: "lead_id,bestandsnaam" },
  );
  if (error) return `Kon bestand niet registreren: ${error.message}`;

  await logAudit("site_bestand_toegevoegd", leadId, { bestandsnaam: veiligeNaam });
  return null;
}

export async function deleteBestand(bestand: SiteBestand): Promise<string | null> {
  const supabase = createClient();
  const { error: storageError } = await supabase.storage.from("demos").remove([bestand.opslag_pad]);
  if (storageError) return `Kon bestand niet verwijderen: ${storageError.message}`;

  const { error } = await supabase.from("site_bestanden").delete().eq("id", bestand.id);
  if (error) return `Kon registratie niet verwijderen: ${error.message}`;

  await logAudit("site_bestand_verwijderd", bestand.lead_id, { bestandsnaam: bestand.bestandsnaam });
  return null;
}

// ── Access code for gated pages ──────────────────────────────────────────

export async function fetchToegang(leadId: string): Promise<SiteToegang | null> {
  const supabase = createClient();
  const { data } = await supabase
    .from("site_toegang")
    .select("lead_id, hint, aangemaakt_op, aangemaakt_door")
    .eq("lead_id", leadId)
    .maybeSingle();
  return (data as SiteToegang | null) ?? null;
}

async function sha256Hex(waarde: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(waarde));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Stores only a salted hash — the plaintext code exists in this function and
 * in whatever the user tells their client, nowhere else. Must stay byte-for-
 * byte compatible with hashCode() in supabase/functions/_shared/site-toegang.ts,
 * which is what verifies it on the public side.
 */
export async function setToegangscode(
  leadId: string,
  code: string,
  hint: string,
): Promise<string | null> {
  const schoon = code.trim();
  if (schoon.length < 6) return "Kies een code van minstens 6 tekens.";

  const supabase = createClient();
  const zout = [...crypto.getRandomValues(new Uint8Array(16))]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { error } = await supabase.from("site_toegang").upsert(
    {
      lead_id: leadId,
      code_hash: await sha256Hex(`${zout}:${schoon}`),
      salt: zout,
      hint: hint.trim() || null,
      aangemaakt_door: user?.email ?? null,
    },
    { onConflict: "lead_id" },
  );
  if (error) return `Kon code niet opslaan: ${error.message}`;

  await logAudit("site_toegangscode_ingesteld", leadId, {});
  return null;
}

export async function clearToegangscode(leadId: string): Promise<string | null> {
  const supabase = createClient();
  const { error } = await supabase.from("site_toegang").delete().eq("lead_id", leadId);
  if (error) return `Kon code niet verwijderen: ${error.message}`;
  await logAudit("site_toegangscode_verwijderd", leadId, {});
  return null;
}

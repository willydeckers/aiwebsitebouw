import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

/**
 * Een bestand uit Storage lezen, gegarandeerd de huidige inhoud.
 *
 * Kopie van worker/src/shared/opslag.ts (zelfde Deno/Node-splitsing als de
 * andere gedeelde bestanden). Een gewone `download()` gaat langs de CDN van
 * Supabase, en die geeft vlak na een overschrijving nog de vorige inhoud terug
 * — gemeten op 2026-09-27, ook met een nieuwe `cacheNonce`. Voor chat-edit
 * betekent dat: een tweede bewerking kort na de eerste leest de bron.json van
 * vóór de eerste, bouwt daarop verder, en draait de eerste stil terug. Een
 * ondertekende URL wordt niet gecachet, dus die leest wat er nu staat.
 */
export async function leesVers(supabase: SupabaseClient, pad: string): Promise<string | null> {
  const { data, error } = await supabase.storage.from("demos").createSignedUrl(pad, 60);
  if (error || !data) return null;
  const antwoord = await fetch(data.signedUrl, { cache: "no-store" });
  if (!antwoord.ok) return null;
  return await antwoord.text();
}

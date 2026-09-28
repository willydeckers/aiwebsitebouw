import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Een bestand uit Storage lezen, gegarandeerd de huidige inhoud.
 *
 * Een gewone `download()` gaat langs de CDN van Supabase, en die geeft vlak na
 * een overschrijving nog de vorige inhoud terug: gemeten op 2026-09-27, een
 * cache-HIT met oude bytes, ook voor een URL met een nieuwe `cacheNonce` (die
 * parameter telt niet mee in de cachesleutel). De invalidatie komt er wel,
 * maar pas na een paar seconden — precies het moment waarop de editor-sync of
 * een tweede chat-edit de bron opnieuw leest. Een tweede bewerking bouwde dan
 * verder op de versie van vóór de eerste, en draaide die stil terug.
 *
 * Een ondertekende URL wordt niet gecachet (altijd MISS, geen cache-headers),
 * dus die leest wat er nu staat. Eén extra aanroep per bestand; voor bestanden
 * waarvan je de verse inhoud nodig hebt, is dat het waard.
 */
export async function leesVers(supabase: SupabaseClient, pad: string): Promise<string | null> {
  const { data, error } = await supabase.storage.from("demos").createSignedUrl(pad, 60);
  if (error || !data) return null;
  const antwoord = await fetch(data.signedUrl, { cache: "no-store" });
  if (!antwoord.ok) return null;
  return await antwoord.text();
}

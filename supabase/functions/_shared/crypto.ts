// AES-GCM encrypt/decrypt for refresh tokens at rest (gmail_koppeling.refresh_token
// is bytea — spec section 6 comment says "encrypted at rest"). Key comes from
// GMAIL_TOKEN_ENCRYPTION_KEY, a base64-encoded 32-byte key generated once
// (e.g. `openssl rand -base64 32`) and stored as an Edge Function secret.

async function getKey(): Promise<CryptoKey> {
  const keyB64 = Deno.env.get("GMAIL_TOKEN_ENCRYPTION_KEY");
  if (!keyB64) throw new Error("GMAIL_TOKEN_ENCRYPTION_KEY ontbreekt.");
  const raw = Uint8Array.from(atob(keyB64), (c) => c.charCodeAt(0));
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}

// Stored layout: 12-byte IV followed by the ciphertext (with GCM's
// authentication tag appended by the Web Crypto API itself).
export async function encryptToken(plaintext: string): Promise<Uint8Array> {
  const key = await getKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(plaintext),
  );
  const out = new Uint8Array(iv.length + ciphertext.byteLength);
  out.set(iv, 0);
  out.set(new Uint8Array(ciphertext), iv.length);
  return out;
}

export async function decryptToken(stored: Uint8Array): Promise<string> {
  const key = await getKey();
  const iv = stored.slice(0, 12);
  const ciphertext = stored.slice(12);
  const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext);
  return new TextDecoder().decode(plaintext);
}

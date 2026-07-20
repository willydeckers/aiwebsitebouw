// The two fixed accounts (spec section 0: "Twee mensen gebruiken dit").
// No dedicated "which Supabase Auth user is which gebruiker" mapping table
// exists, so this heuristic (already used by send-email) is the shared
// source of truth: an email containing "garen" is Garen, anything else
// defaults to Warre.
export function gebruikerFromEmail(email: string | undefined | null): "warre" | "garen" {
  return email?.toLowerCase().includes("garen") ? "garen" : "warre";
}

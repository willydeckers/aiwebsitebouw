import { createClient } from "@/lib/supabase/client";

export type GmailKoppeling = {
  gebruiker: "warre" | "garen";
  gekoppeld_op: string | null;
  status: "actief" | "verlopen" | "niet_gekoppeld";
};

function gebruikerFromEmail(email: string | undefined | null): "warre" | "garen" {
  return email?.toLowerCase().includes("garen") ? "garen" : "warre";
}

export async function fetchOwnGmailKoppeling(): Promise<GmailKoppeling | null> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const gebruiker = gebruikerFromEmail(user.email);
  const { data } = await supabase
    .from("gmail_koppeling")
    .select("gebruiker, gekoppeld_op, status")
    .eq("gebruiker", gebruiker)
    .maybeSingle();

  return (data as GmailKoppeling | null) ?? { gebruiker, gekoppeld_op: null, status: "niet_gekoppeld" };
}

const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.send";

// access_type=offline + prompt=consent (spec 2: "verzending 7+ dagen na
// koppeling nog werkend" needs a refresh_token, which Google only issues
// on a consent grant, not a silent re-auth).
export function buildGmailAuthUrl(redirectUri: string): string {
  const clientId = process.env.NEXT_PUBLIC_GOOGLE_OAUTH_CLIENT_ID ?? "";
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: GMAIL_SCOPE,
    access_type: "offline",
    prompt: "consent",
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

export async function exchangeGmailCode(code: string, redirectUri: string): Promise<string | null> {
  const supabase = createClient();
  const { data, error } = await supabase.functions.invoke("gmail-oauth-exchange", {
    body: { code, redirectUri },
  });

  if (error) return `Gmail-koppeling mislukt: ${error.message}`;
  if (data?.error) return data.error as string;

  return null;
}

export async function disconnectGmail(): Promise<string | null> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return "Niet ingelogd.";

  const { error } = await supabase
    .from("gmail_koppeling")
    .update({ status: "niet_gekoppeld", refresh_token: null })
    .eq("gebruiker", gebruikerFromEmail(user.email));

  return error ? `Ontkoppelen mislukt: ${error.message}` : null;
}

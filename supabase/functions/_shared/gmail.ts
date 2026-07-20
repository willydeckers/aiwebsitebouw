// Raw REST calls instead of the `googleapis` npm package — that library is
// large and Node-oriented; Deno's fetch covers the two calls we need.

async function getAccessToken(refreshToken: string): Promise<string> {
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: Deno.env.get("GOOGLE_OAUTH_CLIENT_ID")!,
      client_secret: Deno.env.get("GOOGLE_OAUTH_CLIENT_SECRET")!,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });

  const json = await response.json();
  if (!response.ok) {
    throw new Error(`Gmail-token vernieuwen mislukt: ${JSON.stringify(json)}`);
  }
  return json.access_token as string;
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function sendGmail({
  refreshToken,
  from,
  to,
  subject,
  html,
}: {
  refreshToken: string;
  from: string;
  to: string;
  subject: string;
  html: string;
}): Promise<void> {
  const accessToken = await getAccessToken(refreshToken);

  const message = [
    `To: ${to}`,
    `From: ${from}`,
    `Subject: ${subject}`,
    "Content-Type: text/html; charset=utf-8",
    "",
    html,
  ].join("\r\n");

  const raw = toBase64Url(new TextEncoder().encode(message));

  const response = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ raw }),
  });

  if (!response.ok) {
    throw new Error(`Gmail-verzending mislukt: ${await response.text()}`);
  }
}

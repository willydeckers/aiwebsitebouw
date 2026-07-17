import { google } from "googleapis";

function createGmailClient() {
  const oauth2Client = new google.auth.OAuth2(
    process.env.GMAIL_CLIENT_ID,
    process.env.GMAIL_CLIENT_SECRET,
  );
  oauth2Client.setCredentials({ refresh_token: process.env.GMAIL_REFRESH_TOKEN });
  return google.gmail({ version: "v1", auth: oauth2Client });
}

function buildRawMessage(to: string, from: string, subject: string, html: string): string {
  const message = [
    `To: ${to}`,
    `From: ${from}`,
    `Subject: ${subject}`,
    "Content-Type: text/html; charset=utf-8",
    "",
    html,
  ].join("\r\n");

  return Buffer.from(message).toString("base64url");
}

export async function sendEmail({
  to,
  subject,
  html,
}: {
  to: string;
  subject: string;
  html: string;
}): Promise<void> {
  const gmail = createGmailClient();
  const from = process.env.GMAIL_SENDER_EMAIL!;

  await gmail.users.messages.send({
    userId: "me",
    requestBody: { raw: buildRawMessage(to, from, subject, html) },
  });
}

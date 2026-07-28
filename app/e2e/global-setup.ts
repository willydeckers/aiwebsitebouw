import { createClient } from "@supabase/supabase-js";
import { chromium, type FullConfig } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

// Signs the test suite in once, without a password anywhere.
//
// The obvious approach — put E2E_EMAIL/E2E_PASSWORD in the environment and
// type them into the login form — puts a real, working credential for a live
// project into CI config and developer shells. It also tests Supabase's login
// form rather than this app.
//
// Instead: the service-role key (already needed to run against a real project)
// mints a one-time magic link for an existing user, exchanges it for a
// session, and writes that session into the browser's storage. No password is
// stored, typed or transmitted, and the token expires on its own.

export const OPSLAG_STAAT = "e2e/.auth/storage-state.json";

export default async function globalSetup(config: FullConfig) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !anon || !serviceRole) {
    throw new Error(
      "E2E vereist NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY en " +
        "SUPABASE_SERVICE_ROLE_KEY. Draai met: npx playwright test --config=playwright.config.ts " +
        "en zorg dat .env.local die drie bevat (de service-role-key haal je met " +
        "`supabase projects api-keys --project-ref <ref>`).",
    );
  }

  const admin = createClient(url, serviceRole);
  const { data: users, error: usersError } = await admin.auth.admin.listUsers();
  if (usersError) throw new Error(`Kon gebruikers niet ophalen: ${usersError.message}`);

  const email = process.env.E2E_GEBRUIKER ?? users.users[0]?.email;
  if (!email) throw new Error("Geen gebruiker gevonden om mee in te loggen.");

  const { data: link, error: linkError } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email,
  });
  if (linkError) throw new Error(`Kon magic link niet maken: ${linkError.message}`);

  const anonClient = createClient(url, anon);
  const { data: sessie, error: otpError } = await anonClient.auth.verifyOtp({
    type: "magiclink",
    token_hash: link.properties.hashed_token,
  });
  if (otpError || !sessie.session) {
    throw new Error(`Kon geen sessie maken: ${otpError?.message}`);
  }

  const baseURL = config.projects[0]?.use?.baseURL ?? "http://localhost:3000";

  // Write the session as the COOKIE @supabase/ssr expects.
  //
  // Two approaches were tried and rejected first, both worth recording because
  // each looks right:
  //  - localStorage: this app uses @supabase/ssr, which deliberately stores in
  //    cookies so the server can read them. The app just showed the login page.
  //  - walking the magic-link verify URL in the browser: the redirect arrived
  //    with no fragment and no cookies, so nothing was ever established.
  // The format below is taken from the installed @supabase/ssr, not guessed:
  // a "base64-" prefix, base64url without padding, chunked at 3180 characters.
  const projectRef = new URL(url).hostname.split(".")[0];
  const cookieNaam = `sb-${projectRef}-auth-token`;
  const base64url = Buffer.from(JSON.stringify(sessie.session), "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  const waarde = `base64-${base64url}`;

  const MAX_CHUNK = 3180;
  const doel = new URL(baseURL);
  const cookies =
    waarde.length <= MAX_CHUNK
      ? [{ naam: cookieNaam, waarde }]
      : Array.from({ length: Math.ceil(waarde.length / MAX_CHUNK) }, (_, i) => ({
          naam: `${cookieNaam}.${i}`,
          waarde: waarde.slice(i * MAX_CHUNK, (i + 1) * MAX_CHUNK),
        }));

  const browser = await chromium.launch();
  const context = await browser.newContext();
  await context.addCookies(
    cookies.map((c) => ({
      name: c.naam,
      value: c.waarde,
      domain: doel.hostname,
      path: "/",
      httpOnly: false,
      secure: doel.protocol === "https:",
      sameSite: "Lax" as const,
      expires: Math.floor(Date.now() / 1000) + 60 * 60,
    })),
  );

  // Prove it worked here rather than letting every test fail with a confusing
  // "element not found" on the login screen.
  const page = await context.newPage();
  await page.goto(`${baseURL}/leads`);
  await page.waitForLoadState("networkidle");
  const zietLogin = await page
    .locator('input[name="password"]')
    .isVisible({ timeout: 3000 })
    .catch(() => false);
  if (zietLogin) {
    throw new Error(
      "Inloggen mislukt: de app toont nog het loginscherm. Waarschijnlijk is het " +
        "cookieformaat van @supabase/ssr gewijzigd — vergelijk met node_modules/@supabase/ssr/" +
        "dist/main/cookies.js (BASE64_PREFIX) en utils/chunker.js (MAX_CHUNK_SIZE).",
    );
  }

  mkdirSync(dirname(OPSLAG_STAAT), { recursive: true });
  writeFileSync(OPSLAG_STAAT, JSON.stringify(await context.storageState(), null, 2));
  await browser.close();

  console.log(`E2E: ingelogd als ${email}`);
}

// Access codes for gated pages, and the session cookie that proves one was
// entered. Used only by track-and-serve (public path) and the app's own
// "stel een toegangscode in" action.
//
// Scope, stated plainly because it matters: this is a shared code per site,
// not an account system. There is no user model in this project, and building
// one into a static-hosting layer would promise a security property it cannot
// keep. What this DOES guarantee is that a gated page's HTML never leaves the
// server without the code — the gate is server-side, not a hidden div. That's
// the honest version of "gated content" for this architecture.

const CODE_COOKIE = "site_toegang";

async function sha256Hex(waarde: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(waarde));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function nieuwZout(): string {
  return [...crypto.getRandomValues(new Uint8Array(16))]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function hashCode(code: string, zout: string): Promise<string> {
  return sha256Hex(`${zout}:${code.trim()}`);
}

/**
 * The cookie value. Derived from the code hash rather than being the hash
 * itself, so a leaked cookie can't be replayed as a stored credential, and
 * rotating the code invalidates every cookie already handed out.
 */
export function cookieWaarde(codeHash: string, leadId: string): Promise<string> {
  return sha256Hex(`cookie:${leadId}:${codeHash}`);
}

export function leesCookie(req: Request, naam: string): string | null {
  const koekjes = req.headers.get("cookie");
  if (!koekjes) return null;
  for (const deel of koekjes.split(";")) {
    const [sleutel, ...rest] = deel.trim().split("=");
    if (sleutel === naam) return rest.join("=");
  }
  return null;
}

export async function heeftToegang(
  req: Request,
  leadId: string,
  codeHash: string,
): Promise<boolean> {
  const cookie = leesCookie(req, CODE_COOKIE);
  if (!cookie) return false;
  return cookie === (await cookieWaarde(codeHash, leadId));
}

export async function toegangCookieHeader(leadId: string, codeHash: string, basisPad: string): Promise<string> {
  const waarde = await cookieWaarde(codeHash, leadId);
  // HttpOnly so page scripts can't read it, SameSite=Lax so a link from the
  // client's own mail still arrives authenticated, Path scoped to this lead so
  // one client's code never unlocks another's site on a shared domain.
  return `${CODE_COOKIE}=${waarde}; Path=${basisPad}; HttpOnly; SameSite=Lax; Secure; Max-Age=${60 * 60 * 24 * 30}`;
}

function escapeHtml(waarde: string): string {
  return waarde.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** The code prompt itself. Plain, self-contained HTML — this page is served
 *  instead of the gated one, so it cannot depend on anything in the site. */
export function toegangFormulier(opties: {
  bedrijfsnaam: string;
  hint: string | null;
  fout: boolean;
  actie: string;
  doel: string;
}): string {
  return `<!DOCTYPE html>
<html lang="nl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Toegangscode — ${escapeHtml(opties.bedrijfsnaam)}</title>
<style>
  body { font-family: system-ui, sans-serif; margin: 0; min-height: 100vh; display: grid; place-items: center;
         background: #f8fafc; color: #0f172a; }
  main { background: #fff; padding: 2rem; border-radius: 1rem; box-shadow: 0 10px 30px rgba(15,23,42,.08);
         width: min(24rem, 90vw); }
  h1 { font-size: 1.25rem; margin: 0 0 .5rem; }
  p { color: #475569; font-size: .925rem; margin: 0 0 1.25rem; }
  label { display: block; font-size: .875rem; font-weight: 600; margin-bottom: .375rem; }
  input { width: 100%; padding: .625rem .75rem; border: 1px solid #cbd5e1; border-radius: .5rem; font-size: 1rem;
          box-sizing: border-box; }
  button { width: 100%; margin-top: 1rem; padding: .675rem; border: 0; border-radius: .5rem; background: #0f172a;
           color: #fff; font-size: 1rem; font-weight: 600; cursor: pointer; }
  .fout { color: #b91c1c; font-size: .875rem; margin-top: .75rem; }
</style>
</head>
<body>
<main>
  <h1>Deze pagina is afgeschermd</h1>
  <p>${opties.hint ? escapeHtml(opties.hint) : "Vul de toegangscode in die je van ons kreeg."}</p>
  <form method="post" action="${escapeHtml(opties.actie)}">
    <input type="hidden" name="doel" value="${escapeHtml(opties.doel)}">
    <label for="code">Toegangscode</label>
    <input id="code" name="code" type="password" autocomplete="current-password" autofocus required>
    <button type="submit">Openen</button>
    ${opties.fout ? '<p class="fout">Die code klopt niet. Probeer opnieuw.</p>' : ""}
  </form>
</main>
</body>
</html>
`;
}

// Spec section 7: "KBO-portaal-/website-scraping: robots.txt, redelijke
// snelheid, herkenbare User-Agent." This is a simplified robots.txt check
// (only handles a flat "Disallow: /" under User-agent: * or our own UA) —
// not a full parser (wildcards, crawl-delay, etc. aren't handled) — good
// enough to respect the common "don't scrape me at all" case without
// pulling in a dependency for it.
const USER_AGENT = "WebAgencyDashboardBot/1.0 (+sourcing-run, zie sectie 3.1a)";

async function isAllowedByRobots(origin: string): Promise<boolean> {
  try {
    const response = await fetch(`${origin}/robots.txt`, {
      headers: { "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return true; // no robots.txt -> allowed by default

    const text = await response.text();
    const lines = text.split("\n").map((l) => l.trim());
    let relevant = false;
    for (const line of lines) {
      const [key, ...rest] = line.split(":");
      const value = rest.join(":").trim();
      if (/^user-agent$/i.test(key)) {
        relevant = value === "*" || value.toLowerCase().includes("webagencydashboardbot");
      } else if (relevant && /^disallow$/i.test(key) && value === "/") {
        return false;
      }
    }
    return true;
  } catch {
    return true; // robots.txt unreachable -> don't block on that alone
  }
}

export type WebsiteStatus = "geen" | "kapot" | "matig" | "goed";

export async function checkWebsiteStatus(
  url: string | null,
): Promise<{ status: WebsiteStatus; html: string | null }> {
  if (!url) return { status: "geen", html: null };

  let origin: string;
  try {
    origin = new URL(url).origin;
  } catch {
    return { status: "kapot", html: null };
  }

  if (!(await isAllowedByRobots(origin))) {
    return { status: "matig", html: null }; // respect robots.txt: no fetch, no verdict beyond "exists"
  }

  try {
    const response = await fetch(url, {
      headers: { "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) return { status: "kapot", html: null };

    const html = await response.text();
    // Heuristic, not a real quality audit: a page with almost no markup
    // or no title is "matig" (thin/placeholder), anything more is "goed".
    const hasTitle = /<title>[^<]{3,}<\/title>/i.test(html);
    const isThin = html.length < 2000;
    return { status: hasTitle && !isThin ? "goed" : "matig", html };
  } catch {
    return { status: "kapot", html: null };
  }
}

// Spec section 7's GDPR heuristic: a recognizable firstname.lastname@
// pattern is a natural person's data (persoonsgebonden); a generic
// info@/contact@-style prefix is not.
export function isPersoonsgebonden(email: string): boolean {
  const local = email.split("@")[0]?.toLowerCase() ?? "";
  const genericPrefixes = ["info", "contact", "hello", "hallo", "sales", "office", "mail", "shop", "webshop"];
  if (genericPrefixes.some((p) => local === p || local.startsWith(`${p}.`) || local.startsWith(`${p}-`))) {
    return false;
  }
  return /^[a-z]+[._-][a-z]+$/.test(local);
}

const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

export function extractContactEmail(html: string): string | null {
  const matches = html.match(EMAIL_REGEX);
  if (!matches || matches.length === 0) return null;

  // Prefer a generic address if one exists (spec 7: "gebruik bij voorkeur
  // het generieke adres... tot [juridische] bevestiging er is").
  const generic = matches.find((m) => !isPersoonsgebonden(m));
  return generic ?? matches[0];
}

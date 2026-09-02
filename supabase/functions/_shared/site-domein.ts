/**
 * Welke site een request bedoelt, en waar die site zijn eigen endpoints onder
 * vindt. Bewust een pure functie los van track-and-serve: dit is de enige plek
 * waar de twee manieren van binnenkomen samenkomen, en dus precies de plek waar
 * een fout stil is — een verkeerd basispad geeft geen exception, het geeft een
 * formulier dat naar niets post.
 *
 * De twee vormen:
 *   1. de functie-URL   .../track-and-serve/{leadId}/contact.html
 *   2. een eigen domein  https://klant.be/contact.html
 *
 * In vorm 2 zit er geen lead-id in het pad; die komt uit `klanten` via de
 * Host-header. Dat opzoeken gebeurt in de aanroeper, want het raakt de
 * database — hier blijft enkel de beslissing die je kan uittesten.
 */

export type RouteVorm =
  | {
      soort: "platform";
      leadId: string;
      /** Padsegmenten ná de lead-prefix. */
      segmenten: string[];
      /** Waar de site zijn endpoints onder vindt, met slash op het einde. */
      basisPad: string;
      /** Publieke map-URL van deze site, zonder slash. Null = niet te bepalen. */
      basisUrl: string | null;
    }
  | {
      soort: "domein";
      host: string;
      segmenten: string[];
      basisPad: string;
      basisUrl: string;
    };

/**
 * Alles wat niet op onze eigen hostnaam binnenkomt, is een gekoppeld domein —
 * of een vergissing, en dan vindt de aanroeper niets.
 *
 * `hostingBase` hoort er expliciet bij, en dat is het subtiele geval: de vaste
 * oorsprong is zelf een eigen domein (het Supabase custom-domain, bv.
 * sites-oorsprong.yudexstudios.com). Zonder deze vergelijking zou een request
 * op die oorsprong als klantdomein worden opgezocht, niets vinden en 404'en —
 * terwijl dat net de URL is waar élke demo-link naartoe wijst.
 */
export function isEigenPlatformHost(host: string, hostingBase: string): boolean {
  const zonderPoort = host.split(":")[0].toLowerCase();
  if (
    zonderPoort.endsWith(".supabase.co") ||
    zonderPoort.endsWith(".supabase.in") ||
    zonderPoort === "localhost" ||
    zonderPoort === "127.0.0.1" ||
    zonderPoort === "host.docker.internal"
  ) {
    return true;
  }

  if (!hostingBase) return false;
  try {
    return new URL(hostingBase).hostname.toLowerCase() === zonderPoort;
  } catch {
    // Een onleesbare DEMO_HOSTING_URL mag geen enkel domein blokkeren.
    return false;
  }
}

export function bepaalRouteVorm(
  host: string,
  pathname: string,
  segments: string[],
  hostingBase: string,
): RouteVorm | null {
  const basis = hostingBase.replace(/\/$/, "");
  const zonderPoort = host.split(":")[0].toLowerCase();

  if (!isEigenPlatformHost(host, basis)) {
    return {
      soort: "domein",
      host: zonderPoort,
      segmenten: segments,
      // Op een eigen domein staat de site in de root, dus alles wat de
      // pagina's terugroepen hangt onder "/".
      basisPad: "/",
      basisUrl: `https://${zonderPoort}`,
    };
  }

  if (!segments[0]) return null;
  const leadId = segments[0];
  return {
    soort: "platform",
    leadId,
    segmenten: segments.slice(1),
    basisPad: pathname.slice(0, pathname.indexOf(leadId) + leadId.length) + "/",
    basisUrl: basis ? `${basis}/${leadId}` : null,
  };
}

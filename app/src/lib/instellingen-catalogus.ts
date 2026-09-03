// Elke instelling die dit project kent, op één plek beschreven.
//
// De lijst bestaat zodat het instellingenscherm kan uitleggen wát je invult en
// wat er stukgaat als het ontbreekt — anders is het een rij naamloze tekstvakken
// en moet je alsnog in de code of de README gaan zoeken, wat precies het
// probleem was dat dit scherm oplost.
//
// De namen zijn letterlijk de omgevingsvariabelen die de code leest. Bewust
// geen eigen namenschema: dan valt er niets te vertalen en kan er niets uit de
// pas lopen met wat de worker of een Edge Function verwacht.

export type Instelling = {
  sleutel: string;
  label: string;
  uitleg: string;
  /** Afgeschermd tonen in het scherm. */
  geheim?: boolean;
  /** Wat er niet werkt zolang dit leeg is. */
  nodigVoor?: string;
  /** Waar je de waarde vandaan haalt. */
  waar?: string;
};

export type InstellingGroep = {
  naam: string;
  uitleg: string;
  instellingen: Instelling[];
};

export const INSTELLINGEN: InstellingGroep[] = [
  {
    naam: "AI",
    uitleg: "Zonder deze sleutel kan de worker niets genereren, onderzoeken of nakijken.",
    instellingen: [
      {
        sleutel: "ANTHROPIC_API_KEY",
        label: "Anthropic API-sleutel",
        uitleg: "Gebruikt voor research, generatie, de review-loop en chat-aanpassingen.",
        geheim: true,
        nodigVoor: "research, generatie, review, chat",
        waar: "console.anthropic.com → API keys",
      },
    ],
  },
  {
    naam: "Hosting en domein",
    uitleg: "Waar de gegenereerde sites te bereiken zijn.",
    instellingen: [
      {
        sleutel: "DEMO_HOSTING_URL",
        label: "Publieke basis-URL",
        uitleg:
          "De basis waarop demo's bereikbaar zijn, bv. https://sites.jouwbureau.be. Ontbreekt hij, dan blijven canonical-, Open Graph- en sitemap-verwijzingen weg in plaats van half ingevuld.",
        nodigVoor: "SEO-tags, sitemap, e-maillinks",
      },
      {
        sleutel: "ANALYTICS_SCRIPT_URL",
        label: "Meetscript voor bezoekcijfers",
        uitleg:
          "Volledige URL van een cookieloos meetscript, bv. https://plausible.io/js/script.js. Leeg = geen statistieken en geen cookiemelding op de sites.",
        nodigVoor: "bezoekcijfers en de cookiemelding",
      },
      {
        sleutel: "CLOUDFLARE_API_TOKEN",
        label: "Cloudflare API-token",
        uitleg: "Enkel nodig om een eigen klantdomein te koppelen; een bureau-subdomein werkt zonder.",
        geheim: true,
        nodigVoor: "eigen domein koppelen",
        waar: "Cloudflare → My Profile → API Tokens (rechten op enkel jouw zone)",
      },
      {
        sleutel: "CLOUDFLARE_ZONE_ID",
        label: "Cloudflare zone-id",
        uitleg: "De zone van je eigen domein in Cloudflare.",
        nodigVoor: "eigen domein koppelen",
      },
      {
        sleutel: "CLOUDFLARE_CNAME_DOEL",
        label: "Cloudflare CNAME-doel",
        uitleg: "Waar het domein van de klant naartoe moet wijzen.",
        nodigVoor: "eigen domein koppelen",
      },
    ],
  },
  {
    naam: "Shopify",
    uitleg: "Alleen nodig voor klanten met een webshop.",
    instellingen: [
      {
        sleutel: "SHOPIFY_PARTNER_ORGANIZATION_ID",
        label: "Partner-organisatie-id",
        uitleg:
          "Staat in de URL van je Partner Dashboard. Zonder dit sterft een winkelaanmaak meteen bij de eerste stap.",
        nodigVoor: "winkel aanmaken",
      },
      {
        sleutel: "SHOPIFY_PARTNER_ACCESS_TOKEN",
        label: "Partner API-token",
        uitleg: "Let op: die API kan zelf géén winkels aanmaken; dat gebeurt via het dashboard.",
        geheim: true,
      },
      {
        sleutel: "SHOPIFY_APP_CLIENT_ID",
        label: "App client-id",
        uitleg: "Van één app in het Shopify Dev Dashboard, geïnstalleerd op de winkel van de klant.",
        nodigVoor: "de winkel vullen",
        waar: "dev.shopify.com/dashboard → Apps → Create app",
      },
      {
        sleutel: "SHOPIFY_APP_CLIENT_SECRET",
        label: "App client-secret",
        uitleg: "Van diezelfde app. Hiermee haalt de pipeline per winkel een token op dat 24 uur geldig is.",
        geheim: true,
      },
    ],
  },
  {
    naam: "E-mail",
    uitleg: "Voor het versturen van demo's vanaf je eigen Gmail-adres.",
    instellingen: [
      {
        sleutel: "GOOGLE_OAUTH_CLIENT_ID",
        label: "Google OAuth client-id",
        uitleg: "Van een OAuth-client (type webapplicatie) in Google Cloud.",
        nodigVoor: "Gmail koppelen",
        waar: "console.cloud.google.com → APIs & Services → Credentials",
      },
      {
        sleutel: "GOOGLE_OAUTH_CLIENT_SECRET",
        label: "Google OAuth client-secret",
        uitleg: "Van diezelfde OAuth-client.",
        geheim: true,
      },
      {
        sleutel: "GOOGLE_PLACES_API_KEY",
        label: "Google Places API-sleutel",
        uitleg: "Optioneel. Zonder deze sleutel slaat het automatisch zoeken de Places-verrijking over.",
        geheim: true,
        nodigVoor: "automatisch leads zoeken (verrijking)",
      },
    ],
  },
];

/** Platte lijst, handig om een waarde bij een sleutel te zoeken. */
export const ALLE_INSTELLINGEN: Instelling[] = INSTELLINGEN.flatMap((g) => g.instellingen);

/**
 * Wat bewust NIET in dit scherm staat. Losse tekst en geen invoerveld, omdat
 * een veld beloven dat we niet kunnen waarmaken erger is dan het uitleggen: de
 * worker heeft deze twee nodig om deze tabel überhaupt te kunnen lezen.
 */
export const BOOTSTRAP_SLEUTELS = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"];

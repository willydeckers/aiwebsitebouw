/**
 * Het `seo`-blok dat bouwSite() nodig heeft om canonical, Open Graph en de
 * LocalBusiness-JSON-LD te kunnen zetten.
 *
 * Waarom dit een apart, puur bestand is en niet gewoon een paar regels in de
 * aanroeper: het ontbreken van dit blok is een stille fout. bouwSite() laat de
 * tags dan simpelweg weg — geen exception, geen waarschuwing, en een screenshot
 * van de pagina ziet er exact hetzelfde uit. Precies zo is het één keer
 * misgegaan: `chat-edit-static` riep bouwSite() zonder dit blok aan, waardoor
 * canonical/OG/JSON-LD van élke pagina verdwenen zodra er via de chat één
 * wijziging was doorgevoerd. Dat is maandenlang niet opgevallen.
 *
 * Dezelfde regels staan in worker/src/pipeline/generate-demo.ts
 * (bouwSeoGegevens) voor de generatiestap, die in Node draait. Houd ze gelijk.
 */

import { standaardOgAfbeelding } from "./image-bank.ts";
import type { SeoGegevens } from "./site-builder.ts";

export type SeoLead = {
  sector?: string | null;
  adres?: string | null;
  telefoon?: string | null;
  notities?: string | null;
  research_samenvatting?: string | null;
};

export function bouwSeoGegevens(opties: {
  leadId: string;
  /** Rechtstreeks uit DEMO_HOSTING_URL. Leeg = geen SEO-tags. */
  hostingBase: string;
  lead: SeoLead | null;
  /** Namen van de bestanden die voor deze lead geüpload zijn. */
  bestanden: string[];
}): SeoGegevens | undefined {
  const hostingBase = (opties.hostingBase ?? "").trim().replace(/\/$/, "");

  // Canonical en og:url kunnen enkel absolute URL's zijn. Zonder basis-URL
  // blijven de tags dus weg in plaats van half ingevuld te zijn: een canonical
  // die naar het verkeerde adres wijst is erger dan geen canonical.
  if (!hostingBase || !opties.lead) return undefined;

  const { lead } = opties;
  const logo = opties.bestanden.find((b) => /^logo\./i.test(b));
  const sector = lead.sector ?? "";
  const briefing = `${lead.notities ?? ""} ${lead.research_samenvatting ?? ""}`;

  return {
    leadId: opties.leadId,
    hostingBase,
    sector,
    adres: lead.adres,
    telefoon: lead.telefoon,
    // Een eigen logo is het beste deelbeeld; anders een foto die bij de sector
    // past, en anders niets.
    ogAfbeelding: logo
      ? `${hostingBase}/${opties.leadId}/bestanden/${encodeURIComponent(logo)}`
      : standaardOgAfbeelding(sector, briefing),
  };
}

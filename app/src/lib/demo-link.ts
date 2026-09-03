// Waar de publieke versie van een site te bereiken is.
//
// Dit stond op drie plaatsen als `process.env.NEXT_PUBLIC_DEMO_HOSTING_URL`,
// en was daardoor overal leeg zolang die variabele niet gezet is — wat ze niet
// was. Gevolg: het dashboard kon nergens de link tonen die wél gewoon werkt.
//
// De functie-URL is af te leiden uit de Supabase-URL die de app sowieso al
// heeft, dus die is de terugval. Zodra er een eigen domein voor de hosting
// bestaat, zet je NEXT_PUBLIC_DEMO_HOSTING_URL en wint die.

const SUPABASE_URL = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/$/, "");
const EXPLICIET = (process.env.NEXT_PUBLIC_DEMO_HOSTING_URL ?? "").replace(/\/$/, "");

/** Basis-URL van de hostinglaag, zonder slash op het einde. Leeg als er geen
 *  Supabase-URL bekend is (dan valt er niets te linken). */
export function demoBasisUrl(): string {
  if (EXPLICIET) return EXPLICIET;
  return SUPABASE_URL ? `${SUPABASE_URL}/functions/v1/track-and-serve` : "";
}

/**
 * De publieke link naar de site van één lead.
 *
 * De slash op het einde is niet cosmetisch: de pagina's linken relatief naar
 * elkaar, dus de browser moet /{leadId}/ als map behandelen. track-and-serve
 * stuurt door om hem toe te voegen, maar meteen goed linken scheelt die ronde.
 */
export function demoLink(leadId: string): string | null {
  const basis = demoBasisUrl();
  return basis ? `${basis}/${leadId}/` : null;
}

/**
 * Of die link ook echt een site tóónt in een browser.
 *
 * Op *.supabase.co niet. De edge-gateway daar herschrijft élk antwoord dat niet
 * al text/plain is naar text/plain, met `Content-Security-Policy: default-src
 * 'none'; sandbox` en `X-Content-Type-Options: nosniff` erbij — gemeten op
 * 2026-09-03, op zowel de HTML-pagina's als sitemap.xml. Een bezoeker ziet dan
 * de broncode in plaats van de site.
 *
 * Alles wat de HTML programmatisch ophaalt (de preview in de app, de
 * screenshots van de review-loop) werkt daar prima mee; enkel een mens met een
 * browser niet. Dat verandert zodra de hosting op een eigen domein staat en
 * NEXT_PUBLIC_DEMO_HOSTING_URL daarnaar wijst.
 */
export function linkRendertInBrowser(): boolean {
  const basis = demoBasisUrl();
  if (!basis) return false;
  try {
    return !new URL(basis).hostname.endsWith(".supabase.co");
  } catch {
    return false;
  }
}

// Duplicated from app/src/lib/pipeline/sector-styles.ts rather than shared
// across the module boundary — Supabase deploys each function's directory
// in isolation, so a relative import reaching outside supabase/functions/
// wouldn't survive deployment. Keep the two in sync by hand.
const SECTOR_STYLES: { keywords: string[]; guidance: string }[] = [
  {
    keywords: ["bloem", "bakker", "slager", "ambacht", "traiteur", "chocolat"],
    guidance:
      "Ambacht-stijl: warme, aardse kleuren (terracotta, crème, donkergroen), " +
      "een serif-lettertype voor titels, veel witruimte, grote productfoto's " +
      "met ronde hoeken. Voelt handgemaakt en persoonlijk, niet corporate.",
  },
  {
    keywords: ["restaurant", "café", "cafe", "horeca", "bistro", "traiteur"],
    guidance:
      "Horeca-stijl: donkere, sfeervolle achtergrond met warme accentkleur " +
      "(bourgondischrood of amber), sober sans-serif lettertype, grote " +
      "sfeerfoto boven de vouw, menu/aanbod duidelijk in kaartjes.",
  },
  {
    keywords: ["dienst", "consult", "advocaat", "boekhoud", "kantoor"],
    guidance:
      "Diensten-stijl: rustig, zakelijk kleurenschema (marineblauw, grijs, " +
      "wit), strak sans-serif lettertype, duidelijke kopjes met USP's, " +
      "call-to-action-knop prominent bovenaan.",
  },
];

const DEFAULT_GUIDANCE = SECTOR_STYLES[0].guidance;

export function getSectorStyleGuidance(sector: string): string {
  const normalized = sector.toLowerCase();
  const match = SECTOR_STYLES.find(({ keywords }) =>
    keywords.some((keyword) => normalized.includes(keyword)),
  );
  return match?.guidance ?? DEFAULT_GUIDANCE;
}

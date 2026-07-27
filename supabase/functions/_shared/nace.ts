// Kept in sync by hand with app/src/lib/nace.ts (no shared-package setup
// between the Next.js app and Deno Edge Functions in this repo) — same
// caveat applies: practical starting set, not the full official
// nomenclature, verify against Statbel's NACE-BEL 2008 codelist before
// relying on the exact 6-digit codes for real KBO matching.
const NACE_LABELS: Record<string, string> = {
  "47.76101": "Bloemist / detailhandel bloemen en planten",
  "47.76201": "Detailhandel huisdieren en huisdiervoeding",
  "96.021": "Haarverzorging",
  "96.022": "Schoonheidsverzorging",
  "56.101": "Restaurant",
  "56.301": "Café / drinkgelegenheid",
  "47.711": "Detailhandel kleding (algemeen)",
  "47.721": "Detailhandel schoeisel en lederwaren",
  "43.341": "Schilderwerk",
  "43.221": "Loodgieterswerk / sanitaire installaties",
  "43.320": "Schrijnwerk / afwerking van gebouwen",
  "45.20": "Onderhoud en reparatie van auto's",
  "47.910": "Detailhandel via postorderbedrijven of internet",
  "74.201": "Fotobeoefening",
  "75.00": "Diergeneeskundige activiteiten",
  "93.130": "Fitnesscentra",
  "93.120": "Sportclubs",
};

export function naceLabel(code: string): string {
  return NACE_LABELS[code] ?? code;
}

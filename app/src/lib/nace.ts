// Human-readable labels for NACE-BEL codes (spec 3.1a: sourcing filters on
// NACE + postcode, but a raw code like "47.76101" means nothing to Warre or
// Garen when picking a sourcing target or scanning the leads list).
//
// This is a practical starting set for common KMO-sectoren, not the full
// official nomenclature (that's ~1000+ codes) — it covers what a web agency
// is likely to source for, grouped into categories for the sourcing-config
// picker. Verify/extend against the official Statbel NACE-BEL 2008 codelist
// (https://statbel.fgov.be) before relying on the exact 6-digit codes for
// real KBO matching; the categories and general codes are solid, the
// precise 6-digit Belgian sub-codes are the part most likely to need a
// correction.

export type NaceCategory = {
  key: string;
  label: string;
  codes: string[];
};

export const NACE_CATEGORIES: NaceCategory[] = [
  {
    key: "bloemen-tuin",
    label: "Bloemisten & tuincentra",
    codes: ["47.76101", "47.76201"],
  },
  {
    key: "haar-schoonheid",
    label: "Kappers & schoonheidsverzorging",
    codes: ["96.021", "96.022"],
  },
  {
    key: "horeca",
    label: "Horeca (restaurants & cafés)",
    codes: ["56.101", "56.301"],
  },
  {
    key: "kleding-mode",
    label: "Kleding & mode",
    codes: ["47.711", "47.721"],
  },
  {
    key: "bouw-renovatie",
    label: "Bouw & renovatie",
    codes: ["43.341", "43.221", "43.320"],
  },
  {
    key: "auto",
    label: "Autogarages & carrosserie",
    codes: ["45.20"],
  },
  {
    key: "webshops",
    label: "Webshops & postorder",
    codes: ["47.910"],
  },
  {
    key: "fotografie",
    label: "Fotografen",
    codes: ["74.201"],
  },
  {
    key: "dierenartsen",
    label: "Dierenartsen",
    codes: ["75.00"],
  },
  {
    key: "fitness",
    label: "Fitness & sportclubs",
    codes: ["93.130", "93.120"],
  },
];

export const NACE_LABELS: Record<string, string> = Object.fromEntries(
  [
    ["47.76101", "Bloemist / detailhandel bloemen en planten"],
    ["47.76201", "Detailhandel huisdieren en huisdiervoeding"],
    ["96.021", "Haarverzorging"],
    ["96.022", "Schoonheidsverzorging"],
    ["56.101", "Restaurant"],
    ["56.301", "Café / drinkgelegenheid"],
    ["47.711", "Detailhandel kleding (algemeen)"],
    ["47.721", "Detailhandel schoeisel en lederwaren"],
    ["43.341", "Schilderwerk"],
    ["43.221", "Loodgieterswerk / sanitaire installaties"],
    ["43.320", "Schrijnwerk / afwerking van gebouwen"],
    ["45.20", "Onderhoud en reparatie van auto's"],
    ["47.910", "Detailhandel via postorderbedrijven of internet"],
    ["74.201", "Fotobeoefening"],
    ["75.00", "Diergeneeskundige activiteiten"],
    ["93.130", "Fitnesscentra"],
    ["93.120", "Sportclubs"],
  ] as const,
);

// Falls back to the raw code when it's not in the curated set above — every
// NACE code sourcing-run encounters in the KBO data is valid to store and
// filter on even if we don't have a friendly label for it yet.
export function naceLabel(code: string): string {
  return NACE_LABELS[code] ?? code;
}

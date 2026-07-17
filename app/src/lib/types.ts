export const LEAD_STATUSES = [
  "nieuw",
  "research",
  "genereren",
  "klaar",
  "verzonden",
  "geopend",
  "klant",
  "geblokkeerd",
  "dood",
] as const;

export type LeadStatus = (typeof LEAD_STATUSES)[number];

// The pipeline order shown in the status bar (spec section 4.4).
// "geblokkeerd" and "dood" are side states, not steps on this bar.
export const LEAD_PIPELINE: LeadStatus[] = [
  "nieuw",
  "research",
  "genereren",
  "klaar",
  "verzonden",
  "geopend",
  "klant",
];

export const LEAD_STATUS_LABELS: Record<LeadStatus, string> = {
  nieuw: "Nieuw",
  research: "Research",
  genereren: "Genereren",
  klaar: "Klaar",
  verzonden: "Verzonden",
  geopend: "Geopend",
  klant: "Klant",
  geblokkeerd: "Geblokkeerd",
  dood: "Dood",
};

export type ResearchOutput = {
  bedrijfsverhaal: string | null;
  kernfeiten: string[];
  bronnen: string[];
  logo_url: string | null;
};

export type Lead = {
  id: string;
  bedrijfsnaam: string;
  sector: string;
  adres: string | null;
  contact_email: string | null;
  contact_naam: string | null;
  notities: string | null;
  status: LeadStatus;
  demo_url: string | null;
  klant_type: "statisch" | "shopify" | null;
  shopify_store_id: string | null;
  research_output: ResearchOutput | null;
  laatste_update: string;
  aangemaakt_op: string;
};

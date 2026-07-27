export const LEAD_STATUSES = [
  "nieuw",
  "research",
  "genereren",
  "klaar",
  "verzonden",
  "geopend",
  "klant",
  "geblokkeerd",
  "budget_overschreden",
  "dood",
] as const;

export type LeadStatus = (typeof LEAD_STATUSES)[number];

// The pipeline order shown in the status bar (spec v9 section 3.1's
// LeadStatus list). "geblokkeerd", "budget_overschreden" and "dood" are
// side-states, not steps on this bar — see the migration's note on why
// those two exist despite not being in that literal enum list.
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
  budget_overschreden: "Budget overschreden",
  dood: "Dood",
};

export type Lead = {
  id: string;
  bedrijfsnaam: string;
  sector: string;
  adres: string | null;
  contact_email: string | null;
  contact_naam: string | null;
  notities: string | null;
  open_vragen: string | null;
  research_samenvatting: string | null;
  status: LeadStatus;
  klant_type: "statisch" | "shopify" | null;
  shopify_store_id: string | null;
  herkomst: "sourcing" | "manueel";
  kbo_nummer: string | null;
  rechtsvorm: string | null;
  nace_code: string | null;
  oprichtingsdatum: string | null;
  google_place_id: string | null;
  telefoon: string | null;
  telefoon_bron: string | null;
  website_status: "geen" | "kapot" | "matig" | "goed" | null;
  website_url: string | null;
  website_url_bron: string | null;
  contact_email_bron: string | null;
  contact_email_persoonsgebonden: boolean | null;
  contact_method: string | null;
  bron_match: string | null;
  laatst_bewerkt_door: string | null;
  laatst_bewerkt_op: string;
  aangemaakt_op: string;
};

export const SITE_TYPES = ["demo", "statisch", "shopify"] as const;
export type SiteType = (typeof SITE_TYPES)[number];

export const SITE_VERSION_STATUSES = ["concept", "afgerond", "actief"] as const;
export type SiteVersionStatus = (typeof SITE_VERSION_STATUSES)[number];

// One entry per page of a multi-page site (spec 3.3, multi-page extension).
// The files sit next to content_referentie in the same version folder; see
// supabase/functions/_shared/site-builder.ts.
export type PaginaMeta = {
  bestand: string;
  titel: string;
  nav_label: string;
};

export type SiteVersion = {
  id: string;
  lead_id: string;
  site_type: SiteType;
  versienummer: number;
  status: SiteVersionStatus;
  content_referentie: string | null;
  /** null = version from before multi-page support: one standalone HTML file. */
  paginas: PaginaMeta[] | null;
  prompt_versie: string | null;
  laatst_bewerkt_door: string | null;
  laatst_bewerkt_op: string;
  aangemaakt_op: string;
};

export type ReviewLogEntry = {
  id: string;
  lead_id: string;
  site_version_id: string | null;
  bron: string;
  instructie_of_bevinding: string | null;
  resultaat: string | null;
  ai_antwoord: string | null;
  error_message: string | null;
  prompt_versie: string | null;
  timestamp: string;
};

export const JOB_STATUSES = ["wachtrij", "bezig", "klaar", "mislukt", "timeout", "geannuleerd"] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export const JOB_TYPES = ["research", "generatie", "review", "shopify_opbouw", "sourcing_run"] as const;
export type JobType = (typeof JOB_TYPES)[number];

export type Job = {
  id: string;
  lead_id: string | null;
  type: JobType;
  status: JobStatus;
  gestart_op: string | null;
  afgerond_op: string | null;
  error_message: string | null;
  pogingen: number;
  aangemaakt_op: string;
};

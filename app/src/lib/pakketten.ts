/**
 * Wat een klant bij ons afneemt. Vier vaste opties, dus platte constanten —
 * geen beheerscherm om ze te bewerken, dat zou meer onderhoud zijn dan het
 * oplost.
 *
 * LET OP: `wijzigingenPerPeriode` zijn voorlopige waarden. Vul de echte
 * aantallen hier in zodra ze vastliggen; ze worden bij het promoveren als
 * startwaarde in `klanten.wijzigingen_inbegrepen` gezet en zijn daarna per
 * klant aanpasbaar (een afwijkende afspraak hoort geen code-wijziging te zijn).
 */
export const PAKKETTEN = [
  {
    id: "aankoop",
    label: "Aankoop",
    korte_uitleg: "Klant koopt de site. Wij dragen over en hosten niet.",
    hosting: false,
    wijzigingenPerPeriode: null,
  },
  {
    id: "bundel_1",
    label: "Bundel 1",
    korte_uitleg: "Wij hosten. Wijzigingen worden apart aangerekend.",
    hosting: true,
    wijzigingenPerPeriode: 0,
  },
  {
    id: "bundel_2",
    label: "Bundel 2",
    korte_uitleg: "Wij hosten, met een aantal wijzigingen inbegrepen.",
    hosting: true,
    wijzigingenPerPeriode: 3,
  },
  {
    id: "bundel_3",
    label: "Bundel 3",
    korte_uitleg: "Wij hosten, met ruimer aantal wijzigingen inbegrepen.",
    hosting: true,
    wijzigingenPerPeriode: 10,
  },
] as const;

export type PakketType = (typeof PAKKETTEN)[number]["id"];

export const BETAALSTATUSSEN = [
  { id: "voorgesteld", label: "Voorgesteld" },
  { id: "akkoord", label: "Akkoord" },
  { id: "gefactureerd", label: "Gefactureerd" },
  { id: "betaald", label: "Betaald" },
] as const;

export type Betaalstatus = (typeof BETAALSTATUSSEN)[number]["id"];

export const DOMEIN_TYPES = [
  {
    id: "bureau_subdomein",
    label: "Subdomein van ons",
    uitleg: "bv. florian.yudexstudios.com — wij beheren de DNS, klant hoeft niets te doen.",
  },
  {
    id: "eigen_domein",
    label: "Eigen domein van de klant",
    uitleg: "bv. florian-hasselt.be — de klant zet een CNAME naar ons.",
  },
] as const;

export type DomeinType = (typeof DOMEIN_TYPES)[number]["id"];

export const BUREAU_DOMEIN = "yudexstudios.com";

export function pakketVan(id: string | null | undefined) {
  return PAKKETTEN.find((p) => p.id === id) ?? null;
}

/**
 * Valideert wat er bij het promoveren is ingevuld. Geeft een leesbare fout
 * terug of null. Bewust hier en niet in de UI: dezelfde regels gelden voor de
 * conversie-actie, en een domein dat niet resolvet is een echte fout, geen
 * cosmetisch detail.
 */
export function controleerDomein(domeinType: DomeinType, domein: string): string | null {
  const schoon = domein
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/+$/, "");

  if (!schoon) return "Vul een domein in.";
  if (schoon.includes("/")) return "Geef enkel de domeinnaam, zonder pad.";

  if (domeinType === "bureau_subdomein") {
    if (!schoon.endsWith(`.${BUREAU_DOMEIN}`)) {
      return `Een subdomein van ons moet eindigen op .${BUREAU_DOMEIN} (bv. florian.${BUREAU_DOMEIN}).`;
    }
    const label = schoon.slice(0, -`.${BUREAU_DOMEIN}`.length);
    if (!/^[a-z0-9][a-z0-9-]*$/.test(label)) {
      return "Het subdomein mag enkel kleine letters, cijfers en koppeltekens bevatten.";
    }
    return null;
  }

  if (!/^[a-z0-9][a-z0-9-]*(\.[a-z0-9][a-z0-9-]*)+$/.test(schoon)) {
    return "Dat lijkt geen geldige domeinnaam (bv. florian-hasselt.be).";
  }
  if (schoon.endsWith(`.${BUREAU_DOMEIN}`)) {
    return `Kies "Subdomein van ons" voor een adres onder ${BUREAU_DOMEIN}.`;
  }
  return null;
}

export function normaliseerDomein(domein: string): string {
  return domein
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/+$/, "");
}

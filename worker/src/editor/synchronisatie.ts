import { createHash } from "node:crypto";

// Wie heeft wat gewijzigd sinds de laatste keer dat de map en Storage gelijk
// waren? Puur, zonder schijf of netwerk, zodat de beslissing getest kan worden
// los van alles wat erom heen gebeurt (zie scripts/test-editor-sync.ts).
//
// Drie toestanden per bestand, als hash:
//   basis  — hoe het was bij de laatste geslaagde synchronisatie
//   lokaal — wat er nu op schijf staat
//   remote — wat er nu in Storage staat (bron.json, uitgesplitst)
//
// Een driewegvergelijking in plaats van "nieuwste wint": een chat-edit die de
// footer aanpast terwijl jij in VS Code aan de homepage zit, moet allebei
// overleven. Enkel als hetzelfde bestand aan beide kanten veranderde, is er
// echt een keuze — en dan wint wat op schijf staat, omdat dat het werk is dat
// iemand op dat moment voor zich heeft.

export type HashMap = Record<string, string>;

export type SyncPlan = {
  /** Remote veranderd, lokaal niet: naar schijf schrijven. */
  naarSchijf: string[];
  /** Remote verwijderd, lokaal ongewijzigd: van schijf halen. */
  vanSchijfWeg: string[];
  /** Er is lokaal iets gewijzigd dat naar Storage moet. */
  uploaden: boolean;
  /** Aan beide kanten anders gewijzigd; lokaal wint. */
  conflicten: string[];
};

export function hashVan(inhoud: string): string {
  // Wat parseSiteBron ook gelijkschakelt, telt hier ook niet als wijziging:
  // regeleinden (\r\n van een Windows-editor) en witruimte aan begin en eind
  // van een bouwsteen (die trimt de parser weg). Anders verschilt de bewaarde
  // versie in Storage altijd een witregel van het bestand op schijf, en
  // herschrijft de volgende synchronisatie dat bestand onder je handen.
  return createHash("sha256").update(inhoud.replace(/\r\n/g, "\n").trim()).digest("hex");
}

export function hashes(bestanden: Record<string, string>): HashMap {
  const uit: HashMap = {};
  for (const [naam, inhoud] of Object.entries(bestanden)) uit[naam] = hashVan(inhoud);
  return uit;
}

export function bepaalSynchronisatie(basis: HashMap, lokaal: HashMap, remote: HashMap): SyncPlan {
  const plan: SyncPlan = { naarSchijf: [], vanSchijfWeg: [], uploaden: false, conflicten: [] };
  const namen = new Set([...Object.keys(basis), ...Object.keys(lokaal), ...Object.keys(remote)]);

  for (const naam of [...namen].sort()) {
    const b = basis[naam];
    const l = lokaal[naam];
    const r = remote[naam];

    if (l === r) continue; // al gelijk, wie het ook veranderde

    const lokaalGewijzigd = l !== b;
    const remoteGewijzigd = r !== b;

    if (!lokaalGewijzigd && remoteGewijzigd) {
      if (r === undefined) plan.vanSchijfWeg.push(naam);
      else plan.naarSchijf.push(naam);
    } else if (lokaalGewijzigd && !remoteGewijzigd) {
      plan.uploaden = true;
    } else {
      // Beide gewijzigd, en niet naar hetzelfde.
      plan.conflicten.push(naam);
      plan.uploaden = true;
    }
  }

  return plan;
}

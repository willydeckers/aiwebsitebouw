// Duplicated in worker/src/shared/image-bank.ts — see the note in
// sector-styles.ts on why (no shared module across the Deno/Node boundary).
// Apart from this header the two files are identical.
//
// Why this exists: generatie was letting the model pick Unsplash CDN photo
// URLs (https://images.unsplash.com/photo-<id>) from memory. That's
// unreliable in two distinct ways, both observed live during an end-to-end
// test (Bloemenatelier Verbeeck, 2026-07-26): some invented IDs don't
// resolve at all (broken image / visible alt-text in the review
// screenshot), and some resolve to a REAL photo that just isn't what the
// model thought it was (a "seasonal bouquet" card that actually showed a
// tropical beach, an "interior greenery" card that showed beer taps) — the
// AI reviewer correctly rejected both. Every URL below was downloaded and
// visually confirmed to show what its label says before being added here.
// Extend this list the same way — never add an ID without checking it.
//
// Why the list is now FILTERED per lead instead of handed over whole
// (2026-07-27): a fixed list plus a prompt rule saying "don't use a photo of
// the wrong thing" does not work. MIKI TEA — a matcha takeaway — got a hair
// salon and a restaurant dinner table on its first generation. The rule was
// then made much more explicit, and the next run used flower-shop photos
// instead, which is arguably worse. The model will reach for the nearest
// available photo essentially every time.
//
// So the choice is removed: an image is only offered when its own keywords
// match this lead's sector or briefing. A lead with no match gets an empty
// list and a hard instruction to use colour blocks, which is the outcome the
// prompt was asking for and not getting.
//
// Licensing note, since it constrains what can be added: everything here is
// Unsplash, which is free for commercial use with no attribution. Wikimedia
// Commons was checked as a source for tea imagery on 2026-07-27 and rejected —
// the candidates were all CC BY-SA, which needs visible attribution and is
// share-alike. That is not something to put on a client's commercial site.
//
// Uitgebreid op 2026-09-02 met bakker, slager, apotheek, dierenarts,
// fietsenmaker en schoonheidssalon. Bakker en slager waren kernsectoren voor
// dit bureau die tot dan nul foto's hadden en dus altijd op kleurvlakken
// uitkwamen. Elke URL hieronder is volgens hetzelfde protocol één voor één in
// een browser geopend en bekeken voor ze hier is beland; één kandidaat voor
// fietsenmaker ("A white mountain bike is hanging", photo-1765376260870) is
// daarbij afgewezen — die bleek een donker beeld met "verhuur" in de tekst,
// wat een herstelzaak verkeerd voorstelt. Dat is precies waarom deze lijst
// bekeken en niet gegokt wordt.

export type BankAfbeelding = {
  naam: string;
  omschrijving: string;
  url: string;
  /**
   * Lowercase substrings; the image is offered when one of them occurs in the
   * lead's sector or briefing. Deliberately specific — "horeca" is not a
   * keyword for the restaurant table, because a takeaway tea bar is horeca too
   * and a dressed dinner table is wrong for it.
   */
  trefwoorden: string[];
};

export const IMAGE_BANK: BankAfbeelding[] = [
  {
    naam: "bloemist-veld",
    omschrijving: "felgekleurde bloemen tegen een blauwe lucht",
    url: "https://images.unsplash.com/photo-1490750967868-88aa4486c946?auto=format&fit=crop&w=2000&q=80",
    trefwoorden: ["bloem", "florist", "boeket"],
  },
  {
    naam: "bloemist-winkel",
    omschrijving: "bloemenwinkel-uitstalling buiten met boeketten en manden",
    url: "https://images.unsplash.com/photo-1487070183336-b863922373d4?auto=format&fit=crop&w=800&q=80",
    trefwoorden: ["bloem", "florist", "boeket"],
  },
  {
    naam: "bloemist-roos",
    omschrijving: "één roze roos in een glazen vaas",
    url: "https://images.unsplash.com/photo-1518895949257-7621c3c786d7?auto=format&fit=crop&w=800&q=80",
    trefwoorden: ["bloem", "florist", "boeket"],
  },
  {
    naam: "bloemist-arrangement",
    omschrijving: "handen die een hartvormig bloemstuk vasthouden",
    url: "https://images.unsplash.com/photo-1526047932273-341f2a7631f9?auto=format&fit=crop&w=800&q=80",
    trefwoorden: ["bloem", "florist", "rouw", "boeket"],
  },
  {
    naam: "tuin-gazon",
    omschrijving: "close-up van een weelderig, pas gemaaid gazon",
    url: "https://images.unsplash.com/photo-1558904541-efa843a96f01?auto=format&fit=crop&w=2000&q=80",
    trefwoorden: ["tuin", "gazon", "landscap", "groenaanleg"],
  },
  {
    naam: "tuin-aanleg",
    omschrijving: "tuinschep en snoeischaar met potgrond, bovenaanzicht",
    url: "https://images.unsplash.com/photo-1416879595882-3373a0480b5b?auto=format&fit=crop&w=800&q=80",
    trefwoorden: ["tuin", "landscap", "groenaanleg", "hovenier"],
  },
  {
    naam: "tuin-realisatie",
    omschrijving: "moderne woning met grote tuin en veranda in avondlicht",
    url: "https://images.unsplash.com/photo-1600585154340-be6161a56a0c?auto=format&fit=crop&w=800&q=80",
    trefwoorden: ["tuin", "landscap", "terras", "veranda"],
  },
  {
    naam: "horeca-tafel",
    omschrijving: "gedekte restauranttafel met wijnglazen en bord eten",
    url: "https://images.unsplash.com/photo-1414235077428-338989a2e8c0?auto=format&fit=crop&w=800&q=80",
    trefwoorden: ["restaurant", "bistro", "brasserie", "traiteur", "eetcafé", "eethuis"],
  },
  {
    naam: "kapper-salon",
    omschrijving: "kapsalon-interieur met stoelen en spiegels",
    url: "https://images.unsplash.com/photo-1560066984-138dadb4c035?auto=format&fit=crop&w=800&q=80",
    trefwoorden: ["kapper", "kapsalon", "barbier", "haartooi"],
  },
  {
    naam: "algemeen-team",
    omschrijving: "twee collega's die high-five geven aan een bureau",
    url: "https://images.unsplash.com/photo-1600880292203-757bb62b4baf?auto=format&fit=crop&w=800&q=80",
    trefwoorden: ["consult", "advies", "kantoor", "boekhoud", "advocaat", "makelaar", "verzekering"],
  },
  {
    naam: "algemeen-handdruk",
    omschrijving: "professionele handdruk",
    url: "https://images.unsplash.com/photo-1521791136064-7986c2920216?auto=format&fit=crop&w=800&q=80",
    trefwoorden: ["consult", "advies", "kantoor", "boekhoud", "advocaat", "makelaar", "verzekering"],
  },
  {
    naam: "algemeen-kantoor",
    omschrijving: "modern kantoorinterieur met glazen wanden",
    url: "https://images.unsplash.com/photo-1497366754035-f200968a6e72?auto=format&fit=crop&w=800&q=80",
    trefwoorden: ["consult", "advies", "kantoor", "boekhoud", "advocaat", "makelaar", "verzekering"],
  },
  {
    naam: "bouw-werf",
    omschrijving: "bouwvakkers met veiligheidsvesten op een werf",
    url: "https://images.unsplash.com/photo-1541888946425-d81bb19240f5?auto=format&fit=crop&w=800&q=80",
    trefwoorden: ["bouw", "aannemer", "renovatie", "dakwerk", "schrijnwerk", "installatie"],
  },
  {
    naam: "bakker-toonbank",
    omschrijving: "bakkerij-interieur met een vitrine vol brood en gebak",
    url: "https://images.unsplash.com/photo-1711672284661-bd70e38f31b2?auto=format&fit=crop&w=2000&q=80",
    trefwoorden: ["bakker", "bakkerij", "banket", "patisserie"],
  },
  {
    naam: "bakker-gebak",
    omschrijving: "croissants en zoet gebak in een verlichte vitrine",
    url: "https://images.unsplash.com/photo-1568254183919-78a4f43a2877?auto=format&fit=crop&w=800&q=80",
    trefwoorden: ["bakker", "bakkerij", "banket", "patisserie", "koffiekoek"],
  },
  {
    naam: "bakker-brood",
    omschrijving: "rustieke zuurdesembroden met korenaren op hout",
    url: "https://images.unsplash.com/photo-1509440159596-0249088772ff?auto=format&fit=crop&w=800&q=80",
    trefwoorden: ["bakker", "bakkerij", "brood", "zuurdesem"],
  },
  {
    naam: "slager-toonbank",
    omschrijving: "donkere rijpingskast met stukken vlees achter glas",
    url: "https://images.unsplash.com/photo-1584048603508-4b31894439a9?auto=format&fit=crop&w=2000&q=80",
    trefwoorden: ["slager", "slagerij", "beenhouwer"],
  },
  {
    naam: "slager-vakwerk",
    omschrijving: "slager die achter de toonbank vlees versnijdt",
    url: "https://images.unsplash.com/photo-1560166444-441876015a70?auto=format&fit=crop&w=800&q=80",
    trefwoorden: ["slager", "slagerij", "beenhouwer"],
  },
  {
    naam: "slager-vitrine",
    omschrijving: "gevulde koeltoonbank met verse stukken vlees",
    url: "https://images.unsplash.com/photo-1625643269470-5d3e7b69fa34?auto=format&fit=crop&w=800&q=80",
    trefwoorden: ["slager", "slagerij", "beenhouwer"],
  },
  {
    naam: "apotheek-advies",
    omschrijving: "apothekeres die een doosje uit het rek neemt",
    url: "https://images.unsplash.com/photo-1580281657527-47f249e8f4df?auto=format&fit=crop&w=2000&q=80",
    trefwoorden: ["apotheek", "apotheker", "farmac"],
  },
  {
    naam: "apotheek-toonbank",
    omschrijving: "apotheker die een klant aan de balie uitleg geeft",
    url: "https://images.unsplash.com/photo-1576091358783-a212ec293ff3?auto=format&fit=crop&w=800&q=80",
    trefwoorden: ["apotheek", "apotheker", "farmac"],
  },
  {
    naam: "apotheek-rekken",
    omschrijving: "rekken met geordende geneesmiddelendoosjes",
    url: "https://images.unsplash.com/photo-1642055514517-7b52288890ec?auto=format&fit=crop&w=800&q=80",
    trefwoorden: ["apotheek", "apotheker", "farmac"],
  },
  {
    naam: "dierenarts-onderzoek",
    omschrijving: "dierenarts met stethoscoop die een teckel onderzoekt",
    url: "https://images.unsplash.com/photo-1770836037793-95bdbf190f71?auto=format&fit=crop&w=2000&q=80",
    trefwoorden: ["dierenarts", "veearts", "dierenkliniek", "dierenpraktijk"],
  },
  {
    naam: "dierenarts-behandeling",
    omschrijving: "twee dierenartsen die een hond op de behandeltafel verzorgen",
    url: "https://images.unsplash.com/photo-1700665537604-412e89a285c3?auto=format&fit=crop&w=800&q=80",
    trefwoorden: ["dierenarts", "veearts", "dierenkliniek", "dierenpraktijk"],
  },
  {
    naam: "dierenarts-pup",
    omschrijving: "kleine pluizige hond die vastgehouden wordt in de praktijk",
    url: "https://images.unsplash.com/photo-1588626863948-1d7978596f17?auto=format&fit=crop&w=800&q=80",
    trefwoorden: ["dierenarts", "veearts", "dierenkliniek", "dierenpraktijk", "trimsalon"],
  },
  {
    naam: "fiets-werkplaats",
    omschrijving: "werkbank met gereedschap aan de wand in een herstelatelier",
    url: "https://images.unsplash.com/photo-1760310936486-4dd450aab2a8?auto=format&fit=crop&w=2000&q=80",
    trefwoorden: ["fiets", "fietsenmaker", "fietsherstel", "tweewieler"],
  },
  {
    naam: "fiets-herstelling",
    omschrijving: "iemand die een fiets herstelt, gehurkt bij het achterwiel",
    url: "https://images.unsplash.com/photo-1777404658877-f1c9edf42f34?auto=format&fit=crop&w=800&q=80",
    trefwoorden: ["fiets", "fietsenmaker", "fietsherstel", "tweewieler"],
  },
  {
    naam: "schoonheid-gezichtsverzorging",
    omschrijving: "gezichtsverzorging met handen die het gezicht masseren",
    url: "https://images.unsplash.com/photo-1731514771613-991a02407132?auto=format&fit=crop&w=2000&q=80",
    trefwoorden: ["schoonheidssalon", "schoonheidsspecialist", "beautysalon", "gelaatsverzorging"],
  },
  {
    naam: "schoonheid-masker",
    omschrijving: "gezichtsmasker dat met een borstel aangebracht wordt",
    url: "https://images.unsplash.com/photo-1761718210089-ba3bb5ccb54f?auto=format&fit=crop&w=800&q=80",
    trefwoorden: ["schoonheidssalon", "schoonheidsspecialist", "beautysalon", "gelaatsverzorging"],
  },
  {
    naam: "schoonheid-salon",
    omschrijving: "rustig saloninterieur met een behandelstoel en spiegel",
    url: "https://images.unsplash.com/photo-1521590832167-7bcbfaa6381f?auto=format&fit=crop&w=800&q=80",
    trefwoorden: ["schoonheidssalon", "beautysalon", "nagelstudio", "manicure"],
  },
];

/** De foto's waarvan het onderwerp bij déze lead past. Leeg = werk met kleurvlakken. */
export function passendeAfbeeldingen(sector: string, briefing?: string | null): BankAfbeelding[] {
  const zoektekst = `${sector} ${briefing ?? ""}`.toLowerCase();
  return IMAGE_BANK.filter((a) => a.trefwoorden.some((t) => zoektekst.includes(t)));
}

/** Beeld voor og:image wanneer de klant zelf geen logo aanleverde. */
export function standaardOgAfbeelding(sector: string, briefing?: string | null): string | null {
  return passendeAfbeeldingen(sector, briefing)[0]?.url ?? null;
}

/**
 * Zoekt de bank-entry bij een URL op het Unsplash-foto-id, niet op de hele
 * URL — de generator mag de query-parameters (formaat, uitsnede) aanpassen.
 */
export function zoekBankAfbeelding(url: string): BankAfbeelding | null {
  const id = /photo-[a-z0-9-]+/i.exec(url)?.[0];
  if (!id) return null;
  return IMAGE_BANK.find((a) => a.url.includes(id)) ?? null;
}

/**
 * The image guidance for one lead: only the photos whose subject actually
 * matches this business, or an explicit "use colour blocks" when none do.
 */
export function bouwImageBankPrompt(sector: string, briefing?: string | null): string {
  const passend = passendeAfbeeldingen(sector, briefing);

  if (passend.length === 0) {
    return `Afbeeldingen: er zijn voor deze sector GEEN geschikte foto's beschikbaar. Gebruik dus
geen enkele stockfoto — verzin zeker geen Unsplash-URL, die zijn in de praktijk kapot of tonen
iets heel anders. Werk in de plaats met effen kleurvlakken en gradiënten in de huisstijlkleuren,
grote typografie, een enkel letter- of vormaccent, en veel witruimte. Dat oogt rustiger en
professioneler dan een foto van het verkeerde onderwerp.

Heeft de klant eigen afbeeldingen meegekregen (zie de lijst met eigen bestanden), gebruik die dan
wél — die tonen het echte bedrijf.`;
  }

  return `Afbeeldingen: gok NOOIT een eigen Unsplash-ID uit het geheugen — een deel bestaat niet
(kapotte afbeelding) en een deel toont iets heel anders dan verwacht. Hieronder staan de enige
toegelaten foto's; ze zijn geselecteerd omdat ze bij déze sector passen:

${passend.map((a) => `- ${a.naam}: ${a.omschrijving} — ${a.url}`).join("\n")}

Past een van deze foto's toch niet bij wat dit bedrijf doet, gebruik hem dan niet: een effen
kleurvlak of gradient in de huisstijlkleuren is altijd beter dan een foto van het verkeerde
onderwerp. Heeft de klant eigen afbeeldingen meegekregen, dan gaan die altijd voor.

Pas het aspect ratio aan met de bestaande query-parameters (w=, h=, fit=crop) naar wens — de
foto-ID zelf mag je niet wijzigen.`;
}

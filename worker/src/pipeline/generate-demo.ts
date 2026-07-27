import { createAnthropicClient } from "../shared/anthropic.js";

// Duplicated from supabase/functions/generatie/index.ts's prompt-building
// logic rather than shared across the Deno/Node runtime boundary — the
// review loop needs to regenerate-with-feedback locally in this worker
// (see the note in review-job.ts on why it doesn't call the Edge Function
// for this). Keep the two in sync by hand.

const MODEL = process.env.MODEL_KWALITEIT ?? "claude-opus-4-8";

const SECTOR_STYLES: { keywords: string[]; guidance: string }[] = [
  {
    keywords: ["bloem", "bakker", "slager", "ambacht", "traiteur", "chocolat"],
    guidance:
      "Ambacht-stijl: warme, aardse kleuren (terracotta, crème, donkergroen), " +
      "een serif-lettertype voor titels, veel witruimte, grote productfoto's " +
      "met ronde hoeken. Voelt handgemaakt en persoonlijk, niet corporate.",
  },
  {
    keywords: ["restaurant", "café", "cafe", "horeca", "bistro"],
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

function getSectorStyleGuidance(sector: string): string {
  const normalized = sector.toLowerCase();
  const match = SECTOR_STYLES.find(({ keywords }) => keywords.some((k) => normalized.includes(k)));
  return match?.guidance ?? SECTOR_STYLES[0].guidance;
}

// Duplicated from supabase/functions/_shared/image-bank.ts — see that
// file's header comment for why this exists and how the URLs were
// verified. Keep the two in sync by hand.
const IMAGE_BANK_PROMPT = `Afbeeldingen: gok NOOIT een eigen Unsplash-ID uit het geheugen — een deel
bestaat niet (kapotte afbeelding) en een deel toont iets heel anders dan verwacht, wat in de
praktijk tot afkeuring in de review-loop heeft geleid. Kies uitsluitend uit onderstaande,
geverifieerde afbeeldingen die passen bij de sector, of gebruik een effen kleurvlak/gradient met
een icoon als er niets passends bij zit.

- bloemist-veld: felgekleurde bloemen tegen een blauwe lucht — https://images.unsplash.com/photo-1490750967868-88aa4486c946?auto=format&fit=crop&w=2000&q=80
- bloemist-winkel: bloemenwinkel-uitstalling buiten met boeketten en manden — https://images.unsplash.com/photo-1487070183336-b863922373d4?auto=format&fit=crop&w=800&q=80
- bloemist-roos: één roze roos in een glazen vaas — https://images.unsplash.com/photo-1518895949257-7621c3c786d7?auto=format&fit=crop&w=800&q=80
- bloemist-arrangement: handen die een hartvormig bloemstuk vasthouden — https://images.unsplash.com/photo-1526047932273-341f2a7631f9?auto=format&fit=crop&w=800&q=80
- tuin-gazon: close-up van een weelderig, pas gemaaid gazon — https://images.unsplash.com/photo-1558904541-efa843a96f01?auto=format&fit=crop&w=2000&q=80
- tuin-aanleg: tuinschep en snoeischaar met potgrond, bovenaanzicht — https://images.unsplash.com/photo-1416879595882-3373a0480b5b?auto=format&fit=crop&w=800&q=80
- tuin-realisatie: moderne woning met grote tuin en veranda in avondlicht — https://images.unsplash.com/photo-1600585154340-be6161a56a0c?auto=format&fit=crop&w=800&q=80
- horeca-tafel: gedekte restauranttafel met wijnglazen en bord eten — https://images.unsplash.com/photo-1414235077428-338989a2e8c0?auto=format&fit=crop&w=800&q=80
- kapper-salon: kapsalon-interieur met stoelen en spiegels — https://images.unsplash.com/photo-1560066984-138dadb4c035?auto=format&fit=crop&w=800&q=80
- algemeen-team: twee collega's die high-five geven aan een bureau — https://images.unsplash.com/photo-1600880292203-757bb62b4baf?auto=format&fit=crop&w=800&q=80
- algemeen-handdruk: professionele handdruk — https://images.unsplash.com/photo-1521791136064-7986c2920216?auto=format&fit=crop&w=800&q=80
- algemeen-kantoor: modern kantoorinterieur met glazen wanden — https://images.unsplash.com/photo-1497366754035-f200968a6e72?auto=format&fit=crop&w=800&q=80
- bouw-werf: bouwvakkers met veiligheidsvesten op een werf — https://images.unsplash.com/photo-1541888946425-d81bb19240f5?auto=format&fit=crop&w=800&q=80

Pas het aspect ratio aan met de bestaande query-parameters (w=, h=, fit=crop) naar wens — de
foto-ID zelf mag je niet wijzigen.`;

const SYSTEM_PROMPT = `Je bent de generatie-stap van een web agency dashboard (spec sectie 3.3).
Genereer één volledig zelfstandig HTML-bestand voor een koude demo-website, met Tailwind via CDN
(<script src="https://cdn.tailwindcss.com"></script>) — geen build-stap, geen externe bestanden
buiten die CDN-link en publiek toegankelijke afbeeldingen-URL's.

${IMAGE_BANK_PROMPT}

Gebruik de meegegeven sectorstijl-richtlijn als leidraad voor kleuren/typografie/lay-out — verzin
geen eigen, afwijkend design. Gebruik de stijlvoorkeuren en sectorkennis hieronder als harde
regels, niet als suggesties. Vertrouw research-feiten en klantnotities; verzin zelf geen
bedrijfsinformatie die niet is meegegeven.

Antwoord uitsluitend met de ruwe HTML, beginnend met <!DOCTYPE html>. Geen markdown-codeblock,
geen uitleg ervoor of erna.`;

export type GenerateUsage = { model: string; tokensIn: number; tokensOut: number };

type Lead = {
  bedrijfsnaam: string;
  sector: string;
  adres: string | null;
  notities: string | null;
  research_samenvatting: string | null;
};

export async function regenerateWithFeedback(
  lead: Lead,
  stijlvoorkeuren: { regel: string; context: string | null }[],
  sectorKennis: { regel: string }[],
  feedback: string,
): Promise<{ html: string; usage: GenerateUsage }> {
  const client = createAnthropicClient();

  const userMessage = [
    `Bedrijfsnaam: ${lead.bedrijfsnaam}`,
    `Sector: ${lead.sector}`,
    lead.adres ? `Adres: ${lead.adres}` : null,
    lead.notities ? `Notities van de klant:\n${lead.notities}` : null,
    lead.research_samenvatting ? `Research-samenvatting:\n${lead.research_samenvatting}` : null,
    `Sectorstijl-richtlijn:\n${getSectorStyleGuidance(lead.sector)}`,
    `Stijlvoorkeuren:\n${
      stijlvoorkeuren.length
        ? stijlvoorkeuren.map((r) => `- ${r.regel}${r.context ? ` (${r.context})` : ""}`).join("\n")
        : "Geen stijlvoorkeuren geregistreerd."
    }`,
    `Sectorkennis (${lead.sector}):\n${
      sectorKennis.length ? sectorKennis.map((r) => `- ${r.regel}`).join("\n") : "Geen sectorkennis geregistreerd."
    }`,
    `Dit is een herziening na review-feedback (spec 3.4) — verwerk expliciet:\n${feedback}`,
  ]
    .filter(Boolean)
    .join("\n\n");

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 16000,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: userMessage }],
  });

  const textBlocks = response.content.filter((b) => b.type === "text");
  const lastText = textBlocks[textBlocks.length - 1];
  if (!lastText || lastText.type !== "text") {
    throw new Error("Geen HTML-antwoord ontvangen van generatie-call.");
  }

  const html = lastText.text.trim();
  if (!html.toLowerCase().startsWith("<!doctype")) {
    throw new Error("Generatie-output start niet met <!DOCTYPE html>.");
  }

  return {
    html,
    usage: { model: MODEL, tokensIn: response.usage.input_tokens, tokensOut: response.usage.output_tokens },
  };
}

export const AI_MODELLEN = [
  {
    id: "claude-opus-4-8",
    label: "Opus (standaard)",
    uitleg: "De huidige standaard. Grondig, goede prijs-kwaliteit.",
  },
  {
    id: "claude-sonnet-5",
    label: "Sonnet",
    uitleg: "Sneller en ongeveer de helft goedkoper. Iets minder grondig.",
  },
  {
    id: "claude-fable-5",
    label: "Fable",
    uitleg:
      "Het zwaarste model, ongeveer dubbel zo duur. Enkel voor het bouwen van de site zelf — " +
      "research, review en chat-edit blijven op Opus draaien.",
  },
] as const;

export type AiModel = (typeof AI_MODELLEN)[number]["id"];

export const STANDAARD_AI_MODEL: AiModel = "claude-opus-4-8";

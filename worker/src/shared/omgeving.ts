// What the worker needs before it can do anything, checked once at startup.
//
// This exists because of a three-week silent failure. Store-creation jobs were
// queued on 1 Aug, 2 Aug and 21 Aug and never ran; when one finally would have
// been picked up it would have died immediately on a missing
// SHOPIFY_PARTNER_ORGANIZATION_ID — present in app/.env.local, absent from
// worker/.env, which is a different file that nobody had reason to think about.
//
// Checking per job means the operator finds out one failed job at a time, with
// the reason buried in a job row. Checking at startup means the worker refuses
// to pretend it is healthy, and says exactly which line is missing from which
// file.

type Vereiste = {
  naam: string;
  /** Which job types stop working without it. Empty = the worker itself. */
  nodigVoor: string[];
  uitleg: string;
};

const KERN: Vereiste[] = [
  { naam: "SUPABASE_URL", nodigVoor: [], uitleg: "project-URL van Supabase" },
  {
    naam: "SUPABASE_SERVICE_ROLE_KEY",
    nodigVoor: [],
    uitleg: "service-role-key — `supabase projects api-keys --project-ref <ref>`",
  },
  {
    naam: "ANTHROPIC_API_KEY",
    nodigVoor: ["research", "generatie", "review"],
    uitleg: "Anthropic-sleutel voor de AI-stappen",
  },
];

const OPTIONEEL: Vereiste[] = [
  {
    naam: "SHOPIFY_PARTNER_ORGANIZATION_ID",
    nodigVoor: ["shopify_store_aanmaak"],
    uitleg: "organisatie-id uit het Partner Dashboard (staat ook in app/.env.local)",
  },
  {
    naam: "SHOPIFY_APP_CLIENT_ID",
    nodigVoor: ["shopify_opbouw"],
    uitleg: "client-id van de app in het Shopify Dev Dashboard",
  },
  {
    naam: "SHOPIFY_APP_CLIENT_SECRET",
    nodigVoor: ["shopify_opbouw"],
    uitleg: "client-secret van diezelfde app",
  },
];

/**
 * Returns the job types this worker cannot handle with its current
 * environment. Fatal gaps throw; the rest are reported so the operator knows
 * what will fail before a lead runs into it.
 */
export function controleerOmgeving(): { onbruikbareTypes: Set<string> } {
  // Where the operator should go to fix it depends on who started us. Inside
  // the desktop app there is no worker/.env at all -- the values come from the
  // settings screen -- and pointing someone at a file that does not exist on
  // their machine is worse than saying nothing.
  const waar =
    process.env.WORKER_STOP_BIJ_GESLOTEN_INVOER === "1"
      ? "bij Voorkeuren → Worker in de app"
      : "in worker/.env";

  const ontbrekendKern = KERN.filter((v) => !process.env[v.naam]);
  if (ontbrekendKern.length) {
    throw new Error(
      `De worker kan niet starten — ontbrekend ${waar}:\n` +
        ontbrekendKern.map((v) => `  ${v.naam}  (${v.uitleg})`).join("\n"),
    );
  }

  const onbruikbareTypes = new Set<string>();
  const ontbrekend = OPTIONEEL.filter((v) => !process.env[v.naam]);
  for (const v of ontbrekend) for (const t of v.nodigVoor) onbruikbareTypes.add(t);

  if (ontbrekend.length) {
    console.warn(
      `\nLet op — deze variabelen ontbreken ${waar}:\n` +
        ontbrekend.map((v) => `  ${v.naam}  (${v.uitleg})`).join("\n") +
        `\nJobs van het type ${[...onbruikbareTypes].join(", ")} worden daarom meteen als ` +
        "mislukt gemarkeerd in plaats van eeuwig in de wachtrij te blijven staan.\n",
    );
  }
  return { onbruikbareTypes };
}

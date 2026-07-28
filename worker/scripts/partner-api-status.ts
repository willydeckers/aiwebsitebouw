// What can the Shopify Partner API actually do, right now, for this
// organization? Run this instead of arguing from memory or documentation:
//
//   cd app && node --env-file=.env.local ../worker/scripts/partner-api-status.ts
//   (or set SHOPIFY_PARTNER_ORGANIZATION_ID / SHOPIFY_PARTNER_ACCESS_TOKEN yourself)
//
// This exists because spec 3.8 asks for "development store via de Shopify
// Partner API", and that has now been claimed twice from recollection — once
// as `developmentStoreCreate`, once as `devStoreCreate` — and disproved twice
// against the live schema. Shopify may add store creation later; when someone
// wants to check, this answers it in ten seconds with facts instead of
// another round of guessing.

const org = process.env.SHOPIFY_PARTNER_ORGANIZATION_ID;
const token = process.env.SHOPIFY_PARTNER_ACCESS_TOKEN;

if (!org || !token) {
  console.error(
    "Zet SHOPIFY_PARTNER_ORGANIZATION_ID en SHOPIFY_PARTNER_ACCESS_TOKEN " +
      "(staan in app/.env.local).",
  );
  process.exit(1);
}

// Note the organization id in the path. Without it Shopify serves a 404 HTML
// page, not a GraphQL error — an easy way to think the API is down when the
// URL is simply wrong.
const endpoint = (versie: string) =>
  `https://partners.shopify.com/${org}/api/${versie}/graphql.json`;

// The Partner API rate-limits hard: four introspection calls back to back
// already returns "Too many requests", which reads exactly like a missing
// field if you're not paying attention. Pace them.
const wacht = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function gql(versie: string, query: string) {
  await wacht(1200);
  const res = await fetch(endpoint(versie), {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token! },
    body: JSON.stringify({ query }),
  });
  const tekst = await res.text();
  try {
    return { status: res.status, json: JSON.parse(tekst) as Record<string, never>, raw: tekst };
  } catch {
    return { status: res.status, json: null, raw: tekst };
  }
}

const VERSIES = ["2025-01", "2025-04", "2025-07", "2025-10", "2026-01", "unstable"];

console.log(`Partner API — organisatie ${org}\n`);
console.log("Beschikbare versies en hun mutations:");

let nieuwsteGeldig: string | null = null;
for (const versie of VERSIES) {
  const r = await gql(versie, "{ __schema { mutationType { fields { name } } } }");
  // deno-lint-ignore no-explicit-any
  const velden = (r.json as any)?.data?.__schema?.mutationType?.fields as { name: string }[] | undefined;
  // deno-lint-ignore no-explicit-any
  const fout = (r.json as any)?.errors?.[0]?.message;
  if (velden && versie !== "unstable") nieuwsteGeldig = versie;
  console.log(
    `  ${versie.padEnd(10)} ${String(r.status).padEnd(4)} ` +
      (velden ? velden.map((f) => f.name).join(", ") : (fout ?? r.raw.slice(0, 60))),
  );
}

console.log("\nBestaat er een mutation om een store aan te maken?");
for (const naam of ["devStoreCreate", "developmentStoreCreate", "storeCreate", "shopCreate"]) {
  const r = await gql(nieuwsteGeldig ?? "2026-01", `mutation { ${naam}(input: {}) { __typename } }`);
  // deno-lint-ignore no-explicit-any
  const fout = (r.json as any)?.errors?.[0]?.message ?? "(geen fout — bestaat mogelijk WEL)";
  console.log(`  ${naam.padEnd(24)} ${fout}`);
}

console.log("\nWat kan je opvragen (query-velden):");
const q = await gql(nieuwsteGeldig ?? "2026-01", "{ __schema { queryType { fields { name } } } }");
// deno-lint-ignore no-explicit-any
const qVelden = (q.json as any)?.data?.__schema?.queryType?.fields as { name: string }[] | undefined;
console.log("  " + (qVelden?.map((f) => f.name).join(", ") ?? "introspectie geweigerd"));

console.log(
  "\nConclusie: zolang hierboven geen store-mutation opduikt, kan een development store\n" +
    "enkel manueel in het Partner Dashboard aangemaakt worden — en levert de Partner API\n" +
    "sowieso geen Admin API-token op (er is geen enkel veld dat winkels teruggeeft).",
);

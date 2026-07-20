// Google Places API (New) - Text Search. Real, documented endpoint
// (unlike the Shopify GraphQL mutations elsewhere in this codebase, which
// are flagged as best-effort recollection) — this one hasn't been
// exercised against a live API key in this environment though, so still
// worth a smoke test before relying on it in production.
const SEARCH_URL = "https://places.googleapis.com/v1/places:searchText";

export type PlaceMatch = {
  placeId: string;
  displayName: string;
  websiteUri: string | null;
};

function normalizeForCompare(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

// Spec 3.1a step 3: "bij twijfel niet koppelen" — only accept a match
// when the returned name is a reasonably confident textual match for the
// KBO company name; anything looser is treated as no match at all rather
// than guessing.
function isConfidentMatch(kboNaam: string, candidateNaam: string): boolean {
  const a = normalizeForCompare(kboNaam);
  const b = normalizeForCompare(candidateNaam);
  return a.length > 0 && b.length > 0 && (a.includes(b) || b.includes(a));
}

export async function findPlaceMatch(
  bedrijfsnaam: string,
  postcode: string | null,
): Promise<PlaceMatch | null> {
  const apiKey = Deno.env.get("GOOGLE_PLACES_API_KEY");
  if (!apiKey) return null;

  const query = postcode ? `${bedrijfsnaam} ${postcode} Belgie` : `${bedrijfsnaam} Belgie`;

  const response = await fetch(SEARCH_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": "places.id,places.displayName,places.websiteUri",
    },
    body: JSON.stringify({ textQuery: query, maxResultCount: 1 }),
  });

  if (!response.ok) return null;

  const data = await response.json();
  const place = data.places?.[0];
  if (!place?.id || !place.displayName?.text) return null;

  if (!isConfidentMatch(bedrijfsnaam, place.displayName.text)) return null;

  return {
    placeId: place.id,
    displayName: place.displayName.text,
    websiteUri: place.websiteUri ?? null,
  };
}

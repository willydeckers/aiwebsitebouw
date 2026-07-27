// Duplicated in worker/src/pipeline/generate-demo.ts — see the note in
// sector-styles.ts on why (no shared module across the Deno/Node boundary).
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
export const IMAGE_BANK_PROMPT = `Afbeeldingen: gok NOOIT een eigen Unsplash-ID uit het geheugen — een deel
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

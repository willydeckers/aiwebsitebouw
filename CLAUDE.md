# Project state — Web Agency Dashboard (spec v9)

This file tracks the **current, real-world state** of the project — what's built, what's
deployed, what's still missing. Update it whenever that state changes (new feature, a
deployment milestone reached, a gap gets closed). Don't let it go stale — a wrong status
here is worse than no status file at all.

For what the app is *supposed* to do, see `dashboard-spec-v9-FINAL.md` (binding spec,
supersedes `dashboard-spec-v2-FINAL.md`). For how to set up/deploy each piece, see
`supabase/README.md` — this file doesn't repeat those details, only summarizes status.

## Layout

```
app/       Next.js static-export dashboard (Tauri-wrapped for desktop)
supabase/  migrations/, functions/ (Edge Functions), tests/
worker/    separate always-on Node service (Playwright review-loop, Shopify store builds)
```

## Build status: all 25 spec build-steps implemented

Every step in the spec's own build order has code written, and is typechecked/linted/built
in this environment (no live Supabase project, Docker, or external API credentials were
available here — see `supabase/README.md`'s delivery checklist for exactly what was and
wasn't verifiable without those). Nothing below is "TODO code to write" — what's open is
deployment, live-credential verification, and a couple of deliberately-external tasks.

## Real-world deployment progress (update this section as it changes)

- **Supabase project**: created, linked, migrations applied successfully (`supabase db push`)
  as of 2026-07-20 — hit two non-idempotent-object errors on the first two attempts
  (`lead_status` type already existed, then a leftover `storage.objects` policy after a
  `public` schema wipe); both resolved, migrations are in. That same `public`-schema wipe
  also silently dropped the project's default table GRANTs (RLS policies alone don't grant
  access — Postgres checks table-level GRANTs first), which surfaced on 2026-07-24 as
  `permission denied for table X` on every table from the app. Fixed via
  `supabase/migrations/20260724000000_fix_public_grants.sql`, pushed live the same day.
- **Edge Functions**: confirmed deployed — 10 functions (`research`, `generatie`,
  `chat-edit-static`, `chat-edit-shopify`, `send-email`, `shopify-staff-invite`,
  `sourcing-run`, `track-and-serve`, `cleanup-storage`, `gmail-oauth-exchange`) show
  `ACTIVE` on the linked project, with `ANTHROPIC_API_KEY` and the rest of the secrets
  table set. **Twee staan er nog niet op**: `lees-afbeelding` en (sinds 02/09)
  `domein-koppelen`. `track-and-serve` draait live ook nog in zijn oude vorm — zie de
  sectie van 2026-09-02 voor het deploy-commando en waarom dat bewust wacht.
- **`.env.local`**: `NEXT_PUBLIC_SUPABASE_URL`/`NEXT_PUBLIC_SUPABASE_ANON_KEY`/
  `ANTHROPIC_API_KEY` set locally. **`NEXT_PUBLIC_DEMO_HOSTING_URL` staat er niét (meer) in** —
  nagekeken op 2026-09-03; de regel hier beweerde sinds 24/07 van wel. De app leidt de
  demo-link daarom zelf af uit `NEXT_PUBLIC_SUPABASE_URL` (zie `app/src/lib/demo-link.ts`), dus
  dat is geen blokkade meer. `NEXT_PUBLIC_GOOGLE_OAUTH_CLIENT_ID` is nog steeds leeg.
  Sinds 2026-09-02 hoeven de meeste sleutels sowieso niet meer in een bestand te staan: zie
  het instellingenscherm verderop.
- **Gmail OAuth**: Google Cloud OAuth client created (Web application type), client ID
  obtained; client secret + `GMAIL_TOKEN_ENCRYPTION_KEY` generation in progress.
- **`ANTHROPIC_API_KEY` (Edge Function secret) was invalid** until 2026-07-24 (silently —
  every AI-calling step failed with a generic client error until the error-surfacing bug
  below was fixed and the real `401 invalid x-api-key` became visible). Re-synced from the
  working local key that day. The account's credit balance then ran out mid-session
  (`400 credit balance too low`) — blocked further testing for a while; **credits were
  topped up and confirmed working again on 2026-07-25**, and the full pipeline was run to
  completion (see below).
- **Worker**: code works end-to-end against the live project (verified 2026-07-24 — see the
  bugfixes below), but is still not hosted anywhere persistent; it was only run manually,
  locally, for that test. Two things to know before hosting it for real:
  - `npm run start` (the `npm` wrapper specifically, not `tsx` itself) reliably crashes
    Chromium's launch on this Windows dev machine (`STATUS_DLL_INIT_FAILED`) — running
    `npx tsx src/index.ts` directly works. Unclear yet whether this is Windows-specific or
    an artifact of this sandboxed dev environment; re-test once hosted on the real
    (presumably Linux) target.
  - Even via `npx tsx`, Chromium launches are intermittently flaky here (resource pressure
    from everything else running in this dev environment, most likely) — `takeScreenshot()`
    now retries a launch failure up to 3x before giving up (`worker/src/shared/screenshot.ts`).
  - The worker needs its own `worker/.env` (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
    `ANTHROPIC_API_KEY`) — this didn't exist anywhere in the repo before 2026-07-26 (correctly
    gitignored, but also never documented as a setup step to actually create it). Start with
    `npx tsx --env-file=.env src/index.ts` from `worker/`. Get the service-role key via
    `supabase projects api-keys --project-ref <ref>`, not from `app/.env.local` (that file's
    copy of it was left empty).
  - **Since 2026-07-27 the worker also runs the generatie-stap**, not just review/Shopify —
    hosting it is no longer optional for a working pipeline. See that session's notes below.
- **KBO Open Data import**: still not started for real. Two rows were seeded directly into
  `kbo_ondernemingen` on 2026-07-24 purely as sourcing-run test fixtures (fictional
  florists in Peer/Hechtel-Eksel) — that's test data exercising the pipeline, not a step
  toward the real recurring import job, which remains unbuilt.

## 2026-07-24 end-to-end test session — bugs found and fixed

Ran the full pipeline live (sourcing-run → research → generatie → review-loop) against two
real test leads (an auto-sourced flower shop + a manually-added "Tuinbouw Hendrix"). Found
and fixed, in order hit:
1. `permission denied for table X` on everything — missing table GRANTs (see above).
2. Every Edge Function failure showed the same generic "non-2xx status code" instead of the
   real error — `supabase.functions.invoke()` needs `error.context.json()` read explicitly.
   Fixed in all 8 call sites; new helper `app/src/lib/supabase/function-error.ts`.
3. A job that failed after being marked `bezig` stayed `bezig` forever (no code path ever
   moved it to `mislukt`) — fixed in `research`, `generatie`, `sourcing-run` Edge Functions.
4. `research`'s `JSON.parse()` on the model's answer broke when the model added a sentence
   of prose before the JSON (happens sometimes with `web_search` enabled) — now extracts the
   `{...}` substring first.
5. **The `demos` Storage bucket was `public: false` live**, despite the migration intending
   `true` (its `on conflict do nothing` was a no-op against pre-existing state) — fixed via
   `20260725000000_fix_demos_bucket_public.sql`. Not a functional break (nothing reads
   Storage URLs directly, `track-and-serve` always uses the service-role client), but worth
   having fixed regardless.
6. **The real one**: the worker's review-loop screenshot always showed raw HTML source, not
   the rendered page — because Supabase Storage serves every object (signed or public) as
   `text/plain` with a locked-down sandbox CSP, by design, to stop stored HTML from ever
   executing on `*.supabase.co`. Fixed by having the worker screenshot via
   `page.setContent(html)` (loading the markup directly) instead of navigating to a Storage
   URL — see the comment in `worker/src/shared/screenshot.ts`. This one mattered: it made
   the AI reviewer reject every version 5/5 times, every lead — actually just from seeing
   source code, not the site — and the review-loop drove the lead to `Geblokkeerd` in what
   looked like normal, if unlucky, spec-compliant behavior. It wasn't; the state machine did
   exactly what it should have given what the worker was (wrongly) telling it.

After fix #6, the reviewer correctly saw the rendered page and gave real, specific feedback
(a broken hero image, a typo) — proof the review-loop itself works. Blocked from taking it
further (concept → afgerond → actief) by the Anthropic credit exhaustion noted above.

## 2026-07-25 — NACE readability + real visual previews

- **NACE codes now have human labels.** `app/src/lib/nace.ts` (frontend) and
  `supabase/functions/_shared/nace.ts` (duplicated for the Deno runtime — no shared-package
  setup between the two) hold a curated `code -> label` map plus a `NACE_CATEGORIES` grouping
  used by the sourcing-config dialog's new category checkboxes. `sourcing-run` now stores the
  label in `leads.sector` instead of the raw code. **This is a starting set, not the full
  official nomenclature** — verify/extend against Statbel's NACE-BEL 2008 codelist,
  especially the exact 6-digit sub-codes, before relying on it for real sourcing.
- **In-app previews (the panel's Demo-preview, and Version History's "Bekijk") now actually
  render the site.** Same root cause as the worker's screenshot bug: Storage serves every
  object as `text/plain`, so a `src="<signed-or-public-storage-url>"` iframe/window only ever
  showed raw source. Both now fetch the HTML bytes and inject them directly — `srcDoc` for
  the inline preview, `document.write()` for "Bekijk"'s popup — bypassing Storage's content-
  type entirely. `version-actions.ts`'s `fetchSignedDemoUrl` was replaced by `fetchDemoHtml`.
- **"Bekijk" opens a popup window**, not an inline iframe — opened synchronously on click
  (before the `await` on the HTML fetch) specifically so real browsers don't treat it as an
  unsolicited, blocked popup; a "Laden..." placeholder shows in it until the fetch resolves.
  Verifiable only by a human — the sandboxed test browser used to verify everything else in
  this file hard-blocks `window.open()` outright (returns `false` even called fully
  synchronously), so this one needs a real click in a real browser to confirm.

## 2026-07-25 — full pipeline run to completion, three leads live

Once Anthropic credits were restored, ran research → generatie → review-loop through to
`actief` for all three of this session's test leads: **Bloemenboetiek De Roos** (the
auto-sourced florist), **Tuinbouw Hendrix** (manual lead, Peer), and **Bloemen Gielen**.
All three now have an AI-approved, live `site_versions` row and resolve on the public
`track-and-serve` route. Two more real bugs turned up and got fixed along the way:

1. **`page.screenshot()` without `fullPage: true` only captures the viewport** — the AI
   reviewer was rejecting every version because it could only ever see the hero section, not
   the rest of the page, and correctly refused to approve a site it couldn't fully see.
   Fixed in `worker/src/shared/screenshot.ts`.
2. **Images occasionally showed blank/alt-text in the screenshot despite the network request
   having completed** (`loading="lazy"` + `networkidle` isn't a hard guarantee every image
   finished decoding before the shot) — added an explicit, bounded
   (`waitForFunction(...img.complete...)`, 5s timeout, best-effort) wait for every `<img>`
   before screenshotting.
3. Chromium's launch remained intermittently flaky under this dev sandbox's load throughout —
   running the worker via a **bounded foreground** `npx tsx src/index.ts` (not
   `run_in_background`) was noticeably more reliable than backgrounding it; unclear whether
   that's specific to this harness's background-process handling or just noise. Re-evaluate
   once the worker is hosted for real.

**Important platform-level finding — the public preview link doesn't render for a real
browser yet.** `track-and-serve` sets `Content-Type: text/html` in its own `Response`, and a
`curl -I` (HEAD) confirms that's what left the function. But a real `GET` — what a browser
actually does on navigation — comes back reclassified as `Content-Type: text/plain` with
`Content-Security-Policy: default-src 'none'; sandbox` and `X-Content-Type-Options: nosniff`
added, i.e. the exact same anti-XSS sandbox Storage applies to stored objects, reproduced
consistently, apparently applied by Supabase's own edge gateway/WAF in front of the function
(response headers show requests landing on different `x-sb-edge-region`s between HEAD and
GET — looks like a gateway-layer body-sniffing rule, not something `track-and-serve`'s own
code can override). This is very likely *why* the spec (section 2) calls for "a custom domain
mapped to that function" rather than linking the raw `*.supabase.co` function URL directly —
a custom domain probably isn't subject to this same shared-subdomain WAF rule, but that's
untested here (no custom domain set up). Net effect: everything that reads the demo HTML
programmatically (the app's own previews, the worker's screenshots) works correctly; a lead
clicking the literal `track-and-serve` URL in a real browser today would not. Get a custom
domain mapped before relying on this link in a real outreach email.

## 2026-07-26 — second E2E round: an auto-sourced florist + Tuinbouw Hendrix re-verified

Re-ran the pipeline live against **Bloemenatelier Verbeeck** (already-sourced, unprocessed
florist lead from the 2026-07-24 sourcing-run fixtures — re-running sourcing-run itself first
correctly found 0 new candidates, since the KBO staging table still only has the two seeded
test rows) and re-verified **Tuinbouw Hendrix**'s existing approved site. Found and fixed three
more real bugs, and hit the same external blocker as before at the end:

1. **`research` had the same status-regression bug `generatie` was already fixed for**: it
   unconditionally set `leads.status = "research"` on every run, with no guard against
   regressing a lead that had already progressed past it. Concretely: Tuinbouw Hendrix's status
   was stuck on `research` despite already having an approved, active site — a legitimate
   re-research (testing the `web_fetch` completeness work) had dragged it backwards, and nothing
   ever moved it forward again. Fixed with the same guard `generatie` already had; the one
   already-stuck lead was corrected directly via SQL (not by re-running anything).
2. **The real one — client-specific chat-edit instructions were leaking into every other
   client's generation.** `chat-edit-static` persists every applied instruction verbatim into
   the *global* `stijlvoorkeuren` table, and `generatie` applies every row in that table to
   *every* lead, unconditionally. An earlier chat-edit on Tuinbouw Hendrix ("look at
   tuinen-hendrix.be and use their services") got saved there and then silently applied to
   Bloemenatelier Verbeeck — an unrelated flower shop — during this test. The AI reviewer
   correctly flagged the mismatch every time and blocked the lead. Fixed by adding a separate
   `onthoud_als_algemene_stijlvoorkeur` tool the model only calls when it judges a change to be
   a genuinely general, client-independent style rule (with its own generalized phrasing, no
   client names/URLs) — client-specific instructions still apply to the current lead but no
   longer get persisted globally. The one bad row already in the live table was deleted.
3. **generatie was picking Unsplash image URLs from memory, and that's unreliable in two
   distinct ways** — both observed live in Verbeeck's rejected reviews: some invented photo IDs
   don't resolve at all (broken image, visible alt-text in the screenshot), and some resolve to
   a *real* photo that isn't what the model thought — a "seasonal bouquet" card that showed a
   tropical beach, an "interior greenery" card that showed beer taps. Fixed with a small curated
   image bank (`supabase/functions/_shared/image-bank.ts`, duplicated into
   `worker/src/pipeline/generate-demo.ts`) — every URL was actually downloaded and visually
   inspected before being added (not just checked for a 200 status), and the prompt now requires
   picking from this list or falling back to a plain color block, instead of guessing new IDs.
   (Confirmed `source.unsplash.com`'s keyword-based random-photo endpoint is dead — 503 — so
   that wasn't available as an easier fix.)

After fix #3, re-ran Verbeeck's generation + review from scratch — got through generatie cleanly
with the new image bank, but the review job itself then hit **the same Anthropic credit
exhaustion this project hit once before** (`credit balance is too low`) partway through, so the
post-fix review outcome for Verbeeck is still unverified. Re-run its review job once credits are
topped up (the existing concept version already reflects the image-bank fix — no need to
regenerate again, just queue a fresh `review` job for lead `35cf54b2-c980-42a9-9a29-ff92d7ce2867`).

Tuinbouw Hendrix's active site (already live from before) was re-inspected this round for
quality — it's genuinely complete: full nav, hero, trust strip, 3-card diensten section,
about/story section, 3-card realisaties section, a themed feature section, and a real contact
block with the actual BE company/address/VAT data from research. In-app preview (the
`srcDoc`-based demo panel) renders it correctly. The public `track-and-serve` link was
re-confirmed still affected by the platform text/plain gateway issue described above (still
needs a custom domain — not a regression, not re-fixable from code).

The worker's Chromium instability note above turned out to have a second, unrelated cause this
round: a stale worker process from earlier in a long session can keep running old code and race
new ones for jobs — always confirm which PID is actually live (`Get-CimInstance Win32_Process`)
after restarting it, not just that *a* `node` process exists.

## 2026-07-27 — meerpagina-generatie (branch `feature/multipage-generator`)

De generator maakt nu een echte samenhangende site van 4-6 pagina's in plaats van één
HTML-bestand. Dit wijkt bewust af van spec 3.3's letterlijke "één AI-call, volledig
HTML-bestand" — die zin is verouderd t.o.v. wat de app moet opleveren.

- **Deterministische assemblage** (`supabase/functions/_shared/site-builder.ts`, gedupliceerd
  naar `worker/src/shared/site-builder.ts` zoals nace.ts/image-bank.ts al deden). Het model
  levert de *onderdelen* in een `===SECTIE===`-formaat (META-paginalijst, HEAD, NAV, FOOTER,
  één body per pagina); de code zet daar de losse HTML-bestanden uit samen. Daardoor zijn
  nav en footer op elke pagina identiek *by construction*, wordt de actieve pagina in code
  gemarkeerd, en wordt elke interne href tegen de echte paginalijst genormaliseerd — een
  onoplosbare link laat de build falen in plaats van een dode link in een demo te sturen.
  `data-nav-actief` op een link is tegelijk hoe de code herkent wat een menu-item is (niet
  het logo, niet een CTA-knop). Regressietest: `cd worker && npm run test:site-builder`.
- **Opslag per versie is een map**: `{leadId}/{versienummer}/index.html` + de andere pagina's
  + `bron.json` (de geparste onderdelen, zodat chat-edit de nav/footer één keer patcht en de
  code ze op alle pagina's opnieuw toepast). `content_referentie` wijst naar `index.html`;
  de nieuwe kolom `site_versions.paginas` is het manifest. `paginas IS NULL` = oude
  één-bestand-versie, overal expliciet afgehandeld.
- **`track-and-serve` serveert `/{leadId}/{bestand}.html`** en redirect `/{leadId}` naar
  `/{leadId}/` — de gegenereerde pagina's linken relatief naar elkaar, dus de browser moet
  de versiemap als directory zien. Enkel bestanden die in `paginas` staan zijn opvraagbaar.
- **`cleanup-storage` loopt nu recursief** — Storage heeft geen echte mappen, dus de oude
  één-niveau-`list()` zag een synthetische map-entry en verwijderde daar niets van.
- **De generatie-stap is verhuisd naar de worker.** Een echte meerpagina-site is enkele
  minuten modeloutput; een Edge Function-invocatie op dit project wordt daar ruim voor
  afgebroken — zowel streamend als niet-streamend exact op ~150s met `WORKER_RESOURCE_LIMIT`
  (platform-wallclock, niet weg te tunen). De run die wél slaagde duurde ~3 minuten. De
  Edge Function `generatie` zet nu enkel een job in de wachtrij (nieuwe kolom `jobs.payload`
  draagt de "extra instructies"-tekst mee); de worker verwerkt hem, net als `review`.
  **Gevolg: de worker moet draaien om te kunnen genereren** — voorheen gold dat enkel voor
  review en Shopify-builds. Aanroep vanuit de app (`invoke("generatie", ...)`) is ongewijzigd.
- **De review-loop bekijkt elke pagina** (desktop-screenshot per pagina + mobiel van de home,
  max 5 pagina's — die beelden gaan allemaal in één call en moeten binnen de €5/lead blijven).
- **Shopify blijft een apart pad, bewust**: Shopify heeft zijn eigen paginasysteem (Page-
  records, een Menu dat het thema rendert, Dawn zet zelf al `aria-current`). Zie de kop van
  `worker/src/pipeline/shopify-build-job.ts` voor hoe een `SiteBron` daar 1-op-1 op zou
  mappen als het ooit gebouwd wordt — dat porten van demo-inhoud naar een nieuwe store
  bestaat nog voor geen enkel site-type.

**Live testrun (Tuinbouw Hendrix, lead `36ff0584-aa25-4be2-86f7-1afac318ed52`).** Deze lead
bestond niet meer in de live DB en is opnieuw aangemaakt. `research`'s `web_fetch` raakte
tuinen-hendrix.be niet (wél gewoon bereikbaar met curl), dus de paginatekst is er als
briefing in `leads.notities` ingezet — research vertrouwt notities expliciet. Resultaat:
6 pagina's (home, diensten, zwemvijvers, realisaties, over-ons, contact), 0 dode links,
nav structureel identiek en footer letterlijk identiek op alle pagina's, per pagina exact de
juiste actieve links (2 per pagina: desktop- én mobielmenu), elke pagina vanaf elke pagina
bereikbaar, echte contactgegevens erin. Geverifieerd door de bestanden lokaal te serveren en
elke interne link met een HEAD-request te volgen, plus screenshots via de worker-Playwright-
route. De in-app preview navigeert aantoonbaar tussen pagina's (klik in de nav van het
iframe → juiste pagina, titel en actieve staat). Niet verifieerbaar hier: de `#sectie`-sprong
na een cross-page-link (deze testbrowser klemt élke programmatische scroll op 0) en de
review-loop op een meerpagina-site (niet live gedraaid — kost een volledige review + evt.
hergeneraties).

## 2026-07-27 — de uitgestelde features (zelfde branch)

Alles wat in de meerpagina-sessie expliciet was uitgesteld, is nu gebouwd. Rode draad, zoals
bij de site-builder: het model schrijft **inhoud**, de code garandeert **gedrag**.

- **Widget-runtime** (`_shared/site-widgets.ts`, gedupliceerd naar `worker/src/shared/`).
  Eén vaste, geteste runtime die vlak voor `</body>` wordt ingespoten, aangestuurd met
  `data-*`-attributen: mobiel menu, FAQ-accordion (native `<details>`, werkt zonder JS), tabs
  (rollen, roving tabindex, pijltjestoetsen), quiz, click-to-load video, formulier, reviews.
  **Eigen `<script>` en inline handlers worden geweigerd**; enige uitzondering is een
  `tailwind.config`-toewijzing in de HEAD. De markup-contracten worden gevalideerd in de
  build — een tabs-blok waarvan de knoppen naar niet-bestaande panelen wijzen faalt nu, in
  plaats van als rij dode knoppen te renderen. Video's laden pas iets van YouTube/Vimeo ná
  een klik (GDPR, spec 7), en video-ID's worden op vorm gecontroleerd — een verzonnen ID is
  dezelfde fout als de verzonnen Unsplash-ID's van 26/07.
- **Hiërarchie**: een pagina kan `"ouder"` hebben, exact één niveau diep (dieper opdelen doe
  je met tabs binnen een pagina). Een hoofdpagina moet in de nav staan, een subpagina mag ook
  enkel vanaf haar ouderpagina bereikbaar zijn. De nav markeert de ouder met
  `aria-current="true"` als een subpagina open staat. **Het kruimelpad wordt door de code
  gebouwd** (met schema.org BreadcrumbList), niet door het model.
- **Formulieren/reviews/downloads/afgeschermde pagina's** draaien op de bestaande
  hostinglaag (`track-and-serve`, service-role) met drie nieuwe tabellen
  (`site_inzendingen`, `site_bestanden`, `site_toegang`). Honeypot + 5 inzendingen/uur per
  (gehashte) afzender. Een review is pas publiek ná goedkeuring in de app. Downloads worden
  als `attachment` + `nosniff` geserveerd en enkel als ze in `site_bestanden` staan; de
  generator krijgt de bestandslijst als prompt-invoer én als harde build-check.
- **Gating is server-side**: een pagina met `toegang: "beveiligd"` wordt niet uit Storage
  gelezen zonder geldige cookie. Het is één gedeelde code per site, **geen accountsysteem** —
  er is geen gebruikersmodel in dit project en dat verzinnen zou een veiligheidsbelofte doen
  die deze laag niet kan houden. De cookie is afgeleid van de code-hash, dus een nieuwe code
  maakt alle uitgedeelde cookies ongeldig. `index.html` kan nooit beveiligd zijn (daar komt
  de e-maillink op uit).
- **Beheer-UI**: nieuw uitklapbaar blok "Site-interactie" in het lead-paneel (inzendingen
  lezen/goedkeuren, bestanden uploaden, toegangscode instellen).

**Twee Shopify-mutations bleken niet te bestaan** (gevalideerd tegen de echte schema's, niet
tegen documentatie):
- `developmentStoreCreate` (Partner API) — bestaat niet, en de Partner API heeft überhaupt
  maar twee mutations (`appCreditCreate`, `appSubscriptionCancel`). **Spec 3.8's "development
  store via de Partner API" is niet haalbaar.** De store wordt nu manueel aangemaakt in het
  Partner Dashboard; bij het omzetten naar Shopify-klant vul je het `myshopify.com`-domein in
  en doet de `shopify_opbouw`-job de rest.
- `staffMemberInvite` (Admin API) — bestaat niet; `StaffMember` is read-only en vereist zelfs
  om te lezen `read_users` (enkel Plus/Advanced). **Spec sectie 4 is niet automatiseerbaar.**
  De functie geeft nu de stappen terug voor de Shopify-beheerder en noteert pas "Uitgenodigd"
  na een expliciete bevestiging.

**Geverifieerd**: 39 unit-tests (`cd worker && npm test`), het gedrag van elke widget in een
echte browser (`scripts/demo-widgets.ts`), en de publieke endpoints live tegen de gedeployde
`track-and-serve` — honeypot, rate limit, review-moderatie, downloads, en het volledige
gating-verhaal (401 zonder code, geen pagina-inhoud in het codescherm, cookie na juiste code,
cookie vervalt na rotatie).

**Niet geverifieerd**: het nieuwe "Site-interactie"-paneel is niet in een draaiende browser
aangeklikt — de testbrowser had geen sessie en het injecteren van een auth-token werd (terecht)
geblokkeerd. Typecheck en lint zijn schoon; de klikpaden zelf moet je één keer zelf nalopen.
Ook niet gedaan: een echte e-commerce end-to-end-test (vereist een development store mét
Admin-token, die bestaat nog niet) en een generatie die de nieuwe widgets/hiërarchie effectief
gebruikt — de bestaande Hendrix-demo is van vóór deze features.

## 2026-07-28 — geschatte duurtijden + briefing-media (MIKI TEA)

- **Elke pipeline-stap toont nu een geschatte duur.** `app/src/lib/job-duur.ts` neemt de
  mediaan van de laatste 10 geslaagde jobs per type uit `jobs`, met een standaardwaarde tot er
  minstens 3 metingen zijn. De standaard voor `generatie` is bewust NIET de historische mediaan:
  de meeste rijen dateren van vóór de verhuizing naar de worker (toen ~150s en één pagina).
  De knop telt enkel de stappen op die díe klik echt uitvoert; een lopende job toont verstreken
  tijd + resterend, en laat "resterend" vallen zodra de schatting voorbij is.
- **Research draait nu ook in de worker.** Zelfde oorzaak als generatie: web_search + meerdere
  web_fetch-rondes zitten met 50-138s tegen het ~150s-plafond van een Edge Function-invocatie.
  Gaat het eroverheen, dan kapt het platform het proces af zonder exception en blijft de job
  eeuwig op `bezig` staan — precies wat er met de MIKI TEA-lead gebeurd was.
- **Afbeeldingen uit de briefing worden binnengehaald** (`worker/src/pipeline/media-ingest.ts`).
  Een logo dat vanaf een Instagram-/Facebook-CDN gelinkt wordt, staat achter een ondertekende URL
  die verloopt (die van MIKI TEA: nog geen 4 dagen geldig). Wordt nu één keer opgehaald, in
  Storage gezet en door `track-and-serve` inline geserveerd. Hexkleuren in de briefing worden als
  huisstijlpalet doorgegeven.
- **De afbeeldingenbank wordt per lead gefilterd.** Een vaste lijst plus een promptregel
  "gebruik geen foto van het verkeerde onderwerp" werkt niet: MIKI TEA (matcha-afhaal) kreeg
  eerst een kapsalon en een gedekte restauranttafel, en na een veel strengere regel
  bloemenwinkelfoto's. Nu krijgt het model enkel de foto's waarvan de trefwoorden matchen met
  sector/briefing; matcht er niets, dan een lege lijst + instructie om met kleurvlakken te
  werken. Wikimedia Commons is als bron van theebeelden bekeken en afgewezen: alles CC BY-SA
  (naamsvermelding verplicht, share-alike) — niet geschikt voor een commerciële klantensite.

**Wat Instagram/Facebook wél en niet kan.** Een Instagram-profiel is niet uitleesbaar: de pagina
is een JS-shell zonder og:-tags en `web_fetch` botst op de login-muur (research meldt dat nu zelf
in `open_vragen`). Een story-link is bovendien na 24u weg én login-only. Wat wél werkt: een
directe CDN-afbeeldings-URL (wordt binnengehaald), de profiel-URL als community-link, en alles
wat de gebruiker zelf in de notities zet. Menu's moeten dus als tekst in de briefing of als
upload via het Site-interactie-paneel komen.

## 2026-07-28 — de uitgestelde featurelijst afgewerkt + live geverifieerd

De negen punten die in de meerpagina-opdracht expliciet waren uitgesteld ("bouw dit NIET nu"),
met hun echte status. Acht zijn gebouwd, één is geblokkeerd op iets dat niet bestaat.

| Feature | Status |
|---|---|
| FAQ-accordion | gebouwd, in browser gedraaid |
| Tabs | gebouwd, in browser gedraaid (klik + pijltjestoetsen + focus) |
| Interactieve quizzes | gebouwd, in browser gedraaid (score, geen dubbel antwoorden) |
| Video-integratie | gebouwd, click-to-load geverifieerd: 0 externe requests vóór de klik |
| Community-integratie | gebouwd (links uit research, geen runtime nodig) |
| Hiërarchische opbouw | gebouwd, in browser gedraaid (kruimelpad, ouder-markering) |
| Downloadbare bestanden | gebouwd, live geserveerd (200, inline voor beelden) |
| Formulieren en reviews | gebouwd, **live geverifieerd** (zie hieronder) |
| Gated content / login | gebouwd, **live geverifieerd** (zie hieronder) |
| E-commerce end-to-end test | **geblokkeerd** — zie onderaan |

**Live tegen de gedeployde `track-and-serve` (2026-07-28):**
- Formulier: gewone inzending 200 + opgeslagen; honeypot ingevuld → 200 maar niets opgeslagen
  (een bot mag niet leren dat hij herkend is); zonder bericht → 400; rate limit slaat toe op de
  6e inzending per uur per afzender → 429.
- Reviews: `GET /{leadId}/reviews` gaf `[]` zolang de review op `nieuw` stond, en pas ná
  goedkeuring in de app de review zelf. Moderatie werkt dus echt, een ingediende review komt
  nooit ongezien op de site.
- Gating: publieke pagina 200; beveiligde pagina zonder code → 401 met codescherm en **geen
  pagina-inhoud in de respons**; verkeerde code → 401; juiste code → 303 met een
  HttpOnly/SameSite=Lax-cookie; mét cookie → 200. Na het roteren van de code was de al
  uitgedeelde cookie meteen ongeldig (401), want de cookie is afgeleid van de code-hash.
- Alle testdata is daarna weer verwijderd en de versie terug op `concept` gezet.

**Waarom de e-commerce end-to-end-test niet kan.** Er is geen development store met een
Admin-token — spec 3.8's `developmentStoreCreate` bestaat niet (zie 2026-07-27), dus die store
moet manueel aangemaakt worden. De Shopify-connector die in deze omgeving hangt, geeft
`operation_not_allowed: This shop is unavailable for API access`. Zonder levende winkel blijven
`chat-edit-shopify` en de rate limiter ongetest. Dit is het enige punt van de lijst dat open
staat, en het hangt op een account, niet op code.

## 2026-07-29 — Shopify store-aanmaak via browserautomatisering + echte tokens

**Waarom UI-automatisering.** Er is geen API om een winkel aan te maken. Dat is nu drie keer
tegen het levende schema gecontroleerd (`developmentStoreCreate`, `devStoreCreate`,
`storeCreate`, `shopCreate` — allemaal "doesn't exist on type 'MutationRoot'"). De Partner API
heeft op 2026-01 één mutation (`appCreditCreate`) en vier queryvelden, waarvan geen enkel
winkels teruggeeft. Hercontroleer met `worker/scripts/partner-api-status.ts`.

- **`worker/src/shopify/`** — nieuwe map. `store-flow-config.ts` bevat élke selector, URL en
  veldnaam; dat is bewust het enige bestand dat je moet openen als Shopify z'n signup-flow
  wijzigt. Elke stap heeft meerdere kandidaat-selectors (data-attribuut → rol+naam → tekst),
  omdat klassenamen bij elke deploy veranderen.
- **`live-browser.ts` is generiek en herbruikbaar** — weet niets van Shopify. Persistente
  context (blijft ingelogd), niet-headless, en een JPEG-stream via Storage die de app als
  `<canvas>` toont. Bewust geen WebSocket/WebRTC: dit hergebruikt transport dat er al is.
- **Mens-in-de-lus.** Bij CAPTCHA/2FA/onbekend scherm gaat de job naar de nieuwe jobstatus
  `wacht_op_mens`, niet naar `mislukt` (er is niets stuk) en niet naar `bezig` (er gebeurt
  niets). De UI toont "actie vereist" + live beeld; jij lost het op in het echte venster en
  klikt Hervatten. **De automatisering typt nooit wachtwoorden en lost nooit zelf een CAPTCHA
  op** — dat is de enige manier die én toelaatbaar én duurzaam is.
- **De statustrigger moest mee.** `bezig → wacht_op_mens` werd geweigerd door
  `enforce_job_status_transition`; ontdekt door de overgang te próberen in plaats van aan te
  nemen dat een nieuwe enum-waarde volstaat. Migratie `20260729010000`.
- **De 15-minutentimeout in de worker checkt nu de status** voor hij toeslaat, anders wordt een
  job die op een mens wacht onder diens handen weggetimeout.

**Tokens: custom apps bestaan niet meer.** Shopify heeft ze op 2026-01-01 afgevoerd ("you can
no longer create new legacy custom apps"), en ze waren sowieso nooit via de Admin API aan te
maken. De vervanger is de **client credentials grant**: één app in het Dev Dashboard, per winkel
geïnstalleerd, tokens programmatisch opgehaald. Gevolg voor het schema: die tokens leven 24 uur,
dus het duurzame geheim is de `client_secret` in de omgeving en wat per winkel in
`shopify_stores` staat is een versleutelde, kortlevende cache. Dat is beter dan een permanente
credential per winkel — een gelekte rij is binnen een dag waardeloos.

- `klanten.shopify_access_token` (plaintext `text`, sinds het eerste schema, nooit gevuld) is
  **gedropt**. `chat-edit-shopify` en `shopify-staff-invite` halen hun token nu via
  `_shared/shopify-token.ts`. Scopes bewust beperkt tot themes/producten/content — geen orders,
  geen klantgegevens.
- `crypto.ts` leest nu `TOKEN_ENCRYPTION_KEY` met terugval op `GMAIL_TOKEN_ENCRYPTION_KEY`.

**Niet geverifieerd, en niet verifieerbaar door mij:** de selectors zijn geschreven tegen wat
het Partner Dashboard hoort te tonen, maar de flow is nooit end-to-end gedraaid — dat vereist
inloggen op het Partner-account (wachtwoord) en zou echte winkels aanmaken. Reken op één ronde
selector-bijstellen bij de eerste echte run; daarvoor bestaan het stappenlog en de screenshot
bij elke mislukte stap. Ook ongetest: de client credentials grant zelf, want er is nog geen app
in het Dev Dashboard en geen winkel om ze op te installeren.

**De demo-inhoud gaat nu ook de winkel in** (`worker/src/shopify/site-naar-shopify.ts`). Dat
porten bestond voor geen enkel site-type; het werkt omdat een `SiteBron` de pagina-bodies al
zonder nav/footer/head bewaart — precies wat een Shopify-pagina moet zijn, want het thema levert
die drie. `paginas` → `pageCreate`, de paginaboom → een `Menu`, footer en head vallen weg.
Vooraf tegen het levende Admin-schema gecontroleerd (pageCreate/menuCreate/menuUpdate/themePublish
bestaan allemaal), en dát bracht een scope-fout aan het licht: `menuCreate` vereist
`write_online_store_navigation`, apart van `write_content`. Zonder die scope zouden de pagina's
netjes overkomen en zou de navigatie stil falen. Twee bewuste keuzes: `index.html` wordt géén
Page (dat is de storefront-home die het thema rendert), en een pagina met `toegang: beveiligd`
wordt overgeslagen in plaats van ongepubliceerd aangemaakt — Shopify heeft geen equivalent voor
de toegangscode, dus porten zou de bescherming stilletjes weghalen. 7 tests dekken de mapping;
niet tegen een levende winkel gedraaid, want die is er nog niet.

**Juridische kanttekening die de gebruiker moet wegen:** geautomatiseerd door het Partner
Dashboard klikken staat vermoedelijk op gespannen voet met de Partner Program Agreement. Het
risico is niet een gefaalde job maar schorsing van het Partner-account, met alle klantwinkels
eraan.

## 2026-07-30 — bugronde uit echt gebruik + persistente chat

Gemeld tijdens gebruik, en wat het bleek te zijn:

- **Willekeurig uitgelogd worden** (het ergste). De auth-guard in
  `(dashboard)/layout.tsx` stuurde naar `/login` bij **elke** null-sessie uit
  `onAuthStateChange`. Dat event vuurt óók met null bij tijdelijke toestanden
  (INITIAL_SESSION vóór storage gelezen is, een refresh die even niets vasthoudt).
  Reageert nu enkel op een echte `SIGNED_OUT`. De browserclient is bovendien een
  expliciete singleton — `createBrowserClient` is singleton-by-default, maar 32
  aanroepplekken die op een default steunen is te veel vertrouwen, en twee clients
  die hetzelfde refresh-token verversen eindigt in `refresh_token_already_used`.
- **"Shopify bleef laden"**: de job stond op `wachtrij` en er draaide geen worker.
  De knop zei desondanks "Bezig met aanmaken…". Toont nu de wachtrij-toestand, en
  de live-view pollt Storage niet meer voor beelden die nog niet kunnen bestaan.
- **Gmail koppelen gaf "Error 400: invalid_request"** — dat was niet Google maar een
  lege `NEXT_PUBLIC_GOOGLE_OAUTH_CLIENT_ID`. De app weigert nu vooraf met uitleg.
- **Hydration-mismatch** kwam van `cz-shortcut-listen` (ColorZilla-extensie) op
  `<body>`. Niet van ons; `suppressHydrationWarning` op dat ene element, zodat een
  echte mismatch niet in de ruis verdwijnt.
- Auditlog noemt nu het bedrijf; "Web Agency" linkt naar Overzicht; de tegels linken
  naar de lijst die ze tellen (leadspagina kent nu de groepen `actief`/`aandacht`).

**Chat is nu persistent** (`chat_berichten`). Stond in React-state, dus sluiten =
kwijt, en de andere gebruiker zag nooit wat er gevraagd was. Rollen: `gebruiker`
(mét adres, zodat "Garen vroeg dit" maanden later beantwoordbaar is), `ai`,
`systeem`. `review_log` blijft apart: dat is het audit-spoor per versie, dit is het
gesprek. `useLeadChat` is de enige plek met chatlogica; het strookje in het paneel
en het volledige venster (`chat-venster.tsx`, met sleep-en-neerzet voor bestanden)
zijn twee weergaven van dezelfde hook.

**E2E staat nu op 5 tests**, groen tegen het echte project.

**Nog steeds open**: geen KBO-import (wacht op een bestand van de gebruiker), geen
levende Shopify-winkel, en **twee gebruikers tegelijk is nooit getest** — de
Realtime-koppelingen zijn er wel, en de chat is daarvoor de logische eerste proef.

## 2026-08-21 — waarom de Shopify-store-aanmaak "bleef hangen"

Gemeld: het blijft hangen, er is nog nooit een winkel aangemaakt. Diagnose gaf drie
gestapelde oorzaken, waarvan de derde de eigenlijke bug was.

**1. Er draaide geen worker.** Drie `shopify_store_aanmaak`-jobs stonden op `wachtrij`
(1 aug, 2 aug, 21 aug), alle drie met `pogingen=0`, `gestart_op` leeg en nul regels in
`shopify_automatisering_log`. De automatisering had dus nog geen milliseconde gedraaid —
het was nooit een selector- of CAPTCHA-probleem.

**2. `SHOPIFY_PARTNER_ORGANIZATION_ID` ontbrak in `worker/.env`.** Hij stond in
`app/.env.local`, maar dat is een ander bestand; de worker leest zijn eigen omgeving. Zodra
een job wél geclaimd werd, was hij meteen gestorven op regel 1. Nu aangevuld.

**3. De echte bug: "wachtrij" en "er draait niets" zagen er identiek uit.** Een job kon drie
weken blijven staan terwijl de UI netjes "in wachtrij" toonde. Daarom:
- **`worker_status`-tabel met hartslag** (elke 15s, plus tijdens lange jobs via een eigen
  interval — anders lijkt een job van 3 minuten op een dode worker). Eén rij, met een
  `check(id)`-primary key: twee workers die elk hun eigen rij schrijven zou een dode
  worker levend laten lijken.
- **Waarschuwingsbalk in de hele dashboard-layout** zodra de laatste hartslag ouder is dan
  60s, met het startcommando erin. Geldt voor álle worker-jobs (research, generatie,
  review, Shopify), niet alleen deze.
- **`worker/src/shared/omgeving.ts`**: de worker controleert zijn omgeving één keer bij het
  opstarten. Kernvariabelen ontbreken → weigert te starten. Optionele ontbreken → waarschuwt
  wélke jobtypes daardoor niet kunnen, en die jobs worden meteen op `mislukt` gezet in plaats
  van eeuwig te blijven staan.

**Daarna geverifieerd door hem echt te draaien**: de worker claimde de job van 1 augustus,
opende een echte browser, kwam op het loginscherm van het Partner Dashboard en zette de job
correct op `wacht_op_mens` met een screenshot erbij. De keten werkt dus tot precies het punt
waar hij een mens nodig heeft.

**Wat er nu nog van jou nodig is** (dit kan de automatisering niet en mag ze niet):
1. Start de worker: `cd worker && npx tsx --env-file=.env src/index.ts`.
2. Log één keer zelf in op het Partner Dashboard in het venster dat opengaat. De sessie blijft
   daarna bewaard in `.shopify-sessie/`.
3. Klik "Hervatten" in het leadpaneel.
Pas dan kunnen de selectors uit `store-flow-config.ts` voor het eerst tegen de echte pagina's
lopen — reken op één ronde bijstellen, daarvoor bestaan het stappenlog en de screenshots.

Nog niet ingevuld: `SHOPIFY_APP_CLIENT_ID`/`SHOPIFY_APP_CLIENT_SECRET` (Dev Dashboard-app).
Zonder die twee worden `shopify_opbouw`-jobs nu netjes geweigerd met uitleg.

## 2026-08-21 — de willekeurige uitlogs, verweesde jobs, en afbeeldingen

- **Uitgelogd worden had een aanwijsbare oorzaak.** Negen `auth.getUser()`-aanroepen op
  gewone handelingen (een lead openen, een voorkeur bewaren, een auditregel schrijven).
  Dat is telkens een netwerkronde die het token serverside valideert; faalt de refresh
  erachter, dan gooit supabase-js de sessie weg en vuurt `SIGNED_OUT`, en de guard zette je
  midden in een klik op `/login`. Al die plekken wilden enkel het e-mailadres — dat leest
  `getSession()` uit storage zónder netwerk. Alle negen zijn omgezet naar
  `app/src/lib/huidige-gebruiker.ts`; er staat nu **geen enkele `getUser()` meer in `app/src`**.
  De guard controleert bovendien vóór hij doorstuurt: een `SIGNED_OUT` terwijl de sessie nog
  in storage staat, is geen uitlog.
- **Er ligt nu een spoor**, want de oorzaak was nooit hard bewezen. `app/src/lib/auth-logboek.ts`
  schrijft elke auth-gebeurtenis naar localStorage (namen en tijdstippen, **nooit tokens**),
  zodat het de redirect overleeft. Uit te lezen via **Voorkeuren → Sessie-diagnose**. Gebeurt
  het opnieuw, kijk daar eerst — dan is er iets om naar te kijken in plaats van een beschrijving.
- **"Blijft hangen op de inlogpagina" (MIKI TEA) waren verweesde jobs.** `claimNextJob` kijkt
  enkel naar `wachtrij`; een job die op `bezig` of `wacht_op_mens` stond toen de worker stierf,
  werd door niemand nog opgepikt — ook niet na "Hervatten", want dat zet hem op `bezig`. De
  worker zet zulke jobs bij het opstarten terug in de wachtrij (`herstelVerweesdeJobs()`, via
  `timeout`, want `bezig → wachtrij` mag niet van de statustrigger).

**WebP: het idee klopt, maar het grootste deel gebeurde al.** Elke URL in de afbeeldingenbank
draagt `auto=format` — dat is imgix-contentonderhandeling: een moderne browser krijgt WebP of
AVIF via de Accept-header, een oude gewoon JPEG. De stockfoto's, veruit de meeste pixels op een
gegenereerde site, waren dus nooit het probleem. Wat er wél ontbrak, zat niet in het formaat:
niets vertelde het model over lazy loading, dus een dienstenpagina met twaalf foto's haalde er
twaalf tegelijk op. `optimaliseerAfbeeldingen()` in de site-builder regelt dat nu in code —
eerste afbeelding `eager` + `fetchpriority="high"`, de rest `lazy`, alles `decoding="async"`,
en een bank-URL zonder `auto=format` krijgt hem alsnog. Een attribuut dat het model bewust
schreef, blijft staan.

**Wat níet omgezet wordt, en waarom niet:** het logo uit de briefing en uploads via de chat
worden byte-voor-byte geserveerd zoals ze binnenkwamen. Omzetten vraagt een encoder in de worker
(`sharp`, een native binary) op een machine die al met native binaries vecht (zie Chromium's
`STATUS_DLL_INIT_FAILED` hierboven). Voor een logo is de winst bovendien klein — PNG is daar
vaak het juiste formaat, en lossless WebP scheelt ~20-30% op enkele tientallen KB. Voor een
telefoonfoto van megabytes is de winst reëel, maar dan is *verkleinen* de grotere hefboom dan
het formaat. Bewuste afweging, geen vergetelheid.

## 2026-08-21 — echte Windows-app met installer

`app/src-tauri/` bestond al, maar was de onaangeroerde `create-tauri-app`-steiger: het wees met
`frontendDist` naar `../.next-static-unused`, een map die niet bestaat. Er was dus nooit een app
gebouwd. Nu wel.

```bash
cd app && npm run app:build
```

Levert `app/src-tauri/target/release/bundle/nsis/Web Agency Dashboard_0.1.0_x64-setup.exe`
(**2,3 MB** — Tauri gebruikt de WebView2 die al op elke Windows 10/11 staat, dus er zit geen
browser in de installer). `npm run app:dev` draait de app tegen `next dev` met hot reload.
Rust is vereist om te bouwen, niet om te draaien.

- `frontendDist` wijst nu naar `../out`, de echte static-export. `beforeBuildCommand` draait
  `next build`, dus één commando volstaat.
- Bundeldoel is **enkel NSIS**, niet `"all"` — `"all"` probeert ook een MSI via WiX te maken, wat
  hier niets toevoegt. Installeert per gebruiker (`currentUser`), dus geen UAC-prompt.
- **`NEXT_PUBLIC_*` worden bij het bouwen ingebakken.** De Supabase-URL en anon-key zitten dus in
  de installer. Dat hoort zo (de anon-key is publiek en RLS doet het werk), maar het betekent dat
  een installer voor een ander Supabase-project opnieuw gebouwd moet worden.
- Geverifieerd: de gebouwde `app.exe` start en blijft draaien, en de static-export die erin zit
  boot schoon in een browser (loginscherm rendert, geen console-fouten). Het vénster zelf is niet
  visueel nagekeken — dat vraagt schermbediening die hier niet beschikbaar was.

**Wat een geïnstalleerde app nog niet kan, en waarom.**
- **De worker draait niet mee.** Research, generatie, review en de Shopify-jobs gebeuren allemaal
  in `worker/`, een apart Node-proces. Installeer je enkel deze app, dan zie je leads en versies
  maar blijft élke pipeline-stap in de wachtrij staan — de worker-waarschuwing bovenaan zegt dat
  ook, alleen noemt ze een `npx tsx`-commando dat voor een geïnstalleerde gebruiker nergens op
  slaat. De echte oplossing is de worker als **Tauri-sidecar** meeleveren (esbuild-bundel +
  Node-binary), met twee open vragen die eerst een beslissing vragen: Playwright's Chromium is
  ~150 MB (meeleveren of bij eerste start ophalen), en de worker heeft de
  `SUPABASE_SERVICE_ROLE_KEY` nodig — die omzeilt RLS volledig en mag dus **niet** in een
  gedeelde installer gebakken worden, maar hoort in een instellingenscherm bij eerste start.
- **Gmail koppelen werkt niet in de verpakte app.** Google's redirect-URI wordt
  `window.location.origin`, en dat is in Tauri `http://tauri.localhost` — geen geldige
  redirect-URI voor Google. Een desktop-app hoort dat via een loopback-listener te doen
  (systeembrowser openen, `http://127.0.0.1:<poort>/` opvangen). Los van de al bekende lege
  `NEXT_PUBLIC_GOOGLE_OAUTH_CLIENT_ID`.
- **Wachtwoord vergeten** stuurt een link naar `NEXT_PUBLIC_APP_URL` (nu `localhost:3000`). Voor
  een geïnstalleerde app moet dat een echt bereikbare URL zijn.

## 2026-08-29 — de worker zit in de app, en de Shopify-automatisering draaide echt

**De worker wordt meegeleverd en start mee met de app, onzichtbaar.** Voorheen kon een
geïnstalleerde app leads en versies tonen maar bleef élke pipeline-stap in de wachtrij —
research, generatie, review en Shopify draaien allemaal in `worker/`, een apart Node-proces dat
je met de hand moest starten.

```bash
cd worker && npm run pak-in     # bundelt + zet node.exe en playwright klaar
cd app && npm run app:build     # installer, 27 MB
```

- `scripts/bundel.ts` (esbuild) maakt er één `worker.cjs` van, 1,5 MB. **Playwright blijft
  extern**: het zoekt zijn driver en browserbinaries relatief aan zijn eigen pakketmap, dus
  gebundeld zou het naar een bestand wijzen dat niet meer bestaat. `scripts/pak-in.ts` zet het
  ernaast, samen met `node.exe`.
- **Chromium gaat niet mee** (~150 MB, enkel nodig voor review-screenshots en de
  Shopify-automatisering). Playwright cachet hem per gebruiker bij het eerste gebruik.
- **De geheimen zitten NIET in de installer.** De service-role-key omzeilt RLS volledig, dus een
  gedeeld installatiebestand zou volledige databasetoegang weggeven. Ze staan in
  `%APPDATA%/be.webagency.dashboard/worker.json`, geschreven door het nieuwe blok
  **Voorkeuren → Worker**. Bewaren herstart de worker meteen.
- De worker-waarschuwingsbalk toont in de verpakte app een **knop** in plaats van een
  `npx tsx`-commando dat een geïnstalleerde gebruiker nergens kan uitvoeren.

**Drie dingen die pas bleken door hem echt te draaien:**
1. **De stdin-bewaker mag niets afleiden uit "stdin is geen TTY".** Elke achtergrondstart krijgt
   meteen EOF, dus de worker stierf één seconde na het starten. Nu enkel actief als de Rust-kant
   `WORKER_STOP_BIJ_GESLOTEN_INVOER=1` zet. Getest: de app hard afschieten neemt de worker mee
   (`RunEvent::Exit` vuurt dan niet, de gesloten pipe wel).
2. **Tauri's `resource_dir()` geeft op Windows een `\\?\`-pad terug** en Node struikelt daarover:
   het faalt op zijn eigen entrypoint met `EISDIR ... lstat 'E:'` vóór er één regel draait.
   `gewoon_pad()` strip het prefix.
3. **De worker never schreef `afgerond_op`.** `job-duur.ts` filtert precies op die kolom om te
   schatten hoe lang een stap duurt — sinds research en generatie naar de worker verhuisden had
   het dus nul metingen en toonde het eeuwig zijn standaardwaarde.

Punt 2 was alleen vindbaar omdat de worker zijn uitvoer nu naar `worker.log` schrijft in
dezelfde map als de config, zichtbaar via Voorkeuren → Worker. Een verborgen proces waarvan
stdout naar `/dev/null` gaat, is niet te diagnosticeren — dat is dezelfde les als de hartslag
van 21/08.

## 2026-08-29 — Antwerp Fried Chicken: volledige pipeline + eerste echte store-aanmaak

Lead `f5364396-b2a2-411e-a99d-1e01ccc3d42b`, Zuivelmarkt 24, 3500 Hasselt, BTW BE 0784461962.

- **Research** vond het echte adres, BTW-nummer en het volledige productaanbod, en meldde
  correct dat het de eigen site niet kon ophalen. Reden achterhaald: `afchasselt.be` en
  `antwerpfriedchickenhasselt.be` hebben een kapotte TLS/SNI-configuratie (elke geautomatiseerde
  client faalt op de handshake) en `http://www.afchasselt.be` toont enkel een doorverwijskaartje
  naar Menute. Er ís dus geen eigen site om over te nemen. Wat wél te verifiëren viel (adres,
  openingsuren, menucategorieën, vijf echte menuprijzen) staat als briefing in `notities`.
- **Generatie** hield zich daaraan: exact die vijf prijzen op de site, geen enkele verzonnen.
- **De review-loop draaide voor het eerst op een meerpagina-site** en deed precies wat hij moet:
  eerste ronde afgekeurd omdat de footer openingsuren als feit vermeldde die research juist als
  onbevestigd had gemarkeerd, tweede ronde goedgekeurd.

**Twee globale stijlvoorkeuren waren nog vervuild van vóór de fix van 26/07.** Beide dateren van
25/07, toen chat-edit élke instructie letterlijk in de globale tabel zette. Gevolg: een frituur
kreeg een pagina "Onze realisaties" met drie projecten, en de reviewer hield de site daar
vervolgens aan alsof het beleid was.
- `Voeg een sectie "Onze realisaties" toe met 3 voorbeeldprojecten.` — verwijderd; er bestaat
  geen algemene vorm van, een afhaalzaak heeft geen projecten.
- De scroll-animatieregel noemde de menu-items van één klant ("diensten", "ontwerp"). De
  bedoeling is wél algemeen, dus herschreven in plaats van verwijderd.
De derde regel (geen emoji's) is van ná de fix, draagt "(gegeneraliseerd)" en is blijven staan.
**Controleer die tabel als een gegenereerde site iets bevat dat nergens op slaat** —
`worker/scripts/toon-voorkeuren.ts`.

**De Shopify-store-aanmaak liep voor het eerst helemaal door.** De selectors waren geschreven
tegen wat het Partner Dashboard geacht werd te tonen en hadden nog nooit gedraaid; de eerste
echte poging strandde op stap één. Zes dingen bleken tegelijk fout — zie de kop van
`worker/src/shopify/store-flow-config.ts` voor de volledige lijst, maar de belangrijkste:
- Het dashboard is verhuisd naar **dev.shopify.com** en de knop heet **"Create store"**.
- Die knop is een `<a>` naar `admin.shopify.com` — een ander origin — dus de job leest de href en
  navigeert. Dat lost meteen een tweede probleem op: **het dashboard-id in die URL's is niet het
  partner-organisatie-id**, en door het van die link te lezen hoeft er geen tweede id
  geconfigureerd te worden dat kan gaan afwijken.
- De formuliervelden zitten in een **shadow root**, dus `document.querySelectorAll` geeft een
  leeg formulier terug. Playwright's locators gaan er wél doorheen.
- **Een Shopify-plan is verplicht**, terwijl de verzendknop actief oogt zonder er een — gevonden
  door te verzenden, niet door de pagina te lezen.
- Succes is een redirect naar `admin.shopify.com/store/<handle>`; het myshopify-domein staat
  nergens op de pagina en wordt uit de handle afgeleid.

Resultaat: acht stappen, allemaal ok, winkel
**`antwerp-fried-chicken-f5364396-ftuyoqau.myshopify.com`** aangemaakt en weggeschreven in
`shopify_stores`. Er staat ook een handmatig aangemaakte `antwerp-fried-chicken-f5364396`
van vlak daarvoor (uit het verkennen van de flow) — die mag weg.

**Nog een statusbug, uit dezelfde familie als die van 26/07.** `generatie` zet de lead bij het
starten op `genereren`, en controleerde aan het eind `lead.status` — maar dat is de waarde van
vóór die update. Een lead die al `klaar` was, matchte dus de "niet terugzetten"-lijst, de update
werd overgeslagen, en de lead bleef eeuwig op `genereren` staan mét een afgewerkte, goedgekeurde
site. De guard onthoudt nu of díe run de status effectief verzet heeft; `verzonden`/`geopend`/
`klant` worden bovendien niet meer naar `genereren` getrokken, wat de oude code wél deed.
`research` heeft de bug niet (zet niets terug aan het eind).

**De mapping site → Shopify is tegen echte output getest**, niet enkel tegen de fixture:
`worker/scripts/proef-shopify-mapping.ts` draait `paginasVoorShopify`/`menuItemsVoorShopify` op
de gegenereerde site en controleert op dode menu-items en weespagina's. Resultaat: 7 pages,
juiste ouder-kindstructuur, home als storefront-root, geen weespagina's.

**Wat er nog van jou nodig is om de winkel effectief te vullen** (één keer, en de code wacht er
al op): er bestaat nog geen app in het Shopify Dev Dashboard. Maak er één aan
(`dev.shopify.com/dashboard/<id>/apps` → Create app), installeer hem op de winkel, en zet
client-id en client-secret in **Voorkeuren → Worker**. Daarna haalt `shopify-token.ts` zelf
tokens op (client credentials grant, 24u geldig) en kan de `shopify_opbouw`-job de pagina's,
het menu en het thema in de winkel zetten. **Ik vul die twee waarden bewust niet zelf in** —
een client-secret aanmaken en wegschrijven is iets wat jij hoort te doen.

De juridische kanttekening van 29/07 blijft staan: geautomatiseerd door het Partner Dashboard
klikken staat vermoedelijk op gespannen voet met de Partner Program Agreement, en het risico is
schorsing van het Partner-account.

## 2026-09-01 — modelkeuze per lead + SEO (branch `feature/multipage-generator`)

**Modelkeuze per lead.** Het model zat vast achter één env-var (`MODEL_KWALITEIT`, fallback
`claude-opus-4-8`), overal gedupliceerd. Nu: nieuwe kolom `leads.ai_model` (migratie
`20260901000000_lead_ai_model.sql`) met drie keuzes — Opus 4.8, Sonnet 5, Fable 5 — en een
`<select>` in het leadpaneel. `NULL` = ongewijzigd gedrag (val terug op de env-var).

- **`resolveModel(aiModel, { maxTier })`** staat in béide `anthropic.ts`-kopieën. De `maxTier`
  bestaat omdat Fable enkel de site zelf mag schrijven: research, review, chat-edit (beide) en
  het uitlezen van een aangeleverde foto worden gecapt op Opus. Kiest een lead Sonnet, dan draait
  álles op Sonnet — het plafond schaalt enkel naar beneden.
- **De prijstabellen moesten mee.** `calculateKostEur()` gooit op een onbekend model, dus zonder
  de rijen voor Sonnet/Fable zou de eerste lead die ze kiest middenin een job crashen. Prijzen
  geverifieerd tegen de officiële modellijst, niet uit het geheugen: Sonnet 5 $2/$10, Fable 5
  $10/$50 per MTok.
- `MODEL_SOURCING` (Haiku, lead-sourcing) is bewust ongemoeid gelaten.

**De hervattingslus van generatie was al stuk, en is vervangen door streaming.** `generate-demo.ts`
hervatte een afgekapte site vanaf een **assistant-prefill**. Prefill is door Anthropic verwijderd en
geeft een 400 op Opus 4.8 — het model dat hier al draaide — én op Sonnet 5 en Fable 5. Een site
boven de 21.000 outputtokens faalde dus, alleen viel dat niet op zolang alles eronder bleef. De
motivering in de code ("niet-streamend vanwege Supabase's invocation-limiet") was bovendien
achterhaald sinds generatie naar de worker verhuisde. Nu: één streamende call,
`MAX_OUTPUT_TOKENS` 21.000 → 64.000, en de hele vervolg-lus plus `knipNaLaatsteVolledigeSectie()`
zijn weg. `stop_reason: "refusal"` en `"max_tokens"` geven nu een expliciete foutmelding.

**SEO.** Gegenereerde sites hadden enkel `<title>`. Toegevoegd, volgens dezelfde scheiding als de
rest van de site-builder — het model schrijft inhoud, de code garandeert vorm:
- **Meta description**: door het model per pagina geschreven (`meta_omschrijving` in `===META===`),
  in code afgekapt op een woordgrens of teruggevallen op titel + bedrijfsnaam. Zacht falen.
- **Canonical + Open Graph**: volledig in code, uit het nieuwe `BouwOpties.seo`-blok. Zonder
  `DEMO_HOSTING_URL` blijven die tags weg in plaats van half ingevuld — een halve URL is erger dan
  geen. `og:image` is het geüploade logo, anders een sector-passende bankfoto.
- **LocalBusiness JSON-LD**, enkel op `index.html`, met een sector→schema.org-typemapping. Het
  adres blijft één tekstveld (het `leads`-schema heeft geen gestructureerd adres), dus geen
  `PostalAddress`.
- **sitemap.xml + robots.txt** worden per request opgebouwd door `track-and-serve`, niet bij het
  genereren in Storage gezet — zo kloppen ze automatisch met wélke versie `actief` is, ook na een
  terugdraai. Beveiligde pagina's blijven uit de sitemap.
- **Alt-tekst is nu een harde build-check**, net als een dode link, want ook onzichtbaar op een
  screenshot. Om het model niet te straffen voor bankfoto's vult `vulAltTeksten()` eerst de
  omschrijving uit de afbeeldingenbank in; enkel écht onbeschreven beeld laat de build falen.

**Bug meegefixt**: `regenerateWithFeedback()` accepteerde `bestanden` maar gaf het niet door aan
`genereerSite()`. Elke hergeneratie in de review-loop verloor dus de bestandslijst — waardoor een
link naar een geüpload document de build kon laten falen (of een logo verdween).

**Geverifieerd**: worker-typecheck + 62 unit-tests (was 51), `deno check` op de vier gewijzigde
Edge Functions, en tsc + eslint op de app. De twee gedupliceerde `site-builder.ts`/`image-bank.ts`
zijn met `Compare-Object` gecontroleerd — ze verschillen enkel in de header en de import-extensie.

**NIET geverifieerd, en dat is belangrijk voor wie hier verder werkt:**
- ~~**De migratie is niet gepusht.**~~ Achterhaald: `leads.ai_model` bestaat wél live
  (nagekeken op 2026-09-02 met een echte select op de kolom). De twee migraties van
  01/09 en 02/09 voor `klanten` stonden op dat moment nog open — zie de sectie hieronder.
- **Geen echte generatie gedraaid.** De SEO-tags, de streamende call en het nieuwe
  `meta_omschrijving`-veld in de prompt zijn niet tegen een levend model getest. De streaming-fix
  is gebaseerd op de officiële API-documentatie, niet op een testcall die de 400 aantoonde.
- **Het leadpaneel is niet aangeklikt** — zelfde reden als bij het Site-interactie-paneel: de
  testbrowser heeft geen sessie. De app boot wel schoon op het loginscherm, zonder console-fouten.

## 2026-09-02 — klantpakketten, verkoop-tracking en hosting op een echt domein

De laatste twee onderdelen van het plan van 01/09. Rode draad: de app legt vast wát er
afgesproken is en wáár de site staat, maar dwingt niets af — dat past bij een app die
enkel intern gebruikt wordt en overal al een mens in de lus heeft.

### Pakket & verkoop (`klanten`)

Vier opties: **aankoop** (eigendomsoverdracht, wij hosten niet) en **bundel 1/2/3** (wij
hosten, oplopend aantal inbegrepen wijzigingen). De aantallen staan in
`app/src/lib/pakketten.ts` als voorlopige waarden en worden bij het promoveren als
startwaarde in `klanten.wijzigingen_inbegrepen` gezet — daarna per klant aanpasbaar, want
een afwijkende afspraak hoort geen code-wijziging te zijn.

- `chat-edit-static`/`chat-edit-shopify` roepen na een geslaagde edit
  `tel_klant_wijziging(lead_id)` aan. Die functie doet niets als de lead nog geen klant is
  of op `aankoop` staat, zodat de gratis demo-iteratieronde niet meetelt.
- **De teller telt, hij blokkeert niet.** Een zesde chat-edit op een bundel van vijf gaat
  gewoon door; het paneel zet het getal in het oranje. Afdwingen zou een aparte, grotere
  beslissing zijn (en een klant die één keer over zijn bundel gaat is een gesprek, geen
  foutmelding).
- "Nieuwe periode starten" zet de teller handmatig op 0. Geen cron: er is geen
  betaalcyclus in dit systeem om op te reageren.

### Hosting op een domein

**Geen aparte `site_domeinen`-tabel, anders dan het plan schetste.** Een klant heeft
precies één definitief domein, `klanten.definitief_domein` bestond al en droeg sinds
01/09 ook `domein_type`. Twee tabellen die allebei "het domein van deze klant" beweren, is
precies hoe ze uit elkaar gaan lopen. Migratie `20260902000000` voegt enkel de
koppelingstoestand toe (`cloudflare_hostname_id`, `domein_status`, `domein_verificatie`,
`domein_gekoppeld_op`) plus een index voor de Host-opzoeking.

- **`track-and-serve` heeft er een tweede ingang bij.** Komt een request niet op onze
  eigen hostnaam binnen, dan wordt de lead opgezocht via `klanten.definitief_domein` en
  staat de site in de root (`/`, `/contact.html`) in plaats van onder `/{leadId}/`. De
  gegenereerde pagina's linken al relatief en de widget-endpoints waren al relatief, dus
  dezelfde bestanden werken in beide vormen zonder aanpassing.
- **De vormbeslissing zit in `_shared/site-domein.ts`, apart en puur**, met 11 tests
  (`cd supabase && deno test functions/_shared/site-domein.test.ts`). Dat is bewust: een
  verkeerd basispad gooit geen exception, het geeft een formulier dat naar niets post.
  Eén van die tests dekt het subtiele geval — **de vaste oorsprong is zélf een eigen
  domein** (het Supabase custom-domain). Zonder die vergelijking met `DEMO_HOSTING_URL`
  zou elke gewone demo-link als klantdomein worden opgezocht en 404'en.
- **`domein_status` is géén voorwaarde om te serveren.** Dat veld toont de voortgang van
  de certificaataanvraag in de app; dat een request überhaupt op dat domein binnenkomt is
  het echte bewijs dat de koppeling werkt. Een status die nog niet gepolld is mag geen 404
  geven op een site die aantoonbaar bereikbaar is.
- **Canonical/og:url/JSON-LD worden bij het serveren herschreven**, niet bij het
  genereren: het domein bestaat meestal nog niet als de site gemaakt wordt, en een
  canonical die naar de functie-URL wijst vertelt Google dat díe URL de echte is — precies
  omgekeerd aan wat een eigen domein moet doen.
- `bouwSitemap`/`bouwRobotsTxt` nemen nu één basis-URL in plaats van leadId + hostingBase,
  om dezelfde reden: op een eigen domein zit er geen lead-id in het pad. Meteen
  meegenomen: de home canonicaliseert naar de map-URL (`…/`) in plaats van
  `…/index.html`, en de sitemap zegt nu hetzelfde — die twee moeten hetzelfde adres
  aanwijzen.
- **`domein-koppelen`** (nieuwe Edge Function) roept Cloudflare's custom-hostnames-API
  aan voor een eigen klantdomein. Een bureau-subdomein raakt Cloudflare niet: dat valt
  onder ons wildcard-record en is meteen actief. Aanmaken zoekt eerst of het hostname al
  bestaat, zodat een tweede klik op "Koppelen" geen tweede aanvraag maakt.

### Site exporteren (aankoop)

"Aankoop" hoort niet bij domein-hosting — daar gaat er juist een rij uit onze routering
weg. In plaats daarvan levert het paneel de actieve versie als zip: alle pagina's, de map
`bestanden/`, en `LEESMIJ.txt`.

- **De zip-schrijver is met de hand geschreven** (`app/src/lib/zip.ts`, "stored", geen
  compressie) omdat de enige gebruiker deze export is en elke dependency ook in de
  Windows-installer belandt. Geverifieerd door een echte zip te maken en die met Windows'
  eigen `Expand-Archive` uit te pakken: vier bestanden, inclusief een submap en een
  bestand van 0 bytes, met kloppende inhoud en CRC.
- **Formulieren, reviews en downloads werken na een export niet meer**, en dat is niet op
  te lossen zonder een volledig portable backend: ze draaien op `track-and-serve` met de
  service-role (honeypot, rate limiting, moderatie). De `data-endpoint`-attributen worden
  daarom verwijderd, zodat de widget zelf "nog niet gekoppeld" toont in plaats van stil te
  falen. Staat ook in LEESMIJ.txt — liever in het pakket dan enkel in een verkoopgesprek.
- **Beveiligde pagina's gaan NIET mee**, zelfde afweging als bij het porten naar Shopify:
  als los bestand zou de toegangscode er gewoon af zijn, en dat is een stillere fout dan
  ze weglaten. LEESMIJ.txt noemt ze bij naam, zodat het een keuze is en geen verrassing.
  **Als je liever hebt dat ze wél meegaan, is dat één regel** in `export-actions.ts`.
- Canonical/OG worden herschreven naar het nieuwe domein als dat al ingevuld is, en anders
  weggelaten — een ontbrekende canonical is neutraal, een foute niet.

### Geverifieerd

- 63 worker-tests (was 62), 38 site-builder-tests, 11 nieuwe deno-tests op de routering.
- `deno check` op `track-and-serve` en `domein-koppelen`; `tsc --noEmit` + eslint schoon op
  de app; `npm run typecheck` schoon op de worker.
- `worker/scripts/toon-lead-model.ts` (nieuw) gedraaid tegen de echte database: toont per
  lead welk model elke stap gebruikt en tast meteen de prijstabel af, zodat een ontbrekende
  rij hier opduikt in plaats van middenin een job.
- De zip, uitgepakt door Windows zelf (zie hierboven).
- **Beide `klanten`-migraties zijn gepusht** (`supabase db push`, 2026-09-02) en daarna
  nagekeken met een echte select op elke nieuwe kolom plus een aanroep van
  `tel_klant_wijziging`.
- **E2E staat op 7 tests, groen tegen het echte project** (`cd app && npm run e2e`). De
  twee nieuwe dekken de modelkeuze en het pakketblok. Dat laatste is meteen het eerste
  paneel van deze reeks dat wél in een draaiende browser is aangeklikt: de test opent het
  blok, leest "Bundel 2" en "2 van 3" af, wijzigt de betaalstatus en controleert dat die
  in de database staat.

### Niet geverifieerd — belangrijk voor wie hier verder werkt

- **De Edge Functions zijn nog niet gedeployed.** `track-and-serve` (gewijzigd) en
  `domein-koppelen` (nieuw) draaien live nog in hun oude vorm. Bewust: in de volgorde
  hieronder komt dat pas na de Cloudflare- en Supabase-domeinstappen, en `domein-koppelen`
  kan zonder die secrets toch niets. Eén commando als het zover is:
  `supabase functions deploy track-and-serve domein-koppelen`.
- **Het domeinblok zelf is niet aangeklikt.** De e2e-test dekt het pakketgedeelte; koppelen
  vraagt een echt domein en een echte Cloudflare-zone.
- **De Cloudflare-aanroepen zijn nooit tegen een echt account gedraaid.** Ze zijn
  geschreven tegen de gedocumenteerde v4-API; er is geen Cloudflare-zone met for-SaaS in
  deze omgeving. Reken op één ronde bijstellen — daarom geeft de functie een foutantwoord
  integraal door in plaats van samengevat.
- **De platformbug van 25/07 is nog steeds niet weerlegd of bevestigd.** Dat een eigen
  domein de `text/plain`+sandbox-CSP van Supabase' edge-gateway omzeilt, blijft een
  hypothese. **Dit is de belangrijkste test van dit hele onderdeel en de goedkoopste:** zet
  eerst één bureau-subdomein op en open het in een echte browser (niet curl — de bug toont
  zich enkel bij een echte GET). Werkt dat niet, kom dan terug vóór je geld uitgeeft aan
  Cloudflare for SaaS.

### Wat jij nog moet regelen (niets hiervan kan ik voor je doen)

Volgorde is belangrijk — stap 5 is een beslismoment dat je geld kan besparen.

1. Cloudflare-account, `yudexstudios.com` als zone toevoegen (nameservers omzetten bij je
   registrar — kijk eerst na welke DNS-records er nu al staan, bv. MX voor e-mail).
2. Supabase custom domain add-on inschakelen op een vast subdomein, bv.
   `sites-oorsprong.yudexstudios.com`, en `DEMO_HOSTING_URL` +
   `NEXT_PUBLIC_DEMO_HOSTING_URL` daarnaar laten wijzen.
3. Wildcard-DNS `*.yudexstudios.com` (proxied) naar dat adres.
4. De functies deployen: `supabase functions deploy track-and-serve domein-koppelen`.
   (De migraties staan er al op sinds 02/09.)
5. **Eerste test**: één testlead met een bureau-subdomein, openen in een echte browser.
   Rendert de pagina normaal? Dan is de platformbug inderdaad weg.
6. Werkt stap 5 niet, stop hier en kom terug. Werkt het wel: Cloudflare for SaaS
   inschakelen (controleer zelf de actuele prijs en of het op jullie plan zit — dat kon ik
   niet live nakijken), een API-token maken met rechten op enkel die zone, en zetten:
   ```
   supabase secrets set CLOUDFLARE_API_TOKEN=... CLOUDFLARE_ZONE_ID=... CLOUDFLARE_CNAME_DOEL=... --project-ref <ref>
   ```
7. Vul de echte aantallen wijzigingen per bundel in `app/src/lib/pakketten.ts` in.

## 2026-09-02 — UX-audit van het dashboard + wat gegenereerde sites misten

Twee losse sporen uit één doorlichting: het dashboard was niet zelfverklarend (Warre moest
mondeling uitleggen hoe het werkt aan Garen), en elke gegenereerde site miste een paar
structurele onderdelen.

### Dashboard (was al gedaan in de werkboom bij aanvang van deze sessie)

- **Spec-paragraafnummers stonden in gebruikersgerichte tekst** — 15 plekken, van
  `title="Sourcing-configuratie (spec 3.1a)"` tot `"Versiegeschiedenis (3.5/3.8)"`. Allemaal
  vervangen door gewone taal. Let op bij een volgende ronde: grep op `\(\d\.\d`, niet op het
  woord "spec" — `"Open vragen (research, 3.2)"` bevatte dat woord niet. Interne
  code-commentaren met spec-verwijzingen zijn bewust blijven staan; die leggen uit *waarom* de
  code is zoals ze is en komen nergens in de UI.
- **`lead-detail-panel.tsx` is geherstructureerd** van een platte stapel van 14 secties naar:
  status → pipeline-knop → demo-preview → versiegeschiedenis bovenaan (waarvoor je het paneel
  opent), dan notities/openstaande vragen, dan één blok **"Klant & account"** (convert, pakket
  & domein, Shopify-winkel, site-interactie, kosten) en tot slot een dichtgeklapt
  **"Instellingen"** (bedrijfsgegevens, AI-model). `KlantPanel` en `SiteInteractiePanel`
  houden hun eigen uitklap: hun label draagt een telling of statuskleur die je juist zonder
  uitklappen wil zien.
- **Lege staten leggen nu uit wat je kan doen** (leadlijst: handmatig toevoegen vs. automatisch
  zoeken, plus dat de worker moet draaien; klantenlijst: dat een klant uit een lead ontstaat).
  De e2e-test klapt "Instellingen" nu open voor ze de modelkeuze leest.

### Privacybeleid, cookiemelding en bezoekerscijfers (nieuw deze sessie)

Elke gegenereerde site heeft een contactformulier dat persoonsgegevens opslaat, en had geen
enkele privacyverklaring. Dat is nu gedicht, volgens dezelfde scheiding als de rest van de
site-builder: **het model schrijft inhoud, de code garandeert wat er moet staan.**

- **De privacypagina wordt door de code geschreven**, net als canonical/OG/JSON-LD — niet door
  het model. Ze somt op wat de site feitelijk doet, en dat weet de code exact: er staat enkel
  een alinea over formulieren als er écht een `data-widget="formulier"` op de site staat, enkel
  over reviews als die er zijn, enkel over een toegangscode bij een beveiligde pagina, en enkel
  over statistieken als die aan staan. Een model dat een bewaartermijn verzint of een formulier
  vergeet, levert een tekst op die er juridisch uitziet en niet klopt.
- **Ze staat bewust níet in `bron.paginas`.** Daardoor komt ze nooit in `bron.json` en dus ook
  niet in de virtuele bestandenlijst die chat-edit aan het model toont: ze kan niet weggevraagd
  worden. Dat is een sterkere garantie dan een uitzonderingslijst in `chat-edit-static`, en het
  is minder code — die functie hoefde er niet voor aangepast te worden.
- Gevolg voor `track-and-serve`: `site_versions.paginas` blijft de lijst van het model, dus de
  privacypagina staat er niet in en zou 404'en. Eén uitzondering op de paginacontrole vangt dat
  op, op één vaste in code vastgelegde bestandsnaam — geen patroon, niets uit het verzoek, dus
  de "geen willekeurig pad naar Storage"-eigenschap blijft gelden. Ze staat om dezelfde reden
  niet in de sitemap, en draagt `noindex`.
- De link staat **binnen** `</footer>`, niet erachter geplakt. Dat verschil is onzichtbaar op
  een screenshot (het staat onderaan) maar het is dan geen footerinhoud — precies het soort
  fout dat de review-loop nooit kan zien. Er is een test die erop staat.
- **De cookiemelding is deel van de geïnjecteerde runtime**, geen `data-widget` dat het model
  plaatst. Een blok dat het model één keer vergeet, is bij een quiz een gemiste kans en hier
  een pagina die meet zonder te vragen. Ze wordt vlak vóór `</body>` toegevoegd, ná alle
  controles op de output van het model — dezelfde volgorde als `WIDGET_RUNTIME`.
- **Ze verschijnt enkel als er iets te vragen valt**, d.w.z. als `ANALYTICS_SCRIPT_URL` gezet
  is. Een balk die toestemming vraagt voor niets is ruis; het contactformulier heeft een
  privacyverklaring nodig (die er nu altijd is), geen cookiemelding — het zet niets op het
  toestel van de bezoeker.
- **Het meetscript staat niet in de HTML.** Het wordt door JavaScript ingeladen ná
  "Accepteren". Een `<script src>` dat al in de pagina staat, is opgehaald voor de bezoeker
  iets kon kiezen, en dan is de keuze decoratie. `data-domain` wordt afgeleid uit
  `location.hostname`, zodat dezelfde bestanden kloppen op de demo-URL, op een eigen domein en
  in een geëxporteerde zip — zonder kolom per lead en zonder hergeneratie als het domein later
  verandert.
- `chat-edit-static` krijgt dezelfde instelling mee, anders haalt de eerste chat-bewerking de
  melding van elke pagina af. **Zet `ANALYTICS_SCRIPT_URL` dus op beide plekken** (`worker/.env`
  én `supabase secrets set`).

**Geverifieerd in een echte browser** (`cd worker && UIT=widgetdemo ANALYTICS_SCRIPT_URL=... npx
tsx scripts/demo-widgets.ts`, dan `preview_start` op de launch-config `sitedemo`): zonder keuze
staat de balk er en is er nul plausible-script; "Weigeren" bewaart de keuze en laadt niets;
"Accepteren" injecteert het script met `data-domain=localhost`; de knop "Cookiekeuze wijzigen"
op de privacypagina opent de balk opnieuw. In een `data:`-context waar localStorage gooit, blijft
de pagina werken en verschijnt de balk gewoon — dat pad is dus ook echt geraakt.

**Wat een mens nog moet doen:** een Plausible-/Fathom-account kiezen en betalen, per klant hun
domein daar registreren, en de juridische tekst laten nakijken. De tekst in
`bouwPrivacyBody()` beschrijft correct wat deze sites doen, maar of dat volstaat voor een
specifieke klant (denk aan een medische praktijk) is geen technische vraag.

### Beeldbank uitgebreid van 6 naar 12 sectoren

Bakker en slager waren als kernsectoren genoemd en hadden **nul** foto's — die sites kwamen dus
altijd op kleurvlakken uit. Toegevoegd: bakker, slager, apotheek, dierenarts, fietsenmaker,
schoonheidssalon (17 foto's erbij, 12 → 29).

Elke URL is volgens het protocol bovenaan `image-bank.ts` één voor één in een browser geopend en
bekeken. Eén kandidaat is daarbij afgewezen: "A white mountain bike is hanging"
(`photo-1765376260870`) bleek een donker beeld met "verhuur" in de tekst — verkeerd voor een
herstelzaak. Fietsenmaker heeft daarom 2 foto's en niet 3.

**`vlees` is bewust géén trefwoord bij de slager.** Een frituur- of restaurantbriefing noemt dat
woord ook, en die zou dan een koeltoonbank met rauw vlees op de site krijgen — exact de
MIKI TEA-fout. Nagekeken: `"frituur met vlees en snacks"` levert nu geen slagersfoto's op.

### De SEO-tags die na elke chat-bewerking verdwenen (gefixt)

`chat-edit-static` roept `bouwSite()` opnieuw aan om de site na een bewerking samen te stellen,
maar gaf het `seo`-blok niet mee. Gevolg: **canonical, Open Graph en de LocalBusiness-JSON-LD
verdwenen van élke pagina zodra er één keer via de chat iets gewijzigd was.** Dateert van de
SEO-toevoeging van 01/09.

Waarom dit maanden onopgemerkt bleef, is het interessante deel: `bouwSite()` laat die tags
zonder dat blok gewoon wég — geen exception, geen waarschuwing — en een screenshot van de
pagina ziet er exact hetzelfde uit. De review-loop kan het per definitie niet zien. Dit is
dezelfde familie als de privacylink die buiten `</footer>` belandde: fouten die enkel in de
markup bestaan.

- De opbouw staat nu in **`_shared/site-seo.ts`**, puur en apart, in plaats van als een paar
  regels in de aanroeper. Dat is bewust: bij een stille fout is een test het enige dat je
  beschermt, en een functie die `Deno.env` leest is niet te testen. De basis-URL komt er dus
  als parameter in; de aanroeper leest `DEMO_HOSTING_URL`.
- **7 nieuwe deno-tests**, waarvan twee expliciet het verschil vastleggen: mét het blok staan
  canonical/og:url/JSON-LD op de pagina, zónder verdwijnen ze (en blijft enkel de gewone
  description over). Die tweede test beschrijft letterlijk de bug, zodat hij niet opnieuw
  wegglipt.
- Drie van mijn eigen testaannames bleken fout en zijn rechtgezet tegen wat de code écht doet:
  `JSON.stringify` zet geen spatie na de dubbele punt (`"@type":"Florist"`), `boekhouder van
  ruimtevaartuigen` matcht wél de beeldbank (op `boekhoud`), en de logo-regel is `/^logo\./i` —
  **`logo definitief.png` telt dus niet als logo**, enkel `logo.<ext>`. Dat laatste staat nu in
  een test, want het is precies het soort detail dat je anders elke keer opnieuw uitzoekt.
- De regels zijn een kopie van `bouwSeoGegevens()` in `worker/src/pipeline/generate-demo.ts`
  (Node) — dezelfde Deno/Node-splitsing als bij de andere gedupliceerde bestanden. Houd ze gelijk.
- **Bewust niet meegenomen:** `bestanden` wordt nog steeds níet aan `bouwSite()` doorgegeven in
  chat-edit. Die optie zet de controle op dode downloadlinks aan, en die nu pas inschakelen zou
  élke bewerking blokkeren op een site die al een link naar een verwijderd bestand bevat. Dat is
  een aparte afweging dan deze bugfix; de bestandslijst wordt enkel gelezen om het logo te vinden.

### Gestileerde 404 in plaats van platte tekst

`track-and-serve` gaf `"Pagina niet gevonden."` als kale tekst — een doodlopend spoor op de site
van een klant, net wanneer iemand een oude link uit een mail volgt.

- De huisstijl staat nergens in de database (kleuren en lettertypes zitten enkel als markup in
  de opgeslagen bestanden), dus haalt de 404 `bron.json` op en hergebruikt head/nav/footer van
  die site. Dat is een extra Storage-lezing, maar enkel op het 404-pad.
- Lukt dat niet (een oude één-bestand-versie heeft geen `bron.json`), dan volgt een sobere maar
  verzorgde pagina — bewust niet terug naar platte tekst.
- Een halve schil telt niet als schil: enkel een nav zonder footer ziet er afgebroken uit en
  leest als een storing in plaats van als een verkeerd adres.
- `sitemap.xml` en `robots.txt` houden hun platte-tekst-404: een crawler heeft niets aan een
  HTML-pagina.
- `_shared/site-404.ts` is puur en apart, met 7 deno-tests.

### Geverifieerd

- 69 worker-tests (was 63; 44 site-builder, 18 widgets, 7 shopify-mapping), `npm run typecheck`
  schoon.
- 25 deno-tests in `_shared` (14 nieuw: 7 voor de 404, 7 voor het seo-blok), `deno check`
  schoon op `track-and-serve`, `chat-edit-static`, `site-builder`, `site-widgets`, `site-404`,
  `site-seo`.
- De vier gedupliceerde bestandsparen (`site-builder`, `site-widgets`, `image-bank`) zijn na
  afloop met `diff` gecontroleerd: ze verschillen enkel in de header en de import-extensie.

### Niet geverifieerd

- ~~**De Edge Functions zijn niet gedeployed.**~~ Beide staan sinds 02/09 live; zie de
  deploy-sectie verderop, inclusief de routeringsbug die daarbij bovenkwam.
- **Geen echte generatie gedraaid.** De privacypagina en de cookiemelding zijn tegen de builder
  en in een browser getest, niet tegen een levend model op een echte lead.
- ~~**Er bestaat nog een aparte, oudere bug in `chat-edit-static`**~~ — gefixt, zie hieronder.
- `SECTOR_STYLES` in `generate-demo.ts` kent de vier nieuwe sectoren niet (apotheek,
  dierenarts, fietsenmaker, schoonheidssalon) en valt voor hen terug op de ambachtsstijl.
  Bewust niet aangeraakt; het is één regel per sector als je andere kleuren wil.

## 2026-09-02 — tweede UX-ronde uit echt gebruik (leadpaneel, chat, popup, instellingen)

Gemeld tijdens gebruik, in één lijst. Wat het bleek te zijn:

### De grote chatbox "werkte niet" — en dat was een echte crash

`useLeadChat` maakte een Realtime-kanaal met de naam `chat-{leadId}`. supabase-js geeft voor
dezelfde topic hetzelfde kanaalobject terug, dus zodra het strookje in het paneel én de grote
chatbox tegelijk openstonden — allebei dezelfde lead — gooide de tweede `.on(...)` de fout
`cannot add postgres_changes callbacks ... after subscribe()`. Die uitzondering nam de hele
pagina mee: je kreeg een lege foutpagina met "Reload". **De kanaalnaam draagt nu een `useId()`
per hook-instantie.** Dit had niets met "geen klant" te maken; het gebeurde altijd zodra beide
weergaven openstonden.

Gevonden door het in een echte browser aan te klikken, niet door te lezen — typecheck en lint
zagen er niets van.

### De popup is vervangen door een overlay

"Bekijk" in de versiegeschiedenis opende een echt venster met `window.open`. Dat wordt
geblokkeerd door de popup-blocker van een gewone browser én door de WebView van de verpakte
Windows-app, en dan kreeg je enkel "kon geen popup-venster openen" — precies wanneer je de site
aan een klant wil tonen. Nu: `leads/site-preview-venster.tsx`, een overlay in de app zelf, met
paginakiezer en desktop/tablet/mobiel. Niet blokkeerbaar, en overal hetzelfde.
Ook bereikbaar vanuit de demo-preview via **Volledig scherm**.

De opzet van de oude popup (synchroon openen binnen het klik-event) was correct; het probleem
was de aanpak zelf, niet de uitvoering.

### Eén chatvenster dat als een chat werkt

- **Bericht-bellen** zoals je verwacht: jij rechts, de AI links, systeemregels als rustige
  notitie in het midden. Invoerveld is een `textarea` die meegroeit; Enter verstuurt,
  Shift+Enter maakt een regel.
- **Eén invoerveld, twee manieren.** Er stonden twee knoppen ("Verstuur" en "of: hele site
  opnieuw genereren met deze instructie"), wat vooral de vraag opriep in welk vakje een
  instructie hoort. Nu kies je vooraf **Gericht aanpassen** of **Hele site hergenereren**, met
  de uitleg ernaast, en doet de knop wat er op staat. De losse hergenereer-knop onder het
  strookje in het paneel is weg.
- **Modelkeuze zit in de chat** (Opus/Sonnet/Fable), niet enkel weggestopt bij Instellingen.
- **Bewaar als versie** en **Zet live** staan in de kop. Dat laatste is wat "wijzigingen
  doorvoeren naar het domein" doet: `track-and-serve` serveert de `actief` versie, dus
  activeren ís publiceren.
- **Bestanden**: paperclip + slepen, `accept="image/*,.pdf,.txt,.md,.csv"` en `multiple`, en het
  veld wordt na elke keuze leeggemaakt zodat hetzelfde bestand opnieuw gekozen kan worden.
- **De chat werkt nu ook zonder site-versie.** Hij hing onder de demo-preview, en die verschijnt
  pas als er een site is — bij een verse lead was er dus geen chat terwijl het paneel wel die
  indruk gaf. Er staat nu een knop in het paneel zelf; zonder versie wordt je bericht de
  briefing voor de eerste generatie, staat "Gericht aanpassen" uit, en zegt de kop dat ook.

### Het profielmenu liep dood, en werd afgeknipt

Klikken op je naam gaf een kaartje met je eigen naam erin en verder niets. Nu een echt menu met
**Instellingen** en **Voorkeuren** (met een regel uitleg elk), Profiel bewerken en Uitloggen,
dat sluit bij Escape en bij klikken erbuiten.

Het werd bovendien **afgeknipt getoond** — dat is het stuk uit de screenshot. De oorzaak stond
niet in de component maar in de layout: de balk bovenaan is `static`, en de inhoudskaart
eronder maakt door `backdrop-blur` een eigen stapelcontext en tekende eroverheen. Je zag enkel
het bovenste streepje. `relative z-30` op die `<header>` lost het op.

### Minder tekst in het leadpaneel

- Het regeltje "home — klik in de navigatie om te bladeren" naast Demo-preview is weg.
- **Publieke link** en **Review-log** staan achter een knop in plaats van altijd uitgeklapt.
- **Notities/briefing** (3835 tekens bij Tuinbouw Hendrix) en **Openstaande vragen** staan achter
  een knop. Notities klapt vanzelf open zolang het veld leeg is: dan is het geen lap tekst maar
  precies het veld dat je moet invullen.

### Eén instellingenscherm voor alle sleutels

Nieuw: `/instellingen`, plus de tabel `app_instellingen` (migratie `20260902010000`, **gepusht**).
Alle sleutels die tot nu in `app/.env.local`, `worker/.env` en de Supabase-secrets verspreid
stonden, staan er nu bij elkaar met uitleg, waar je ze vandaan haalt, en wat er niet werkt zolang
ze leeg zijn. Geheimen worden afgeschermd getoond.

- **De worker leest ze bij het opstarten** (`worker/src/shared/instellingen.ts`) en zet ze in
  `process.env` vóór `controleerOmgeving()`. Wat in het scherm staat wint van wat in de omgeving
  staat — je hebt het daar net ingevuld en je ziet het daar staan.
- **SUPABASE_URL en SUPABASE_SERVICE_ROLE_KEY staan er bewust niet in.** De worker heeft die twee
  nodig om deze tabel te kúnnen lezen; ze hier zetten zou betekenen dat hij ze moet ophalen uit
  de plek die hij zonder die waarden niet bereikt. Het scherm zegt dat, en verwijst naar het
  bestaande Worker-blok.
- Een lege waarde verwijdert de rij: "niet ingesteld" en "ingesteld op niets" moeten voor de
  worker hetzelfde betekenen.
- Ontbreekt de tabel (migratie niet gedraaid), dan waarschuwt de worker en draait hij verder op
  de omgeving — zoals vóór dit scherm bestond.

### Geverifieerd in een draaiende browser

Ingelogd via dezelfde magic-link-truc als `app/e2e/global-setup.ts`:
- Instellingen: opslaan → uitlezen → wissen, echt tegen de live database (daarna weer leeg —
  de testwaarde voor `DEMO_HOSTING_URL` is verwijderd, want dat subdomein bestaat nog niet en
  zou de worker een fout adres geven).
- Volledig scherm: alle 6 pagina's van Tuinbouw Hendrix, paginakiezer werkt.
- Chat: opent zonder crash, modelkeuze Opus/Sonnet/Fable, bestandsknop met de juiste `accept`.
- Chat zonder versie: getest op een tijdelijke lead (daarna verwijderd) — knop, kop en
  uitgeschakelde "Gericht aanpassen" kloppen.
- Profielmenu: opent volledig over de inhoud, en navigeert echt naar `/instellingen`.
- **7 e2e-tests groen** (`npx playwright test`), app `tsc` + `eslint` schoon, worker typecheck +
  69 tests, 25 deno-tests.

**Let op bij het draaien van de e2e-suite**: `reuseExistingServer: true` betekent dat een dev
server die je zelf al hebt draaien meegebruikt wordt. Draait daar tegelijk een browser in die
tegen dezelfde leads werkt, dan falen tests willekeurig op timeouts. Stop je eigen server eerst.

### Het klantenscherm gebruikt nu dezelfde chat als het leadpaneel

Gemeld: "het hoofdwerkveld is de grote chatbox bij klanten, maar daar is veel minder terug te
vinden dan bij het leadpaneel." Klopte, en het was erger dan alleen minder knoppen — het was een
tweede, aparte implementatie:

- De "chat" toonde rijen uit **`review_log`**, niet het echte gesprek uit `chat_berichten`. Wat
  je bij een lead in de chat typte, zag je hier dus niet, en omgekeerd.
- Geen bestanden, geen modelkeuze, geen "bewaar als versie", geen "zet live".
- De preview was één `<iframe srcDoc>` met alleen de homepagina: geen paginakeuze, geen
  mobiel/desktop, geen volledig scherm — en interne links deden niets.
- Ernaast stond wéér een apart blok "Site herwerken met extra informatie", precies de dubbeling
  die bij de leads al was opgeruimd.

Nu is het aan beide kanten dezelfde `ChatVenster`, met drie nieuwe eigenschappen zodat één
component beide plekken bedient:

- **`ingebed`** — dezelfde chat als paneel in een pagina in plaats van als schermvullende laag.
  In die smalle kolom staat het tekstveld op een eigen regel met de knoppen eronder; op volle
  breedte blijft alles op één regel. De uitleg bij "gericht aanpassen / hergenereren" wordt daar
  een tooltip in plaats van drie regels tekst.
- **`readOnly` + `readOnlyReden`** — de bewerk-vergrendeling van het klantenscherm blijft
  bestaan: is de ander aan het bewerken, dan kan je meekijken maar niet typen. Die vergrendeling
  was het enige dat dit scherm béter deed dan het leadpaneel, en is behouden.
- **`magHergenereren`** — uit voor Shopify-klanten: die sites worden door Shopify gerenderd, niet
  door onze generator, dus "hele site hergenereren" bestaat daar niet.

De backendkeuze blijft waar ze hoorde: `useLeadChat` accepteert nu een eigen `patch`-functie, en
het klantenscherm geeft er één mee die via `startKlantChatEdit` op `klant_type` kiest tussen
`chat-edit-static` en `chat-edit-shopify`. Eén chat-interface, één plek waar de backend gekozen
wordt — en niet twee schermen die uit elkaar groeien.

De preview links is nu de echte site-preview: paginakiezer, desktop/mobiel, volledig scherm, en
interne links die werken (via hetzelfde postMessage-pad als bij de leads).

**Geverifieerd in de browser** op klant Florian: site rendert, paginakiezer en viewports werken,
en rechts staan modelkeuze, "Bewaar als versie", "Zet live", de manier-keuze en de paperclip,
met de badge "Jij bewerkt nu".

### De demo-link wordt nu getoond, en de platformbug van 25/07 is gemeten

De app kende de publieke link niet: `NEXT_PUBLIC_DEMO_HOSTING_URL` staat niet in
`app/.env.local` (ondanks wat hierboven ooit genoteerd is), en op drie plaatsen werd die
variabele rechtstreeks gelezen. Gevolg: de knop "Publieke link" verscheen niet en de
publiceer-dialoog meldde dat er geen basis-URL was — terwijl de functie-URL gewoon werkt.

`app/src/lib/demo-link.ts` leidt hem nu af uit `NEXT_PUBLIC_SUPABASE_URL`:
`{supabase-url}/functions/v1/track-and-serve/{leadId}/`. Staat de expliciete variabele wél
gezet (straks, bij een eigen domein), dan wint die. Nagekeken in de app: bij Bloemen Gielen
toont hij nu `https://uewbogxrdijartyuzfvw.supabase.co/functions/v1/track-and-serve/835c5c84-.../`,
en die URL geeft 200 met de echte site.

**De platformbug van 2026-07-25 is nu gemeten in plaats van vermoed.** Op `*.supabase.co`
herschrijft de edge-gateway **élk** antwoord dat niet al `text/plain` is:

| pad | wat wij sturen | wat er aankomt |
|---|---|---|
| `/{leadId}/` | `text/html; charset=utf-8` | `text/plain` |
| `/{leadId}/index.html` | `text/html; charset=utf-8` | `text/plain` |
| `/{leadId}/sitemap.xml` | `application/xml` | `text/plain` |
| `/{leadId}/robots.txt` | `text/plain; charset=utf-8` | ongewijzigd |

Er komen ook `Content-Security-Policy: default-src 'none'; sandbox` en
`X-Content-Type-Options: nosniff` bij. Dat XML óók wordt herschreven is het nieuwe gegeven: het
is geen HTML-specifieke regel maar "alles behalve platte tekst", dus **er bestaat geen
header-truc die dit omzeilt**. Een browser toont daar de broncode, wat er ook geprobeerd wordt.

Wat wél werkt op dat adres: alles wat de HTML programmatisch ophaalt — de preview in de app, de
screenshots van de review-loop, de widget-endpoints. Enkel een mens met een browser niet.

De publiceer-dialoog zegt dat nu ter plekke, met de verwijzing naar "Volledig scherm" om de site
tóch te tonen. `linkRendertInBrowser()` bepaalt dat op de hostnaam, dus die waarschuwing
verdwijnt vanzelf zodra de hosting op een eigen domein staat.

**Voor wie dit oplost:** de enige uitweg blijft stap 2 uit de lijst hieronder — de Supabase
custom-domain add-on op een vast subdomein, met `DEMO_HOSTING_URL` en
`NEXT_PUBLIC_DEMO_HOSTING_URL` daarnaartoe. Of dat de herschrijving wegneemt is nog steeds
onbewezen; het is wel de goedkoopste test en het blijft de eerste die je moet doen.

### De worker serveert de site nu zelf, zodat ze in een browser te tonen is

Het probleem hierboven is niet op te lossen op `*.supabase.co`: die gateway herschrijft élk
antwoord dat niet al `text/plain` is, dus een browser toont daar broncode. Er is geen
content-type dat eraan ontsnapt.

Dus doet de worker het zelf. `worker/src/hosting/lokale-server.ts` start mee met de worker op
poort **4321** (`LOKALE_HOSTING_POORT` om te wijzigen) en serveert
`http://localhost:4321/{leadId}/` — dezelfde bestanden uit Storage, zonder gateway ertussen, met
de juiste Content-Type.

- **Actieve versie eerst, anders de nieuwste.** Zo is een concept ook te bekijken vóór het live
  staat, wat precies is wat je tijdens het werken wil.
- **Formulieren en reviews worden doorgestuurd** naar de echte `track-and-serve`. Die kent de
  honeypot, de rate limiting en de moderatie; dat hier half overdoen zou twee versies van
  dezelfde regels opleveren. Een demo waarin iemand het contactformulier invult, loopt dus niet
  halverwege stuk.
- **Geüploade bestanden hebben een eigen route** (`/{leadId}/bestanden/{naam}`). Die staan
  niet in de map van de versie maar op hun eigen pad in `site_bestanden`, en dat had ik eerst
  niet overgenomen: een logo bleef leeg terwijl het in de app wél verscheen — want de app
  vervangt afbeeldingen door data-URI's voor de srcdoc-preview, en verbergt dat verschil dus.
  Afbeeldingen inline, de rest als download, SVG bewust ook als download (kan script bevatten).
- **Bewust geen tweede track-and-serve**: geen toegangscodes, geen sitemap, geen
  domeinroutering. Dit is een kijkvenster op de bestanden, geen hostinglaag.
- Losstaand te starten met `cd worker && npx tsx --env-file=.env scripts/toon-site.ts`, handig om
  iets te tonen zonder de jobs-lus.

De app toont de link op twee plekken: bij **Publieke link** in het leadpaneel (naast de
functie-URL, met het verschil erbij uitgelegd) en in de **publiceer-dialoog**, waar de
waarschuwing over `*.supabase.co` nu een werkende link meekrijgt in plaats van alleen te zeggen
wat niet kan.

**Geverifieerd in een echte browser**: Florian (het geüploade logo laadt, nul gebroken
afbeeldingen; de PDF-menukaart komt als download binnen), Bloemen Gielen (`Content-Type: text/html`, geen
sandbox-CSP, site rendert volledig met beelden en lettertypes) en Tuinbouw Hendrix — dat is een
meerpagina-site, en daar werkt het klikken tussen pagina's, met de juiste actieve markering in de
nav.

**Beperkingen, expliciet**: alleen op deze machine, en alleen zolang de worker draait. Het is
geen vervanging voor de hosting — de custom-domain-stap blijft wat je nodig hebt om een klant een
link te sturen. Dit is om het te kúnnen tonen.

### Publiceren, offline halen, contactmeldingen en bronnen (2026-09-02, latere ronde)

Zes punten uit gebruik, met wat ze bleken te vragen:

**"Zet live" vroeg nooit wáárheen.** De knop activeerde de versie meteen. Live op de demo-link of
op het eigen domein van de klant is een wezenlijk verschil, en dat stond nergens op het moment
dat je erop drukte. Er is nu een dialoog (`leads/publiceer-dialoog.tsx`) die eerst toont waar het
naartoe gaat — demo-link, bureau-subdomein of eigen domein, opgezocht in `klanten` — en pas dan
publiceert. Staat er nog geen domein, dan zegt ze dat en wijst ze naar Pakket & domein.

**Offline halen kan.** `deactivateVersion()` zet de actieve versie terug op `afgerond`. Bewust
géén nieuwe status: `track-and-serve` serveert alleen wat op `actief` staat, dus "geen actieve
versie" ís al offline. Een derde status zou hetzelfde betekenen op twee plekken. De versie blijft
staan, dus terugzetten is één klik.

**Welke versie live staat, is nu zichtbaar** in de kop van de chat: groen "Dit is wat bezoekers
zien" als je naar de actieve versie kijkt, en anders "Live staat versie N — je kijkt naar een
andere versie". Daarvóór kon je een concept bewerken in de overtuiging dat het de live site was.

**Inzendingen worden gemaild.** Dit was een echt gat: een contact- of reservatieformulier belandde
alléén in `site_inzendingen`, en of iemand dat zag hing ervan af of hij toevallig in het dashboard
keek. Voor een reservatie is dat geen systeem maar een archief. Nieuw:
- kolom `leads.meldingen_email` (migratie `20260902020000`, gepusht),
- `track-and-serve` mailt elke inzending naar dat adres via de bestaande Gmail-koppeling,
- `sendGmail` kreeg `replyTo`, gezet op de bezoeker — anders moet de klant elk antwoord met de
  hand naar het juiste adres overtypen,
- het mailen gebeurt ná het bewaren en in een try/catch: een kapotte mailkoppeling mag een
  bezoeker geen foutmelding geven voor iets wat aan onze kant misloopt. De rij in
  `site_inzendingen` blijft het echte archief.
- Leeg adres = alleen bewaren, precies het gedrag van hiervoor.

**Eén scherm voor contactgegevens** (`leads/site-contact-panel.tsx`), in zowel het leadpaneel als
het klantenscherm: het meldingsadres hierboven en het telefoonnummer dat op de site komt. Het
label draagt een waarschuwing zolang er geen adres staat, want dan verdwijnen reservaties stil in
de database.

**"Bronnen in deze chat"** (`leads/bronnen-paneel.tsx`), naar het voorbeeld van Claude: een
zijpaneel vanuit de chat met alle bestanden die aan deze lead hangen — naam, soort, grootte, wie
het toevoegde, en de uitgelezen tekst uitklapbaar. Die lijst zat verstopt in een uitklapblok
onderaan het leadpaneel, ver van de chat waarin je het bestand net had gesleept, terwijl "heeft
hij het logo nu wél?" precies de vraag is die je tijdens het werken hebt.

**De begeleidende tekst in de chat is ingekort** van drie alinea's naar één regel.

### Geverifieerd

In de browser op klant Florian: publiceer-dialoog (toont correct "Geen publieke basis-URL
ingesteld", want `DEMO_HOSTING_URL` staat er nog niet), bronnenpaneel met het echte bestand van
die lead, contactscherm met beide velden, de groene live-indicatie en de kortere tekst.

Live tegen de gedeployde functie: de site van Bloemen Gielen geeft nog steeds 200, en een
inzending zonder ingesteld meldingsadres wordt gewoon aanvaard (`{"ok":true}`) — geen regressie.
De testinzending is daarna weer verwijderd.

**Niet getest**: het daadwerkelijk versturen van zo'n mail. Dat vraagt een lead met een ingevuld
`meldingen_email` én een werkende Gmail-koppeling; die koppeling bestaat nog niet
(`NEXT_PUBLIC_GOOGLE_OAUTH_CLIENT_ID` is leeg). De code volgt hetzelfde pad als `notifyOpened`,
dat al langer bestaat, maar dat pad is zelf ook nooit live gedraaid.

Ook niet aangeklikt: "Offline halen" — dat zou de site van een echte klant offline hebben gehaald.

### De e2e-suite wordt flaky als je hem kort na elkaar draait

Belangrijk om te weten voor wie hem draait, want het kost anders een halfuur zoeken naar een bug
die er niet is.

Losse tests en paren slagen altijd in enkele seconden. Draai je de volledige suite meerdere keren
kort na elkaar, dan beginnen de **laatste** tests te falen op "row not found" na 30 seconden — en
wélke tests dat zijn, verschilt per run. De suite maakt per test een lead aan via de service-role
en logt bij elke run opnieuw in met een verse magic link; na een stuk of vijf runs binnen het
halfuur haalt een pas ingevoegde lead de lijst niet meer.

Wat het niet is: de UI (elke falende test slaagt los), en niet de opgeruimde testdata
(gecontroleerd: nul achtergebleven `E2E-test `-leads, 8 leads in totaal).

Praktisch: draai de suite één keer, en stop je eigen dev-server eerst — `reuseExistingServer:
true` betekent dat een server waar jij zelf in zit meegebruikt wordt, en een openstaand
dashboard houdt via Realtime verbindingen open waardoor `global-setup`'s
`waitForLoadState("networkidle")` afloopt in een timeout.

### Deploy van 2026-09-02, en de routeringsbug die daarbij bovenkwam

`track-and-serve` en `chat-edit-static` staan **live** (`supabase functions deploy` vanuit de
repo-root). Twee dingen om te onthouden:

**Draai het commando vanuit de repo-root, niet vanuit `app/`.** Er is nergens een
`supabase/config.toml`, dus de CLI kan de projectmap niet zelf vinden. Vanuit `app/` maakt hij
een lege `app/supabase/.temp/` aan en zoekt hij de functie op `app/supabase/functions/...` —
wat een 400 geeft met "Entrypoint path does not exist". Vanuit de root klopt alles.

**De domeinroutering was stuk, en dat bleek pas live.** De deploy activeerde de
domein-ondersteuning van eerder op 02/09, die nooit gedeployed was. `bepaalRouteVorm` besliste
enkel op de **Host-header** of een request via de functie-URL of via een klantdomein binnenkwam.
Een Edge Function ziet die header niet noodzakelijk als de hostnaam waarop de bezoeker de site
opvroeg — gevolg: élke demo-link viel door naar de klantdomein-opzoeking, vond niets, en gaf 404.
Alle demo-links waren daardoor enkele minuten stuk.

Opgelost door eerst naar het pad te kijken: **een lead-id (UUID) vooraan in het pad betekent
functie-URL**, ongeacht wat de Host-header zegt. Pas als dat er niet staat, wordt de host
gebruikt om een klantdomein op te zoeken. Twee tests in `site-domein.test.ts` leggen precies dit
vast (13 tests daar nu, 27 in `_shared` in totaal).

Waarom de bestaande tests dit niet vingen: die gaven zelf een host mee die ze verzonnen hadden
(`abcdef.supabase.co`), en die klopte altijd. De aanname zat in de test én in de code.

**Live nagekeken na de fix**: Bloemen Gielen en Bloemenboetiek De Roos geven weer 200 met hun
echte `<title>`, en een onbestaande pagina geeft de nieuwe 404 mét de bedrijfsnaam erin
("Deze pagina bestaat niet (meer) — Bloemen Gielen"). Antwerp Fried Chicken geeft terecht
"Shopify-klanten worden rechtstreeks door Shopify bediend", en Tuinbouw Hendrix staat op
`concept` — dus "Deze site staat nog niet online" klopt daar.

**De privacypagina verschijnt pas bij de volgende generatie.** Bestaande versies zijn gebouwd
vóór die toevoeging; `privacybeleid.html` staat dus nog niet in hun map en geeft (terecht) 404.

### Niet gedaan / nog open

- **Bestanden uploaden is niet met een echt bestand getest** — de knop, het `accept`-filter en de
  sleepzone zijn nagekeken, maar een bestand kiezen kan de testbrowser niet.
- **Geen echte chat-bewerking gedraaid**: dat kost een modelaanroep en raakt een levende site.
- ~~De Edge Functions van vandaag staan nog niet live~~ — gedeployed, zie hierboven.

## Known gaps (deliberate, not oversights)

- **KBO Open Data import script doesn't exist.** `sourcing-run` reads from a
  `kbo_ondernemingen` staging table (`supabase/migrations/20260720000000_kbo_staging_table.sql`),
  but nothing populates that table yet — KBO publishes a downloadable file periodically,
  not a live API, so this needs a one-off (then recurring) import job once the user has
  downloaded a file. Ask before building this.
- **Shopify: automatisch een development store aanmaken kan niet.** Dit is nu tweemaal tegen
  het levende schema gecontroleerd, op twee verschillende voorgestelde mutation-namen:
  `developmentStoreCreate` (2026-07-27) en `devStoreCreate` (2026-07-28). Allebei antwoorden ze
  `Field '<naam>' doesn't exist on type 'MutationRoot'` — dat is het schema, geen rechtenfout.
  Feiten voor organisatie 4987287 op versie 2026-01:
  - mutations: **enkel `appCreditCreate`** (`unstable` heeft er vier: + appSubscriptionCancel,
    eventsinkCreate, eventsinkDelete)
  - queries: `app`, `publicApiVersions`, `transaction`, `transactions` — **geen enkel veld dat
    winkels teruggeeft**, dus ook geen weg naar een Admin-token
  - geldige versies: enkel 2025-10, 2026-01 en unstable; alles daarvoor geeft "Invalid API
    version". De client stond op `2025-01` en was daarmee stilzwijgend dood — rechtgezet.
  - de URL moet het organisatie-id in het pad hebben (`/{org}/api/{versie}/graphql.json`);
    zonder dat krijg je een 404-HTML-pagina die makkelijk voor een storing doorgaat.
  Hercontroleer met `worker/scripts/partner-api-status.ts` in plaats van dit opnieuw uit het
  geheugen te beweren. Wat dus open blijft: er is nog geen development store mét Admin-token, en
  die moet manueel aangemaakt worden; `chat-edit-shopify` en de rate limiter zijn daardoor nog
  niet tegen een levende winkel gedraaid.
- ~~**No E2E test exists yet.**~~ Gebouwd op 2026-07-29: `app/e2e/critical-path.spec.ts`,
  intussen 7 tests, **groen tegen het echte project** (`cd app && npm run e2e`). Dekt: lead verschijnt
  in de lijst → paneel opent → klik op het geblurde deel sluit → een job die tijdens het kijken
  wordt ingestoken verschijnt via Realtime → een mislukte job toont zijn échte foutmelding
  (regressietest voor de "non-2xx status code"-bug van juli) → Voorkeuren toont de regels die
  elke generatie sturen. Maakt en verwijdert zijn eigen leads (prefix `E2E-test `).
  - Inloggen gebeurt **zonder wachtwoord**: `global-setup.ts` munt met de service-role-key een
    magic link en schrijft de sessie als cookie. Let op — twee voor de hand liggende aanpakken
    werken NIET en zijn allebei geprobeerd: localStorage (deze app gebruikt `@supabase/ssr`,
    dat bewust in cookies opslaat) en de verify-URL in de browser volgen (kwam terug zonder
    fragment én zonder cookies). Het cookieformaat is overgenomen uit de geïnstalleerde
    `@supabase/ssr` (`base64-`-prefix, base64url, chunks van 3180), niet gegokt.
  - Draait niet zomaar: `app/.env.local` heeft een **lege** `SUPABASE_SERVICE_ROLE_KEY`. Geef
    hem mee uit `worker/.env` of vul hem in.
  - Draait bewust géén research/generatie/review: die kosten echt geld per run en vragen de
    worker. Jobs worden rechtstreeks ingestoken; wat getest wordt is hoe de app erop reageert.
- **Version-history UI (`app/src/app/(dashboard)/leads/version-history.tsx`) is untested
  in a real browser.** The underlying DB constraints it relies on are verified; the UI
  interactions (create/view/activate/revert) haven't been clicked through live.

## Where to look for more detail

- `supabase/README.md` — setup steps, environment variables, Gmail OAuth walkthrough, full
  delivery checklist with verified/unverified items.
- `supabase/tests/README.md` — how to reproduce the RLS + race-condition checks.
- `dashboard-spec-v9-FINAL.md` — the binding spec this build implements.
- `git log` — one commit per build step, with commit messages documenting what was verified
  vs. speculative at the time.

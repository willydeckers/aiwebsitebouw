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
- **Edge Functions**: confirmed deployed — all 10 functions (`research`, `generatie`,
  `chat-edit-static`, `chat-edit-shopify`, `send-email`, `shopify-staff-invite`,
  `sourcing-run`, `track-and-serve`, `cleanup-storage`, `gmail-oauth-exchange`) show
  `ACTIVE` on the linked project, with `ANTHROPIC_API_KEY` and the rest of the secrets
  table set.
- **`.env.local`**: `NEXT_PUBLIC_SUPABASE_URL`/`NEXT_PUBLIC_SUPABASE_ANON_KEY`/
  `ANTHROPIC_API_KEY` set locally, plus (2026-07-24) `NEXT_PUBLIC_DEMO_HOSTING_URL` and
  `NEXT_PUBLIC_APP_URL` (pointing straight at the deployed `track-and-serve` function and
  `localhost:3000` respectively — no custom domain yet). `DEMO_HOSTING_URL` set to match as
  an Edge Function secret. `NEXT_PUBLIC_GOOGLE_OAUTH_CLIENT_ID` still empty.
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
  4 tests, **groen tegen het echte project** (`cd app && npm run e2e`). Dekt: lead verschijnt
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

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

## Known gaps (deliberate, not oversights)

- **KBO Open Data import script doesn't exist.** `sourcing-run` reads from a
  `kbo_ondernemingen` staging table (`supabase/migrations/20260720000000_kbo_staging_table.sql`),
  but nothing populates that table yet — KBO publishes a downloadable file periodically,
  not a live API, so this needs a one-off (then recurring) import job once the user has
  downloaded a file. Ask before building this.
- **Shopify Partner/Admin API calls are unverified against a live account.** The mutation
  shapes in `worker/src/shared/shopify-partner-client.ts` and
  `supabase/functions/_shared/shopify.ts` are written from documentation, not tested live.
  Test with a real Partner account before using with an actual client.
- **No E2E test exists yet.** Playwright is a dependency in both `app/` and `worker/`
  already; `app/e2e/critical-path.spec.ts` (lead created → job triggered → Realtime status
  change) still needs writing, and needs a real test Supabase project to run against.
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

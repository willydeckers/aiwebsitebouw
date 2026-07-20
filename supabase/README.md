# Supabase — setup (spec v9)

Implements the data model and access rules from `dashboard-spec-v9-FINAL.md`
sections 2 (architecture), 6 (datamodel), and 7 (security/compliance).

## What's here

- `migrations/` — apply in filename order. `20260717*` are the original v2
  schema; `20260719000000_v9_datamodel.sql` is the v9 pivot (new leads
  columns for sourcing, `site_versions`/`review_log` version history,
  `gmail_koppeling`, `sourcing_config`, `gebruikers_profiel`, `ui_presets`,
  `audit_log`, the atomic budget-check function, the job state-machine
  trigger); `20260720000000_kbo_staging_table.sql` adds the KBO Open Data
  staging table (see its own comment — this needs a separate, external
  import job, not built here).
- `functions/` — Edge Functions for the "lichte taken" (section 2):
  `research`, `generatie`, `chat-edit-static`, `chat-edit-shopify`,
  `send-email`, `shopify-staff-invite`, `sourcing-run`, `track-and-serve`
  (public demo hosting + open-tracking), `cleanup-storage`,
  `gmail-oauth-exchange`.
- `tests/` — minimal RLS + race-condition regression checks, runnable
  against a plain local PostgreSQL instance. See `tests/README.md`.
- The `worker/` project (repo root, sibling to `app/`) is the separate
  hosted Node service for the "zware taken" — the Playwright review-loop
  and Shopify store building. It is not part of Supabase itself; deploy it
  as its own long-running process (see `worker/package.json`'s `start`
  script) with `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` and the same
  Anthropic/Shopify env vars as the Edge Functions.

## One-time setup (requires a Supabase account — manual, not scriptable from here)

1. Create a Supabase project at https://supabase.com (or `supabase projects
   create` with the CLI + an access token).
2. Apply every migration in `migrations/` in order, either via the SQL
   editor or `supabase db push` once linked (`supabase link --project-ref
   <ref>`).
3. Create exactly 2 users under Authentication → Users (Warre, Garen) with
   a password each. Leave public sign-ups disabled (default) — the spec
   rules out self-registration.
4. Deploy the Edge Functions: `supabase functions deploy <name>` for each
   directory under `functions/` (skip `_shared`). Set their secrets via
   `supabase secrets set` — see the per-function env vars below.
5. Copy the project URL and anon key into `app/.env.local`. Also set
   `NEXT_PUBLIC_DEMO_HOSTING_URL` (the public base URL `track-and-serve` is
   reachable at — a custom domain mapped to that function, per spec
   section 2's `demo.jouwagency.be/{lead-slug}`) and
   `NEXT_PUBLIC_GOOGLE_OAUTH_CLIENT_ID` (see Gmail section below — this one
   is safe to expose client-side, OAuth client IDs aren't secret).
6. Deploy `worker/` to a long-running host (a VM, Fly.io, Railway, etc. —
   anything that can run Playwright and stay up; NOT another Edge Function,
   per spec section 2's "aparte gehoste Node/Python-worker").

## Environment variables (Edge Functions + worker)

| Variable | Used by | Notes |
|---|---|---|
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | all Edge Functions, worker | Never in the client. |
| `ANTHROPIC_API_KEY` | research, generatie, chat-edit-*, sourcing-run, worker | |
| `MODEL_KWALITEIT` | research, generatie, chat-edit-*, worker | Defaults to `claude-opus-4-8`. Spec section 2's "kwalitatief sterker" tier. |
| `MODEL_SOURCING` | sourcing-run | Defaults to `claude-haiku-4-5`. Spec section 2's cheap/fast tier — keeps sourcing under €0.10/lead. |
| `GOOGLE_PLACES_API_KEY` | sourcing-run | Optional — sourcing-run skips Places matching without it. |
| `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET` | gmail-oauth-exchange, send-email | From a Google Cloud OAuth client (see below). |
| `GMAIL_TOKEN_ENCRYPTION_KEY` | gmail-oauth-exchange, send-email, track-and-serve | Base64, 32 random bytes (`openssl rand -base64 32`), generated once. |
| `DEMO_HOSTING_URL` | send-email, track-and-serve | Same public base URL as `NEXT_PUBLIC_DEMO_HOSTING_URL` above, used server-side to build links. |
| `SHOPIFY_PARTNER_ORGANIZATION_ID`, `SHOPIFY_PARTNER_ACCESS_TOKEN` | worker (shopify-build-job) | Shopify Partner API — dev-store creation. |

## Gmail API (spec section 2/7 — per-user OAuth, not a shared token)

v9 replaced v2's single shared refresh-token env vars with a per-user
OAuth grant, connected from Voorkeuren in the app:

1. Create a Google Cloud project, enable the Gmail API, and create an
   OAuth 2.0 Client ID (Web application type). Add
   `<your-demo-hosting-or-app-url>/gmail-callback` as an authorized
   redirect URI.
2. Put the client ID in `NEXT_PUBLIC_GOOGLE_OAUTH_CLIENT_ID` (app) and
   both the client ID + secret in `GOOGLE_OAUTH_CLIENT_ID`/
   `GOOGLE_OAUTH_CLIENT_SECRET` (Edge Function secrets).
3. Each user connects their own Gmail from Voorkeuren → "Koppel Gmail" —
   this is the actual OAuth consent + token exchange, no manual token
   generation needed (unlike the v2 setup).
4. Before real use: move the OAuth consent screen to "In production" in
   Google Cloud Console (spec section 2/9) — in testing mode, Google
   revokes refresh tokens after 7 days, which fails section 9's "verzending
   7+ dagen na koppeling nog werkend" check.

## Delivery checklist (spec section 9) — status as of this build

Verified in this environment (no live Supabase project, Docker, or
external API credentials were available — everything below was checked
against a real local PostgreSQL 17 instance, `deno check`, and static
builds; see `tests/README.md` for exact reproduction steps):

- [x] RLS policies effectively block an unauthenticated (`anon`) request
      and allow full access to `authenticated` — automated in
      `tests/security_and_race_conditions.sql`.
- [x] Budget-stop race condition: two genuinely concurrent transactions on
      the same lead never both succeed past the €5 cap (advisory-lock
      atomic transaction, verified with two live concurrent psql sessions).
- [x] One-active-job-per-lead race condition: two concurrent inserts for
      the same (lead, type) — exactly one survives (partial unique index).
- [x] Job state machine: `wachtrij→bezig→timeout→wachtrij` (manual retry)
      succeeds; invalid transitions (e.g. `bezig→wachtrij`) are rejected.
- [x] Lead deletion: DB-level cascade clears `jobs`/`site_versions`/
      `review_log`/`project_kosten` for the deleted lead.
- [x] Migration applies cleanly on top of the full v2→v9 history.
- [x] App typechecks, lints, and builds under `output: 'export'`; every
      Edge Function typechecks under `deno check`; the worker project
      typechecks.

**Still needs a live deployment to verify** (nothing in this environment
can exercise these — a real Supabase project, deployed Edge Functions, a
running worker, and real API credentials are all required):

- [ ] Own logo in the Tauri app shell (no framework placeholder) and "app
      voelt vlot aan" — both are visual/UX judgment calls on the real
      packaged app.
- [ ] A test sourcing-run actually run against real KBO Open Data (needs
      the external import into `kbo_ondernemingen` — see that migration's
      comment) and a real `GOOGLE_PLACES_API_KEY`.
- [ ] Version-picker UI exercised end-to-end in the browser: create,
      view an older version, "Maak deze actief", "Herstel als nieuwe
      versie" (the underlying DB constraints are verified; the UI itself
      — `app/src/app/(dashboard)/leads/version-history.tsx` — is not).
- [ ] Storage cleanup on lead deletion, the actual Storage-object half
      (the DB cascade half is verified) — needs `cleanup-storage` run
      against a real Storage bucket.
- [ ] Gmail OAuth consent screen moved to "In production", and sending
      confirmed still working 7+ days after linking.
- [ ] Navigating to a lead-detail page and refreshing (F5) — the URL
      already encodes the selected lead via a query param, so this should
      work, but hasn't been exercised in a real browser against a real
      backend.
- [ ] A basic E2E test for the critical path (lead created → job
      triggered → status change observed via Realtime) — Playwright is
      already a dependency in both `app/` and `worker/`; write
      `app/e2e/critical-path.spec.ts` once a test Supabase project exists
      to run it against.

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
  `public` schema wipe); both resolved, migrations are in.
- **Edge Functions**: not yet confirmed deployed.
- **`.env.local` / Edge Function secrets / worker hosting**: in progress — following the
  deployment walkthrough artifact published earlier in this project's chat history.
- **Gmail OAuth**: Google Cloud OAuth client created (Web application type), client ID
  obtained; client secret + `GMAIL_TOKEN_ENCRYPTION_KEY` generation in progress.
- **Worker**: not yet hosted anywhere.
- **KBO Open Data import**: not started (see Known gaps below).

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

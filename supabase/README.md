# Supabase — setup

Implements the data model and access rules from `dashboard-spec-v2-FINAL.md`
section 5 (datamodel) and section 6 (security).

## What's here

- `migrations/20260717000000_initial_schema.sql` — full schema (`leads`,
  `jobs`, `klanten`, `email_events`, `stijlvoorkeuren`, `sector_kennis`,
  `project_kosten`), the one-active-job-per-lead rate limit, and RLS policies
  scoped to `authenticated` sessions only.

## One-time setup (requires a Supabase account — manual, not scriptable from here)

1. Create a Supabase project at https://supabase.com (or `supabase projects create`
   if you have the CLI + an access token).
2. Apply the migration: either paste `migrations/20260717000000_initial_schema.sql`
   into the SQL editor, or run `supabase db push` once the project is linked
   (`supabase link --project-ref <ref>`).
3. Create exactly 2 users under Authentication → Users (Warre, Garen) with a
   password each. Leave public sign-ups disabled (default) — the spec
   explicitly rules out self-registration.
4. Copy the project URL and anon key into `app/.env.local` (see
   `app/.env.local.example`). Never put the service-role key in the client —
   it's for Edge Functions only.

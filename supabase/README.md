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
5. Copy the service-role key into `SUPABASE_SERVICE_ROLE_KEY` in
   `app/.env.local` too — it's used server-only by the public tracking
   redirect (`app/api/track/[leadId]`), which runs without a dashboard login
   session and so can't use the anon key + RLS like everything else.

## Gmail API (spec section 3.6 — sending + open notifications)

Requires a Google Cloud project with the Gmail API enabled and an OAuth
client (Desktop app or Web app type). One-time, per sending account:

1. Create OAuth credentials in Google Cloud Console → APIs & Services →
   Credentials. Note the client ID and secret.
2. Run the standard Google OAuth2 authorization-code flow once (e.g. via
   Google's OAuth Playground, or a short throwaway script) with scope
   `https://www.googleapis.com/auth/gmail.send`, using that client ID/secret,
   to obtain a refresh token for the account that should send from.
3. Fill in `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, `GMAIL_REFRESH_TOKEN`,
   and `GMAIL_SENDER_EMAIL` in `app/.env.local`.

-- Every table in public/ has an "authenticated full access" RLS policy (see
-- 20260717000000_initial_schema.sql onward), but RLS is only ever consulted
-- *after* Postgres checks table-level GRANTs. On a normal Supabase project
-- those grants are set up automatically at project creation (GRANT ... TO
-- anon, authenticated, service_role + matching ALTER DEFAULT PRIVILEGES).
-- Per this project's CLAUDE.md, the public schema was dropped and recreated
-- once during initial migration troubleshooting (to clear a leftover
-- storage.objects policy) — that wiped those default grants, which is why
-- every authenticated request now fails with "permission denied for table
-- X" instead of an RLS violation. This restores them, and makes sure future
-- migrations don't hit the same gap.

grant usage on schema public to authenticated, service_role;

grant all on all tables in schema public to authenticated, service_role;
grant all on all sequences in schema public to authenticated, service_role;
grant all on all functions in schema public to authenticated, service_role;

alter default privileges in schema public
  grant all on tables to authenticated, service_role;
alter default privileges in schema public
  grant all on sequences to authenticated, service_role;
alter default privileges in schema public
  grant all on functions to authenticated, service_role;

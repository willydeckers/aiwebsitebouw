-- Minimal stand-in for the parts of a real Supabase project the
-- migrations assume exist (auth/storage schemas, anon/authenticated/
-- service_role roles, a realtime publication) — for running the
-- migrations and security_and_race_conditions.sql against a plain local
-- PostgreSQL instance, without Docker/the Supabase CLI. NOT a functional
-- replica of Supabase (no real auth.uid()/JWT handling, no Storage API,
-- no PostgREST) — just enough surface for the DDL and RLS/GRANT checks to
-- mean something. See supabase/tests/README.md for how to use this.
create extension if not exists pgcrypto;

create role authenticated;
create role anon;
create role service_role;

create schema auth;
create table auth.users (id uuid primary key default gen_random_uuid());
create or replace function auth.uid() returns uuid as $$
  select null::uuid;
$$ language sql stable;

create schema storage;
create table storage.buckets (
  id text primary key,
  name text not null,
  public boolean not null default false
);
create table storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets (id),
  name text
);
alter table storage.objects enable row level security;

create publication supabase_realtime;

-- Real Supabase grants anon/authenticated broad schema+table-level ACLs by
-- default and relies on RLS as the actual gate (not the GRANTs) — this
-- mirrors that so testing against this stub actually exercises RLS policy
-- enforcement instead of failing earlier on a plain permission-denied.
grant usage on schema public to anon, authenticated;
grant all on all tables in schema public to anon, authenticated;
grant all on all sequences in schema public to anon, authenticated;
grant execute on all functions in schema public to anon, authenticated;
alter default privileges in schema public grant all on tables to anon, authenticated;

grant usage on schema storage to anon, authenticated;
grant all on all tables in schema storage to anon, authenticated;

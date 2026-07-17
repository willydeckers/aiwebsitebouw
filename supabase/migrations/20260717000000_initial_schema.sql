-- Initial schema for the Web Agency Dashboard (spec section 5: dashboard-spec-v2-FINAL.md)
-- Two trusted accounts only (Warre, Garen) — no public registration, so RLS simply
-- requires an authenticated session rather than per-row ownership checks.

create extension if not exists "pgcrypto";

-- ─────────────────────────────────────────────────────────────────────────
-- leads
-- ─────────────────────────────────────────────────────────────────────────
create type lead_status as enum (
  'nieuw', 'research', 'genereren', 'klaar', 'verzonden', 'geopend',
  'klant', 'geblokkeerd', 'dood'
);

create type klant_type as enum ('statisch', 'shopify');

create table leads (
  id uuid primary key default gen_random_uuid(),
  bedrijfsnaam text not null,
  sector text not null,
  adres text,
  contact_email text,
  contact_naam text,
  notities text,
  status lead_status not null default 'nieuw',
  demo_url text,
  klant_type klant_type,
  shopify_store_id text,
  laatste_update timestamptz not null default now(),
  aangemaakt_op timestamptz not null default now()
);

create index leads_status_idx on leads (status);
create index leads_sector_idx on leads (sector);

-- ─────────────────────────────────────────────────────────────────────────
-- jobs
-- ─────────────────────────────────────────────────────────────────────────
create type job_type as enum ('research', 'generate_demo', 'review', 'build_shopify');
create type job_status as enum ('queued', 'running', 'done', 'failed');

create table jobs (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references leads (id) on delete cascade,
  type job_type not null,
  status job_status not null default 'queued',
  error_message text,
  aangemaakt_op timestamptz not null default now(),
  afgerond_op timestamptz
);

create index jobs_lead_id_idx on jobs (lead_id);
create index jobs_status_idx on jobs (status);

-- Rate-limit: max 1 active job per lead (spec section 6)
create unique index jobs_one_active_per_lead_idx on jobs (lead_id)
  where status in ('queued', 'running');

-- ─────────────────────────────────────────────────────────────────────────
-- klanten
-- ─────────────────────────────────────────────────────────────────────────
create table klanten (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references leads (id) on delete cascade,
  type klant_type not null,
  definitief_domein text,
  shopify_staff_account_status text,
  site_status text,
  laatst_gecontroleerd_op timestamptz
);

create index klanten_lead_id_idx on klanten (lead_id);

-- ─────────────────────────────────────────────────────────────────────────
-- email_events
-- ─────────────────────────────────────────────────────────────────────────
create type email_event_type as enum ('verzonden', 'geopend');

create table email_events (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references leads (id) on delete cascade,
  type email_event_type not null,
  "timestamp" timestamptz not null default now()
);

create index email_events_lead_id_idx on email_events (lead_id);

-- ─────────────────────────────────────────────────────────────────────────
-- stijlvoorkeuren
-- ─────────────────────────────────────────────────────────────────────────
create table stijlvoorkeuren (
  id uuid primary key default gen_random_uuid(),
  regel text not null,
  context text,
  toegevoegd_door text not null,
  datum timestamptz not null default now()
);

-- ─────────────────────────────────────────────────────────────────────────
-- sector_kennis
-- ─────────────────────────────────────────────────────────────────────────
create type sector_kennis_bron as enum ('handmatig', 'geleerd uit review');

create table sector_kennis (
  id uuid primary key default gen_random_uuid(),
  sector text not null,
  regel text not null,
  bron sector_kennis_bron not null default 'handmatig',
  datum timestamptz not null default now()
);

create index sector_kennis_sector_idx on sector_kennis (sector);

-- ─────────────────────────────────────────────────────────────────────────
-- project_kosten
-- ─────────────────────────────────────────────────────────────────────────
create type project_kosten_stap as enum ('research', 'generatie', 'review', 'chat_edit');

create table project_kosten (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references leads (id) on delete cascade,
  stap project_kosten_stap not null,
  model text not null,
  tokens_in integer not null,
  tokens_out integer not null,
  kost_eur numeric(10, 4) not null,
  "timestamp" timestamptz not null default now()
);

create index project_kosten_lead_id_idx on project_kosten (lead_id);

-- ─────────────────────────────────────────────────────────────────────────
-- Row Level Security
--
-- Only 2 pre-created accounts exist (Warre, Garen) and there is no public
-- registration (spec section 6), so any authenticated session is a trusted
-- session — policies gate on auth.role() = 'authenticated' rather than
-- per-row ownership. Anonymous (unauthenticated) access is denied entirely.
-- ─────────────────────────────────────────────────────────────────────────
alter table leads enable row level security;
alter table jobs enable row level security;
alter table klanten enable row level security;
alter table email_events enable row level security;
alter table stijlvoorkeuren enable row level security;
alter table sector_kennis enable row level security;
alter table project_kosten enable row level security;

create policy "authenticated full access" on leads
  for all to authenticated using (true) with check (true);

create policy "authenticated full access" on jobs
  for all to authenticated using (true) with check (true);

create policy "authenticated full access" on klanten
  for all to authenticated using (true) with check (true);

create policy "authenticated full access" on email_events
  for all to authenticated using (true) with check (true);

create policy "authenticated full access" on stijlvoorkeuren
  for all to authenticated using (true) with check (true);

create policy "authenticated full access" on sector_kennis
  for all to authenticated using (true) with check (true);

create policy "authenticated full access" on project_kosten
  for all to authenticated using (true) with check (true);

-- ─────────────────────────────────────────────────────────────────────────
-- laatste_update bookkeeping on leads
-- ─────────────────────────────────────────────────────────────────────────
create function set_leads_laatste_update()
returns trigger as $$
begin
  new.laatste_update = now();
  return new;
end;
$$ language plpgsql;

create trigger leads_set_laatste_update
  before update on leads
  for each row
  execute function set_leads_laatste_update();

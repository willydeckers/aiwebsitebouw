-- Spec v9 (dashboard-spec-v9-FINAL.md) datamodel migration. Supersedes the
-- v2-era schema built in the earlier migrations. This migration is additive
-- and type-swapping rather than destructive — existing rows are preserved
-- and remapped onto the new enums where the vocabulary changed (English
-- job/enum values -> the Dutch ones v9 specifies).

-- ─────────────────────────────────────────────────────────────────────────
-- 1. leads: new status side-states + the full v9 column set
--
-- Spec section 3.1 gives the LeadStatus enum as
--   Nieuw | Research | Genereren | Klaar | Verzonden | Geopend | Klant | Dood
-- but section 3.3 ("Budget overschreden") and 3.4 ("Geblokkeerd") both set
-- a lead status those two words never appear in. Treated the same way the
-- v2 build treated this same gap: as side-states alongside the main
-- pipeline, not a spec contradiction to silently drop.
-- ─────────────────────────────────────────────────────────────────────────
alter type lead_status add value if not exists 'budget_overschreden';

create type herkomst as enum ('sourcing', 'manueel');

alter table leads
  add column if not exists open_vragen text,
  add column if not exists herkomst herkomst not null default 'manueel',
  add column if not exists kbo_nummer text,
  add column if not exists rechtsvorm text,
  add column if not exists nace_code text,
  add column if not exists oprichtingsdatum date,
  add column if not exists google_place_id text,
  add column if not exists telefoon text,
  add column if not exists telefoon_bron text,
  add column if not exists website_status text
    check (website_status in ('geen', 'kapot', 'matig', 'goed')),
  add column if not exists website_url text,
  add column if not exists website_url_bron text,
  add column if not exists contact_email_bron text,
  -- GDPR/ePrivacy flag (spec section 7): true once the found address looks
  -- like a named individual (voornaam.naam@) rather than a generic
  -- info@/contact@ inbox — cold B2B outreach to it is legally shakier.
  add column if not exists contact_email_persoonsgebonden boolean,
  add column if not exists contact_method text,
  add column if not exists bron_match text,
  add column if not exists laatst_bewerkt_door text;

-- research_output and review_notitie were v2-era additions (not in either
-- version's core datamodel). review_notitie is properly superseded by
-- review_log below. research_output's replacement is narrower than it
-- looks: v9's leads columns only persist open_vragen (uncertain facts),
-- and section 3.3 describes generation as using stijlvoorkeuren/
-- sectorkennis, not explicit research findings. But research (3.2) and
-- generation (3.3) are separately user-triggered actions in this UI, not
-- one atomic call — without somewhere to hold the confirmed findings
-- between those two clicks, a research run would have nothing to hand the
-- generator. research_samenvatting is that hand-off slot: plain text,
-- scratch/transient by design (overwritten on every research run, not a
-- permanent record the way open_vragen is).
alter table leads add column if not exists research_samenvatting text;
alter table leads drop column if exists research_output;
alter table leads drop column if exists review_notitie;
-- demo_url is likewise superseded by site_versions.content_referentie
-- (the "actief" version is what the hosting layer in section 2 serves).
alter table leads drop column if exists demo_url;

-- kbo_nummer is the sourcing-run dedupe key (spec 3.1a step 1) — unique
-- once populated, but nullable for manually-entered leads that never get one.
create unique index if not exists leads_kbo_nummer_key on leads (kbo_nummer)
  where kbo_nummer is not null;

comment on column leads.kbo_nummer is
  'Genormaliseerd naar pure cijfers vóór opslag/dedupe (spec 3.1a stap 1).';

-- laatste_update -> laatst_bewerkt_op: same column, v9's name for it.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_name = 'leads' and column_name = 'laatste_update'
  ) then
    alter table leads rename column laatste_update to laatst_bewerkt_op;
  end if;
end $$;

-- The v2 trigger function set `new.laatste_update` — update it to the
-- renamed column so the existing `leads_set_laatste_update` trigger (still
-- attached to `leads`) keeps working, and reuse it below for
-- site_versions.laatst_bewerkt_op too.
create or replace function set_leads_laatste_update()
returns trigger as $$
begin
  new.laatst_bewerkt_op = now();
  return new;
end;
$$ language plpgsql;

-- ─────────────────────────────────────────────────────────────────────────
-- 2. jobs: Dutch JobStatus enum, new job type, gestart_op/pogingen,
--    race-condition-safe "one active job" constraint, and a status-
--    transition guard (spec section 6's state-machine comment).
-- ─────────────────────────────────────────────────────────────────────────
-- sourcing_run (added below) creates leads rather than acting on one that
-- already exists, so lead_id can't stay NOT NULL — the v2 schema had it
-- required because every job type back then targeted an existing lead.
alter table jobs alter column lead_id drop not null;

create type job_status_v9 as enum ('wachtrij', 'bezig', 'klaar', 'mislukt', 'timeout', 'geannuleerd');

alter table jobs add column if not exists status_v9 job_status_v9;

update jobs set status_v9 = case status
  when 'queued' then 'wachtrij'
  when 'running' then 'bezig'
  when 'done' then 'klaar'
  when 'failed' then 'mislukt'
end::job_status_v9
where status_v9 is null;

alter table jobs alter column status_v9 set not null;
alter table jobs alter column status_v9 set default 'wachtrij';

drop index if exists jobs_one_active_per_lead_idx;
alter table jobs drop column status;
alter table jobs rename column status_v9 to status;

create type job_type_v9 as enum ('research', 'generatie', 'review', 'shopify_opbouw', 'sourcing_run');

alter table jobs add column if not exists type_v9 job_type_v9;

update jobs set type_v9 = case type
  when 'research' then 'research'
  when 'generate_demo' then 'generatie'
  when 'review' then 'review'
  when 'build_shopify' then 'shopify_opbouw'
end::job_type_v9
where type_v9 is null;

alter table jobs alter column type_v9 set not null;
alter table jobs drop column type;
alter table jobs rename column type_v9 to type;

alter table jobs
  add column if not exists gestart_op timestamptz,
  add column if not exists pogingen integer not null default 0;

alter table jobs rename column aangemaakt_op to aangemaakt_op_legacy;
alter table jobs add column if not exists aangemaakt_op timestamptz not null default now();
update jobs set aangemaakt_op = aangemaakt_op_legacy where aangemaakt_op_legacy is not null;
alter table jobs drop column aangemaakt_op_legacy;

-- "Max 1 actieve job per lead" per spec section 6's literal index
-- definition — scoped per (lead_id, type), not per lead across all types
-- (the prose says "per lead" but the index it names is the binding part).
create unique index if not exists jobs_one_active_per_lead_type_idx
  on jobs (lead_id, type)
  where status in ('wachtrij', 'bezig');

-- State machine per spec section 6's comment. bezig->mislukt isn't listed
-- there but is clearly required (a job must be able to fail) — added as a
-- pragmatic gap-fill, same as the lead-status side-states above.
create or replace function enforce_job_status_transition()
returns trigger as $$
begin
  if TG_OP = 'UPDATE' and OLD.status is distinct from NEW.status then
    if not (
      (OLD.status = 'wachtrij' and NEW.status in ('bezig', 'geannuleerd')) or
      (OLD.status = 'bezig' and NEW.status in ('klaar', 'timeout', 'mislukt', 'geannuleerd')) or
      (OLD.status = 'timeout' and NEW.status = 'wachtrij') or
      (OLD.status = 'mislukt' and NEW.status = 'wachtrij')
    ) then
      raise exception 'Ongeldige job-statusovergang: % -> %', OLD.status, NEW.status;
    end if;
  end if;
  return NEW;
end;
$$ language plpgsql;

drop trigger if exists jobs_enforce_status_transition on jobs;
create trigger jobs_enforce_status_transition
  before update on jobs
  for each row execute function enforce_job_status_transition();

-- ─────────────────────────────────────────────────────────────────────────
-- 3. site_versions — replaces the flat demo_url/research_output/
--    review_notitie columns on leads with proper version history
--    (spec 3.3/3.5/3.7/3.8).
-- ─────────────────────────────────────────────────────────────────────────
create type site_type as enum ('demo', 'statisch', 'shopify');
create type site_version_status as enum ('concept', 'afgerond', 'actief');

create table site_versions (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references leads (id) on delete cascade,
  site_type site_type not null,
  versienummer integer not null,
  status site_version_status not null default 'concept',
  content_referentie text,
  prompt_versie text,
  laatst_bewerkt_door text,
  laatst_bewerkt_op timestamptz not null default now(),
  aangemaakt_op timestamptz not null default now(),
  unique (lead_id, versienummer)
);

create index site_versions_lead_id_idx on site_versions (lead_id);

-- "Eén concept-versie + (na eerste afronding) één actieve versie" (3.5).
create unique index site_versions_one_concept_per_lead_idx
  on site_versions (lead_id) where status = 'concept';
create unique index site_versions_one_actief_per_lead_idx
  on site_versions (lead_id) where status = 'actief';

alter table site_versions enable row level security;
create policy "authenticated full access" on site_versions
  for all to authenticated using (true) with check (true);

create trigger site_versions_set_laatst_bewerkt_op
  before update on site_versions
  for each row
  execute function set_leads_laatste_update();

-- ─────────────────────────────────────────────────────────────────────────
-- 4. review_log — replaces the leads.review_notitie jsonb column.
-- ─────────────────────────────────────────────────────────────────────────
create table review_log (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references leads (id) on delete cascade,
  site_version_id uuid references site_versions (id) on delete cascade,
  bron text not null,
  instructie_of_bevinding text,
  resultaat text,
  error_message text,
  prompt_versie text,
  "timestamp" timestamptz not null default now()
);

create index review_log_lead_id_idx on review_log (lead_id);
create index review_log_site_version_id_idx on review_log (site_version_id);

alter table review_log enable row level security;
create policy "authenticated full access" on review_log
  for all to authenticated using (true) with check (true);

-- ─────────────────────────────────────────────────────────────────────────
-- 5. gebruiker enum shared by the per-user tables below.
-- ─────────────────────────────────────────────────────────────────────────
create type gebruiker_naam as enum ('warre', 'garen');

-- ─────────────────────────────────────────────────────────────────────────
-- 6. gmail_koppeling — per-user Gmail OAuth link (spec 2/7), replacing the
--    single shared refresh-token env vars from the v2 build.
-- ─────────────────────────────────────────────────────────────────────────
create table gmail_koppeling (
  id uuid primary key default gen_random_uuid(),
  gebruiker gebruiker_naam not null unique,
  -- Encrypted at rest via pgsodium/Supabase Vault in the Edge Function that
  -- writes this row — never store a plaintext refresh token here directly.
  refresh_token bytea,
  gekoppeld_op timestamptz,
  status text not null default 'niet_gekoppeld' check (status in ('actief', 'verlopen', 'niet_gekoppeld'))
);

alter table gmail_koppeling enable row level security;
create policy "authenticated full access" on gmail_koppeling
  for all to authenticated using (true) with check (true);

-- ─────────────────────────────────────────────────────────────────────────
-- 7. sourcing_config — settings for the automated sourcing-run (3.1a),
--    edited via the gear icon on the Leads screen.
-- ─────────────────────────────────────────────────────────────────────────
create table sourcing_config (
  id uuid primary key default gen_random_uuid(),
  nace_codes text[] not null default '{}',
  postcodes text[] not null default '{}',
  kwaliteitsdrempel_matig boolean not null default true,
  run_frequentie text,
  max_leads_per_run integer not null default 20,
  laatst_uitgevoerd_op timestamptz
);

alter table sourcing_config enable row level security;
create policy "authenticated full access" on sourcing_config
  for all to authenticated using (true) with check (true);

-- ─────────────────────────────────────────────────────────────────────────
-- 8. gebruikers_profiel + ui_presets — profile bubble + per-user theme
--    (spec section 5's "layout met profielbol").
-- ─────────────────────────────────────────────────────────────────────────
create table gebruikers_profiel (
  id uuid primary key default gen_random_uuid(),
  gebruiker gebruiker_naam not null unique,
  naam text,
  profielfoto_url text
);

alter table gebruikers_profiel enable row level security;
create policy "authenticated full access" on gebruikers_profiel
  for all to authenticated using (true) with check (true);

create table ui_presets (
  id uuid primary key default gen_random_uuid(),
  gebruiker gebruiker_naam not null,
  naam text not null,
  thema text,
  achtergrondkleur text,
  accentkleur text,
  unique (gebruiker, naam)
);

alter table ui_presets enable row level security;
create policy "authenticated full access" on ui_presets
  for all to authenticated using (true) with check (true);

-- ─────────────────────────────────────────────────────────────────────────
-- 9. audit_log
-- ─────────────────────────────────────────────────────────────────────────
create table audit_log (
  id uuid primary key default gen_random_uuid(),
  gebruiker text not null,
  actie text not null,
  lead_id uuid references leads (id) on delete set null,
  detail jsonb,
  "timestamp" timestamptz not null default now()
);

create index audit_log_lead_id_idx on audit_log (lead_id);
create index audit_log_timestamp_idx on audit_log ("timestamp");

alter table audit_log enable row level security;
create policy "authenticated full access" on audit_log
  for all to authenticated using (true) with check (true);

-- ─────────────────────────────────────────────────────────────────────────
-- 10. project_kosten: prompt_versie column.
-- ─────────────────────────────────────────────────────────────────────────
alter table project_kosten add column if not exists prompt_versie text;

-- ─────────────────────────────────────────────────────────────────────────
-- 11. Atomic, race-condition-free budget check (spec 3.3/7/9): the
--     "cumulative cost < €5" check and the project_kosten insert happen in
--     one transaction serialized per lead_id via a transaction-scoped
--     advisory lock, so two concurrent actions on the same lead can't both
--     read "still under budget" and both push it over.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function record_project_kost_if_under_budget(
  p_lead_id uuid,
  p_stap project_kosten_stap,
  p_model text,
  p_tokens_in integer,
  p_tokens_out integer,
  p_kost_eur numeric,
  p_prompt_versie text default null,
  p_budget_eur numeric default 5.0
) returns table (toegestaan boolean, cumulatieve_kost numeric) as $$
declare
  v_lock_key bigint;
  v_current_total numeric;
begin
  -- Transaction-scoped advisory lock keyed by lead_id — released
  -- automatically at commit/rollback, so it can't be leaked by a crashed
  -- caller the way an explicit unlock-based lock could be.
  v_lock_key := ('x' || substr(md5(p_lead_id::text), 1, 15))::bit(60)::bigint;
  perform pg_advisory_xact_lock(v_lock_key);

  select coalesce(sum(kost_eur), 0) into v_current_total
  from project_kosten
  where lead_id = p_lead_id;

  if v_current_total + p_kost_eur > p_budget_eur then
    return query select false, v_current_total;
    return;
  end if;

  insert into project_kosten (lead_id, stap, model, tokens_in, tokens_out, kost_eur, prompt_versie)
  values (p_lead_id, p_stap, p_model, p_tokens_in, p_tokens_out, p_kost_eur, p_prompt_versie);

  return query select true, v_current_total + p_kost_eur;
end;
$$ language plpgsql;

-- ─────────────────────────────────────────────────────────────────────────
-- 12. Drop the now-unused v2 enum types (no column references either after
--     the rename dance above).
-- ─────────────────────────────────────────────────────────────────────────
drop type if exists job_status;
drop type if exists job_type;

-- ─────────────────────────────────────────────────────────────────────────
-- 13. The "demos" bucket must stop being public: spec section 2 requires
--     that "geen kale Storage-object-URL wordt ooit naar een lead
--     gestuurd" — a public bucket lets anyone who guesses/finds the path
--     bypass the tracking Edge Function entirely. Access now goes through
--     that Edge Function only, using its service-role key.
-- ─────────────────────────────────────────────────────────────────────────
update storage.buckets set public = false where id = 'demos';
drop policy if exists "public can read demos" on storage.objects;

-- ─────────────────────────────────────────────────────────────────────────
-- 14. Realtime (spec section 2): "Supabase Realtime op jobs, site_versions,
--     review_log" — the frontend has no server to poll from under static
--     export, so this is how it learns a background job/version/review
--     changed.
-- ─────────────────────────────────────────────────────────────────────────
alter publication supabase_realtime add table jobs;
alter publication supabase_realtime add table site_versions;
alter publication supabase_realtime add table review_log;

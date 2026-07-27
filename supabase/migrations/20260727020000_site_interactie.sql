-- Backing tables for the interactive site features: form/review submissions,
-- downloadable files, and per-lead access codes for gated pages.
--
-- All three are read and written by the public hosting layer
-- (`track-and-serve`) with the service-role client, exactly as it already
-- serves demo HTML — no anon-key access to any of this from a visitor's
-- browser. RLS below is therefore about the *app's* two accounts, and denies
-- everyone else by default.

-- ─────────────────────────────────────────────────────────────────────────
-- 1. site_inzendingen — what visitors send through a generated form
-- ─────────────────────────────────────────────────────────────────────────
-- GDPR (spec section 7): these rows are personal data submitted by third
-- parties. They cascade away with the lead, which is what makes "verwijder
-- deze lead" a real erasure rather than a half one. Nothing here is used for
-- outreach — it is inbound contact the client asked for.
create table if not exists site_inzendingen (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references leads (id) on delete cascade,
  soort text not null check (soort in ('contact', 'offerte', 'review')),
  naam text,
  email text,
  bericht text,
  score smallint check (score between 1 and 5),
  -- Any additional fields the generated form happened to include. Kept as a
  -- blob rather than columns because the form's shape is per-site.
  extra jsonb,
  status text not null default 'nieuw'
    check (status in ('nieuw', 'gelezen', 'goedgekeurd', 'afgekeurd', 'spam')),
  -- Salted hash, never a raw address: enough to rate-limit a flood from one
  -- source, not enough to identify a visitor after the fact.
  afzender_hash text,
  aangemaakt_op timestamptz not null default now()
);

create index if not exists site_inzendingen_lead_id_idx on site_inzendingen (lead_id, aangemaakt_op desc);
-- Serving approved reviews is the one read on the visitor-facing path.
create index if not exists site_inzendingen_reviews_idx
  on site_inzendingen (lead_id, aangemaakt_op desc)
  where soort = 'review' and status = 'goedgekeurd';

alter table site_inzendingen enable row level security;
create policy "authenticated full access" on site_inzendingen
  for all to authenticated using (true) with check (true);

-- ─────────────────────────────────────────────────────────────────────────
-- 2. site_bestanden — files the user uploads for a lead to offer as downloads
-- ─────────────────────────────────────────────────────────────────────────
-- The generator can't invent a PDF, so downloads are always files a real
-- person uploaded. They live in the `demos` bucket at
-- `{lead_id}/bestanden/{bestandsnaam}` — beside the version folders rather
-- than inside one, because a brochure outlives any single site version.
create table if not exists site_bestanden (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references leads (id) on delete cascade,
  bestandsnaam text not null,
  opslag_pad text not null,
  content_type text,
  grootte_bytes bigint,
  omschrijving text,
  toegevoegd_door text,
  aangemaakt_op timestamptz not null default now(),
  -- The generator links files by name, so a lead can't have two of the same.
  unique (lead_id, bestandsnaam)
);

create index if not exists site_bestanden_lead_id_idx on site_bestanden (lead_id);

alter table site_bestanden enable row level security;
create policy "authenticated full access" on site_bestanden
  for all to authenticated using (true) with check (true);

-- ─────────────────────────────────────────────────────────────────────────
-- 3. site_toegang — the access code for a lead's gated pages
-- ─────────────────────────────────────────────────────────────────────────
-- Gating is enforced in `track-and-serve`: a page marked "beveiligd" in the
-- version manifest is never sent to a browser that hasn't presented the code.
-- This is deliberately a shared code per site, not per-visitor accounts —
-- there is no user model here and inventing one would promise a security
-- property this hosting layer cannot keep.
create table if not exists site_toegang (
  lead_id uuid primary key references leads (id) on delete cascade,
  -- sha256(salt || code), hex. The plaintext code is shown to the user once,
  -- when they set it, and never stored.
  code_hash text not null,
  salt text not null,
  -- Shown above the code prompt, e.g. "de code uit je welkomstmail".
  hint text,
  aangemaakt_op timestamptz not null default now(),
  aangemaakt_door text
);

alter table site_toegang enable row level security;
create policy "authenticated full access" on site_toegang
  for all to authenticated using (true) with check (true);

comment on table site_toegang is
  'Gedeelde toegangscode per lead voor pagina''s met toegang=beveiligd in site_versions.paginas. Geen accountsysteem — zie de opmerking in track-and-serve.';

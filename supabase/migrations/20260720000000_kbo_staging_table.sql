-- Staging table for KBO Open Data (spec 3.1a step 1).
--
-- KBO Open Data (https://kbopub.economie.fgov.be/kbo-open-data) is NOT a
-- live per-company lookup API — it's a full+incremental CSV/XML dataset
-- published periodically by FPS Economie, requiring registration to
-- download. Querying it by NACE code + postcode + active-status at
-- sourcing-run time means importing that dataset into a queryable table
-- first; the sourcing-run Edge Function reads from this table rather than
-- calling any live "KBO API" (no such thing exists for bulk filtering).
--
-- Populating/refreshing this table is a separate, external ETL job (parse
-- the KBO Open Data CSVs, upsert here) that is NOT built as part of this
-- migration or the sourcing-run function — same kind of manual, external
-- setup step as the Shopify Partner credentials and Gmail OAuth grant
-- documented elsewhere in supabase/README.md.
create table kbo_ondernemingen (
  kbo_nummer text primary key, -- genormaliseerd naar pure cijfers (spec 3.1a stap 1)
  naam text not null,
  rechtsvorm text,
  nace_code text,
  postcode text,
  adres text,
  oprichtingsdatum date,
  actief boolean not null default true,
  website_url text,
  laatst_geimporteerd_op timestamptz not null default now()
);

create index kbo_ondernemingen_nace_postcode_idx on kbo_ondernemingen (nace_code, postcode)
  where actief;

alter table kbo_ondernemingen enable row level security;
create policy "authenticated full access" on kbo_ondernemingen
  for all to authenticated using (true) with check (true);

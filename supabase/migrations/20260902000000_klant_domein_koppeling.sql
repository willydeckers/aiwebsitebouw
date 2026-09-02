-- Hosting op een echt domein (spec 2: "een custom domain mapped to that
-- function"), in twee vormen die dezelfde oorsprong delen:
--   bureau_subdomein -> {iets}.yudexstudios.com, wij beheren de DNS zelf
--   eigen_domein     -> de klant zet een CNAME; Cloudflare for SaaS regelt
--                       het certificaat via een "custom hostname"
--
-- Bewust GEEN aparte site_domeinen-tabel, zoals eerst geschetst: een klant
-- heeft precies één definitief domein, `klanten.definitief_domein` bestond al
-- en droeg sinds 20260901010000 ook `domein_type`. Twee tabellen die allebei
-- "het domein van deze klant" beweren, is precies hoe ze uit elkaar gaan
-- lopen. Wat hier bijkomt, is enkel de koppelingstoestand.

-- Enkel gevuld bij domein_type = 'eigen_domein'. Een bureau-subdomein valt
-- onder ons eigen wildcard-DNS-record en heeft geen custom hostname nodig.
alter table klanten add column if not exists cloudflare_hostname_id text;

alter table klanten add column if not exists domein_status text
  check (domein_status is null or domein_status in ('in_aanvraag', 'actief', 'mislukt'));

-- De CNAME-instructie die de klant bij zijn eigen registrar moet zetten,
-- zoals Cloudflare ze teruggaf. Hier bewaard zodat je ze kan herhalen zonder
-- de API opnieuw te bevragen — en zodat ze blijft kloppen als de API even
-- onbereikbaar is op het moment dat de klant belt.
alter table klanten add column if not exists domein_verificatie jsonb;

alter table klanten add column if not exists domein_gekoppeld_op timestamptz;

-- track-and-serve zoekt bij élke request op een eigen domein de klant op via
-- de Host-header. De bestaande unieke index staat op lower(definitief_domein)
-- en dekt een gelijkheidszoektocht op de kolom zelf niet; domeinen worden
-- genormaliseerd (kleine letters) opgeslagen, dus deze index doet dat wel.
create index if not exists klanten_definitief_domein_idx
  on klanten (definitief_domein)
  where definitief_domein is not null;

comment on column klanten.cloudflare_hostname_id is
  'ID van het Cloudflare custom hostname. Null bij een bureau-subdomein — dat valt onder ons wildcard-record.';
comment on column klanten.domein_status is
  'in_aanvraag = wacht op de CNAME van de klant en/of het certificaat. Enkel "actief" wordt door track-and-serve bediend.';

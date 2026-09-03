-- Eén plek voor de instellingen die tot nu in bestanden stonden.
--
-- Waarom: de sleutels van dit project lagen verspreid over drie bestanden die
-- niets van elkaar weten — `app/.env.local`, `worker/.env` en de secrets-tabel
-- van Supabase. Dat is precies hoe SHOPIFY_PARTNER_ORGANIZATION_ID drie weken
-- lang in het ene bestand stond en in het andere niet, waardoor elke
-- store-aanmaak-job stierf op regel één. Wie iets wil wijzigen moet nu weten
-- wélk bestand, en dat is kennis die nergens staat.
--
-- Wat hier NIET in hoort, en waarom dat geen vergetelheid is:
-- SUPABASE_URL en SUPABASE_SERVICE_ROLE_KEY. De worker heeft die twee nodig om
-- überhaupt verbinding te maken met deze database — ze hier bewaren zou
-- betekenen dat hij ze moet ophalen uit de plek die hij zonder die waarden niet
-- kan bereiken. Die twee blijven dus lokaal (worker/.env of het
-- instellingenscherm van de verpakte app); de rest komt hiervandaan.
create table if not exists app_instellingen (
  -- De naam van de omgevingsvariabele, exact zoals de code hem leest. Geen
  -- eigen namenschema: dan is er niets te vertalen en kan er niets uit de pas
  -- lopen met wat de worker of een Edge Function verwacht.
  sleutel text primary key,

  waarde text not null default '',

  -- Enkel voor de weergave: een sleutel wordt in het scherm afgeschermd
  -- getoond. Het is geen beveiligingsgrens — wie de rij mag lezen, mag de
  -- waarde lezen — maar het voorkomt dat een API-sleutel meekijkt over je
  -- schouder of in een screenshot belandt.
  geheim boolean not null default false,

  bijgewerkt_op timestamptz not null default now(),
  bijgewerkt_door text
);

alter table app_instellingen enable row level security;

-- Zelfde lijn als de rest van dit project: twee mensen, allebei eigenaar. De
-- afscherming zit erin dat je moet zijn ingelogd, niet in een rollenmodel dat
-- hier niemand heeft.
create policy "authenticated full access" on app_instellingen
  for all to authenticated using (true) with check (true);

comment on table app_instellingen is
  'Centrale instellingen (API-sleutels en configuratie), gelezen door de worker bij het opstarten. SUPABASE_URL en SUPABASE_SERVICE_ROLE_KEY staan hier bewust niet in: die zijn nodig om deze tabel te kunnen lezen.';

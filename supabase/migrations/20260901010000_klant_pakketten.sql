-- Wat een klant bij ons afneemt, vastgelegd op het moment van promoveren.
--
-- Vier opties: aankoop (wij dragen de site over en hosten niet), en drie
-- bundels waarbij wij hosten met een oplopend aantal inbegrepen wijzigingen.
--
-- Bewust GEEN betaalintegratie: de app wordt enkel intern gebruikt, dus dit is
-- administratie om op terug te vallen, geen verkoopkanaal. Om dezelfde reden
-- blokkeert de teller niets — hij telt en toont, jij beslist.

alter table klanten add column if not exists pakket_type text
  check (pakket_type is null or pakket_type in ('aankoop', 'bundel_1', 'bundel_2', 'bundel_3'));

-- null = niet van toepassing (aankoop) of onbeperkt. De echte aantallen per
-- bundel liggen nog niet vast; ze worden per klant ingevuld vanuit de
-- standaardwaarden in app/src/lib/pakketten.ts.
alter table klanten add column if not exists wijzigingen_inbegrepen integer;
alter table klanten add column if not exists wijzigingen_gebruikt_periode integer not null default 0;
alter table klanten add column if not exists periode_gestart_op date;

alter table klanten add column if not exists deal_bedrag numeric(10, 2);
alter table klanten add column if not exists betaalstatus text
  check (betaalstatus is null or betaalstatus in ('voorgesteld', 'akkoord', 'gefactureerd', 'betaald'));
alter table klanten add column if not exists deal_notities text;

-- definitief_domein bestond al; dit zegt WELK soort domein daarin staat.
-- bureau_subdomein = {iets}.yudexstudios.com (wij beheren de DNS zelf),
-- eigen_domein     = de klant zijn eigen domeinnaam, via een CNAME naar ons.
alter table klanten add column if not exists domein_type text
  check (domein_type is null or domein_type in ('bureau_subdomein', 'eigen_domein'));

-- De domeinnaam moet uniek zijn: twee klanten op hetzelfde domein zou betekenen
-- dat een bezoeker niet deterministisch bij de juiste site uitkomt.
create unique index if not exists klanten_definitief_domein_uniek
  on klanten (lower(definitief_domein))
  where definitief_domein is not null;

-- Eén plek voor het ophogen, zodat beide chat-edit-functies (statisch en
-- shopify) niet elk hun eigen versie van "is dit al een klant?" hoeven te
-- hebben. Doet niets als de lead nog geen klant is of geen bundel heeft.
create or replace function tel_klant_wijziging(p_lead_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update klanten
     set wijzigingen_gebruikt_periode = wijzigingen_gebruikt_periode + 1
   where lead_id = p_lead_id
     and pakket_type is not null
     and pakket_type <> 'aankoop';
$$;

comment on function tel_klant_wijziging(uuid) is
  'Telt één verbruikte wijziging voor de klant achter deze lead. Telt niet af en blokkeert niets — de app toont enkel gebruikt/inbegrepen.';

comment on column klanten.pakket_type is
  'aankoop = eigendomsoverdracht, wij hosten niet. bundel_1/2/3 = wij hosten, oplopend aantal inbegrepen wijzigingen.';
comment on column klanten.wijzigingen_gebruikt_periode is
  'Opgehoogd door chat-edit zodra de lead klant is. Handmatig gereset bij een nieuwe periode — er is geen betaalcyclus om op te reageren.';

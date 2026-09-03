-- Waar een inzending van de site naartoe moet.
--
-- Tot nu belandde een contact- of reservatieformulier alleen in
-- `site_inzendingen`, en moest iemand in het dashboard gaan kijken of er iets
-- binnengekomen was. Voor een reservatie is dat het verkeerde model: die is
-- tijdgebonden, en een klant die pas de volgende dag ziet dat er een tafel
-- gevraagd werd, heeft geen reservatiesysteem maar een archief.
--
-- Eén adres per lead, geen lijst: meerdere ontvangers is een mailinglijst
-- maken, en dat kan de klant beter zelf in zijn eigen mailbox regelen met een
-- doorstuurregel. Leeg = niet mailen, alleen bewaren (het gedrag van hiervoor).
alter table leads add column if not exists meldingen_email text;

comment on column leads.meldingen_email is
  'Adres waar inzendingen van de site naartoe gemaild worden. Leeg = enkel bewaren in site_inzendingen.';

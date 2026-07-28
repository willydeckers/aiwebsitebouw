-- An uploaded menu photo is only useful to the generator if its *content* is
-- readable. A logo needs no reading; a photo of a menu card is the entire
-- product list and is currently invisible to the pipeline.
--
-- The transcription is cached here rather than redone per generation: reading
-- an image costs a vision call, and the review loop can regenerate up to five
-- times on one lead.
alter table site_bestanden add column if not exists geextraheerde_tekst text;
alter table site_bestanden add column if not exists tekst_geextraheerd_op timestamptz;

comment on column site_bestanden.geextraheerde_tekst is
  'Letterlijke transcriptie van een geüploade afbeelding (bv. een menukaart), gemaakt door de worker. NULL = nog niet gelezen of niets leesbaars.';

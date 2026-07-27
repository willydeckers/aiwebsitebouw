-- Multi-page sites (spec 3.3, uitgebreid): a version is no longer one HTML
-- file but a folder of them.
--
-- content_referentie keeps pointing at the entry page — now
-- `{lead_id}/{versienummer}/index.html` instead of `{lead_id}/{versienummer}.html`
-- — so every existing reader (track-and-serve, the preview panel, chat-edit,
-- the review loop) still resolves to the home page without a data migration.
-- This column is the manifest of the *other* pages in that same folder.
--
-- Deliberately NOT derived by listing the Storage folder: pre-multi-page
-- versions live as siblings in `{lead_id}/` (1.html, 2.html, ...), so a
-- listing would happily report other versions as "pages" of this one. Null
-- here means "single-page version from before this change" and every reader
-- branches on that explicitly.
alter table site_versions add column if not exists paginas jsonb;

comment on column site_versions.paginas is
  'Meerpagina-manifest: [{"bestand","titel","nav_label"}, ...] in dezelfde map als content_referentie. NULL = oude versie met één HTML-bestand.';

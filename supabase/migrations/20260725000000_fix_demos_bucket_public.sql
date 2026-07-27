-- 20260717020000_demos_storage_bucket.sql's `on conflict (id) do nothing`
-- turned out to be a no-op: the `demos` bucket already existed (created
-- during earlier setup troubleshooting, see CLAUDE.md) with `public: false`,
-- so it was never actually flipped to public as that migration intended.
-- Not a functional break today — the app never reads Storage URLs directly,
-- track-and-serve always serves via the service-role client — but it
-- contradicts this bucket's documented purpose (spec 3.6: demo links must
-- be reachable without authentication), so fix it explicitly rather than
-- leaving deployed state silently disagreeing with the migration history.
update storage.buckets set public = true where id = 'demos';

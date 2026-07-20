-- Minimal automated regression test for spec section 8's two explicit asks
-- ("een basis end-to-end-test... en een test die bevestigt dat
-- RLS-policies effectief blokkeren voor een niet-geauthenticeerde
-- aanvraag") plus the section 9 delivery-checklist items that are
-- meaningfully testable at the database layer alone (job state machine,
-- lead-deletion cascade). The true concurrent-session race-condition
-- checks (budget stop, one-active-job) need two separate connections and
-- are documented as a manual exercise in README.md instead — a single
-- .sql script can't fork two live sessions against itself.
--
-- Run against a throwaway database with the full migration chain +
-- local_supabase_stub.sql already applied (see README.md). Expected
-- results are noted in \echo lines — compare visually, there's no pgTAP
-- here (deliberately, to stay "minimal" per spec section 8).

\set ON_ERROR_STOP off

-- ── RLS: anon fully blocked, authenticated has full access ─────────────
insert into leads (bedrijfsnaam, sector, status) values ('RLS Test BV', 'test', 'nieuw');

\echo '--- anon: expect 0 visible rows, insert/update/delete all no-op or denied ---'
set role anon;
select count(*) as anon_visible_rows from leads; -- expect 0
insert into leads (bedrijfsnaam, sector, status) values ('Anon Insert', 'test', 'nieuw'); -- expect RLS error
update leads set notities = 'hack' where bedrijfsnaam = 'RLS Test BV'; -- expect UPDATE 0
delete from leads where bedrijfsnaam = 'RLS Test BV'; -- expect DELETE 0
reset role;

select bedrijfsnaam, notities from leads where bedrijfsnaam = 'RLS Test BV'; -- expect notities still null

\echo '--- authenticated: expect full access ---'
set role authenticated;
select count(*) as authenticated_visible_rows from leads; -- expect >= 1
update leads set notities = 'legit update' where bedrijfsnaam = 'RLS Test BV'; -- expect UPDATE 1
reset role;

\echo '--- storage.objects (demos bucket, private since the v9 migration): anon blocked ---'
set role anon;
select count(*) as anon_storage_rows from storage.objects where bucket_id = 'demos'; -- expect 0
insert into storage.objects (bucket_id, name) values ('demos', 'anon-write-test.html'); -- expect RLS error
reset role;

-- ── Job state machine: valid transitions succeed, invalid ones are rejected ──
insert into leads (bedrijfsnaam, sector, status) values ('State Machine Test BV', 'test', 'nieuw')
returning id as sm_lead_id \gset

insert into jobs (lead_id, type, status) values (:'sm_lead_id', 'research', 'wachtrij')
returning id as sm_job_id \gset

\echo '--- wachtrij -> bezig (valid) ---'
update jobs set status = 'bezig' where id = :'sm_job_id'; -- expect UPDATE 1

\echo '--- bezig -> wachtrij (invalid: not in the state machine) ---'
update jobs set status = 'wachtrij' where id = :'sm_job_id'; -- expect ERROR

\echo '--- bezig -> timeout (valid: job artificially stuck) ---'
update jobs set status = 'timeout' where id = :'sm_job_id'; -- expect UPDATE 1

\echo '--- timeout -> wachtrij (valid: manual retry, spec section 9) ---'
update jobs set status = 'wachtrij' where id = :'sm_job_id'; -- expect UPDATE 1

-- ── One-active-job-per-(lead,type) partial unique index ─────────────────
\echo '--- duplicate active job for the same (lead, type): expect unique-violation ---'
insert into jobs (lead_id, type, status) values (:'sm_lead_id', 'research', 'wachtrij'); -- expect ERROR (23505)

\echo '--- different type on the same lead: expect success ---'
insert into jobs (lead_id, type, status) values (:'sm_lead_id', 'generatie', 'wachtrij'); -- expect INSERT 1

-- ── site_versions: one concept / one actief per lead ─────────────────────
insert into site_versions (lead_id, site_type, versienummer, status) values (:'sm_lead_id', 'demo', 1, 'concept');
\echo '--- second concept for the same lead: expect unique-violation ---'
insert into site_versions (lead_id, site_type, versienummer, status) values (:'sm_lead_id', 'demo', 2, 'concept'); -- expect ERROR

-- ── Atomic budget check (single-session sanity check; see README.md for the true concurrent version) ──
select * from record_project_kost_if_under_budget(:'sm_lead_id'::uuid, 'research', 'claude-opus-4-8', 1000, 500, 3.0, 'test');
-- expect toegestaan=true, cumulatieve_kost=3.0
select * from record_project_kost_if_under_budget(:'sm_lead_id'::uuid, 'research', 'claude-opus-4-8', 1000, 500, 3.0, 'test');
-- expect toegestaan=false (3.0+3.0=6.0 > 5.0 default budget), cumulatieve_kost still 3.0
select count(*) as project_kosten_rows from project_kosten where lead_id = :'sm_lead_id'; -- expect 1, not 2

-- ── Lead deletion cascade (DB half of spec 9's Storage-opruiming check) ──
insert into review_log (lead_id, bron, resultaat) values (:'sm_lead_id', 'ai', 'goedgekeurd');

select
  (select count(*) from jobs where lead_id = :'sm_lead_id') as jobs_before,
  (select count(*) from site_versions where lead_id = :'sm_lead_id') as versions_before,
  (select count(*) from review_log where lead_id = :'sm_lead_id') as review_log_before,
  (select count(*) from project_kosten where lead_id = :'sm_lead_id') as kosten_before;
-- expect all > 0

delete from leads where id = :'sm_lead_id';

select
  (select count(*) from jobs where lead_id = :'sm_lead_id') as jobs_after,
  (select count(*) from site_versions where lead_id = :'sm_lead_id') as versions_after,
  (select count(*) from review_log where lead_id = :'sm_lead_id') as review_log_after,
  (select count(*) from project_kosten where lead_id = :'sm_lead_id') as kosten_after;
-- expect all 0 (cascade) -- Storage objects themselves are NOT covered by
-- this DB-only test; that half needs cleanup-storage run against a real
-- Storage bucket (see README.md).

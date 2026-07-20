# Security & race-condition regression tests

Minimal, spec-mandated tests (section 8: "minstens een basis
end-to-end-test... en een test die bevestigt dat RLS-policies effectief
blokkeren") that can run against a plain local PostgreSQL instance — no
Docker or Supabase CLI required.

## Running against a throwaway local instance

```sh
# 1. Init + start a throwaway cluster (adjust the PostgreSQL bin path/port
#    for your machine).
initdb -D /tmp/pgtest_data -U postgres --auth=trust --no-locale -E UTF8
pg_ctl -D /tmp/pgtest_data -l /tmp/pgtest_log.txt -o "-p 5544" start

# 2. Create the test DB, apply the Supabase-environment stub, then every
#    migration in order.
createdb -h localhost -p 5544 -U postgres v9test
psql -h localhost -p 5544 -U postgres -d v9test -v ON_ERROR_STOP=1 \
  -f supabase/tests/local_supabase_stub.sql
for f in supabase/migrations/*.sql; do
  psql -h localhost -p 5544 -U postgres -d v9test -v ON_ERROR_STOP=1 -f "$f"
done

# 3. Run the regression test and compare output against the `-- expect...`
#    comments in the file (no pgTAP — deliberately minimal per spec section 8).
psql -h localhost -p 5544 -U postgres -d v9test \
  -f supabase/tests/security_and_race_conditions.sql

# 4. Tear down.
pg_ctl -D /tmp/pgtest_data stop
rm -rf /tmp/pgtest_data /tmp/pgtest_log.txt
```

`local_supabase_stub.sql` only creates enough of `auth`/`storage` and the
`anon`/`authenticated`/`service_role` roles for the migrations' DDL and RLS
policies to mean something — it is **not** a functional Supabase replica
(no real JWT/`auth.uid()`, no Storage API, no PostgREST). Running the same
migrations + test file against a real Supabase project (or the Supabase
CLI's local stack, once Docker is available) is a stronger check and
should be preferred once that's set up.

## What this file does NOT cover

- **Storage cleanup on lead deletion** (spec section 9): the SQL test only
  proves the DB-level `ON DELETE CASCADE` clears every dependent row. The
  Storage-object half needs `cleanup-storage` run against a real bucket —
  create a lead, generate a demo (so it has a Storage object), delete it
  via the UI, and confirm the object is gone from the Supabase Storage
  browser.
- **True concurrent-session race conditions** (spec section 9: "probeer
  bewust twee acties tegelijk te forceren"). A single `.sql` script can't
  fork two live sessions against itself — do this manually with two
  terminals against the same test database:

  ```sh
  # terminal A                          # terminal B (run within ~1s of A)
  psql -h localhost -p 5544 -U postgres -d v9test
  ```
  ```sql
  -- both terminals, same lead_id, run back-to-back:
  begin;
  select pg_sleep(1);
  select * from record_project_kost_if_under_budget(
    '<lead-id>'::uuid, 'research', 'claude-opus-4-8', 1000, 500, 3.0, 'test'
  );
  commit;
  ```
  One session should get `toegestaan=true` (cumulative 3.0), the other
  `toegestaan=false` (3.0+3.0=6.0 exceeds the 5.0 default budget) — and
  `select count(*) from project_kosten where lead_id = '<lead-id>'` should
  come back `1`, never `2`. Same pattern for the one-active-job index:
  both terminals `insert into jobs (lead_id, type, status) values
  ('<lead-id>', 'review', 'wachtrij')` — exactly one should succeed.

  This was run and verified once during the v9 build (both cases behaved
  as described above); re-run it after any change to
  `record_project_kost_if_under_budget` or the `jobs_one_active_per_lead_type_idx`
  index.

- **The application-level E2E path** (lead created in the UI → job
  triggered → status change observed via Realtime in the browser) needs a
  deployed Supabase project + a running app instance; nothing in this
  repo can execute that without one. Playwright is already a dependency
  in both `app/` and `worker/` — once a test Supabase project exists, a
  `app/e2e/critical-path.spec.ts` exercising exactly that path is the
  natural next addition here.

-- A heartbeat, so "nothing is happening" stops being invisible.
--
-- Three shopify_store_aanmaak jobs sat in `wachtrij` for three weeks —
-- 1 Aug, 2 Aug, 21 Aug — never claimed, pogingen=0, gestart_op null, zero log
-- rows. The automation had never run for a millisecond, because no worker
-- process was running. The UI said "in wachtrij", which is true and useless:
-- a queue with nothing behind it looks exactly like a queue that is busy.
--
-- This is not specific to Shopify. Research, generatie and review all moved to
-- the worker, so any of them can hang the same silent way. One row, updated
-- every poll, lets the app say "de worker draait niet" instead of showing a
-- spinner forever.
create table if not exists worker_status (
  -- Single row, enforced: two workers writing their own rows would let a dead
  -- one look alive because a live one exists somewhere.
  id boolean primary key default true check (id),
  laatste_hartslag timestamptz not null default now(),
  gestart_op timestamptz not null default now(),
  -- Which job it is on right now, if any. Handy for "it IS running, it's just
  -- busy with something else" — a real answer to "why is mine not moving".
  huidige_job_id uuid,
  versie text
);

insert into worker_status (id, laatste_hartslag, gestart_op)
values (true, now() - interval '1 day', now() - interval '1 day')
on conflict (id) do nothing;

alter table worker_status enable row level security;
create policy "authenticated read" on worker_status
  for select to authenticated using (true);
-- Only the worker writes, and it uses the service-role key, which bypasses RLS.

comment on table worker_status is
  'Hartslag van de worker. Ouder dan ~60s betekent: er draait er geen, en jobs blijven in de wachtrij staan.';

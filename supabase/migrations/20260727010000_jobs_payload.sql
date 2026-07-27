-- Generation moved from the `generatie` Edge Function to the worker (spec
-- section 2's "zware taken" list, which generation has now joined): a real
-- multi-page site takes several minutes of model output, and an Edge Function
-- invocation is capped well below that — it was killed at ~150s with
-- WORKER_RESOURCE_LIMIT every time, both streaming and not.
--
-- The Edge Function now only enqueues the job, so the one piece of per-run
-- input it used to take as a request body (the "opnieuw genereren met extra
-- instructies" text) has to travel with the job row.
alter table jobs add column if not exists payload jsonb;

comment on column jobs.payload is
  'Per-run invoer voor de worker, bv. {"extraContext": "..."} bij een generatie-job. NULL voor jobs zonder extra invoer.';

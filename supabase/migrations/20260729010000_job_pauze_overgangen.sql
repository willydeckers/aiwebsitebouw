-- The 'wacht_op_mens' status added in the previous migration was rejected by
-- the state-machine trigger, which only knew the transitions that existed
-- before it. Caught by trying the transition rather than assuming a new enum
-- value is enough.
--
-- The four new edges, and why each one:
--   bezig -> wacht_op_mens          the automation hit a CAPTCHA/2FA and stopped
--   wacht_op_mens -> bezig          a human intervened and pressed resume
--   wacht_op_mens -> mislukt        nobody intervened, or it stalled again
--   wacht_op_mens -> geannuleerd    abandoned on purpose
--
-- Note what is deliberately NOT allowed: wachtrij -> wacht_op_mens. A job that
-- was never picked up cannot be waiting on a person, and permitting it would
-- let a queued job masquerade as one needing attention.
create or replace function enforce_job_status_transition()
returns trigger as $$
begin
  if TG_OP = 'UPDATE' and OLD.status is distinct from NEW.status then
    if not (
      (OLD.status = 'wachtrij' and NEW.status in ('bezig', 'geannuleerd')) or
      (OLD.status = 'bezig' and NEW.status in ('klaar', 'timeout', 'mislukt', 'geannuleerd', 'wacht_op_mens')) or
      (OLD.status = 'wacht_op_mens' and NEW.status in ('bezig', 'mislukt', 'geannuleerd', 'timeout')) or
      (OLD.status = 'timeout' and NEW.status = 'wachtrij') or
      (OLD.status = 'mislukt' and NEW.status = 'wachtrij')
    ) then
      raise exception 'Ongeldige job-statusovergang: % -> %', OLD.status, NEW.status;
    end if;
  end if;
  return NEW;
end;
$$ language plpgsql;

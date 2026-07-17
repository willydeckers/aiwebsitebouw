-- Research-step output (spec section 3.2) needs to persist so both the
-- generator and the reviewer can read it later in the pipeline — not
-- listed explicitly in spec section 5's core datamodel, but required by
-- the "output goes to two places" requirement in section 3.2.
alter table leads add column research_output jsonb;

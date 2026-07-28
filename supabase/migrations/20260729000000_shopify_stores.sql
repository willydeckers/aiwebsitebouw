-- Shopify store creation + token acquisition.
--
-- Two platform facts shape this whole design, both verified rather than
-- assumed (see worker/scripts/partner-api-status.ts and the notes in
-- worker/src/shared/shopify-token.ts):
--
-- 1. There is no API to create a store. The Partner API's entire mutation set
--    on 2026-01 is `appCreditCreate`. Store creation is therefore driven
--    through the Partner Dashboard UI by Playwright — hence the job type and
--    the paused status below, which exist so a human can step in at a CAPTCHA.
--
-- 2. Tokens are NOT long-lived per-store secrets. Custom apps can no longer be
--    created at all (Shopify removed this on 2026-01-01). The supported route
--    is one Dev Dashboard app owned by the agency, installed per store, with
--    tokens minted on demand via the client credentials grant. Those tokens
--    expire after 24 hours.
--
--    That last point inverts the obvious schema: the durable secret is the
--    app's client_secret (one, in env), and what's stored per store is a
--    short-lived cached token. A leaked row is worthless within a day, which
--    is strictly better than a permanent per-store credential.

-- ─────────────────────────────────────────────────────────────────────────
-- 1. New job type + a status for "waiting for a human"
-- ─────────────────────────────────────────────────────────────────────────
alter type job_type_v9 add value if not exists 'shopify_store_aanmaak';

-- The UI automation stops rather than fails when it meets a CAPTCHA, 2FA or an
-- unrecognised page. "mislukt" would be wrong (nothing is broken) and leaving
-- it on "bezig" would be a lie (nothing is progressing).
alter type job_status_v9 add value if not exists 'wacht_op_mens';

-- ─────────────────────────────────────────────────────────────────────────
-- 2. shopify_stores — one row per store the agency controls
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists shopify_stores (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references leads (id) on delete cascade,

  -- e.g. "mijn-winkel.myshopify.com". Unique because a store belongs to one
  -- lead; two leads pointing at the same shop would race each other's themes.
  shop_domein text not null unique,
  store_naam text,

  -- Set once the Dev Dashboard app has been installed on this store, which is
  -- what makes the client credentials grant work for it. Until then there is
  -- no way to get a token and the rest of the pipeline must not try.
  app_geinstalleerd boolean not null default false,

  -- Cached client-credentials token. AES-GCM encrypted with the same scheme as
  -- gmail_koppeling.refresh_token — never a plaintext token at rest.
  toegang_token bytea,
  toegang_token_verloopt_op timestamptz,
  toegang_scopes text,

  status text not null default 'aangemaakt'
    check (status in ('aangemaakt', 'app_geinstalleerd', 'klaar', 'mislukt')),
  fout_melding text,

  aangemaakt_op timestamptz not null default now(),
  aangemaakt_door text
);

create index if not exists shopify_stores_lead_id_idx on shopify_stores (lead_id);

alter table shopify_stores enable row level security;
create policy "authenticated full access" on shopify_stores
  for all to authenticated using (true) with check (true);

comment on column shopify_stores.toegang_token is
  'Versleutelde, kortlevende client-credentials-token (24u). NIET het duurzame geheim — dat is de client_secret van de Dev Dashboard-app, en die staat in de omgeving.';

-- ─────────────────────────────────────────────────────────────────────────
-- 3. Step log for the UI automation
-- ─────────────────────────────────────────────────────────────────────────
-- Browser automation against someone else's UI breaks in ways an API never
-- does: a renamed field, an extra consent screen, a slow page. Without a
-- per-step record, "het werkte niet" means rewatching a session that is
-- already over. Each row says which step, which selector, what happened.
create table if not exists shopify_automatisering_log (
  id uuid primary key default gen_random_uuid(),
  job_id uuid references jobs (id) on delete cascade,
  lead_id uuid references leads (id) on delete cascade,
  stap text not null,
  selector text,
  resultaat text not null check (resultaat in ('ok', 'overgeslagen', 'mislukt', 'wacht_op_mens')),
  detail text,
  schermafbeelding_pad text,
  "timestamp" timestamptz not null default now()
);

create index if not exists shopify_automatisering_log_job_idx
  on shopify_automatisering_log (job_id, "timestamp");

alter table shopify_automatisering_log enable row level security;
create policy "authenticated full access" on shopify_automatisering_log
  for all to authenticated using (true) with check (true);

-- ─────────────────────────────────────────────────────────────────────────
-- 4. The existing plaintext Shopify token column
-- ─────────────────────────────────────────────────────────────────────────
-- klanten.shopify_access_token has been a plaintext `text` column since the
-- first schema, while the Gmail refresh token next to it was always encrypted.
-- Nothing has ever written a real value to it (there has never been a live
-- store), so this drops it rather than migrating ciphertext: shopify_stores is
-- now the single place a token lives, and leaving a second, unencrypted home
-- for the same secret is how one of them quietly gets used.
alter table klanten drop column if exists shopify_access_token;

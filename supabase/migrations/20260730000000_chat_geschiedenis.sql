-- Chat history that survives closing the panel.
--
-- Until now the chat lived in React state: close the lead, lose the
-- conversation. That's wrong for two reasons beyond the obvious annoyance.
-- First, two people work in this dashboard — if Garen asks for a change,
-- Warre has no way to see that it was asked, let alone by whom. Second, the
-- instructions given to a site ARE part of its history; review_log records
-- what the AI decided, but not the back-and-forth that led there.
--
-- Note this is a superset of what review_log's 'chat-edit' rows hold. Those
-- stay: review_log is the per-version audit trail (what was applied, with
-- which prompt version), while this is the conversation. Merging them would
-- mean either losing the audit shape or storing UI state in an audit table.
create table if not exists chat_berichten (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references leads (id) on delete cascade,

  -- Who is speaking. 'gebruiker' carries the actual address in `afzender`, so
  -- "Garen vroeg dit" is answerable months later; 'ai' is the assistant's
  -- reply; 'systeem' is the app itself reporting what it did (a file was
  -- uploaded, a regeneration was queued).
  rol text not null check (rol in ('gebruiker', 'ai', 'systeem')),
  afzender text,

  bericht text not null,

  -- Which version the message was about, so history stays readable after a
  -- regeneration replaces the content it referred to.
  site_version_id uuid references site_versions (id) on delete set null,

  -- Was this a targeted patch or a full regeneration? Kept because the two
  -- have very different consequences and the transcript should show which.
  soort text not null default 'chat'
    check (soort in ('chat', 'patch', 'regeneratie', 'upload')),

  aangemaakt_op timestamptz not null default now()
);

create index if not exists chat_berichten_lead_idx
  on chat_berichten (lead_id, aangemaakt_op);

alter table chat_berichten enable row level security;
create policy "authenticated full access" on chat_berichten
  for all to authenticated using (true) with check (true);

comment on table chat_berichten is
  'Gespreksgeschiedenis per lead. Blijft bewaard over sessies en gebruikers heen; review_log blijft het audit-spoor per versie.';

alter table leads add column if not exists ai_model text
  check (ai_model is null or ai_model in ('claude-opus-4-8', 'claude-sonnet-5', 'claude-fable-5'));

comment on column leads.ai_model is
  'Optionele per-lead model-override voor research/generatie/review/chat-edit. NULL = val terug op MODEL_KWALITEIT. Fable wordt voor research/review/chat-edit teruggeschaald naar Opus — zie resolveModel().';

-- Chat-based bewerken (spec 3.5) never surfaced what the AI actually said —
-- chat-edit-static/-shopify only logged the user's own instruction, never
-- the model's reply. If the model asks a clarifying question instead of
-- editing (a real possibility: MAX_TOOL_ITERATIONS breaks the loop on any
-- non-tool_use turn), the UI still reported "toegepast" as if a change had
-- been made, with the model's actual question nowhere to be seen — exactly
-- the "ik zie niets gebeuren" gap reported in testing.
alter table review_log add column ai_antwoord text;

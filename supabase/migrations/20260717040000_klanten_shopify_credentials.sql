-- Shopify Admin API access for a converted shopify-klant (needed by the
-- chat-based editor, spec section 3.5/3.9). Not in spec section 5's core
-- datamodel — same kind of gap as research_output/review_notitie. Obtaining
-- these (installing a custom app on the dev store, or completing the OAuth
-- grant) is a manual setup step, same as the Shopify Partner credentials
-- documented in supabase/README.md.
alter table klanten add column shopify_domain text;
alter table klanten add column shopify_access_token text;

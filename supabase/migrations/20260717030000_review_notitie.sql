-- Review-loop output (spec section 3.4): "automatische review-notities
-- zichtbaar" in the demo-preview screen (section 4.5). Same kind of gap as
-- research_output — not in section 5's core datamodel, but required to
-- persist and display the review-loop's structured feedback.
alter table leads add column review_notitie jsonb;

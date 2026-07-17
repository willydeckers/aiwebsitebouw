-- Storage for generated static demo sites (spec section 3.3: "Koude demo").
-- Public bucket: demo links are sent to leads by email (section 3.6), so the
-- generated HTML must be reachable without authentication.
insert into storage.buckets (id, name, public)
values ('demos', 'demos', true)
on conflict (id) do nothing;

-- Only authenticated (Warre/Garen) sessions can write; anyone can read the
-- generated demo files, matching the bucket's public purpose.
create policy "authenticated can write demos" on storage.objects
  for all to authenticated
  using (bucket_id = 'demos')
  with check (bucket_id = 'demos');

create policy "public can read demos" on storage.objects
  for select to anon
  using (bucket_id = 'demos');

insert into storage.buckets (id, name, public)
values ('desktop-app', 'desktop-app', true)
on conflict (id) do update set public = true;

-- Public read
drop policy if exists "desktop-app public read" on storage.objects;
create policy "desktop-app public read"
on storage.objects for select
to public
using (bucket_id = 'desktop-app');

-- Allow anon/auth uploads to this bucket (needed for Lovable agent upload).
drop policy if exists "desktop-app upload" on storage.objects;
create policy "desktop-app upload"
on storage.objects for insert
to public
with check (bucket_id = 'desktop-app');

drop policy if exists "desktop-app update" on storage.objects;
create policy "desktop-app update"
on storage.objects for update
to public
using (bucket_id = 'desktop-app')
with check (bucket_id = 'desktop-app');

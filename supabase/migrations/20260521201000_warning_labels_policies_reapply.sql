-- Re-apply RLS policies for the warning-labels storage bucket so any
-- signed-in user can upload/replace the shared warning label PDFs.
drop policy if exists "warning-labels public read" on storage.objects;
create policy "warning-labels public read"
on storage.objects for select
to public
using (bucket_id = 'warning-labels');

drop policy if exists "warning-labels auth upload" on storage.objects;
create policy "warning-labels auth upload"
on storage.objects for insert
to authenticated
with check (bucket_id = 'warning-labels');

drop policy if exists "warning-labels auth update" on storage.objects;
create policy "warning-labels auth update"
on storage.objects for update
to authenticated
using (bucket_id = 'warning-labels')
with check (bucket_id = 'warning-labels');

drop policy if exists "warning-labels auth delete" on storage.objects;
create policy "warning-labels auth delete"
on storage.objects for delete
to authenticated
using (bucket_id = 'warning-labels');

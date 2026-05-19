-- Ensure the warning-labels storage bucket exists.
insert into storage.buckets (id, name, public)
values ('warning-labels', 'warning-labels', true)
on conflict (id) do update set public = true;

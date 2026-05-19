insert into storage.buckets (id, name, public)
values ('desktop-app', 'desktop-app', true)
on conflict (id) do update set public = true;

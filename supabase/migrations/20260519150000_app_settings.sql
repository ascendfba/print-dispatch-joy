-- Global app-wide key/value settings shared across all authenticated users.
create table if not exists public.app_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.app_settings enable row level security;

do $$
declare p record;
begin
  for p in
    select policyname from pg_policies
    where schemaname = 'public' and tablename = 'app_settings'
  loop
    execute format('drop policy if exists %I on public.app_settings', p.policyname);
  end loop;
end $$;

create policy "authenticated read app_settings"
  on public.app_settings for select to authenticated using (true);
create policy "authenticated insert app_settings"
  on public.app_settings for insert to authenticated with check (true);
create policy "authenticated update app_settings"
  on public.app_settings for update to authenticated using (true) with check (true);

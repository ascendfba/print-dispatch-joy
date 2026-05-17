create table if not exists public.dev_apps (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null default 'Untitled',
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{0,62}$'),
  html text not null default '',
  is_published boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists dev_apps_user_id_idx on public.dev_apps(user_id);
create index if not exists dev_apps_published_idx on public.dev_apps(is_published) where is_published;
alter table public.dev_apps enable row level security;
create policy "owners manage own dev_apps" on public.dev_apps for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "anyone reads published dev_apps" on public.dev_apps for select to anon, authenticated using (is_published = true);
create or replace function public.dev_apps_set_updated_at() returns trigger language plpgsql as \$\$
begin new.updated_at = now(); return new; end;
\$\$;
drop trigger if exists dev_apps_updated_at on public.dev_apps;
create trigger dev_apps_updated_at before update on public.dev_apps for each row execute function public.dev_apps_set_updated_at();

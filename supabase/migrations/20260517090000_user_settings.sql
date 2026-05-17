create table if not exists public.user_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  mintsoft_base_url text not null default 'https://api.mintsoft.co.uk',
  mintsoft_username text not null default '',
  mintsoft_password text not null default '',
  mintsoft_api_key text not null default '',
  printers jsonb not null default '{"small":"","large":"","other":""}'::jsonb,
  silent_print boolean not null default true,
  rework_client_id text not null default '',
  rework_map jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.user_settings enable row level security;
create policy "owners manage own settings" on public.user_settings
  for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

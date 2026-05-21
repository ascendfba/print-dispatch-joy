-- Mintsoft product cache + hourly sync via pg_cron

create extension if not exists pg_cron;
create extension if not exists pg_net;

create table if not exists public.mintsoft_products (
  id bigint primary key,
  sku text,
  name text,
  description text,
  image_url text,
  ean text,
  upc text,
  client_id integer,
  stock_level numeric not null default 0,
  allocated numeric not null default 0,
  on_hand numeric not null default 0,
  raw jsonb,
  updated_at timestamptz not null default now()
);
create index if not exists mintsoft_products_client_idx on public.mintsoft_products(client_id);
create index if not exists mintsoft_products_sku_idx on public.mintsoft_products(sku);
create index if not exists mintsoft_products_instock_idx
  on public.mintsoft_products(client_id)
  where stock_level > 0 or allocated > 0 or on_hand > 0;

alter table public.mintsoft_products enable row level security;
drop policy if exists "auth read mintsoft_products" on public.mintsoft_products;
create policy "auth read mintsoft_products"
  on public.mintsoft_products for select to authenticated using (true);

create table if not exists public.mintsoft_clients (
  id bigint primary key,
  name text,
  short_name text,
  brand_name text,
  updated_at timestamptz not null default now()
);
alter table public.mintsoft_clients enable row level security;
drop policy if exists "auth read mintsoft_clients" on public.mintsoft_clients;
create policy "auth read mintsoft_clients"
  on public.mintsoft_clients for select to authenticated using (true);

create table if not exists public.mintsoft_sync_state (
  id text primary key,
  last_run_at timestamptz,
  last_success_at timestamptz,
  last_status text,
  last_error text,
  product_count integer,
  duration_ms integer
);
alter table public.mintsoft_sync_state enable row level security;
drop policy if exists "auth read mintsoft_sync_state" on public.mintsoft_sync_state;
create policy "auth read mintsoft_sync_state"
  on public.mintsoft_sync_state for select to authenticated using (true);

insert into public.mintsoft_sync_state (id) values ('products')
  on conflict (id) do nothing;

-- Generate and store a cron secret in Supabase Vault (idempotent).
do $$
begin
  if not exists (select 1 from vault.secrets where name = 'mintsoft_cron_secret') then
    perform vault.create_secret(gen_random_uuid()::text, 'mintsoft_cron_secret');
  end if;
end $$;

-- RPC for the server to read the cron secret for header comparison.
create or replace function public.get_mintsoft_cron_secret()
returns text
language sql
security definer
set search_path = public, vault
as $$
  select decrypted_secret from vault.decrypted_secrets where name = 'mintsoft_cron_secret' limit 1;
$$;
revoke all on function public.get_mintsoft_cron_secret() from public, anon, authenticated;
grant execute on function public.get_mintsoft_cron_secret() to service_role;

-- Unschedule previous version if present, then schedule hourly sync.
do $$
declare
  jid bigint;
begin
  select j.jobid into jid from cron.job j where j.jobname = 'sync-mintsoft-hourly';
  if jid is not null then
    perform cron.unschedule(jid);
  end if;
end $$;

select cron.schedule(
  'sync-mintsoft-hourly',
  '7 * * * *',
  $cron$
  select net.http_post(
    url := 'https://print-dispatch-joy.lovable.app/api/public/cron/sync-mintsoft',
    headers := jsonb_build_object(
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'mintsoft_cron_secret'),
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 300000
  );
  $cron$
);

notify pgrst, 'reload schema';

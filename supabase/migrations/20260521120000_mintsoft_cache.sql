-- Mintsoft product cache (tables only - cron scheduled in separate migration)

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

notify pgrst, 'reload schema';

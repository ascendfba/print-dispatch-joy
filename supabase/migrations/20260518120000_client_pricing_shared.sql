-- Make client pricing shared across all authenticated users.
-- Any signed-in user can read and edit the single global pricing table.

create table if not exists public.client_pricing (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  client_id text not null,
  client_name text,
  rate_code text not null,
  rate_per_unit numeric not null,
  updated_at timestamptz not null default now()
);

-- Drop any prior per-user policies.
do $$
declare p record;
begin
  for p in
    select policyname from pg_policies
    where schemaname = 'public' and tablename = 'client_pricing'
  loop
    execute format('drop policy if exists %I on public.client_pricing', p.policyname);
  end loop;
end $$;

alter table public.client_pricing enable row level security;

-- Allow user_id to be null for global rows.
alter table public.client_pricing alter column user_id drop not null;

-- Deduplicate: keep newest row per (client_id, rate_code).
delete from public.client_pricing a
using public.client_pricing b
where a.client_id = b.client_id
  and a.rate_code = b.rate_code
  and a.ctid < b.ctid;

-- Enforce one row per service-per-client globally.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'client_pricing_client_rate_unique'
  ) then
    alter table public.client_pricing
      add constraint client_pricing_client_rate_unique
      unique (client_id, rate_code);
  end if;
end $$;

-- Shared read/write for any authenticated user.
create policy "authenticated read client_pricing"
  on public.client_pricing for select to authenticated using (true);
create policy "authenticated insert client_pricing"
  on public.client_pricing for insert to authenticated with check (true);
create policy "authenticated update client_pricing"
  on public.client_pricing for update to authenticated using (true) with check (true);
create policy "authenticated delete client_pricing"
  on public.client_pricing for delete to authenticated using (true);

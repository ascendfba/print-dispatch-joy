create table if not exists public.print_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  printer text not null,
  kind text,
  label text,
  order_id text,
  byte_size integer,
  status text not null check (status in ('success','error')),
  error text,
  source text not null default 'web' check (source in ('web','desktop'))
);

grant select, insert, update, delete on public.print_history to authenticated;
grant all on public.print_history to service_role;

create index if not exists print_history_user_created_idx
  on public.print_history (user_id, created_at desc);

alter table public.print_history enable row level security;

drop policy if exists "Users can read own print history" on public.print_history;
create policy "Users can read own print history"
  on public.print_history for select to authenticated
  using (auth.uid() = user_id);

drop policy if exists "Users can insert own print history" on public.print_history;
create policy "Users can insert own print history"
  on public.print_history for insert to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "Users can delete own print history" on public.print_history;
create policy "Users can delete own print history"
  on public.print_history for delete to authenticated
  using (auth.uid() = user_id);

notify pgrst, 'reload schema';

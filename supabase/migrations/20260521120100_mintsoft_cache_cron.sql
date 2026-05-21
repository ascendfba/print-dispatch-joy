-- Schedule hourly Mintsoft sync. Wrapped in DO blocks so failures in any
-- single step don't roll back the whole migration.

do $outer$
begin
  create extension if not exists pg_cron;
  create extension if not exists pg_net;
exception when others then
  raise notice 'extension setup failed: %', sqlerrm;
end;
$outer$;

do $outer$
begin
  if not exists (select 1 from vault.secrets where name = 'mintsoft_cron_secret') then
    perform vault.create_secret(gen_random_uuid()::text, 'mintsoft_cron_secret');
  end if;
exception when others then
  raise notice 'vault secret setup failed: %', sqlerrm;
end;
$outer$;

create or replace function public.get_mintsoft_cron_secret()
returns text
language sql
security definer
set search_path = public, vault
as $fn$
  select decrypted_secret from vault.decrypted_secrets where name = 'mintsoft_cron_secret' limit 1;
$fn$;
revoke all on function public.get_mintsoft_cron_secret() from public, anon, authenticated;
grant execute on function public.get_mintsoft_cron_secret() to service_role;

do $outer$
declare
  jid bigint;
begin
  select j.jobid into jid from cron.job j where j.jobname = 'sync-mintsoft-hourly';
  if jid is not null then
    perform cron.unschedule(jid);
  end if;
  perform cron.schedule(
    'sync-mintsoft-hourly',
    '7 * * * *',
    $job$
    select net.http_post(
      url := 'https://print-dispatch-joy.lovable.app/api/public/cron/sync-mintsoft',
      headers := jsonb_build_object(
        'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'mintsoft_cron_secret'),
        'Content-Type', 'application/json'
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 300000
    );
    $job$
  );
exception when others then
  raise notice 'cron schedule failed: %', sqlerrm;
end;
$outer$;

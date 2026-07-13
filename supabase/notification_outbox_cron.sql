-- Reprocessa emails transacionais que falharam na tentativa imediata.
-- Requer no Vault o secret notification_worker_secret, igual ao secret
-- NOTIFICATION_WORKER_SECRET configurado na Edge Function.
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;
create extension if not exists supabase_vault with schema vault;

do $$
begin
  perform cron.unschedule(jobid)
  from cron.job
  where jobname = 'assego-process-notification-outbox';

  perform cron.schedule(
    'assego-process-notification-outbox',
    '*/5 * * * *',
    $cron$
      select net.http_post(
        url := 'https://nqjaxsehplhbusrleuhd.supabase.co/functions/v1/process-notification-outbox',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'x-cron-secret', (
            select decrypted_secret
            from vault.decrypted_secrets
            where name = 'notification_worker_secret'
            limit 1
          )
        ),
        body := '{"batchSize":10}'::jsonb,
        timeout_milliseconds := 55000
      );
    $cron$
  );
end;
$$;

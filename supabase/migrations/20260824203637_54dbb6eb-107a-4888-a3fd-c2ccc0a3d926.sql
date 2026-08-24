
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

SELECT vault.create_secret(encode(gen_random_bytes(32), 'hex'), 'voyara_cron_secret', 'Bearer token for the daily pending-review reminder job');

SELECT cron.schedule(
  'voyara-daily-pending-review-reminders',
  '0 8 * * *',
  $$
  SELECT net.http_post(
    url := 'https://project--eef14d9d-02ef-4a76-99eb-00bb83f1c583.lovable.app/api/public/cron/pending-reviews',
    headers := jsonb_build_object(
      'content-type', 'application/json',
      'authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'voyara_cron_secret')
    ),
    body := '{}'::jsonb
  );
  $$
);

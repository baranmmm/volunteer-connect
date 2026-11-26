-- The remaining scheduled jobs move to pg_cron, so they no longer depend on the GitHub workflows (which stay as
-- manual fallbacks). What the "Task reminders" workflow did is now all in the database or the outbox tick:
-- run_notification_digest ('notification-digest') and run_task_reminders ('task-reminders') already have pg_cron jobs,
-- emails and pushes are sent by the outbox tick ('outbox-flush', 20261213090000), and event reminders get their own
-- job here. The Recycle Bin cleanup has to delete Storage files through the app, so pg_cron calls its route.
-- * public.post_scheduled_route(path, timeout_ms): POSTs <Vault app_url><path> with "Authorization: Bearer <Vault
--   scheduled_jobs_secret>" through pg_net (asynchronous; answers land in net._http_response). Only paths under
--   /api/public/. Returns the pg_net request id, or NULL when a secret is missing or the call fails. Never raises,
--   never logs the secret. No grant to anyone (pg_cron runs it as the job owner).
-- * public.recycle_bin_cleanup_tick(): calls /api/public/cleanup-deleted-events (5 minute timeout). No grant.
-- * cron job 'event-reminders' at :20 past 07, 08, 09, 13 and 18 UTC: enqueue_event_reminders() directly (idempotent:
--   one reminder per registration and start date; the outbox tick sends them).
-- * cron job 'recycle-bin-cleanup' at 03:30 UTC: recycle_bin_cleanup_tick() (the "Cleanup Recycle Bin" schedule).
-- Jobs are created where pg_cron is available (Supabase); skipped with a NOTICE elsewhere (PGlite).
-- Additive: two new functions and two cron jobs; no table or existing data is changed by the migration itself.

CREATE FUNCTION public.post_scheduled_route(_path text, _timeout_ms integer DEFAULT 25000) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE _secret text; _url text; _id bigint;
BEGIN
  IF _path IS NULL OR _path !~ '^/api/public/[a-z0-9-]+$' THEN RETURN NULL; END IF;
  SELECT s.decrypted_secret INTO _secret FROM vault.decrypted_secrets s WHERE s.name = 'scheduled_jobs_secret' LIMIT 1;
  SELECT s.decrypted_secret INTO _url FROM vault.decrypted_secrets s WHERE s.name = 'app_url' LIMIT 1;
  IF coalesce(btrim(_secret), '') = '' OR coalesce(btrim(_url), '') = '' THEN RETURN NULL; END IF;
  SELECT net.http_post(
    url := rtrim(btrim(_url), '/') || _path,
    body := '{}'::jsonb,
    headers := jsonb_build_object('Authorization', 'Bearer ' || btrim(_secret), 'Content-Type', 'application/json'),
    timeout_milliseconds := greatest(coalesce(_timeout_ms, 25000), 1000)) INTO _id;
  RETURN _id;
EXCEPTION WHEN OTHERS THEN
  -- Never the secret: only the error text of the failing call.
  RAISE NOTICE 'post_scheduled_route % skipped: %', _path, SQLERRM;
  RETURN NULL;
END $$;

CREATE FUNCTION public.recycle_bin_cleanup_tick() RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  SELECT public.post_scheduled_route('/api/public/cleanup-deleted-events', 300000);
$$;

REVOKE ALL ON FUNCTION public.post_scheduled_route(text, integer), public.recycle_bin_cleanup_tick()
  FROM PUBLIC, anon, authenticated;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'pg_cron') THEN
    CREATE EXTENSION IF NOT EXISTS pg_cron;
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'event-reminders') THEN
      PERFORM cron.unschedule('event-reminders');
    END IF;
    PERFORM cron.schedule('event-reminders', '20 7,8,9,13,18 * * *', 'SELECT public.enqueue_event_reminders()');
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'recycle-bin-cleanup') THEN
      PERFORM cron.unschedule('recycle-bin-cleanup');
    END IF;
    PERFORM cron.schedule('recycle-bin-cleanup', '30 3 * * *', 'SELECT public.recycle_bin_cleanup_tick()');
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pg_cron not available: event reminders and the Recycle Bin cleanup run from the GitHub workflows: %', SQLERRM;
END $$;

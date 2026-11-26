-- The outbox tick: every minute pg_cron asks the app to send what is waiting (push notifications, and the email outbox
-- for every priority within the daily limit), so delivery never depends on a member action or the GitHub workflows.
-- * public.outbox_flush_due(): whether there is due work: a pending push (not_before passed) or a push claim older than
--   5 minutes; a pending email (not_before passed) while the London day's limit has room, or an email claim older
--   than 15 minutes (the claim functions give those back). Service role only.
-- * public.outbox_flush_tick(): when work is due and the Vault secrets 'scheduled_jobs_secret' and 'app_url' exist,
--   POSTs <app_url>/api/public/outbox-flush with "Authorization: Bearer <secret>" through pg_net (asynchronous: the
--   tick returns at once; the answers land in net._http_response). Otherwise it does nothing. Never raises. No grant
--   to anyone (pg_cron runs it as the job owner).
-- * cron job 'outbox-flush' every minute, where pg_cron is available (Supabase); skipped with a NOTICE elsewhere
--   (PGlite). pg_net is enabled where available. No secret values here: docs/push.md "Production setup".
-- Additive: two new functions and a cron job; no table or existing data is changed.

CREATE FUNCTION public.outbox_flush_due() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (SELECT 1 FROM public.push_outbox o
      WHERE o.status = 'pending' AND coalesce(o.not_before, '-infinity'::timestamptz) <= now())
    OR EXISTS (SELECT 1 FROM public.push_outbox o
      WHERE o.status = 'sending' AND o.claimed_at < now() - interval '5 minutes')
    OR EXISTS (SELECT 1 FROM public.email_outbox o
      WHERE o.status = 'sending' AND o.claimed_at < now() - interval '15 minutes')
    OR (EXISTS (SELECT 1 FROM public.email_outbox o
          WHERE o.status = 'pending' AND coalesce(o.not_before, '-infinity'::timestamptz) <= now())
        AND (SELECT count(*) FROM public.email_outbox o
          WHERE (o.status = 'sent' AND o.sent_at >= (((now() AT TIME ZONE 'Europe/London')::date)::timestamp AT TIME ZONE 'Europe/London'))
             OR o.status = 'sending') < public.email_daily_limit())
$$;

CREATE FUNCTION public.outbox_flush_tick() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE _secret text; _url text;
BEGIN
  IF NOT public.outbox_flush_due() THEN RETURN; END IF;
  SELECT s.decrypted_secret INTO _secret FROM vault.decrypted_secrets s WHERE s.name = 'scheduled_jobs_secret' LIMIT 1;
  SELECT s.decrypted_secret INTO _url FROM vault.decrypted_secrets s WHERE s.name = 'app_url' LIMIT 1;
  IF coalesce(btrim(_secret), '') = '' OR coalesce(btrim(_url), '') = '' THEN RETURN; END IF;
  PERFORM net.http_post(
    url := rtrim(btrim(_url), '/') || '/api/public/outbox-flush',
    body := '{}'::jsonb,
    headers := jsonb_build_object('Authorization', 'Bearer ' || btrim(_secret), 'Content-Type', 'application/json'),
    timeout_milliseconds := 25000);
EXCEPTION WHEN OTHERS THEN
  -- Never the secret: only the error text of the failing call.
  RAISE NOTICE 'outbox_flush_tick skipped: %', SQLERRM;
END $$;

REVOKE ALL ON FUNCTION public.outbox_flush_due(), public.outbox_flush_tick() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.outbox_flush_due() TO service_role;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'pg_net') THEN
    CREATE EXTENSION IF NOT EXISTS pg_net;
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pg_net not available: the outbox tick cannot call the app: %', SQLERRM;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'pg_cron') THEN
    CREATE EXTENSION IF NOT EXISTS pg_cron;
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'outbox-flush') THEN
      PERFORM cron.unschedule('outbox-flush');
    END IF;
    PERFORM cron.schedule('outbox-flush', '* * * * *', 'SELECT public.outbox_flush_tick()');
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pg_cron not available: outbox sending runs after member actions and from the task-reminders route: %', SQLERRM;
END $$;

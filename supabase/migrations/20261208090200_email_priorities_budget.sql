-- Email sending order, a reserve for Supabase Auth emails, mentions emailed at once, and an in-app warning at 250 emails
-- a day (approved by the user, 2026-11-26). On top of 20261208090100.
--
-- * Mentions (task_note_mention): one email at once (template 'notice'), like assignments, meeting invitations and
--   requests waiting for review; switchable off per person (type 'mention'). They leave the daily summary.
-- * Priorities (email_priority; lower number goes first, oldest first within one):
--     1 transactional: guest and subscriber confirmations, registration confirmations, event updates and cancellations
--     2 immediate notice emails (notice)
--     3 reminders: task_reminder and event_reminder (event reminders are queued two days ahead, so a delay of a run or a
--       day still reaches people before the event; they stay ahead of announcements and summaries)
--     4 announcements (event_announcement)
--     5 the daily summary (daily_digest), lowest: it may slip to the next day
--   The priority column allows 1-5 now; pending rows are re-ranked.
-- * Reserve: Supabase Auth (sign-up confirmation, password reset) sends through the same Brevo account and the same
--   300 a day, and the app never blocks it: the app stops at email_daily_limit() = 280 a London day, leaving 20 for Auth.
--   The one place to change: email_daily_limit() (and email_provider_daily_limit() = 300 for the warning text).
-- * Warning: when the app has sent email_budget_warning_at() = 250 emails in a London day, every active National
--   Coordinator and Branch Manager gets one in-app notice 'email_budget_warning' (entity_type 'email_budget'), once per
--   person and London day; always on, never emailed. Regional Directors and volunteers do not (they manage no email
--   plan; Branch Managers see the effect on their branch's events first). The day's notice itself is the log (no
--   table); a transaction-level advisory lock keeps concurrent sends from warning twice. Test captures (sent_at NULL,
--   20261130090400) are not counted.
-- Schema: the email_outbox priority check (1-5) and the notifications entity_type check (+ 'email_budget'); data: the
-- priority of pending outbox rows is recomputed. Functions replaced with the same signatures and grants; one trigger
-- added.

ALTER TABLE public.email_outbox DROP CONSTRAINT IF EXISTS email_outbox_priority_check;
ALTER TABLE public.email_outbox ADD CONSTRAINT email_outbox_priority_check CHECK (priority BETWEEN 1 AND 5);

ALTER TABLE public.notifications DROP CONSTRAINT notifications_entity_type_check;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_entity_type_check
  CHECK (entity_type IN ('task', 'meeting', 'task_request', 'meeting_request', 'review', 'digest', 'volunteer_application',
    'email_budget'));

CREATE OR REPLACE FUNCTION public.email_priority(_template text) RETURNS smallint
LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT (CASE
    WHEN _template = 'notice' THEN 2
    WHEN _template IN ('task_reminder', 'event_reminder') THEN 3
    WHEN _template = 'event_announcement' THEN 4
    WHEN _template = 'daily_digest' THEN 5
    ELSE 1 END)::smallint
$$;

UPDATE public.email_outbox SET priority = public.email_priority(template)
WHERE status = 'pending' AND priority IS DISTINCT FROM public.email_priority(template);

-- The app's own daily limit: the provider's 300 minus a reserve of 20 for Supabase Auth emails.
CREATE OR REPLACE FUNCTION public.email_daily_limit() RETURNS integer LANGUAGE sql IMMUTABLE SET search_path = public AS $$ SELECT 280 $$;
CREATE FUNCTION public.email_provider_daily_limit() RETURNS integer LANGUAGE sql IMMUTABLE SET search_path = public AS $$ SELECT 300 $$;
CREATE FUNCTION public.email_budget_warning_at() RETURNS integer LANGUAGE sql IMMUTABLE SET search_path = public AS $$ SELECT 250 $$;

-- Mentions are emailed at once.
CREATE OR REPLACE FUNCTION public.notification_email_mode(_kind text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE
    WHEN _kind IN ('task_assigned', 'task_group_created', 'meeting_invited', 'review_waiting', 'task_note_mention') THEN 'immediate'
    WHEN _kind = 'task_reminder' THEN 'own'
    ELSE 'digest' END
$$;

CREATE OR REPLACE FUNCTION public.notification_email_timing(_type text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE WHEN _type IN ('task_assigned', 'mention', 'review', 'task_reminder') THEN 'immediate'
    WHEN _type = 'meeting' THEN 'mixed' ELSE 'digest' END
$$;

-- Emails the app sent today (London day; captured test emails have no send time and do not count).
CREATE FUNCTION public.emails_sent_today(p_now timestamptz DEFAULT now()) RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT count(*)::integer FROM public.email_outbox
  WHERE status = 'sent' AND sent_at >= ((p_now AT TIME ZONE 'Europe/London')::date)::timestamp AT TIME ZONE 'Europe/London'
$$;

-- At email_budget_warning_at() sent today: one in-app warning per active National Coordinator and Branch Manager and
-- London day. Returns how many warnings were created.
CREATE FUNCTION public.email_budget_check(p_now timestamptz DEFAULT now()) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _day date := (p_now AT TIME ZONE 'Europe/London')::date; _sent integer; _n integer;
BEGIN
  _sent := public.emails_sent_today(p_now);
  IF _sent < public.email_budget_warning_at() THEN RETURN 0; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('email_budget_warning'));
  INSERT INTO public.notifications (user_id, kind, actor_id, entity_type, entity_id, title, link, payload)
  SELECT p.id, 'email_budget_warning', NULL, 'email_budget', p.id, '', '/dashboard',
    jsonb_build_object('day', _day, 'sent', _sent, 'limit', public.email_provider_daily_limit(), 'app_limit', public.email_daily_limit())
  FROM public.profiles p
  WHERE p.status = 'active' AND p.deleted_at IS NULL
    AND public.has_any_role(p.id, ARRAY['national_coordinator', 'branch_manager']::public.app_role[])
    AND NOT EXISTS (SELECT 1 FROM public.notifications n WHERE n.user_id = p.id AND n.kind = 'email_budget_warning'
      AND n.payload->>'day' = _day::text);
  GET DIAGNOSTICS _n = ROW_COUNT;
  RETURN _n;
END $$;

CREATE FUNCTION public.email_outbox_budget_watch() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  BEGIN
    PERFORM public.email_budget_check();
  EXCEPTION WHEN OTHERS THEN
    NULL;  -- a warning never stops an email from being marked sent
  END;
  RETURN NULL;
END $$;
CREATE TRIGGER email_outbox_budget_watch AFTER UPDATE OF status ON public.email_outbox
  FOR EACH ROW WHEN (NEW.status = 'sent' AND OLD.status IS DISTINCT FROM 'sent' AND NEW.sent_at IS NOT NULL)
  EXECUTE FUNCTION public.email_outbox_budget_watch();

REVOKE ALL ON FUNCTION public.email_priority(text), public.email_daily_limit(), public.email_provider_daily_limit(),
  public.email_budget_warning_at(), public.notification_email_mode(text), public.notification_email_timing(text),
  public.emails_sent_today(timestamptz), public.email_budget_check(timestamptz), public.email_outbox_budget_watch()
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.emails_sent_today(timestamptz), public.email_budget_check(timestamptz) TO service_role;

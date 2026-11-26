-- In-app notices are always immediate; the delivery setting now decides only the EMAIL (approved by the user,
-- 2026-11-26).
--
-- Before: notify() stored notices of a type delivered in the 'digest' (the default for Branch Managers, Regional
-- Directors and National Coordinators) as held (not listed, not counted: no badge) until run_notification_digest()
-- released them at 08:00 London under one in-app 'daily_digest' notice. No email was sent for notices.
-- After:
-- * notify(): every notice is listed and counted at once, for every role (held is always false). A notice whose type
--   is delivered in the digest is marked for the daily summary email (notifications.email_digest).
-- * run_notification_digest() (08:00 London, idempotent per person and London day through notification_digest_log):
--   per active person with marked notices not yet in a summary, ONE email_outbox row (template 'daily_digest', payload
--   {count, kinds, day}; rendered at send time by the sender), then those notices are marked as summarised
--   (email_digested_at). The counts include only types the person still has on and set to the summary at that moment.
--   Never an empty summary: nothing to report means no email and no log row. No in-app 'daily_digest' notice any more
--   (old ones still render). Returns the number of summary emails queued.
-- * 'immediate' delivery keeps today's email behaviour: no email per notice (in the app only). Off (enabled = false)
--   still means no notice at all. Locked types (task_assigned, mention, review) and the delivery-locked types
--   (task_note, task_reminder) are always immediate, so never in the summary email; opted-in task reminder emails
--   (template 'task_reminder') are unchanged.
-- * email_priority(): 'daily_digest' joins the reminders tier (2), after transactional emails and before announcements.
-- * Notices held before this migration are released now (held = false) and marked for the next summary email, so
--   nothing is lost. A check constraint keeps held false from now on (the column stays for the existing functions that
--   filter on it).
-- Additive: new columns, an index, a constraint; notify, run_notification_digest and email_priority replaced (same
-- signatures and grants). No table, policy or grant change otherwise.

ALTER TABLE public.notifications
  ADD COLUMN email_digest boolean NOT NULL DEFAULT false,
  ADD COLUMN email_digested_at timestamptz;
CREATE INDEX notifications_email_digest_pending_idx ON public.notifications (user_id)
  WHERE email_digest AND email_digested_at IS NULL;

ALTER TABLE public.notification_digest_log
  ADD COLUMN email_id uuid REFERENCES public.email_outbox(id) ON DELETE SET NULL;
CREATE INDEX notification_digest_log_email_idx ON public.notification_digest_log (email_id) WHERE email_id IS NOT NULL;

-- Held notices come out now (listed and counted at their original time) and go into the next summary email.
UPDATE public.notifications SET held = false, email_digest = true WHERE held;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_never_held CHECK (NOT held);

-- notify() as in 20261129090200, never held; digest delivery marks the notice for the summary email.
CREATE OR REPLACE FUNCTION public.notify(_user uuid, _kind text, _entity_type text, _entity_id uuid, _title text, _link text,
  _payload jsonb DEFAULT '{}'::jsonb) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _id uuid; _type text := public.notification_type(_kind); _setting jsonb; _branch text;
BEGIN
  IF _user IS NULL OR _user IS NOT DISTINCT FROM auth.uid() THEN RETURN NULL; END IF;
  -- Replaced by the grouped "waiting for you" notice (review_notice_refresh).
  IF _kind IN ('task_request_received', 'meeting_request_received') THEN RETURN NULL; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = _user AND status = 'active' AND deleted_at IS NULL) THEN RETURN NULL; END IF;
  _setting := public.notification_setting(_user, _type);
  IF NOT (_setting->>'enabled')::boolean THEN RETURN NULL; END IF;
  _branch := CASE _entity_type
    WHEN 'task' THEN (SELECT b.name FROM public.tasks t JOIN public.branches b ON b.id = t.branch_id WHERE t.id = _entity_id)
    WHEN 'meeting' THEN (SELECT b.name FROM public.meetings m JOIN public.branches b ON b.id = m.branch_id WHERE m.id = _entity_id) END;
  BEGIN
    INSERT INTO public.notifications (user_id, kind, actor_id, entity_type, entity_id, title, link, payload, held, email_digest)
    VALUES (_user, _kind, auth.uid(), _entity_type, _entity_id, left(coalesce(_title, ''), 300), _link,
      coalesce(_payload, '{}'::jsonb) || CASE WHEN _branch IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('branch', _branch) END,
      false, _setting->>'delivery' = 'digest')
    RETURNING id INTO _id;
  EXCEPTION WHEN foreign_key_violation THEN
    -- The recipient (or the actor) was deleted at this very moment: no notice, the action itself goes on.
    RETURN NULL;
  END;
  RETURN _id;
END $$;

-- Daily summary email (service role, 08:00 London; at most one per person and London day, never empty).
CREATE OR REPLACE FUNCTION public.run_notification_digest(p_now timestamptz DEFAULT now()) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _day date := (p_now AT TIME ZONE 'Europe/London')::date; _u uuid; _n integer := 0; _kinds jsonb; _count integer; _mail uuid;
BEGIN
  IF extract(hour FROM p_now AT TIME ZONE 'Europe/London') < 8 THEN RETURN 0; END IF;
  FOR _u IN SELECT DISTINCT n.user_id FROM public.notifications n JOIN public.profiles p ON p.id = n.user_id
      AND p.status = 'active' AND p.deleted_at IS NULL
    WHERE n.email_digest AND n.email_digested_at IS NULL AND n.created_at <= p_now ORDER BY 1 LOOP
    -- Already summarised today (or another run is doing it): newer notices wait for tomorrow's email.
    INSERT INTO public.notification_digest_log (user_id, day) VALUES (_u, _day) ON CONFLICT (user_id, day) DO NOTHING;
    CONTINUE WHEN NOT FOUND;
    -- Only types the person still has on and set to the summary count (they may have changed it since).
    SELECT coalesce(sum(c), 0)::integer, jsonb_object_agg(kind, c) INTO _count, _kinds FROM (
      SELECT n.kind, count(*) AS c FROM public.notifications n
      WHERE n.user_id = _u AND n.email_digest AND n.email_digested_at IS NULL AND n.created_at <= p_now
        AND public.notification_setting(_u, public.notification_type(n.kind)) @> '{"enabled": true, "delivery": "digest"}'::jsonb
      GROUP BY n.kind) k;
    UPDATE public.notifications SET email_digested_at = p_now
    WHERE user_id = _u AND email_digest AND email_digested_at IS NULL AND created_at <= p_now;
    IF _count = 0 THEN
      -- Nothing to report: no email and no log row.
      DELETE FROM public.notification_digest_log WHERE user_id = _u AND day = _day;
      CONTINUE;
    END IF;
    INSERT INTO public.email_outbox (user_id, template, payload, dedupe_key)
    VALUES (_u, 'daily_digest', jsonb_build_object('count', _count, 'kinds', _kinds, 'day', _day),
      'daily_digest:' || _u || ':' || _day)
    ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING
    RETURNING id INTO _mail;
    UPDATE public.notification_digest_log SET email_id = _mail WHERE user_id = _u AND day = _day;
    _n := _n + 1;
  END LOOP;
  RETURN _n;
END $$;

-- 1 transactional, 2 reminders and the daily summary email, 3 announcements.
CREATE OR REPLACE FUNCTION public.email_priority(_template text) RETURNS smallint
LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT (CASE WHEN _template IN ('event_reminder', 'task_reminder', 'daily_digest') THEN 2
    WHEN _template = 'event_announcement' THEN 3 ELSE 1 END)::smallint
$$;

-- Grants as before (internal and server-only: no client may call them).
REVOKE ALL ON FUNCTION public.notify(uuid, text, text, uuid, text, text, jsonb), public.email_priority(text),
  public.run_notification_digest(timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.run_notification_digest(timestamptz) TO service_role;

-- Notice emails (approved by the user, 2026-11-26), on top of 20261208090000 (in-app always immediate).
--
-- Before (20261208090000): one email at most, the daily summary, for types whose per-user delivery was 'digest'
-- (default for Branch Managers, Regional Directors, National Coordinators); 'immediate' meant no email.
-- After:
-- * In the app nothing changes: every notice is immediate; task_assigned, mention and review stay always on; the other
--   types keep their in-app on/off (types->type->enabled). Off still means no notice and so no email.
-- * Email timing is fixed per kind, no longer a per-user choice (notification_email_mode):
--   - immediately, one email per notice (template 'notice'): task_assigned and task_group_created (type task_assigned),
--     meeting_invited (type meeting) and the grouped "requests waiting for your review" notice (review_waiting): an
--     email when that notice is created or its count goes up (a new request), never for the same pending email twice
--     (a pending email of a notice is reused: the content is rendered at send time with the current count);
--   - task reminders keep their own email (template 'task_reminder', run_task_reminders);
--   - every other kind goes into the daily summary email (20261208090000), also mentions; only notices still unread
--     when the summary is built count (approved by the user, 2026-11-26).
-- * Email on/off per type and person (types->type->email, default on for every role; task_reminder uses the existing
--   notification_preferences.task_reminder_emails). The locked types stay on in the app when their email is off.
--   Existing settings: 'delivery' is no longer read (it is left in the stored JSON, nothing is rewritten); everyone
--   starts with every email on. Turning an email off cancels that type's notice emails still pending.
-- * Signed unsubscribe links (server code, EMAIL_LINK_SECRET): notice_email_unsubscribe (service role only) turns off one
--   type's email for one person without signing in.
-- * email_priority: 'notice' joins tier 2 (reminders and the daily summary), after transactional emails and before
--   announcements.
-- * notice_email_context (service role only): the sender's view of a queued notice email at send time.
-- Additive: no table or column change, no data rewritten; functions added or replaced (same signatures where they
-- existed). Grants: client RPCs to authenticated only; internal and server-only functions revoked from
-- PUBLIC/anon/authenticated (service role where the server calls them).

-- ---------------------------------------------------------------------------------------------------------------
-- Email timing per kind, email on/off per type

CREATE FUNCTION public.notification_email_mode(_kind text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE
    WHEN _kind IN ('task_assigned', 'task_group_created', 'meeting_invited', 'review_waiting') THEN 'immediate'
    WHEN _kind = 'task_reminder' THEN 'own'
    ELSE 'digest' END
$$;

-- How a type's email arrives (Profile > Notifications): immediately, in the daily summary, or both (meetings:
-- invitations at once, changes and cancellations in the summary).
CREATE FUNCTION public.notification_email_timing(_type text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE WHEN _type IN ('task_assigned', 'review', 'task_reminder') THEN 'immediate'
    WHEN _type = 'meeting' THEN 'mixed' ELSE 'digest' END
$$;

CREATE FUNCTION public.notification_email_on(_user uuid, _type text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE WHEN _type = 'task_reminder' THEN public.wants_task_reminder_emails(_user)
    ELSE coalesce((SELECT (p.types->_type->>'email')::boolean FROM public.notification_preferences p WHERE p.user_id = _user), true) END
$$;

-- One person's setting for a type: { enabled (in the app), email }. Locked types are always on in the app.
CREATE OR REPLACE FUNCTION public.notification_setting(_user uuid, _type text) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object(
    'enabled', public.notification_type_locked(_type)
      OR coalesce((SELECT (p.types->_type->>'enabled')::boolean FROM public.notification_preferences p WHERE p.user_id = _user), true),
    'email', public.notification_email_on(_user, _type))
$$;

CREATE OR REPLACE FUNCTION public.get_notification_settings() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_accepted_privacy_notice() THEN RETURN NULL; END IF;
  RETURN jsonb_build_object(
    'task_reminder_emails', public.wants_task_reminder_emails(auth.uid()),
    'types', (SELECT jsonb_agg(public.notification_setting(auth.uid(), t) || jsonb_build_object('type', t,
        'locked', public.notification_type_locked(t), 'email_timing', public.notification_email_timing(t)) ORDER BY o)
      FROM unnest(ARRAY['task_assigned', 'mention', 'review', 'task_status', 'task_note', 'task_reminder', 'meeting', 'request_decided'])
        WITH ORDINALITY AS x(t, o)));
END $$;

-- In-app on/off for the changeable types (p_delivery is ignored: email timing is no longer a personal choice). Other
-- keys of the type's settings (email) are kept.
CREATE OR REPLACE FUNCTION public.set_notification_setting(p_type text, p_enabled boolean, p_delivery text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.require_privacy_accepted();
  IF auth.uid() IS NULL OR NOT public.session_ok() THEN RAISE EXCEPTION 'Not allowed'; END IF;
  IF p_type NOT IN ('task_status', 'task_note', 'task_reminder', 'meeting', 'request_decided') THEN
    RAISE EXCEPTION 'This notice cannot be changed';
  END IF;
  INSERT INTO public.notification_preferences (user_id, types)
  VALUES (auth.uid(), jsonb_build_object(p_type, jsonb_build_object('enabled', coalesce(p_enabled, true))))
  ON CONFLICT (user_id) DO UPDATE SET types = public.notification_preferences.types
    || jsonb_build_object(p_type, coalesce(public.notification_preferences.types->p_type, '{}'::jsonb)
      || jsonb_build_object('enabled', coalesce(p_enabled, true))), updated_at = now();
  RETURN public.notification_setting(auth.uid(), p_type) || jsonb_build_object('type', p_type);
END $$;

-- Internal: one type's email on/off for one person; off cancels that type's notice emails still waiting.
CREATE FUNCTION public.notification_email_set(_user uuid, _type text, _on boolean) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF _type NOT IN ('task_assigned', 'mention', 'review', 'task_status', 'task_note', 'task_reminder', 'meeting', 'request_decided')
    OR _on IS NULL THEN
    RAISE EXCEPTION 'Not allowed';
  END IF;
  IF _type = 'task_reminder' THEN
    INSERT INTO public.notification_preferences (user_id, task_reminder_emails, updated_at) VALUES (_user, _on, now())
    ON CONFLICT (user_id) DO UPDATE SET task_reminder_emails = EXCLUDED.task_reminder_emails, updated_at = now();
  ELSE
    INSERT INTO public.notification_preferences (user_id, types)
    VALUES (_user, jsonb_build_object(_type, jsonb_build_object('email', _on)))
    ON CONFLICT (user_id) DO UPDATE SET types = public.notification_preferences.types
      || jsonb_build_object(_type, coalesce(public.notification_preferences.types->_type, '{}'::jsonb) || jsonb_build_object('email', _on)),
      updated_at = now();
  END IF;
  IF NOT _on THEN
    UPDATE public.email_outbox SET status = 'cancelled', last_error = 'email_off'
    WHERE user_id = _user AND status = 'pending'
      AND ((template = 'notice' AND payload->>'type' = _type) OR (_type = 'task_reminder' AND template = 'task_reminder'));
  END IF;
END $$;

-- Profile > Notifications: email on/off for any type (locked types included; they stay on in the app).
CREATE FUNCTION public.set_notification_email(p_type text, p_on boolean) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.require_privacy_accepted();
  IF auth.uid() IS NULL OR NOT public.session_ok()
    OR NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'Not allowed';
  END IF;
  PERFORM public.notification_email_set(auth.uid(), p_type, p_on);
  RETURN public.notification_setting(auth.uid(), p_type) || jsonb_build_object('type', p_type);
END $$;

-- A signed unsubscribe link (verified by server code): one type's email off for one person, without signing in.
-- 'invalid' for someone deleted or unknown (the answer never says more).
CREATE FUNCTION public.notice_email_unsubscribe(p_user uuid, p_type text) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF p_user IS NULL OR NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_user AND deleted_at IS NULL)
    OR p_type NOT IN ('task_assigned', 'mention', 'review', 'task_status', 'task_note', 'task_reminder', 'meeting', 'request_decided') THEN
    RETURN 'invalid';
  END IF;
  PERFORM public.notification_email_set(p_user, p_type, false);
  RETURN 'unsubscribed';
END $$;

-- Internal: queue one immediate notice email, unless one for this notice is still waiting (rendered at send time).
CREATE FUNCTION public.queue_notice_email(_user uuid, _notification uuid, _type text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF _notification IS NULL OR NOT public.notification_email_on(_user, _type) THEN RETURN; END IF;
  IF EXISTS (SELECT 1 FROM public.email_outbox WHERE notification_id = _notification AND template = 'notice' AND status = 'pending') THEN
    RETURN;
  END IF;
  INSERT INTO public.email_outbox (user_id, notification_id, template, payload)
  VALUES (_user, _notification, 'notice', jsonb_build_object('type', _type));
END $$;

-- ---------------------------------------------------------------------------------------------------------------
-- notify(): as in 20261208090000; immediate kinds queue their email, digest kinds are marked for the summary when the
-- type's email is on.

CREATE OR REPLACE FUNCTION public.notify(_user uuid, _kind text, _entity_type text, _entity_id uuid, _title text, _link text,
  _payload jsonb DEFAULT '{}'::jsonb) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _id uuid; _type text := public.notification_type(_kind); _setting jsonb; _branch text;
  _mode text := public.notification_email_mode(_kind);
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
      false, _mode = 'digest' AND (_setting->>'email')::boolean)
    RETURNING id INTO _id;
    IF _mode = 'immediate' THEN PERFORM public.queue_notice_email(_user, _id, _type); END IF;
  EXCEPTION WHEN foreign_key_violation THEN
    -- The recipient (or the actor) was deleted at this very moment: no notice, the action itself goes on.
    RETURN NULL;
  END;
  RETURN _id;
END $$;

-- The grouped review notice (as in 20261129090200): an email when it is created or its count goes up.
CREATE OR REPLACE FUNCTION public.review_notice_refresh(_user uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _w jsonb; _id uuid; _total text;
BEGIN
  IF _user IS NULL OR NOT public.is_active_person(_user) THEN RETURN; END IF;
  _w := public.review_waiting_for(_user);
  BEGIN
    IF (_w->>'total')::integer = 0 THEN
      DELETE FROM public.notifications WHERE user_id = _user AND kind = 'review_waiting' AND read_at IS NULL;
      RETURN;
    END IF;
    SELECT id, payload->>'total' INTO _id, _total FROM public.notifications
    WHERE user_id = _user AND kind = 'review_waiting' AND read_at IS NULL ORDER BY created_at DESC LIMIT 1;
    IF _id IS NULL THEN
      INSERT INTO public.notifications (user_id, kind, actor_id, entity_type, entity_id, title, link, payload)
      VALUES (_user, 'review_waiting', NULL, 'review', _user, '', '/requests?tab=review', _w)
      RETURNING id INTO _id;
      PERFORM public.queue_notice_email(_user, _id, 'review');
    ELSIF _total IS DISTINCT FROM _w->>'total' THEN
      UPDATE public.notifications SET payload = _w, created_at = now() WHERE id = _id;
      IF (_w->>'total')::integer > coalesce(nullif(_total, '')::integer, 0) THEN
        PERFORM public.queue_notice_email(_user, _id, 'review');
      END IF;
    END IF;
  EXCEPTION WHEN foreign_key_violation THEN
    RETURN;  -- the reviewer was deleted at this very moment
  END;
END $$;

-- ---------------------------------------------------------------------------------------------------------------
-- Daily summary email (as in 20261208090000): counts only notices still unread in the app (never email what the
-- person has already seen) of types still on in the app with their email on; every marked notice is settled either way
-- (a notice read before the summary is never emailed later). All read, or nothing else to report: no email and no log
-- row. The payload also lists the types (one unsubscribe link each).

CREATE OR REPLACE FUNCTION public.run_notification_digest(p_now timestamptz DEFAULT now()) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _day date := (p_now AT TIME ZONE 'Europe/London')::date; _u uuid; _n integer := 0; _kinds jsonb; _types jsonb;
  _count integer; _mail uuid;
BEGIN
  IF extract(hour FROM p_now AT TIME ZONE 'Europe/London') < 8 THEN RETURN 0; END IF;
  FOR _u IN SELECT DISTINCT n.user_id FROM public.notifications n JOIN public.profiles p ON p.id = n.user_id
      AND p.status = 'active' AND p.deleted_at IS NULL
    WHERE n.email_digest AND n.email_digested_at IS NULL AND n.created_at <= p_now ORDER BY 1 LOOP
    -- Already summarised today (or another run is doing it): newer notices wait for tomorrow's email.
    INSERT INTO public.notification_digest_log (user_id, day) VALUES (_u, _day) ON CONFLICT (user_id, day) DO NOTHING;
    CONTINUE WHEN NOT FOUND;
    SELECT coalesce(sum(c), 0)::integer, jsonb_object_agg(kind, c) INTO _count, _kinds FROM (
      SELECT n.kind, count(*) AS c FROM public.notifications n
      WHERE n.user_id = _u AND n.email_digest AND n.email_digested_at IS NULL AND n.created_at <= p_now
        AND n.read_at IS NULL
        AND public.notification_setting(_u, public.notification_type(n.kind)) @> '{"enabled": true, "email": true}'::jsonb
      GROUP BY n.kind) k;
    SELECT jsonb_agg(DISTINCT to_jsonb(public.notification_type(x))) INTO _types FROM jsonb_object_keys(coalesce(_kinds, '{}'::jsonb)) x;
    UPDATE public.notifications SET email_digested_at = p_now
    WHERE user_id = _u AND email_digest AND email_digested_at IS NULL AND created_at <= p_now;
    IF _count = 0 THEN
      -- Nothing to report: no email and no log row.
      DELETE FROM public.notification_digest_log WHERE user_id = _u AND day = _day;
      CONTINUE;
    END IF;
    INSERT INTO public.email_outbox (user_id, template, payload, dedupe_key)
    VALUES (_u, 'daily_digest', jsonb_build_object('count', _count, 'kinds', _kinds, 'types', _types, 'day', _day),
      'daily_digest:' || _u || ':' || _day)
    ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING
    RETURNING id INTO _mail;
    UPDATE public.notification_digest_log SET email_id = _mail WHERE user_id = _u AND day = _day;
    _n := _n + 1;
  END LOOP;
  RETURN _n;
END $$;

-- 1 transactional, 2 reminders, notice emails and the daily summary, 3 announcements.
CREATE OR REPLACE FUNCTION public.email_priority(_template text) RETURNS smallint
LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT (CASE WHEN _template IN ('event_reminder', 'task_reminder', 'daily_digest', 'notice') THEN 2
    WHEN _template = 'event_announcement' THEN 3 ELSE 1 END)::smallint
$$;

-- The sender's view of a member notice email (notice, daily_digest, task_reminder) at send time: the member's language
-- and, for 'notice', the notice with the actor's name and whether it still applies (the notice exists and is unread,
-- the type's email is on).
CREATE FUNCTION public.notice_email_context(p_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _o public.email_outbox; _n public.notifications; _type text;
BEGIN
  SELECT * INTO _o FROM public.email_outbox WHERE id = p_id;
  IF _o.id IS NULL OR _o.user_id IS NULL THEN RETURN NULL; END IF;
  IF _o.template <> 'notice' THEN
    RETURN jsonb_build_object('language', (SELECT preferred_language FROM public.profiles WHERE id = _o.user_id), 'applies', true);
  END IF;
  SELECT * INTO _n FROM public.notifications WHERE id = _o.notification_id;
  _type := coalesce(_o.payload->>'type', public.notification_type(_n.kind));
  RETURN jsonb_build_object(
    'language', (SELECT preferred_language FROM public.profiles WHERE id = _o.user_id),
    'type', _type,
    'applies', _n.id IS NOT NULL AND _n.read_at IS NULL AND public.notification_email_on(_o.user_id, _type),
    'notice', CASE WHEN _n.id IS NOT NULL THEN jsonb_build_object('kind', _n.kind, 'title', _n.title, 'link', _n.link,
      'payload', _n.payload, 'created_at', _n.created_at,
      'actor_name', (SELECT full_name FROM public.profiles WHERE id = _n.actor_id AND deleted_at IS NULL)) END);
END $$;

-- ---------------------------------------------------------------------------------------------------------------
-- Grants

REVOKE ALL ON FUNCTION public.notification_email_mode(text), public.notification_email_timing(text),
  public.notification_email_on(uuid, text), public.notification_email_set(uuid, text, boolean),
  public.queue_notice_email(uuid, uuid, text), public.notify(uuid, text, text, uuid, text, text, jsonb),
  public.notification_setting(uuid, text), public.review_notice_refresh(uuid), public.email_priority(text),
  public.run_notification_digest(timestamptz), public.notice_email_unsubscribe(uuid, text), public.notice_email_context(uuid)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.run_notification_digest(timestamptz), public.notice_email_unsubscribe(uuid, text),
  public.notice_email_context(uuid) TO service_role;
REVOKE ALL ON FUNCTION public.get_notification_settings(), public.set_notification_setting(text, boolean, text),
  public.set_notification_email(text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_notification_settings(), public.set_notification_setting(text, boolean, text),
  public.set_notification_email(text, boolean) TO authenticated;

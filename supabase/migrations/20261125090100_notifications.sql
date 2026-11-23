-- In-app notifications, an email outbox (nothing sends it yet) and per-user notification preferences.
-- * notifications: one row per person and event ("X assigned you: <task>"). Channel-independent: kind, the entity it is
--   about, a title snapshot, a link (app path) and a payload. Email for any kind later = an email_outbox row pointing at
--   the notification; no schema change.
-- * email_outbox: rows for a future sender (SMTP through Brevo or Resend). No client access at all.
-- * notification_preferences: "Email reminders for tasks" (default on). Missing row = defaults.

CREATE TABLE public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind ~ '^[a-z_]{1,60}$'),
  actor_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  entity_type text NOT NULL CHECK (entity_type IN ('task', 'meeting', 'task_request', 'meeting_request')),
  entity_id uuid NOT NULL,
  title text NOT NULL DEFAULT '' CHECK (char_length(title) <= 300),
  link text NOT NULL CHECK (link LIKE '/%' AND char_length(link) <= 300),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  read_at timestamptz
);
CREATE INDEX notifications_user_unread_idx ON public.notifications (user_id, created_at DESC) WHERE read_at IS NULL;
CREATE INDEX notifications_user_idx ON public.notifications (user_id, created_at DESC);
CREATE INDEX notifications_entity_idx ON public.notifications (entity_type, entity_id);

CREATE TABLE public.email_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  notification_id uuid REFERENCES public.notifications(id) ON DELETE SET NULL,
  template text NOT NULL CHECK (template ~ '^[a-z_]{1,60}$'),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed', 'cancelled')),
  attempts integer NOT NULL DEFAULT 0,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz
);
CREATE INDEX email_outbox_pending_idx ON public.email_outbox (created_at) WHERE status = 'pending';

CREATE TABLE public.notification_preferences (
  user_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  task_reminder_emails boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_preferences ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.notifications, public.email_outbox, public.notification_preferences FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.notifications, public.notification_preferences TO authenticated;
GRANT ALL ON public.notifications, public.email_outbox, public.notification_preferences TO service_role;

-- Users read only their own notices and preferences. The outbox has no policy for clients (service role only).
CREATE POLICY notifications_read_own ON public.notifications FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()));
CREATE POLICY notification_preferences_read_own ON public.notification_preferences FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()));
CREATE POLICY privacy_notice_required ON public.notifications AS RESTRICTIVE FOR SELECT TO authenticated
  USING ((SELECT public.has_accepted_privacy_notice()));
CREATE POLICY privacy_notice_required ON public.notification_preferences AS RESTRICTIVE FOR SELECT TO authenticated
  USING ((SELECT public.has_accepted_privacy_notice()));
CREATE POLICY email_outbox_service ON public.email_outbox FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Internal: one notice for one person. Nobody is notified about their own action, nor when inactive or deleted.
CREATE FUNCTION public.notify(_user uuid, _kind text, _entity_type text, _entity_id uuid, _title text, _link text,
  _payload jsonb DEFAULT '{}'::jsonb) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _id uuid;
BEGIN
  IF _user IS NULL OR _user IS NOT DISTINCT FROM auth.uid() THEN RETURN NULL; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = _user AND status = 'active' AND deleted_at IS NULL) THEN RETURN NULL; END IF;
  INSERT INTO public.notifications (user_id, kind, actor_id, entity_type, entity_id, title, link, payload)
  VALUES (_user, _kind, auth.uid(), _entity_type, _entity_id, left(coalesce(_title, ''), 300), _link, coalesce(_payload, '{}'::jsonb))
  RETURNING id INTO _id;
  RETURN _id;
END $$;

-- Internal: does this person want task reminder emails? (Default on.)
CREATE FUNCTION public.wants_task_reminder_emails(_user uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce((SELECT task_reminder_emails FROM public.notification_preferences WHERE user_id = _user), true)
$$;

-- The caller's notices, newest first (with the actor's name).
CREATE FUNCTION public.list_my_notifications(p_limit integer DEFAULT 30) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(jsonb_agg(x ORDER BY x.created_at DESC), '[]'::jsonb) FROM (
    SELECT n.id, n.kind, n.entity_type, n.entity_id, n.title, n.link, n.payload, n.created_at, n.read_at,
      CASE WHEN a.deleted_at IS NULL THEN a.full_name END AS actor_name
    FROM public.notifications n LEFT JOIN public.profiles a ON a.id = n.actor_id
    WHERE n.user_id = auth.uid() AND public.session_ok() AND public.has_accepted_privacy_notice()
    ORDER BY n.created_at DESC LIMIT greatest(1, least(coalesce(p_limit, 30), 100))) x
$$;

-- Unread counts for the badges: task assignments (Tasks), request notices (Requests), meeting notices, all.
CREATE FUNCTION public.get_unread_notification_counts() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object(
    'tasks', count(*) FILTER (WHERE kind = 'task_assigned'),
    'requests', count(*) FILTER (WHERE entity_type IN ('task_request', 'meeting_request')),
    'meetings', count(*) FILTER (WHERE entity_type = 'meeting'),
    'total', count(*))
  FROM public.notifications
  WHERE user_id = auth.uid() AND read_at IS NULL AND public.session_ok() AND public.has_accepted_privacy_notice()
$$;

-- Opening an item marks its notices read: one notice, or every notice about one entity, or all.
CREATE FUNCTION public.mark_notifications_read(p_id uuid DEFAULT NULL, p_entity_type text DEFAULT NULL, p_entity_id uuid DEFAULT NULL)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _n integer;
BEGIN
  PERFORM public.require_privacy_accepted();
  IF auth.uid() IS NULL OR NOT public.session_ok() THEN RAISE EXCEPTION 'Not allowed'; END IF;
  UPDATE public.notifications SET read_at = now()
  WHERE user_id = auth.uid() AND read_at IS NULL
    AND (p_id IS NULL OR id = p_id)
    AND (p_entity_type IS NULL OR entity_type = p_entity_type)
    AND (p_entity_id IS NULL OR entity_id = p_entity_id);
  GET DIAGNOSTICS _n = ROW_COUNT;
  RETURN _n;
END $$;

-- "Email reminders for tasks" on the Profile page. In-app notices always appear.
CREATE FUNCTION public.set_task_reminder_emails(p_on boolean) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.require_privacy_accepted();
  IF auth.uid() IS NULL OR p_on IS NULL OR NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'Not allowed';
  END IF;
  INSERT INTO public.notification_preferences (user_id, task_reminder_emails, updated_at) VALUES (auth.uid(), p_on, now())
  ON CONFLICT (user_id) DO UPDATE SET task_reminder_emails = EXCLUDED.task_reminder_emails, updated_at = now();
  RETURN p_on;
END $$;

CREATE FUNCTION public.get_notification_preferences() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object('task_reminder_emails', public.wants_task_reminder_emails(auth.uid()))
$$;

REVOKE ALL ON FUNCTION public.notify(uuid, text, text, uuid, text, text, jsonb), public.wants_task_reminder_emails(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.list_my_notifications(integer), public.get_unread_notification_counts(),
  public.mark_notifications_read(uuid, text, uuid), public.set_task_reminder_emails(boolean), public.get_notification_preferences() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_my_notifications(integer), public.get_unread_notification_counts(),
  public.mark_notifications_read(uuid, text, uuid), public.set_task_reminder_emails(boolean), public.get_notification_preferences() TO authenticated;

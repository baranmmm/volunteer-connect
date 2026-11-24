-- Less notification noise, notification settings, daily summary, grouped "waiting for you" notice, assignee self-reminders.
--
-- * Who is notified: only what directly concerns the person (assigned to me, @mentioned, meetings I am invited to,
--   my request decided, a task I created moved to Blocked or Done). Never the actor (notify() already skips them).
-- * Notice types (notification_type()): task_assigned, mention and review are always on and immediate. The others
--   (task_status, task_note, task_reminder, meeting, request_decided) can be turned off or delivered in the daily
--   summary. Default delivery: immediately for volunteers, daily summary for Branch Managers, Regional Directors and
--   National Coordinators. Settings live in notification_preferences.types.
-- * Daily summary: notices for the summary are stored "held" (not listed, not counted). run_notification_digest()
--   (08:00 Europe/London, idempotent per person and day) releases them under one 'daily_digest' notice
--   (notifications.digest_id). No email is sent yet.
-- * Requests waiting for review: one grouped notice per reviewer ('review_waiting', entity_type 'review') updated in
--   place whenever a task/meeting request, event request or volunteer application they review arrives or is decided;
--   removed when nothing is waiting. get_review_waiting() gives the counts (badges, dashboard card).
-- * Self-reminders: an assignee may set their own reminders on a task assigned to them
--   (task_assignees.my_reminders); they apply only to that assignee, next to the task's reminders. Mute silences the
--   task's reminders, not one's own. Reminders stay off by default.

ALTER TABLE public.notifications DROP CONSTRAINT notifications_entity_type_check;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_entity_type_check
  CHECK (entity_type IN ('task', 'meeting', 'task_request', 'meeting_request', 'review', 'digest'));
ALTER TABLE public.notifications ADD COLUMN held boolean NOT NULL DEFAULT false,
  ADD COLUMN digest_id uuid REFERENCES public.notifications(id) ON DELETE SET NULL;
CREATE INDEX notifications_held_idx ON public.notifications (user_id) WHERE held;
CREATE INDEX notifications_digest_idx ON public.notifications (digest_id) WHERE digest_id IS NOT NULL;

ALTER TABLE public.notification_preferences ADD COLUMN types jsonb NOT NULL DEFAULT '{}'::jsonb
  CHECK (jsonb_typeof(types) = 'object');

CREATE TABLE public.notification_digest_log (
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  day date NOT NULL,
  notification_id uuid REFERENCES public.notifications(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, day)
);
CREATE INDEX notification_digest_log_notification_idx ON public.notification_digest_log (notification_id) WHERE notification_id IS NOT NULL;
ALTER TABLE public.notification_digest_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.notification_digest_log FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.notification_digest_log TO service_role;
CREATE POLICY notification_digest_log_service ON public.notification_digest_log FOR ALL TO service_role USING (true) WITH CHECK (true);

ALTER TABLE public.task_assignees ADD COLUMN my_reminders jsonb CHECK (my_reminders IS NULL OR jsonb_typeof(my_reminders) = 'object');

-- ---------------------------------------------------------------------------------------------------------------
-- Types and settings

CREATE FUNCTION public.notification_type(_kind text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE
    WHEN _kind = 'task_assigned' THEN 'task_assigned'
    WHEN _kind = 'task_note_mention' THEN 'mention'
    WHEN _kind IN ('review_waiting', 'task_request_received', 'meeting_request_received') THEN 'review'
    WHEN _kind = 'task_status_changed' THEN 'task_status'
    WHEN _kind = 'task_note_added' THEN 'task_note'
    WHEN _kind = 'task_reminder' THEN 'task_reminder'
    WHEN _kind LIKE 'meeting\_%' ESCAPE '\' AND _kind NOT LIKE 'meeting\_request\_%' ESCAPE '\' THEN 'meeting'
    WHEN _kind IN ('task_request_accepted', 'task_request_declined', 'meeting_request_approved', 'meeting_request_declined') THEN 'request_decided'
    ELSE 'other' END
$$;

-- Always on and immediate: direct assignments, mentions and requests waiting for review.
CREATE FUNCTION public.notification_type_locked(_type text) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = public AS $$ SELECT _type IN ('task_assigned', 'mention', 'review') $$;

-- Default delivery: volunteers immediately; Branch Managers, Regional Directors and National Coordinators daily summary.
CREATE FUNCTION public.notification_default_delivery(_user uuid) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE WHEN public.has_any_role(_user, ARRAY['branch_manager', 'regional_director', 'national_coordinator']::public.app_role[])
    THEN 'digest' ELSE 'immediate' END
$$;

-- One person's setting for a type: { enabled, delivery }.
CREATE FUNCTION public.notification_setting(_user uuid, _type text) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE WHEN public.notification_type_locked(_type) THEN jsonb_build_object('enabled', true, 'delivery', 'immediate')
    ELSE jsonb_build_object(
      'enabled', coalesce((SELECT (p.types->_type->>'enabled')::boolean FROM public.notification_preferences p WHERE p.user_id = _user), true),
      'delivery', coalesce((SELECT p.types->_type->>'delivery' FROM public.notification_preferences p WHERE p.user_id = _user),
        public.notification_default_delivery(_user))) END
$$;

-- Profile > Notifications: every type with its setting.
CREATE FUNCTION public.get_notification_settings() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_accepted_privacy_notice() THEN RETURN NULL; END IF;
  RETURN jsonb_build_object(
    'default_delivery', public.notification_default_delivery(auth.uid()),
    'task_reminder_emails', public.wants_task_reminder_emails(auth.uid()),
    'types', (SELECT jsonb_agg(public.notification_setting(auth.uid(), t) || jsonb_build_object('type', t, 'locked', public.notification_type_locked(t))
        ORDER BY o)
      FROM unnest(ARRAY['task_assigned', 'mention', 'review', 'task_status', 'task_note', 'task_reminder', 'meeting', 'request_decided'])
        WITH ORDINALITY AS x(t, o)));
END $$;

CREATE FUNCTION public.set_notification_setting(p_type text, p_enabled boolean, p_delivery text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.require_privacy_accepted();
  IF auth.uid() IS NULL OR NOT public.session_ok() THEN RAISE EXCEPTION 'Not allowed'; END IF;
  IF p_type NOT IN ('task_status', 'task_note', 'task_reminder', 'meeting', 'request_decided') THEN
    RAISE EXCEPTION 'This notice cannot be changed';
  END IF;
  IF p_delivery NOT IN ('immediate', 'digest') THEN RAISE EXCEPTION 'Not allowed'; END IF;
  INSERT INTO public.notification_preferences (user_id, types)
  VALUES (auth.uid(), jsonb_build_object(p_type, jsonb_build_object('enabled', coalesce(p_enabled, true), 'delivery', p_delivery)))
  ON CONFLICT (user_id) DO UPDATE SET types = public.notification_preferences.types
    || jsonb_build_object(p_type, jsonb_build_object('enabled', coalesce(p_enabled, true), 'delivery', p_delivery)), updated_at = now();
  RETURN public.notification_setting(auth.uid(), p_type);
END $$;

-- ---------------------------------------------------------------------------------------------------------------
-- notify(): types, settings and held (summary) notices. The branch name goes into the payload (grouping).

CREATE OR REPLACE FUNCTION public.notify(_user uuid, _kind text, _entity_type text, _entity_id uuid, _title text, _link text,
  _payload jsonb DEFAULT '{}'::jsonb) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _id uuid; _type text := public.notification_type(_kind); _setting jsonb; _branch text;
BEGIN
  IF _user IS NULL OR _user IS NOT DISTINCT FROM auth.uid() THEN RETURN NULL; END IF;
  -- Replaced by the grouped "waiting for you" notice (review_notice_refresh).
  IF _kind IN ('task_request_received', 'meeting_request_received') THEN RETURN NULL; END IF;
  -- Key-share lock: a person being deleted at this moment is skipped (or their deletion waits), so a notice never
  -- breaks the action that caused it.
  PERFORM 1 FROM public.profiles WHERE id = _user AND status = 'active' AND deleted_at IS NULL FOR KEY SHARE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  _setting := public.notification_setting(_user, _type);
  IF NOT (_setting->>'enabled')::boolean THEN RETURN NULL; END IF;
  _branch := CASE _entity_type
    WHEN 'task' THEN (SELECT b.name FROM public.tasks t JOIN public.branches b ON b.id = t.branch_id WHERE t.id = _entity_id)
    WHEN 'meeting' THEN (SELECT b.name FROM public.meetings m JOIN public.branches b ON b.id = m.branch_id WHERE m.id = _entity_id) END;
  INSERT INTO public.notifications (user_id, kind, actor_id, entity_type, entity_id, title, link, payload, held)
  VALUES (_user, _kind, auth.uid(), _entity_type, _entity_id, left(coalesce(_title, ''), 300), _link,
    coalesce(_payload, '{}'::jsonb) || CASE WHEN _branch IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('branch', _branch) END,
    _setting->>'delivery' = 'digest')
  RETURNING id INTO _id;
  RETURN _id;
END $$;

-- The creator hears only when a task they created moves to Blocked or Done (by someone else).
CREATE OR REPLACE FUNCTION public.task_status_notice(_t public.tasks, _old text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF _t.status IS DISTINCT FROM _old AND _t.status IN ('blocked', 'done') AND _t.created_by IS DISTINCT FROM auth.uid() THEN
    PERFORM public.notify(_t.created_by, 'task_status_changed', 'task', _t.id, _t.title, '/tasks?task=' || _t.id,
      jsonb_build_object('status', _t.status, 'previous', _old));
  END IF;
END $$;

-- Lists and counts never show held notices (they come with the daily summary). Summary items carry digest_id.
CREATE OR REPLACE FUNCTION public.list_my_notifications(p_limit integer DEFAULT 30) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(jsonb_agg(x ORDER BY x.created_at DESC), '[]'::jsonb) FROM (
    SELECT n.id, n.kind, n.entity_type, n.entity_id, n.title, n.link, n.payload, n.created_at, n.read_at, n.digest_id,
      CASE WHEN a.deleted_at IS NULL THEN a.full_name END AS actor_name
    FROM public.notifications n LEFT JOIN public.profiles a ON a.id = n.actor_id
    WHERE n.user_id = auth.uid() AND NOT n.held AND public.session_ok() AND public.has_accepted_privacy_notice()
    ORDER BY n.created_at DESC LIMIT greatest(1, least(coalesce(p_limit, 30), 100))) x
$$;

CREATE OR REPLACE FUNCTION public.get_unread_notification_counts() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object(
    'tasks', count(*) FILTER (WHERE kind IN ('task_assigned', 'task_note_mention', 'task_note_added')),
    'requests', count(*) FILTER (WHERE entity_type IN ('task_request', 'meeting_request')),
    'meetings', count(*) FILTER (WHERE entity_type = 'meeting'),
    'total', count(*))
  FROM public.notifications
  WHERE user_id = auth.uid() AND read_at IS NULL AND NOT held AND public.session_ok() AND public.has_accepted_privacy_notice()
$$;

-- ---------------------------------------------------------------------------------------------------------------
-- Requests waiting for review: counts per person and one grouped notice, updated in place.

-- May _user manage this scope (the reviewers of event requests): mirrors can_manage_event_scope for any person.
CREATE FUNCTION public.user_manages_scope(_user uuid, _scope text, _branch uuid, _region uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.is_active_person(_user) AND (
    (_scope IN ('branch', 'region') AND EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user AND role = 'regional_director' AND region_id = _region))
    OR (_scope = 'branch' AND public.has_role(_user, 'branch_manager') AND public.get_user_branch(_user) = _branch)
    OR (_scope = 'national' AND public.has_role(_user, 'national_coordinator')))
$$;

-- The people who review requests in a scope.
CREATE FUNCTION public.scope_reviewers(_scope text, _branch uuid, _region uuid) RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT DISTINCT r.user_id FROM public.user_roles r
  WHERE (r.role = 'regional_director' AND _scope IN ('branch', 'region') AND r.region_id = _region)
     OR (r.role = 'branch_manager' AND _scope = 'branch' AND public.get_user_branch(r.user_id) = _branch)
     OR (r.role = 'national_coordinator' AND _scope = 'national')
$$;

-- What waits for _user's decision: task/meeting requests sent to them, event requests and volunteer applications in
-- the scopes they manage; with up to three branch names.
CREATE FUNCTION public.review_waiting_for(_user uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH work AS (
    SELECT branch_id FROM public.task_requests WHERE target_id = _user AND status = 'submitted'
    UNION ALL SELECT branch_id FROM public.meeting_requests WHERE target_id = _user AND status = 'submitted'),
  ev AS (
    SELECT branch_id FROM public.event_requests
    WHERE deleted_at IS NULL AND status IN ('submitted', 'under_review') AND requester_id IS DISTINCT FROM _user
      AND public.user_manages_scope(_user, scope, branch_id, region_id)),
  apps AS (
    SELECT a.branch_id FROM public.volunteer_applications a JOIN public.branches b ON b.id = a.branch_id
    WHERE a.deleted_at IS NULL AND a.status = 'submitted' AND public.user_manages_scope(_user, 'branch', a.branch_id, b.region_id)),
  allb AS (SELECT branch_id FROM work UNION ALL SELECT branch_id FROM ev UNION ALL SELECT branch_id FROM apps)
  SELECT jsonb_build_object(
    'work', (SELECT count(*) FROM work), 'event_requests', (SELECT count(*) FROM ev), 'applications', (SELECT count(*) FROM apps),
    'total', (SELECT count(*) FROM allb),
    'branches', (SELECT coalesce(jsonb_agg(name ORDER BY n DESC, name), '[]'::jsonb) FROM (
      SELECT b.name, count(*) AS n FROM allb JOIN public.branches b ON b.id = allb.branch_id GROUP BY b.name ORDER BY count(*) DESC, b.name LIMIT 3) x))
$$;

-- The caller's waiting counts (Requests badge, mobile More badge, dashboard "Waiting for you").
CREATE FUNCTION public.get_review_waiting() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE WHEN auth.uid() IS NOT NULL AND public.session_ok() AND public.has_accepted_privacy_notice()
    THEN public.review_waiting_for(auth.uid())
    ELSE jsonb_build_object('work', 0, 'event_requests', 0, 'applications', 0, 'total', 0, 'branches', '[]'::jsonb) END
$$;

-- One unread "N requests are waiting for you" notice per reviewer, always immediate; gone when nothing waits.
CREATE FUNCTION public.review_notice_refresh(_user uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _w jsonb; _id uuid;
BEGIN
  IF _user IS NULL THEN RETURN; END IF;
  -- Key-share lock: a reviewer being deleted at this moment is skipped (or their deletion waits), so this side effect
  -- never breaks the request that triggered it.
  PERFORM 1 FROM public.profiles WHERE id = _user AND status = 'active' AND deleted_at IS NULL FOR KEY SHARE;
  IF NOT FOUND OR NOT public.is_active_person(_user) THEN RETURN; END IF;
  _w := public.review_waiting_for(_user);
  SELECT id INTO _id FROM public.notifications WHERE user_id = _user AND kind = 'review_waiting' AND read_at IS NULL
    ORDER BY created_at DESC LIMIT 1 FOR UPDATE;
  IF (_w->>'total')::integer = 0 THEN
    DELETE FROM public.notifications WHERE user_id = _user AND kind = 'review_waiting' AND read_at IS NULL;
    RETURN;
  END IF;
  IF _id IS NULL THEN
    INSERT INTO public.notifications (user_id, kind, actor_id, entity_type, entity_id, title, link, payload)
    VALUES (_user, 'review_waiting', NULL, 'review', _user, '', '/requests?tab=review', _w);
  ELSIF (SELECT payload->>'total' FROM public.notifications WHERE id = _id) IS DISTINCT FROM _w->>'total' THEN
    UPDATE public.notifications SET payload = _w, created_at = now() WHERE id = _id;
  END IF;
END $$;

CREATE FUNCTION public.work_requests_review_refresh() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.review_notice_refresh(NEW.target_id);
  IF TG_OP = 'UPDATE' AND OLD.target_id IS DISTINCT FROM NEW.target_id THEN PERFORM public.review_notice_refresh(OLD.target_id); END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER task_requests_review_refresh AFTER INSERT OR UPDATE OF status, target_id ON public.task_requests
  FOR EACH ROW EXECUTE FUNCTION public.work_requests_review_refresh();
CREATE TRIGGER meeting_requests_review_refresh AFTER INSERT OR UPDATE OF status, target_id ON public.meeting_requests
  FOR EACH ROW EXECUTE FUNCTION public.work_requests_review_refresh();

CREATE FUNCTION public.event_requests_review_refresh() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _u uuid;
BEGIN
  FOR _u IN SELECT public.scope_reviewers(NEW.scope, NEW.branch_id, NEW.region_id)
    UNION SELECT public.scope_reviewers(OLD.scope, OLD.branch_id, OLD.region_id) WHERE TG_OP = 'UPDATE' LOOP
    PERFORM public.review_notice_refresh(_u);
  END LOOP;
  RETURN NULL;
END $$;
CREATE TRIGGER event_requests_review_refresh AFTER INSERT OR UPDATE OF status, deleted_at, scope, branch_id, region_id ON public.event_requests
  FOR EACH ROW EXECUTE FUNCTION public.event_requests_review_refresh();

CREATE FUNCTION public.volunteer_applications_review_refresh() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _u uuid;
BEGIN
  FOR _u IN SELECT public.scope_reviewers('branch', b.id, b.region_id) FROM public.branches b WHERE b.id = NEW.branch_id LOOP
    PERFORM public.review_notice_refresh(_u);
  END LOOP;
  RETURN NULL;
END $$;
CREATE TRIGGER volunteer_applications_review_refresh AFTER INSERT OR UPDATE OF status, deleted_at ON public.volunteer_applications
  FOR EACH ROW EXECUTE FUNCTION public.volunteer_applications_review_refresh();

-- ---------------------------------------------------------------------------------------------------------------
-- Daily summary (service role, 08:00 London; idempotent per person and London day).

CREATE FUNCTION public.run_notification_digest(p_now timestamptz DEFAULT now()) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _day date := (p_now AT TIME ZONE 'Europe/London')::date; _u uuid; _digest uuid; _n integer := 0; _kinds jsonb; _count integer;
BEGIN
  IF extract(hour FROM p_now AT TIME ZONE 'Europe/London') < 8 THEN RETURN 0; END IF;
  FOR _u IN SELECT DISTINCT n.user_id FROM public.notifications n JOIN public.profiles p ON p.id = n.user_id
      AND p.status = 'active' AND p.deleted_at IS NULL WHERE n.held ORDER BY 1 LOOP
    INSERT INTO public.notification_digest_log (user_id, day) VALUES (_u, _day) ON CONFLICT (user_id, day) DO NOTHING;
    CONTINUE WHEN NOT FOUND;
    SELECT count(*), jsonb_object_agg(kind, c) INTO _count, _kinds
    FROM (SELECT kind, count(*) AS c FROM public.notifications WHERE user_id = _u AND held GROUP BY kind) k;
    INSERT INTO public.notifications (user_id, kind, actor_id, entity_type, entity_id, title, link, payload)
    VALUES (_u, 'daily_digest', NULL, 'digest', _u, '', '/dashboard', jsonb_build_object('count', _count, 'kinds', _kinds, 'day', _day))
    RETURNING id INTO _digest;
    UPDATE public.notifications SET held = false, digest_id = _digest WHERE user_id = _u AND held;
    UPDATE public.notification_digest_log SET notification_id = _digest WHERE user_id = _u AND day = _day;
    _n := _n + 1;
  END LOOP;
  RETURN _n;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.schedule('notification-digest', '5 7,8 * * *', 'SELECT public.run_notification_digest()');
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pg_cron not available: the Task reminders workflow runs the daily summary (%)', SQLERRM;
END $$;

-- ---------------------------------------------------------------------------------------------------------------
-- Assignee self-reminders

-- Validated reminder settings (the task form's shape): { before_days, repeat_kind, repeat_every_days, repeat_start,
-- overdue_every_days }. NULL when nothing would be sent.
CREATE FUNCTION public.clean_reminders(p jsonb) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SET search_path = public AS $$
DECLARE _before integer[]; _kind text; _every integer; _start date; _overdue integer;
BEGIN
  IF p IS NULL OR jsonb_typeof(p) <> 'object' THEN RETURN NULL; END IF;
  _before := CASE WHEN jsonb_typeof(p->'before_days') = 'array'
    THEN ARRAY(SELECT DISTINCT x::integer FROM jsonb_array_elements_text(p->'before_days') x ORDER BY 1) ELSE '{}'::integer[] END;
  _kind := coalesce(p->>'repeat_kind', 'none');
  _every := CASE WHEN _kind = 'every_n' THEN nullif(p->>'repeat_every_days', '')::integer END;
  _start := CASE WHEN _kind <> 'none' THEN nullif(p->>'repeat_start', '')::date END;
  _overdue := nullif(p->>'overdue_every_days', '')::integer;
  IF cardinality(_before) > 6 OR EXISTS (SELECT 1 FROM unnest(_before) x WHERE x NOT BETWEEN 1 AND 365)
    OR _kind NOT IN ('none', 'daily', 'every_n', 'weekly') OR (_kind = 'every_n' AND (_every IS NULL OR _every NOT BETWEEN 2 AND 90))
    OR _overdue NOT BETWEEN 1 AND 90 THEN
    RAISE EXCEPTION 'Reminder settings are not valid';
  END IF;
  IF cardinality(_before) = 0 AND _kind = 'none' AND _overdue IS NULL THEN RETURN NULL; END IF;
  RETURN jsonb_build_object('before_days', to_jsonb(_before), 'repeat_kind', _kind, 'repeat_every_days', _every,
    'repeat_start', _start, 'overdue_every_days', _overdue);
END $$;

-- An assignee sets (or clears, with NULL / nothing on) their own reminders on a task assigned to them.
CREATE FUNCTION public.set_my_task_reminders(p_id uuid, p_reminders jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _r jsonb;
BEGIN
  PERFORM public.require_privacy_accepted();
  PERFORM public.work_actor();
  PERFORM public.task_locked(p_id);
  _r := public.clean_reminders(p_reminders);
  UPDATE public.task_assignees SET my_reminders = CASE WHEN _r IS NULL THEN NULL
      ELSE _r || jsonb_build_object('repeat_start', coalesce(_r->>'repeat_start', CASE WHEN _r->>'repeat_kind' <> 'none'
        THEN ((now() AT TIME ZONE 'Europe/London')::date)::text END)) END
  WHERE task_id = p_id AND user_id = auth.uid() AND public.can_view_task(p_id);
  IF NOT FOUND THEN RAISE EXCEPTION 'Not allowed'; END IF;
  RETURN (SELECT my_reminders FROM public.task_assignees WHERE task_id = p_id AND user_id = auth.uid());
END $$;

-- The task with someone's own reminder settings in place of the task's (for task_reminder_kind).
CREATE FUNCTION public.task_with_reminders(_t public.tasks, _r jsonb) RETURNS public.tasks
LANGUAGE plpgsql IMMUTABLE SET search_path = public AS $$
BEGIN
  _t.remind_before_days := CASE WHEN jsonb_typeof(_r->'before_days') = 'array'
    THEN ARRAY(SELECT x::integer FROM jsonb_array_elements_text(_r->'before_days') x) ELSE '{}'::integer[] END;
  _t.repeat_kind := coalesce(_r->>'repeat_kind', 'none');
  _t.repeat_every_days := nullif(_r->>'repeat_every_days', '')::integer;
  _t.repeat_start := nullif(_r->>'repeat_start', '')::date;
  _t.overdue_every_days := nullif(_r->>'overdue_every_days', '')::integer;
  RETURN _t;
END $$;

-- The scheduler: the task's reminders (unless muted) and the assignee's own ones; at most one per task, person, day.
CREATE OR REPLACE FUNCTION public.run_task_reminders(p_now timestamptz DEFAULT now()) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _local timestamp := p_now AT TIME ZONE 'Europe/London'; _day date := (p_now AT TIME ZONE 'Europe/London')::date;
  _x record; _n integer := 0; _notice uuid; _kind text;
BEGIN
  IF extract(hour FROM _local) < 9 THEN RETURN 0; END IF;
  FOR _x IN
    SELECT t AS task, t.id, t.title, t.due_date, a.user_id AS assignee, a.reminders_muted, a.my_reminders
    FROM public.tasks t JOIN public.task_assignees a ON a.task_id = t.id
    JOIN public.profiles p ON p.id = a.user_id AND p.status = 'active' AND p.deleted_at IS NULL
    WHERE t.deleted_at IS NULL AND t.status <> 'done' AND t.due_date IS NOT NULL AND (NOT a.reminders_muted OR a.my_reminders IS NOT NULL)
      AND t.due_date >= _day - 366
    ORDER BY t.id, a.user_id
  LOOP
    _kind := CASE WHEN NOT _x.reminders_muted THEN public.task_reminder_kind(_x.task, _day) END;
    IF _kind IS NULL AND _x.my_reminders IS NOT NULL THEN
      _kind := public.task_reminder_kind(public.task_with_reminders(_x.task, _x.my_reminders), _day);
    END IF;
    CONTINUE WHEN _kind IS NULL;
    -- Still allowed to see the task (moved branch, lost the role...): no reminder.
    CONTINUE WHEN NOT public.task_visible_to(_x.id, _x.assignee);
    INSERT INTO public.task_reminder_log (task_id, user_id, day, kind) VALUES (_x.id, _x.assignee, _day, _kind)
    ON CONFLICT (task_id, user_id, day) DO NOTHING;
    CONTINUE WHEN NOT FOUND;
    _notice := public.notify(_x.assignee, 'task_reminder', 'task', _x.id, _x.title, '/tasks?task=' || _x.id,
      jsonb_build_object('due_date', _x.due_date, 'reminder', _kind));
    IF public.wants_task_reminder_emails(_x.assignee) THEN
      INSERT INTO public.email_outbox (user_id, notification_id, template, payload)
      VALUES (_x.assignee, _notice, 'task_reminder', jsonb_build_object('task_title', _x.title, 'due_date', _x.due_date,
        'link', '/tasks?task=' || _x.id, 'reminder', _kind));
    END IF;
    _n := _n + 1;
  END LOOP;
  RETURN _n;
END $$;

-- get_task adds the caller's own reminders.
CREATE OR REPLACE FUNCTION public.get_task(p_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _t public.tasks;
BEGIN
  IF NOT public.has_accepted_privacy_notice() OR NOT public.can_view_task(p_id) THEN RETURN NULL; END IF;
  SELECT * INTO _t FROM public.tasks WHERE id = p_id;
  RETURN public.task_json(_t) || jsonb_build_object(
    'reminders', jsonb_build_object('before_days', to_jsonb(_t.remind_before_days), 'repeat_kind', _t.repeat_kind,
      'repeat_every_days', _t.repeat_every_days, 'repeat_start', _t.repeat_start, 'overdue_every_days', _t.overdue_every_days),
    'my_reminders_muted', (SELECT reminders_muted FROM public.task_assignees WHERE task_id = p_id AND user_id = auth.uid()),
    'my_reminders', (SELECT my_reminders FROM public.task_assignees WHERE task_id = p_id AND user_id = auth.uid()),
    'event_title', (SELECT title FROM public.events WHERE id = _t.event_id AND public.can_view_event(id)),
    'meeting_title', (SELECT title FROM public.meetings WHERE id = _t.meeting_id AND public.can_view_meeting(id)),
    'decision_text', (SELECT d.text FROM public.meeting_decisions d WHERE d.id = _t.decision_id AND public.can_view_meeting(d.meeting_id)));
END $$;

-- ---------------------------------------------------------------------------------------------------------------
-- Grants

REVOKE ALL ON FUNCTION public.notification_type(text), public.notification_type_locked(text), public.notification_default_delivery(uuid),
  public.notification_setting(uuid, text), public.user_manages_scope(uuid, text, uuid, uuid), public.scope_reviewers(text, uuid, uuid),
  public.review_waiting_for(uuid), public.review_notice_refresh(uuid), public.work_requests_review_refresh(),
  public.event_requests_review_refresh(), public.volunteer_applications_review_refresh(), public.clean_reminders(jsonb),
  public.task_with_reminders(public.tasks, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.run_notification_digest(timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.run_notification_digest(timestamptz) TO service_role;
REVOKE ALL ON FUNCTION public.get_notification_settings(), public.set_notification_setting(text, boolean, text),
  public.get_review_waiting(), public.set_my_task_reminders(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_notification_settings(), public.set_notification_setting(text, boolean, text),
  public.get_review_waiting(), public.set_my_task_reminders(uuid, jsonb) TO authenticated;

-- Existing open requests: one grouped notice per reviewer (replacing the per-request "received" notices).
DELETE FROM public.notifications WHERE kind IN ('task_request_received', 'meeting_request_received') AND read_at IS NULL;
DO $$
DECLARE _u uuid;
BEGIN
  FOR _u IN SELECT DISTINCT p.id FROM public.profiles p WHERE p.status = 'active' AND p.deleted_at IS NULL
      AND public.has_any_role(p.id, ARRAY['volunteer', 'branch_manager', 'regional_director', 'national_coordinator']::public.app_role[]) LOOP
    PERFORM public.review_notice_refresh(_u);
  END LOOP;
END $$;

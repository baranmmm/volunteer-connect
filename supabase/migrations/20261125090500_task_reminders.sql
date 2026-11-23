-- Daily task reminders (09:00 Europe/London). run_task_reminders is idempotent: task_reminder_log allows at most one
-- reminder per task, person and London day, so running it twice (pg_cron and the GitHub workflow, or a retry) never
-- sends twice. Before 09:00 London time it does nothing, so a UTC schedule at 08:05 and 09:05 covers summer and winter.
-- A reminder is due for an assignee when the task has a due date, is not done and not deleted, the person is still an
-- assignee (active, not deleted, can still see the task) and has not muted it, and today is:
-- * "before": N days before the due date, for any N in remind_before_days;
-- * "repeat": from repeat_start until the due date, daily, every N days or weekly;
-- * "overdue": every overdue_every_days days after the due date.
-- Each reminder creates an in-app notice and, unless the person turned "Email reminders for tasks" off, a pending
-- email_outbox row (template task_reminder; nothing sends it yet).

CREATE FUNCTION public.task_reminder_kind(_t public.tasks, _day date) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE
    WHEN _t.due_date IS NULL OR _t.status = 'done' OR _t.deleted_at IS NOT NULL THEN NULL
    WHEN _day > _t.due_date THEN
      CASE WHEN _t.overdue_every_days IS NOT NULL AND (_day - _t.due_date) % _t.overdue_every_days = 0 THEN 'overdue' END
    WHEN (_t.due_date - _day) = ANY (_t.remind_before_days) THEN 'before'
    WHEN _t.repeat_kind <> 'none' AND _day >= coalesce(_t.repeat_start, _day)
      AND (_day - coalesce(_t.repeat_start, _day)) % (CASE _t.repeat_kind WHEN 'daily' THEN 1 WHEN 'weekly' THEN 7 ELSE coalesce(_t.repeat_every_days, 1) END) = 0
      THEN 'repeat'
    END
$$;

-- Service role (scheduler) only. Returns the number of reminders created.
CREATE FUNCTION public.run_task_reminders(p_now timestamptz DEFAULT now()) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _local timestamp := p_now AT TIME ZONE 'Europe/London'; _day date := (p_now AT TIME ZONE 'Europe/London')::date;
  _x record; _n integer := 0; _notice uuid; _kind text;
BEGIN
  IF extract(hour FROM _local) < 9 THEN RETURN 0; END IF;
  FOR _x IN
    SELECT t AS task, t.id, t.title, t.due_date, a.user_id AS assignee FROM public.tasks t JOIN public.task_assignees a ON a.task_id = t.id
    JOIN public.profiles p ON p.id = a.user_id AND p.status = 'active' AND p.deleted_at IS NULL
    WHERE t.deleted_at IS NULL AND t.status <> 'done' AND t.due_date IS NOT NULL AND NOT a.reminders_muted
      AND t.due_date >= _day - 366
    ORDER BY t.id, a.user_id
  LOOP
    _kind := public.task_reminder_kind(_x.task, _day);
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

-- Whether a given person (not the caller) can see a task: the same rules as can_view_task.
CREATE FUNCTION public.task_visible_to(_task uuid, _uid uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.is_active_person(_uid) AND NOT public.is_follower(_uid)
    AND EXISTS (SELECT 1 FROM public.tasks t WHERE t.id = _task AND t.deleted_at IS NULL AND (
      t.created_by = _uid
      OR EXISTS (SELECT 1 FROM public.task_assignees a WHERE a.task_id = t.id AND a.user_id = _uid)
      OR (t.scope = 'branch' AND public.is_branch_member(_uid, t.branch_id))
      OR EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = _uid AND r.role = 'regional_director' AND r.region_id = t.region_id)))
    -- An assignee whose role changed so that they could no longer be assigned here stops getting reminders.
    AND EXISTS (SELECT 1 FROM public.tasks t WHERE t.id = _task AND CASE t.scope
      WHEN 'national' THEN public.has_any_role(_uid, ARRAY['regional_director', 'branch_manager', 'national_coordinator']::public.app_role[])
      ELSE public.in_work_scope('region', NULL, t.region_id, _uid) END)
$$;

REVOKE ALL ON FUNCTION public.task_reminder_kind(public.tasks, date), public.run_task_reminders(timestamptz), public.task_visible_to(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.run_task_reminders(timestamptz) TO service_role;

-- pg_cron when the project has it (hourly at :05 08–09 UTC = 09:05 London all year; the function skips earlier hours).
-- Otherwise the GitHub workflow "Task reminders" calls /api/public/task-reminders at the same times.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'pg_cron') THEN
    CREATE EXTENSION IF NOT EXISTS pg_cron;
    PERFORM cron.schedule('task-reminders', '5 8,9 * * *', 'SELECT public.run_task_reminders()');
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pg_cron is not available: task reminders run from the scheduled workflow';
END $$;

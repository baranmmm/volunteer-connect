-- Tasks: branch, region and national tasks with assignees, reminders settings, links to events and meeting decisions,
-- and upward task requests. Clients only read (RLS); every write is a SECURITY DEFINER RPC that starts with
-- require_privacy_accepted(). Followers get nothing.
-- Visibility: every member (volunteer and up) of a branch sees the branch's tasks; the Regional Director sees every
-- task in the region; region tasks are also visible to the region's Branch Managers and to assignees; national tasks
-- to National Coordinators and assignees. Creators always see their tasks.
-- Assigning: Branch Manager → volunteers and Branch Managers of the branch; Regional Director → anyone in the region;
-- National Coordinator (national tasks) → Regional Directors, Branch Managers and National Coordinators, never
-- volunteers; a volunteer → only themselves (a self-task in their branch).

CREATE TABLE public.tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope text NOT NULL CHECK (scope IN ('branch', 'region', 'national')),
  branch_id uuid REFERENCES public.branches(id),
  region_id uuid REFERENCES public.regions(id),
  title text NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 200),
  description text CHECK (char_length(description) <= 5000),
  status text NOT NULL DEFAULT 'todo' CHECK (status IN ('todo', 'in_progress', 'blocked', 'done')),
  priority text NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
  due_date date,
  self_task boolean NOT NULL DEFAULT false,
  event_id uuid REFERENCES public.events(id) ON DELETE SET NULL,
  meeting_id uuid REFERENCES public.meetings(id) ON DELETE SET NULL,
  decision_id uuid REFERENCES public.meeting_decisions(id) ON DELETE SET NULL,
  -- Reminders (only used while there is a due date and the task is not done).
  remind_before_days integer[] NOT NULL DEFAULT '{3}' CHECK (cardinality(remind_before_days) <= 6 AND 0 < ALL (remind_before_days) AND 365 >= ALL (remind_before_days)),
  repeat_kind text NOT NULL DEFAULT 'none' CHECK (repeat_kind IN ('none', 'daily', 'every_n', 'weekly')),
  repeat_every_days integer CHECK (repeat_every_days BETWEEN 2 AND 90),
  repeat_start date,
  overdue_every_days integer CHECK (overdue_every_days BETWEEN 1 AND 90),
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  source_request_id uuid,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  deleted_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  CONSTRAINT tasks_scope_shape CHECK ((scope = 'branch' AND branch_id IS NOT NULL AND region_id IS NOT NULL)
    OR (scope = 'region' AND branch_id IS NULL AND region_id IS NOT NULL) OR (scope = 'national' AND branch_id IS NULL AND region_id IS NULL)),
  CONSTRAINT tasks_repeat_shape CHECK (repeat_kind <> 'every_n' OR repeat_every_days IS NOT NULL)
);
CREATE INDEX tasks_branch_idx ON public.tasks (branch_id) WHERE deleted_at IS NULL;
CREATE INDEX tasks_region_idx ON public.tasks (region_id) WHERE deleted_at IS NULL;
CREATE INDEX tasks_due_idx ON public.tasks (due_date) WHERE deleted_at IS NULL AND status <> 'done';
CREATE INDEX tasks_event_idx ON public.tasks (event_id) WHERE event_id IS NOT NULL;
CREATE INDEX tasks_decision_idx ON public.tasks (decision_id) WHERE decision_id IS NOT NULL;

CREATE TABLE public.task_assignees (
  task_id uuid NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  assigned_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  reminders_muted boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (task_id, user_id)
);
CREATE INDEX task_assignees_user_idx ON public.task_assignees (user_id);

-- At most one reminder per task, person and London day (the scheduler's idempotency key).
CREATE TABLE public.task_reminder_log (
  task_id uuid NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  day date NOT NULL,
  kind text NOT NULL CHECK (kind IN ('before', 'repeat', 'overdue')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (task_id, user_id, day)
);

CREATE TABLE public.task_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  target_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  scope text NOT NULL CHECK (scope IN ('branch', 'national')),
  branch_id uuid REFERENCES public.branches(id),
  region_id uuid REFERENCES public.regions(id),
  title text NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 200),
  description text CHECK (char_length(description) <= 5000),
  priority text NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
  due_date date,
  status text NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted', 'accepted', 'declined', 'withdrawn')),
  decline_reason text CHECK (char_length(decline_reason) <= 1000),
  task_id uuid REFERENCES public.tasks(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT task_requests_decline_reason CHECK (status <> 'declined' OR char_length(btrim(coalesce(decline_reason, ''))) >= 10)
);
CREATE INDEX task_requests_target_idx ON public.task_requests (target_id, status);
CREATE INDEX task_requests_requester_idx ON public.task_requests (requester_id, created_at DESC);

ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_assignees ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_reminder_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.tasks, public.task_assignees, public.task_reminder_log, public.task_requests FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.tasks, public.task_assignees, public.task_requests TO authenticated;
GRANT ALL ON public.tasks, public.task_assignees, public.task_reminder_log, public.task_requests TO service_role;
CREATE POLICY task_reminder_log_service ON public.task_reminder_log FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE TRIGGER tasks_touch BEFORE UPDATE ON public.tasks FOR EACH ROW EXECUTE FUNCTION public.work_touch();
CREATE TRIGGER task_requests_touch BEFORE UPDATE ON public.task_requests FOR EACH ROW EXECUTE FUNCTION public.work_touch();

-- ---------------------------------------------------------------------------------------------------------------
-- Visibility, editing, assigning

CREATE FUNCTION public.can_view_task(_task uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.is_active_person(auth.uid()) AND public.session_ok() AND NOT public.is_follower(auth.uid())
    AND EXISTS (SELECT 1 FROM public.tasks t WHERE t.id = _task AND t.deleted_at IS NULL AND (
      public.can_manage_event_scope(t.scope, t.branch_id, t.region_id)
      OR t.created_by = auth.uid()
      OR EXISTS (SELECT 1 FROM public.task_assignees a WHERE a.task_id = t.id AND a.user_id = auth.uid())
      OR (t.scope = 'branch' AND public.is_branch_member(auth.uid(), t.branch_id))
      OR (t.scope = 'region' AND public.has_role(auth.uid(), 'branch_manager')
          AND EXISTS (SELECT 1 FROM public.branches b WHERE b.id = public.get_user_branch(auth.uid()) AND b.region_id = t.region_id))))
$$;

-- Edit everything: the creator and the managers of the scope (Branch Manager of the branch, Regional Director of the
-- region, National Coordinators for national tasks). A volunteer's self-task: the volunteer.
CREATE FUNCTION public.can_edit_task(_task uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.is_active_person(auth.uid()) AND public.session_ok() AND (public.is_member(auth.uid()) OR public.is_nc())
    AND EXISTS (SELECT 1 FROM public.tasks t WHERE t.id = _task AND t.deleted_at IS NULL
      AND (t.created_by = auth.uid() OR public.can_manage_event_scope(t.scope, t.branch_id, t.region_id)))
$$;

-- Status only: editors and assignees.
CREATE FUNCTION public.can_set_task_status(_task uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.can_edit_task(_task) OR (public.can_view_task(_task)
    AND EXISTS (SELECT 1 FROM public.task_assignees WHERE task_id = _task AND user_id = auth.uid()))
$$;

-- May the caller assign _user to a task in this scope? Managers by their rights; others only themselves.
CREATE FUNCTION public.task_assignee_ok(_scope text, _branch uuid, _region uuid, _user uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.is_active_person(_user) AND CASE
    WHEN _scope = 'national' THEN public.is_nc()
      AND public.has_any_role(_user, ARRAY['regional_director', 'branch_manager', 'national_coordinator']::public.app_role[])
    WHEN EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'regional_director' AND region_id = _region)
      AND public.can_manage_event_scope(_scope, _branch, _region) THEN public.in_work_scope('region', NULL, _region, _user)
    WHEN _scope = 'branch' AND public.can_manage_event_scope(_scope, _branch, _region) THEN public.is_branch_member(_user, _branch)
      AND public.has_any_role(_user, ARRAY['volunteer', 'branch_manager']::public.app_role[])
    ELSE _user = auth.uid() AND _scope = 'branch' AND public.is_branch_member(_user, _branch) END
$$;

-- Creating in a scope: managers of the scope, or a member of the branch for a self-task.
CREATE FUNCTION public.can_create_task(_scope text, _branch uuid, _region uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.work_scope_valid(_scope, _branch, _region) AND (public.can_manage_event_scope(_scope, _branch, _region)
    OR (_scope = 'branch' AND public.is_active_person(auth.uid()) AND public.session_ok() AND public.is_branch_member(auth.uid(), _branch)))
$$;

CREATE POLICY tasks_read ON public.tasks FOR SELECT TO authenticated USING (deleted_at IS NULL AND public.can_view_task(id));
CREATE POLICY task_assignees_read ON public.task_assignees FOR SELECT TO authenticated USING (public.can_view_task(task_id));
CREATE POLICY task_requests_read ON public.task_requests FOR SELECT TO authenticated
  USING (requester_id = (SELECT auth.uid()) OR (target_id = (SELECT auth.uid()) AND (SELECT public.session_ok())));
CREATE POLICY privacy_notice_required ON public.tasks AS RESTRICTIVE FOR SELECT TO authenticated USING ((SELECT public.has_accepted_privacy_notice()));
CREATE POLICY privacy_notice_required ON public.task_assignees AS RESTRICTIVE FOR SELECT TO authenticated USING ((SELECT public.has_accepted_privacy_notice()));
CREATE POLICY privacy_notice_required ON public.task_requests AS RESTRICTIVE FOR SELECT TO authenticated USING ((SELECT public.has_accepted_privacy_notice()));

-- ---------------------------------------------------------------------------------------------------------------
-- Internal: fields, assignees, notices

CREATE FUNCTION public.task_locked(_id uuid) RETURNS public.tasks
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _t public.tasks;
BEGIN
  SELECT * INTO _t FROM public.tasks WHERE id = _id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Task not found'; END IF;
  RETURN _t;
END $$;

CREATE FUNCTION public.task_fields(_t public.tasks, p jsonb) RETURNS public.tasks
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _r jsonb;
BEGIN
  IF p ? 'title' THEN _t.title := btrim(coalesce(p->>'title', '')); END IF;
  IF p ? 'description' THEN _t.description := nullif(btrim(coalesce(p->>'description', '')), ''); END IF;
  IF p ? 'status' THEN _t.status := p->>'status'; END IF;
  IF p ? 'priority' THEN _t.priority := p->>'priority'; END IF;
  IF p ? 'due_date' THEN _t.due_date := nullif(p->>'due_date', '')::date; END IF;
  IF p ? 'event_id' THEN _t.event_id := nullif(p->>'event_id', '')::uuid; END IF;
  IF p ? 'reminders' THEN
    _r := coalesce(p->'reminders', '{}'::jsonb);
    _t.remind_before_days := CASE WHEN jsonb_typeof(_r->'before_days') = 'array'
      THEN ARRAY(SELECT DISTINCT x::integer FROM jsonb_array_elements_text(_r->'before_days') x ORDER BY 1) ELSE '{}'::integer[] END;
    _t.repeat_kind := coalesce(_r->>'repeat_kind', 'none');
    _t.repeat_every_days := CASE WHEN _t.repeat_kind = 'every_n' THEN nullif(_r->>'repeat_every_days', '')::integer END;
    _t.repeat_start := CASE WHEN _t.repeat_kind <> 'none' THEN coalesce(nullif(_r->>'repeat_start', '')::date,
      (now() AT TIME ZONE 'Europe/London')::date) END;
    _t.overdue_every_days := nullif(_r->>'overdue_every_days', '')::integer;
  END IF;
  IF char_length(coalesce(_t.title, '')) NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'Title is required'; END IF;
  IF _t.status NOT IN ('todo', 'in_progress', 'blocked', 'done') OR _t.priority NOT IN ('low', 'medium', 'high', 'urgent')
    OR _t.repeat_kind NOT IN ('none', 'daily', 'every_n', 'weekly') THEN RAISE EXCEPTION 'Not allowed'; END IF;
  IF cardinality(_t.remind_before_days) > 6 OR EXISTS (SELECT 1 FROM unnest(_t.remind_before_days) x WHERE x NOT BETWEEN 1 AND 365)
    OR (_t.repeat_kind = 'every_n' AND _t.repeat_every_days NOT BETWEEN 2 AND 90)
    OR (_t.repeat_kind = 'every_n' AND _t.repeat_every_days IS NULL)
    OR _t.overdue_every_days NOT BETWEEN 1 AND 90 THEN
    RAISE EXCEPTION 'Reminder settings are not valid';
  END IF;
  -- A linked event: one the caller can see, in the same scope.
  IF _t.event_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.events e WHERE e.id = _t.event_id AND e.deleted_at IS NULL
      AND public.can_view_event(e.id) AND e.scope = _t.scope AND e.branch_id IS NOT DISTINCT FROM _t.branch_id
      AND e.region_id IS NOT DISTINCT FROM _t.region_id) THEN
    RAISE EXCEPTION 'Linked event must be in the same scope';
  END IF;
  RETURN _t;
END $$;

-- Sets the assignee list; returns the ids that are new. New assignees get "X assigned you" (never for oneself).
CREATE FUNCTION public.task_set_assignees(_t public.tasks, _ids uuid[]) RETURNS uuid[]
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _new uuid[]; _u uuid;
BEGIN
  _ids := ARRAY(SELECT DISTINCT x FROM unnest(coalesce(_ids, '{}'::uuid[])) x WHERE x IS NOT NULL);
  IF cardinality(_ids) > 50 THEN RAISE EXCEPTION 'Too many assignees'; END IF;
  _new := ARRAY(SELECT x FROM unnest(_ids) x WHERE NOT EXISTS (SELECT 1 FROM public.task_assignees WHERE task_id = _t.id AND user_id = x));
  FOREACH _u IN ARRAY _new LOOP
    IF NOT public.task_assignee_ok(_t.scope, _t.branch_id, _t.region_id, _u) THEN RAISE EXCEPTION 'This person cannot be assigned'; END IF;
  END LOOP;
  DELETE FROM public.task_assignees WHERE task_id = _t.id AND NOT (user_id = ANY (_ids));
  INSERT INTO public.task_assignees (task_id, user_id, assigned_by) SELECT _t.id, x, auth.uid() FROM unnest(_new) x;
  FOREACH _u IN ARRAY _new LOOP
    PERFORM public.notify(_u, 'task_assigned', 'task', _t.id, _t.title, '/tasks?task=' || _t.id,
      jsonb_build_object('due_date', _t.due_date));
  END LOOP;
  RETURN _new;
END $$;

-- Internal create (also used when a task request is accepted).
CREATE FUNCTION public.task_insert(_scope text, _branch uuid, _region uuid, p jsonb, _assignees uuid[], _source uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _t public.tasks; _manager boolean; _decision public.meeting_decisions;
BEGIN
  IF NOT public.can_create_task(_scope, _branch, _region) THEN RAISE EXCEPTION 'Not allowed'; END IF;
  _manager := public.can_manage_event_scope(_scope, _branch, _region);
  _t.id := gen_random_uuid(); _t.scope := _scope; _t.branch_id := _branch; _t.region_id := _region;
  _t.status := 'todo'; _t.priority := 'medium'; _t.remind_before_days := '{3}'; _t.repeat_kind := 'none';
  _t := public.task_fields(_t, p);
  _t.self_task := NOT _manager;
  -- A volunteer's own task: assigned to them only.
  IF NOT _manager THEN _assignees := ARRAY[auth.uid()]; END IF;
  -- From a meeting decision: the caller can see the meeting, and the task is in the meeting's scope.
  IF nullif(p->>'decision_id', '') IS NOT NULL THEN
    SELECT * INTO _decision FROM public.meeting_decisions WHERE id = (p->>'decision_id')::uuid;
    IF NOT FOUND OR NOT public.can_edit_meeting(_decision.meeting_id) OR NOT EXISTS (SELECT 1 FROM public.meetings m
        WHERE m.id = _decision.meeting_id AND m.scope = _scope AND m.branch_id IS NOT DISTINCT FROM _branch AND m.region_id IS NOT DISTINCT FROM _region) THEN
      RAISE EXCEPTION 'Not allowed';
    END IF;
    _t.decision_id := _decision.id; _t.meeting_id := _decision.meeting_id;
  END IF;
  INSERT INTO public.tasks (id, scope, branch_id, region_id, title, description, status, priority, due_date, self_task, event_id,
    meeting_id, decision_id, remind_before_days, repeat_kind, repeat_every_days, repeat_start, overdue_every_days, created_by,
    source_request_id, completed_at)
  VALUES (_t.id, _scope, _branch, _region, _t.title, _t.description, _t.status, _t.priority, _t.due_date, _t.self_task, _t.event_id,
    _t.meeting_id, _t.decision_id, _t.remind_before_days, _t.repeat_kind, _t.repeat_every_days, _t.repeat_start, _t.overdue_every_days,
    auth.uid(), _source, CASE WHEN _t.status = 'done' THEN now() END)
  RETURNING * INTO _t;
  PERFORM public.task_set_assignees(_t, _assignees);
  RETURN _t.id;
END $$;

-- An assignee changed the status: the creator hears about it.
CREATE FUNCTION public.task_status_notice(_t public.tasks, _old text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF _t.status IS DISTINCT FROM _old AND _t.created_by IS DISTINCT FROM auth.uid()
    AND EXISTS (SELECT 1 FROM public.task_assignees WHERE task_id = _t.id AND user_id = auth.uid()) THEN
    PERFORM public.notify(_t.created_by, 'task_status_changed', 'task', _t.id, _t.title, '/tasks?task=' || _t.id,
      jsonb_build_object('status', _t.status, 'previous', _old));
  END IF;
END $$;

-- ---------------------------------------------------------------------------------------------------------------
-- Client RPCs: tasks

CREATE FUNCTION public.create_task(p jsonb) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _scope text := p->>'scope'; _branch uuid := nullif(p->>'branch_id', '')::uuid; _region uuid := nullif(p->>'region_id', '')::uuid;
BEGIN
  PERFORM public.require_privacy_accepted();
  PERFORM public.work_actor();
  IF _scope = 'branch' THEN SELECT region_id INTO _region FROM public.branches WHERE id = _branch; END IF;
  IF _scope = 'national' THEN _branch := NULL; _region := NULL; END IF;
  RETURN public.task_insert(_scope, _branch, _region, p, public.json_uuid_array(p->'assignee_ids'), NULL);
END $$;

-- Full edit (editors). The scope does not change.
CREATE FUNCTION public.update_task(p_id uuid, p jsonb) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _old public.tasks; _t public.tasks;
BEGIN
  PERFORM public.require_privacy_accepted();
  PERFORM public.work_actor();
  _old := public.task_locked(p_id);
  IF NOT public.can_edit_task(p_id) THEN RAISE EXCEPTION 'Not allowed'; END IF;
  _t := public.task_fields(_old, p);
  UPDATE public.tasks SET title = _t.title, description = _t.description, status = _t.status, priority = _t.priority, due_date = _t.due_date,
    event_id = _t.event_id, remind_before_days = _t.remind_before_days, repeat_kind = _t.repeat_kind, repeat_every_days = _t.repeat_every_days,
    repeat_start = _t.repeat_start, overdue_every_days = _t.overdue_every_days,
    completed_at = CASE WHEN _t.status = 'done' THEN coalesce(_old.completed_at, now()) END
  WHERE id = p_id;
  -- A volunteer's self-task stays theirs alone.
  IF p ? 'assignee_ids' AND NOT _old.self_task THEN PERFORM public.task_set_assignees(_t, public.json_uuid_array(p->'assignee_ids')); END IF;
  PERFORM public.task_status_notice(_t, _old.status);
  RETURN p_id;
END $$;

-- Status only (assignees and editors). Kanban drag and drop uses this.
CREATE FUNCTION public.set_task_status(p_id uuid, p_status text) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _t public.tasks; _old text;
BEGIN
  PERFORM public.require_privacy_accepted();
  PERFORM public.work_actor();
  _t := public.task_locked(p_id);
  IF NOT public.can_set_task_status(p_id) THEN RAISE EXCEPTION 'Not allowed'; END IF;
  IF p_status NOT IN ('todo', 'in_progress', 'blocked', 'done') THEN RAISE EXCEPTION 'Not allowed'; END IF;
  _old := _t.status;
  IF _old = p_status THEN RETURN p_status; END IF;
  UPDATE public.tasks SET status = p_status, completed_at = CASE WHEN p_status = 'done' THEN now() END WHERE id = p_id RETURNING * INTO _t;
  PERFORM public.task_status_notice(_t, _old);
  RETURN p_status;
END $$;

-- An assignee mutes (or unmutes) reminders for themselves on this task.
CREATE FUNCTION public.set_task_reminder_mute(p_id uuid, p_muted boolean) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.require_privacy_accepted();
  PERFORM public.work_actor();
  UPDATE public.task_assignees SET reminders_muted = coalesce(p_muted, false) WHERE task_id = p_id AND user_id = auth.uid()
    AND public.can_view_task(p_id);
  IF NOT FOUND THEN RAISE EXCEPTION 'Not allowed'; END IF;
  RETURN coalesce(p_muted, false);
END $$;

-- To the Recycle Bin.
CREATE FUNCTION public.delete_task(p_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _t public.tasks;
BEGIN
  PERFORM public.require_privacy_accepted();
  PERFORM public.work_actor();
  _t := public.task_locked(p_id);
  IF NOT public.can_edit_task(p_id) THEN RAISE EXCEPTION 'Not allowed'; END IF;
  UPDATE public.tasks SET deleted_at = now(), deleted_by = auth.uid() WHERE id = p_id;
  INSERT INTO public.recycle_bin_audit_log (actor_id, item_type, item_id, action, branch_id, region_id)
  VALUES (auth.uid(), 'task', p_id, 'delete', _t.branch_id, _t.region_id);
END $$;

CREATE FUNCTION public.task_json(_t public.tasks) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object('id', _t.id, 'scope', _t.scope, 'branch_id', _t.branch_id, 'region_id', _t.region_id,
    'branch', (SELECT name FROM public.branches WHERE id = _t.branch_id), 'region', (SELECT name FROM public.regions WHERE id = _t.region_id),
    'title', _t.title, 'description', _t.description, 'status', _t.status, 'priority', _t.priority, 'due_date', _t.due_date,
    'self_task', _t.self_task, 'created_by', _t.created_by,
    'created_by_name', (SELECT full_name FROM public.profiles WHERE id = _t.created_by AND deleted_at IS NULL),
    'event_id', _t.event_id, 'meeting_id', _t.meeting_id, 'decision_id', _t.decision_id, 'created_at', _t.created_at,
    'assignees', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'full_name', p.full_name) ORDER BY p.full_name, p.id), '[]'::jsonb)
      FROM public.task_assignees a JOIN public.profiles p ON p.id = a.user_id WHERE a.task_id = _t.id AND p.deleted_at IS NULL),
    'mine', EXISTS (SELECT 1 FROM public.task_assignees a WHERE a.task_id = _t.id AND a.user_id = auth.uid()),
    'can_edit', public.can_edit_task(_t.id), 'can_set_status', public.can_set_task_status(_t.id))
$$;

-- Every task the caller can see (newest due first among open ones; at most 1000).
CREATE FUNCTION public.list_tasks() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(jsonb_agg(public.task_json(t) ORDER BY t.due_date NULLS LAST, t.created_at, t.id), '[]'::jsonb)
  FROM (SELECT * FROM public.tasks t WHERE t.deleted_at IS NULL AND public.has_accepted_privacy_notice() AND public.can_view_task(t.id)
        ORDER BY (t.status = 'done'), t.due_date NULLS LAST, t.created_at, t.id LIMIT 1000) t
$$;

-- One task with reminders, my mute, the linked event and meeting (titles only when visible). NULL when not visible.
CREATE FUNCTION public.get_task(p_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _t public.tasks;
BEGIN
  IF NOT public.has_accepted_privacy_notice() OR NOT public.can_view_task(p_id) THEN RETURN NULL; END IF;
  SELECT * INTO _t FROM public.tasks WHERE id = p_id;
  RETURN public.task_json(_t) || jsonb_build_object(
    'reminders', jsonb_build_object('before_days', to_jsonb(_t.remind_before_days), 'repeat_kind', _t.repeat_kind,
      'repeat_every_days', _t.repeat_every_days, 'repeat_start', _t.repeat_start, 'overdue_every_days', _t.overdue_every_days),
    'my_reminders_muted', (SELECT reminders_muted FROM public.task_assignees WHERE task_id = p_id AND user_id = auth.uid()),
    'event_title', (SELECT title FROM public.events WHERE id = _t.event_id AND public.can_view_event(id)),
    'meeting_title', (SELECT title FROM public.meetings WHERE id = _t.meeting_id AND public.can_view_meeting(id)),
    'decision_text', (SELECT d.text FROM public.meeting_decisions d WHERE d.id = _t.decision_id AND public.can_view_meeting(d.meeting_id)));
END $$;

-- People the caller may assign in a scope (the picker). Empty when the caller cannot create there.
CREATE FUNCTION public.list_task_people(p_scope text, p_branch uuid DEFAULT NULL, p_region uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF p_scope = 'branch' THEN SELECT region_id INTO p_region FROM public.branches WHERE id = p_branch; END IF;
  IF NOT public.has_accepted_privacy_notice() OR NOT public.can_create_task(p_scope, p_branch, p_region) THEN RETURN '[]'::jsonb; END IF;
  RETURN (SELECT coalesce(jsonb_agg(x ORDER BY x->>'full_name', x->>'id'), '[]'::jsonb)
          FROM jsonb_array_elements(public.scope_people(CASE WHEN p_scope = 'national' THEN 'national' ELSE 'region' END,
            NULL, p_region)) x
          WHERE public.task_assignee_ok(p_scope, p_branch, p_region, (x->>'id')::uuid));
END $$;

-- The dashboard "My tasks" card: open and overdue counts, the next five by due date (London today).
CREATE FUNCTION public.get_my_task_summary() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH mine AS (
    SELECT t.* FROM public.tasks t JOIN public.task_assignees a ON a.task_id = t.id AND a.user_id = auth.uid()
    WHERE t.deleted_at IS NULL AND t.status <> 'done' AND public.has_accepted_privacy_notice() AND public.can_view_task(t.id))
  SELECT jsonb_build_object(
    'open', (SELECT count(*) FROM mine),
    'overdue', (SELECT count(*) FROM mine WHERE due_date < (now() AT TIME ZONE 'Europe/London')::date),
    'today', (now() AT TIME ZONE 'Europe/London')::date,
    'next', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'title', m.title, 'status', m.status, 'priority', m.priority,
        'due_date', m.due_date) ORDER BY m.due_date NULLS LAST, m.created_at, m.id), '[]'::jsonb)
      FROM (SELECT * FROM mine ORDER BY due_date NULLS LAST, created_at, id LIMIT 5) m))
$$;

-- Tasks linked to an event, for its managers (the event page).
CREATE FUNCTION public.get_event_tasks(p_event uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'title', t.title, 'status', t.status, 'due_date', t.due_date)
    ORDER BY t.due_date NULLS LAST, t.created_at, t.id), '[]'::jsonb)
  FROM public.tasks t
  WHERE t.event_id = p_event AND t.deleted_at IS NULL AND public.has_accepted_privacy_notice() AND public.can_manage_event(p_event)
    AND public.can_view_task(t.id)
$$;

-- ---------------------------------------------------------------------------------------------------------------
-- Task requests: a lower role asks a higher role in their chain to take on a task.

CREATE FUNCTION public.task_request_json(_r public.task_requests) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object('id', _r.id, 'kind', 'task', 'title', _r.title, 'description', _r.description, 'priority', _r.priority,
    'due_date', _r.due_date, 'status', _r.status, 'decline_reason', _r.decline_reason, 'task_id', _r.task_id, 'scope', _r.scope,
    'branch', (SELECT name FROM public.branches WHERE id = _r.branch_id),
    'requester_id', _r.requester_id, 'requester_name', (SELECT full_name FROM public.profiles WHERE id = _r.requester_id AND deleted_at IS NULL),
    'target_id', _r.target_id, 'target_name', (SELECT full_name FROM public.profiles WHERE id = _r.target_id AND deleted_at IS NULL),
    'created_at', _r.created_at, 'reviewed_at', _r.reviewed_at)
$$;

CREATE FUNCTION public.submit_task_request(p jsonb) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _me uuid; _target uuid := nullif(p->>'target_id', '')::uuid; _s record; _id uuid; _title text := btrim(coalesce(p->>'title', ''));
  _priority text := coalesce(nullif(p->>'priority', ''), 'medium');
BEGIN
  PERFORM public.require_privacy_accepted();
  _me := public.work_actor();
  IF NOT public.request_target_ok(_me, _target) THEN RAISE EXCEPTION 'This person cannot receive your request'; END IF;
  IF char_length(_title) NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'Title is required'; END IF;
  IF _priority NOT IN ('low', 'medium', 'high', 'urgent') THEN RAISE EXCEPTION 'Not allowed'; END IF;
  SELECT * INTO _s FROM public.request_scope_of(_me);
  INSERT INTO public.task_requests (requester_id, target_id, scope, branch_id, region_id, title, description, priority, due_date)
  VALUES (_me, _target, _s.scope, _s.branch_id, _s.region_id, _title, nullif(btrim(coalesce(p->>'description', '')), ''), _priority,
    nullif(p->>'due_date', '')::date)
  RETURNING id INTO _id;
  PERFORM public.notify(_target, 'task_request_received', 'task_request', _id, _title, '/requests?tab=review');
  RETURN _id;
END $$;

CREATE FUNCTION public.task_request_locked(_id uuid) RETURNS public.task_requests
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _r public.task_requests;
BEGIN
  SELECT * INTO _r FROM public.task_requests WHERE id = _id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Request not found'; END IF;
  RETURN _r;
END $$;

CREATE FUNCTION public.withdraw_task_request(p_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _r public.task_requests;
BEGIN
  PERFORM public.require_privacy_accepted();
  PERFORM public.work_actor();
  _r := public.task_request_locked(p_id);
  IF _r.requester_id IS DISTINCT FROM auth.uid() OR _r.status <> 'submitted' THEN RAISE EXCEPTION 'Not allowed'; END IF;
  UPDATE public.task_requests SET status = 'withdrawn' WHERE id = p_id;
END $$;

CREATE FUNCTION public.decline_task_request(p_id uuid, p_reason text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _r public.task_requests;
BEGIN
  PERFORM public.require_privacy_accepted();
  PERFORM public.work_actor();
  _r := public.task_request_locked(p_id);
  IF _r.target_id IS DISTINCT FROM auth.uid() OR _r.status <> 'submitted' THEN RAISE EXCEPTION 'Not allowed'; END IF;
  IF char_length(btrim(coalesce(p_reason, ''))) < 10 OR char_length(p_reason) > 1000 THEN RAISE EXCEPTION 'Decline reason is too short'; END IF;
  UPDATE public.task_requests SET status = 'declined', decline_reason = btrim(p_reason), reviewed_at = now() WHERE id = p_id;
  PERFORM public.notify(_r.requester_id, 'task_request_declined', 'task_request', p_id, _r.title, '/requests?tab=mine',
    jsonb_build_object('reason', btrim(p_reason)));
END $$;

-- Accepts: a task assigned to the target, in the target's scope that includes the requester's branch (the requester's
-- branch; national when a Regional Director asked a National Coordinator).
CREATE FUNCTION public.accept_task_request(p_id uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _r public.task_requests; _task uuid;
BEGIN
  PERFORM public.require_privacy_accepted();
  PERFORM public.work_actor();
  _r := public.task_request_locked(p_id);
  IF _r.target_id IS DISTINCT FROM auth.uid() OR _r.status <> 'submitted' THEN RAISE EXCEPTION 'Not allowed'; END IF;
  _task := public.task_insert(_r.scope, _r.branch_id, _r.region_id,
    jsonb_build_object('title', _r.title, 'description', _r.description, 'priority', _r.priority, 'due_date', _r.due_date),
    ARRAY[auth.uid()], p_id);
  UPDATE public.task_requests SET status = 'accepted', task_id = _task, reviewed_at = now() WHERE id = p_id;
  PERFORM public.notify(_r.requester_id, 'task_request_accepted', 'task_request', p_id, _r.title, '/tasks?task=' || _task);
  RETURN _task;
END $$;

CREATE FUNCTION public.list_my_task_requests() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(jsonb_agg(public.task_request_json(r) ORDER BY r.created_at DESC), '[]'::jsonb)
  FROM public.task_requests r WHERE r.requester_id = auth.uid() AND public.has_accepted_privacy_notice() AND public.session_ok()
$$;
CREATE FUNCTION public.list_task_requests_to_review(p_filter text DEFAULT 'open') RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(jsonb_agg(public.task_request_json(r) ORDER BY r.created_at DESC), '[]'::jsonb)
  FROM public.task_requests r WHERE r.target_id = auth.uid() AND public.has_accepted_privacy_notice() AND public.session_ok()
    AND CASE WHEN p_filter = 'decided' THEN r.status IN ('accepted', 'declined') ELSE r.status = 'submitted' END
$$;

-- Open task and meeting requests waiting for the caller (the Requests badge).
CREATE FUNCTION public.get_work_request_count() RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE WHEN public.session_ok() AND public.has_accepted_privacy_notice() THEN
    ((SELECT count(*) FROM public.task_requests WHERE target_id = auth.uid() AND status = 'submitted')
     + (SELECT count(*) FROM public.meeting_requests WHERE target_id = auth.uid() AND status = 'submitted'))::integer ELSE 0 END
$$;

-- ---------------------------------------------------------------------------------------------------------------
-- Grants

REVOKE ALL ON FUNCTION public.task_locked(uuid), public.task_fields(public.tasks, jsonb), public.task_set_assignees(public.tasks, uuid[]),
  public.task_insert(text, uuid, uuid, jsonb, uuid[], uuid), public.task_status_notice(public.tasks, text), public.task_json(public.tasks),
  public.task_request_json(public.task_requests), public.task_request_locked(uuid), public.task_assignee_ok(text, uuid, uuid, uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.can_view_task(uuid), public.can_edit_task(uuid), public.can_set_task_status(uuid), public.can_create_task(text, uuid, uuid),
  public.create_task(jsonb), public.update_task(uuid, jsonb), public.set_task_status(uuid, text), public.set_task_reminder_mute(uuid, boolean),
  public.delete_task(uuid), public.list_tasks(), public.get_task(uuid), public.list_task_people(text, uuid, uuid), public.get_my_task_summary(),
  public.get_event_tasks(uuid), public.submit_task_request(jsonb), public.withdraw_task_request(uuid), public.decline_task_request(uuid, text),
  public.accept_task_request(uuid), public.list_my_task_requests(), public.list_task_requests_to_review(text), public.get_work_request_count()
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_view_task(uuid), public.can_edit_task(uuid), public.can_set_task_status(uuid), public.can_create_task(text, uuid, uuid),
  public.create_task(jsonb), public.update_task(uuid, jsonb), public.set_task_status(uuid, text), public.set_task_reminder_mute(uuid, boolean),
  public.delete_task(uuid), public.list_tasks(), public.get_task(uuid), public.list_task_people(text, uuid, uuid), public.get_my_task_summary(),
  public.get_event_tasks(uuid), public.submit_task_request(jsonb), public.withdraw_task_request(uuid), public.decline_task_request(uuid, text),
  public.accept_task_request(uuid), public.list_my_task_requests(), public.list_task_requests_to_review(text), public.get_work_request_count()
  TO authenticated;

-- Volunteers create "@all" task groups for their own branch (approved by the user, 2026-11-26).
--
-- * Who: any active volunteer of a branch, for that branch only (besides its Branch Manager and the region's Regional
--   Director, as before). Followers, other branches, National Coordinators and anon stay refused.
-- * Members of a volunteer's group: every active volunteer of the branch and its Branch Manager(s), each with their own
--   task at once (no approval). Regional Directors and National Coordinators have no branch, so they are never members;
--   they get no notice about it. Groups created by a manager keep their member rule (task_group_people) unchanged.
-- * The Branch Manager(s) get one in-app notice "<name> created a task for all members: <title>" (kind
--   task_group_created, linking to the group) instead of the plain assignment notice for their own member task. It is an
--   assignment, so it uses the assignment notice type (always on, immediate). No email: in-app notices send none today
--   (only opted-in task reminders do).
-- * Editing and deleting stay as in 20261205090000 (can_edit_task_group): the creating volunteer, the branch's Branch
--   Manager or the region's Regional Director. Other members only change their own member task. The creating volunteer
--   may add members by the same member rule (task_group_add_member).
-- Additive: new internal helpers; create_task_group, task_group_add_member, notification_type and
-- get_unread_notification_counts are replaced (same signatures and grants); no table, policy or data change.

-- One person is a member of a volunteer's branch group: active, of that branch, a volunteer or Branch Manager (never a
-- Regional Director or National Coordinator).
CREATE FUNCTION public.task_group_member_ok(_branch uuid, _user uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = _user AND p.status = 'active' AND p.deleted_at IS NULL)
    AND public.is_branch_member(_user, _branch)
    AND public.has_any_role(_user, ARRAY['volunteer', 'branch_manager']::public.app_role[])
    AND NOT public.has_any_role(_user, ARRAY['regional_director', 'national_coordinator']::public.app_role[])
$$;

-- All members of a volunteer's branch group.
CREATE FUNCTION public.task_group_branch_people(_branch uuid) RETURNS uuid[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(array_agg(p.id ORDER BY p.full_name, p.id), '{}'::uuid[])
  FROM public.profiles p WHERE public.task_group_member_ok(_branch, p.id)
$$;

-- One member's task in a volunteer's group. The member rule replaces the caller's assignment rights (a volunteer may
-- not assign their Branch Manager otherwise). Branch Managers get the task_group_created notice, everyone else the
-- normal assignment notice (notify never notifies the creator themselves).
CREATE FUNCTION public.task_group_insert_member_task(_g public.task_groups, _body jsonb, _user uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _t public.tasks;
BEGIN
  IF NOT public.task_group_member_ok(_g.branch_id, _user) THEN RAISE EXCEPTION 'This person cannot be assigned'; END IF;
  _t.id := gen_random_uuid(); _t.scope := 'branch'; _t.branch_id := _g.branch_id; _t.region_id := _g.region_id;
  _t.status := 'todo'; _t.priority := 'medium'; _t.remind_before_days := '{}'; _t.repeat_kind := 'none';
  _t := public.task_fields(_t, _body - 'status');
  INSERT INTO public.tasks (id, scope, branch_id, region_id, title, description, status, priority, due_date, self_task, event_id,
    meeting_id, decision_id, remind_before_days, repeat_kind, repeat_every_days, repeat_start, overdue_every_days, created_by,
    group_id)
  VALUES (_t.id, 'branch', _g.branch_id, _g.region_id, _t.title, _t.description, 'todo', _t.priority, _t.due_date, false,
    _t.event_id, _g.meeting_id, _g.decision_id, _t.remind_before_days, _t.repeat_kind, _t.repeat_every_days, _t.repeat_start,
    _t.overdue_every_days, auth.uid(), _g.id)
  RETURNING * INTO _t;
  INSERT INTO public.task_assignees (task_id, user_id, assigned_by) VALUES (_t.id, _user, auth.uid());
  IF public.has_role(_user, 'branch_manager') THEN
    PERFORM public.notify(_user, 'task_group_created', 'task', _t.id, _g.title, '/tasks?group=' || _g.id,
      jsonb_build_object('due_date', _g.due_date, 'group_id', _g.id));
  ELSE
    PERFORM public.notify(_user, 'task_assigned', 'task', _t.id, _t.title, '/tasks?task=' || _t.id,
      jsonb_build_object('due_date', _t.due_date));
  END IF;
  RETURN _t.id;
END $$;

-- create_task_group as in 20261205090000, also for an active volunteer of the branch (their own branch only).
CREATE OR REPLACE FUNCTION public.create_task_group(p jsonb) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _branch uuid := nullif(p->>'branch_id', '')::uuid; _region uuid; _t public.tasks; _g public.task_groups;
  _decision public.meeting_decisions; _people uuid[]; _u uuid; _body jsonb; _task uuid; _manager boolean;
BEGIN
  PERFORM public.require_privacy_accepted();
  PERFORM public.work_actor();
  IF coalesce(p->>'scope', 'branch') <> 'branch' OR _branch IS NULL THEN RAISE EXCEPTION 'Not allowed'; END IF;
  SELECT region_id INTO _region FROM public.branches WHERE id = _branch;
  IF NOT public.work_scope_valid('branch', _branch, _region) THEN RAISE EXCEPTION 'Not allowed'; END IF;
  _manager := public.can_manage_event_scope('branch', _branch, _region);
  IF NOT _manager AND NOT (public.is_branch_member(auth.uid(), _branch) AND public.has_role(auth.uid(), 'volunteer')) THEN
    RAISE EXCEPTION 'Not allowed';
  END IF;
  -- The same field rules as a task (title, description, priority, due date, linked event, reminders).
  _t.id := gen_random_uuid(); _t.scope := 'branch'; _t.branch_id := _branch; _t.region_id := _region;
  _t.status := 'todo'; _t.priority := 'medium'; _t.remind_before_days := '{}'; _t.repeat_kind := 'none';
  _t := public.task_fields(_t, p - 'status');
  IF nullif(p->>'decision_id', '') IS NOT NULL THEN
    SELECT * INTO _decision FROM public.meeting_decisions WHERE id = (p->>'decision_id')::uuid;
    IF NOT FOUND OR NOT public.can_edit_meeting(_decision.meeting_id) OR NOT EXISTS (SELECT 1 FROM public.meetings m
        WHERE m.id = _decision.meeting_id AND m.scope = 'branch' AND m.branch_id = _branch) THEN
      RAISE EXCEPTION 'Not allowed';
    END IF;
  END IF;
  _people := CASE WHEN _manager THEN public.task_group_people(_branch, _region) ELSE public.task_group_branch_people(_branch) END;
  IF coalesce(cardinality(_people), 0) = 0 THEN RAISE EXCEPTION 'This group has no members to assign'; END IF;
  IF cardinality(_people) > 500 THEN RAISE EXCEPTION 'Too many assignees'; END IF;
  INSERT INTO public.task_groups (branch_id, region_id, title, description, priority, due_date, event_id, meeting_id, decision_id, created_by)
  VALUES (_branch, _region, _t.title, _t.description, _t.priority, _t.due_date, _t.event_id, _decision.meeting_id, _decision.id, auth.uid())
  RETURNING * INTO _g;
  _body := public.task_group_body(_g) || CASE WHEN p ? 'reminders' THEN jsonb_build_object('reminders', p->'reminders') ELSE '{}'::jsonb END;
  FOREACH _u IN ARRAY _people LOOP
    IF _manager THEN
      _task := public.task_insert('branch', _branch, _region, _body, ARRAY[_u], NULL);
      UPDATE public.tasks SET group_id = _g.id WHERE id = _task;
    ELSE
      PERFORM public.task_group_insert_member_task(_g, _body, _u);
    END IF;
  END LOOP;
  RETURN _g.id;
END $$;

-- task_group_add_member as in 20261205090000; an editor who is not a manager of the branch (the creating volunteer)
-- adds members by the volunteer group's member rule.
CREATE OR REPLACE FUNCTION public.task_group_add_member(_g public.task_groups, _user uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _task uuid; _manager boolean := public.can_manage_event_scope('branch', _g.branch_id, _g.region_id);
BEGIN
  IF _manager AND (NOT public.is_branch_member(_user, _g.branch_id) OR NOT public.task_assignee_ok('branch', _g.branch_id, _g.region_id, _user)) THEN
    RAISE EXCEPTION 'This person cannot be assigned';
  END IF;
  IF NOT _manager AND NOT public.task_group_member_ok(_g.branch_id, _user) THEN RAISE EXCEPTION 'This person cannot be assigned'; END IF;
  IF EXISTS (SELECT 1 FROM public.tasks t JOIN public.task_assignees a ON a.task_id = t.id
             WHERE t.group_id = _g.id AND t.deleted_at IS NULL AND a.user_id = _user) THEN
    RAISE EXCEPTION 'This person is already in the group';
  END IF;
  IF NOT _manager THEN RETURN public.task_group_insert_member_task(_g, public.task_group_body(_g), _user); END IF;
  _task := public.task_insert('branch', _g.branch_id, _g.region_id, public.task_group_body(_g), ARRAY[_user], NULL);
  UPDATE public.tasks SET group_id = _g.id WHERE id = _task;
  RETURN _task;
END $$;

-- notification_type as in 20261202090000, plus task_group_created (an assignment: always on, immediate).
CREATE OR REPLACE FUNCTION public.notification_type(_kind text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE
    WHEN _kind IN ('task_assigned', 'task_group_created') THEN 'task_assigned'
    WHEN _kind = 'task_note_mention' THEN 'mention'
    WHEN _kind IN ('review_waiting', 'task_request_received', 'meeting_request_received') THEN 'review'
    WHEN _kind = 'task_status_changed' THEN 'task_status'
    WHEN _kind = 'task_note_added' THEN 'task_note'
    WHEN _kind = 'task_reminder' THEN 'task_reminder'
    WHEN _kind LIKE 'meeting\_%' ESCAPE '\' AND _kind NOT LIKE 'meeting\_request\_%' ESCAPE '\' THEN 'meeting'
    WHEN _kind IN ('task_request_accepted', 'task_request_declined', 'meeting_request_approved', 'meeting_request_declined',
      'volunteer_application_approved', 'volunteer_application_declined') THEN 'request_decided'
    ELSE 'other' END
$$;

-- get_unread_notification_counts as in 20261128090000, with task_group_created in the Tasks badge.
CREATE OR REPLACE FUNCTION public.get_unread_notification_counts() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object(
    'tasks', count(*) FILTER (WHERE kind IN ('task_assigned', 'task_group_created', 'task_note_mention', 'task_note_added')),
    'requests', count(*) FILTER (WHERE entity_type IN ('task_request', 'meeting_request')),
    'meetings', count(*) FILTER (WHERE entity_type = 'meeting'),
    'total', count(*))
  FROM public.notifications
  WHERE user_id = auth.uid() AND read_at IS NULL AND NOT held AND public.session_ok() AND public.has_accepted_privacy_notice()
$$;

REVOKE ALL ON FUNCTION public.task_group_member_ok(uuid, uuid), public.task_group_branch_people(uuid),
  public.task_group_insert_member_task(public.task_groups, jsonb, uuid) FROM PUBLIC, anon, authenticated;

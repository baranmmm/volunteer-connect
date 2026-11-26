-- Task groups ("@all") and meeting carry-over.
--
-- * Task groups. Assigning a branch task to "@all" creates one task_groups row (title, description, priority, due
--   date, branch, creator, optional event / meeting decision link) and one ordinary task per active member of the
--   branch at save time, each with tasks.group_id. A member is someone the caller may assign in the branch who belongs
--   to it (is_branch_member + task_assignee_ok: volunteers and Branch Managers of the branch). Each member owns their
--   own task: status, notes, done, archive and their reminders work as for any task, and each member gets the normal
--   task_assigned notice (task_set_assignees → notify). Membership is a snapshot: editors add or remove members later
--   (set_task_group_members). Only the managers of the branch (its Branch Manager, the region's Regional Director)
--   create groups; the creator and those managers edit them (can_edit_task_group mirrors can_edit_task).
-- * Visibility. task_groups rows are read through RLS with the same rule as branch tasks: the branch's members, the
--   branch's managers, the creator and the group's members (can_view_task_group). Writes only through the
--   SECURITY DEFINER RPCs below, each starting with require_privacy_accepted().
-- * Derived status. A group's status is never stored: task_group_status() reads the live member tasks (all done →
--   done; any in progress or done → in progress; otherwise to do). Blocked members count as "to do" for the group's
--   status and are reported in the per-status counts.
-- * Editing the group's title, description, priority or due date writes them to every member task in the same
--   transaction. Deleting the group moves every member task to the Recycle Bin (one audit row each, like delete_task)
--   and then deletes the group row; tasks.group_id is ON DELETE SET NULL, so a member task restored from the Recycle
--   Bin comes back as an ordinary task. Removing a member moves their task to the Recycle Bin the same way.
-- * Reads: task_json gains group_id; get_task_group / list_task_groups return a group with its members, counts and
--   derived status; get_meeting and get_event_tasks return group_id on their task rows, so the meeting decision and
--   the event's "Linked tasks" can show one row per group.
-- * Carry-over. list_meeting_carry_over lists the unresolved agenda items of earlier meetings in the same scope (that
--   the caller may edit), with their decisions and not-done tasks. carry_over_agenda copies the chosen items and
--   decisions into a new meeting and moves (does not copy) the chosen tasks to the new decisions, all in one
--   transaction; a carried item is marked carried_to and is not offered again.

-- ---------------------------------------------------------------------------------------------------------------
-- Tables

CREATE TABLE public.task_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope text NOT NULL DEFAULT 'branch' CHECK (scope = 'branch'),
  branch_id uuid NOT NULL REFERENCES public.branches(id),
  region_id uuid NOT NULL REFERENCES public.regions(id),
  title text NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 200),
  description text CHECK (char_length(description) <= 5000),
  priority text NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
  due_date date,
  event_id uuid REFERENCES public.events(id) ON DELETE SET NULL,
  meeting_id uuid REFERENCES public.meetings(id) ON DELETE SET NULL,
  decision_id uuid REFERENCES public.meeting_decisions(id) ON DELETE SET NULL,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX task_groups_branch_idx ON public.task_groups (branch_id);
CREATE INDEX task_groups_region_idx ON public.task_groups (region_id);
CREATE INDEX task_groups_event_idx ON public.task_groups (event_id) WHERE event_id IS NOT NULL;
CREATE INDEX task_groups_meeting_idx ON public.task_groups (meeting_id) WHERE meeting_id IS NOT NULL;
CREATE INDEX task_groups_decision_idx ON public.task_groups (decision_id) WHERE decision_id IS NOT NULL;
CREATE INDEX task_groups_created_by_idx ON public.task_groups (created_by) WHERE created_by IS NOT NULL;

ALTER TABLE public.tasks ADD COLUMN group_id uuid REFERENCES public.task_groups(id) ON DELETE SET NULL;
CREATE INDEX tasks_group_idx ON public.tasks (group_id) WHERE group_id IS NOT NULL;

-- An agenda item carried into a later meeting (carry_over_agenda): not offered again.
ALTER TABLE public.meeting_agenda_items ADD COLUMN carried_to uuid REFERENCES public.meeting_agenda_items(id) ON DELETE SET NULL;
CREATE INDEX meeting_agenda_items_carried_to_idx ON public.meeting_agenda_items (carried_to) WHERE carried_to IS NOT NULL;

ALTER TABLE public.task_groups ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.task_groups FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.task_groups TO authenticated;
GRANT ALL ON public.task_groups TO service_role;
CREATE TRIGGER task_groups_touch BEFORE UPDATE ON public.task_groups FOR EACH ROW EXECUTE FUNCTION public.work_touch();

-- ---------------------------------------------------------------------------------------------------------------
-- Visibility and editing (the same rules as branch tasks)

CREATE FUNCTION public.can_view_task_group(_group uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.is_active_person(auth.uid()) AND public.session_ok() AND NOT public.is_follower(auth.uid())
    AND EXISTS (SELECT 1 FROM public.task_groups g WHERE g.id = _group AND (
      public.can_manage_event_scope('branch', g.branch_id, g.region_id)
      OR g.created_by = auth.uid()
      OR public.is_branch_member(auth.uid(), g.branch_id)
      OR EXISTS (SELECT 1 FROM public.tasks t JOIN public.task_assignees a ON a.task_id = t.id
                 WHERE t.group_id = g.id AND t.deleted_at IS NULL AND a.user_id = auth.uid())))
$$;

CREATE FUNCTION public.can_edit_task_group(_group uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.is_active_person(auth.uid()) AND public.session_ok() AND (public.is_member(auth.uid()) OR public.is_nc())
    AND EXISTS (SELECT 1 FROM public.task_groups g WHERE g.id = _group
      AND (g.created_by = auth.uid() OR public.can_manage_event_scope('branch', g.branch_id, g.region_id)))
$$;

CREATE POLICY task_groups_read ON public.task_groups FOR SELECT TO authenticated USING (public.can_view_task_group(id));
CREATE POLICY privacy_notice_required ON public.task_groups AS RESTRICTIVE FOR SELECT TO authenticated
  USING ((SELECT public.has_accepted_privacy_notice()));

-- ---------------------------------------------------------------------------------------------------------------
-- Internal helpers

-- The derived status of a group from its live member tasks.
CREATE FUNCTION public.task_group_status(_group uuid) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE WHEN count(*) = 0 THEN 'todo'
    WHEN bool_and(t.status = 'done') THEN 'done'
    WHEN bool_or(t.status IN ('in_progress', 'done')) THEN 'in_progress'
    ELSE 'todo' END
  FROM public.tasks t WHERE t.group_id = _group AND t.deleted_at IS NULL
$$;

CREATE FUNCTION public.task_group_locked(_id uuid) RETURNS public.task_groups
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _g public.task_groups;
BEGIN
  SELECT * INTO _g FROM public.task_groups WHERE id = _id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Task group not found'; END IF;
  RETURN _g;
END $$;

-- People who become members of a branch group: active people of the branch the caller may assign there.
CREATE FUNCTION public.task_group_people(_branch uuid, _region uuid) RETURNS uuid[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(array_agg(p.id ORDER BY p.full_name, p.id), '{}'::uuid[])
  FROM public.profiles p
  WHERE p.status = 'active' AND p.deleted_at IS NULL AND public.is_branch_member(p.id, _branch)
    AND public.task_assignee_ok('branch', _branch, _region, p.id)
$$;

-- The task body for a member's task, from the group (title, description, priority, due date, links).
CREATE FUNCTION public.task_group_body(_g public.task_groups) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_strip_nulls(jsonb_build_object('title', _g.title, 'description', _g.description, 'priority', _g.priority,
    'due_date', _g.due_date, 'event_id', _g.event_id, 'decision_id', _g.decision_id))
$$;

-- Creates one member's task in the group (task_insert checks the rights and sends the assignment notice).
CREATE FUNCTION public.task_group_add_member(_g public.task_groups, _user uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _task uuid;
BEGIN
  IF NOT public.is_branch_member(_user, _g.branch_id) OR NOT public.task_assignee_ok('branch', _g.branch_id, _g.region_id, _user) THEN
    RAISE EXCEPTION 'This person cannot be assigned';
  END IF;
  IF EXISTS (SELECT 1 FROM public.tasks t JOIN public.task_assignees a ON a.task_id = t.id
             WHERE t.group_id = _g.id AND t.deleted_at IS NULL AND a.user_id = _user) THEN
    RAISE EXCEPTION 'This person is already in the group';
  END IF;
  _task := public.task_insert('branch', _g.branch_id, _g.region_id, public.task_group_body(_g), ARRAY[_user], NULL);
  UPDATE public.tasks SET group_id = _g.id WHERE id = _task;
  RETURN _task;
END $$;

-- To the Recycle Bin (as delete_task): one member task.
CREATE FUNCTION public.task_group_trash_task(_task uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _t public.tasks;
BEGIN
  _t := public.task_locked(_task);
  UPDATE public.tasks SET deleted_at = now(), deleted_by = auth.uid() WHERE id = _task;
  INSERT INTO public.recycle_bin_audit_log (actor_id, item_type, item_id, action, branch_id, region_id)
  VALUES (auth.uid(), 'task', _task, 'delete', _t.branch_id, _t.region_id);
END $$;

CREATE FUNCTION public.task_group_json(_g public.task_groups) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH m AS (
    SELECT t.id AS task_id, t.status, t.archived_at, a.user_id, p.full_name
    FROM public.tasks t
    LEFT JOIN public.task_assignees a ON a.task_id = t.id
    LEFT JOIN public.profiles p ON p.id = a.user_id AND p.deleted_at IS NULL
    WHERE t.group_id = _g.id AND t.deleted_at IS NULL)
  SELECT jsonb_build_object('id', _g.id, 'scope', _g.scope, 'branch_id', _g.branch_id, 'region_id', _g.region_id,
    'branch', (SELECT name FROM public.branches WHERE id = _g.branch_id), 'region', (SELECT name FROM public.regions WHERE id = _g.region_id),
    'title', _g.title, 'description', _g.description, 'priority', _g.priority, 'due_date', _g.due_date,
    'event_id', _g.event_id, 'meeting_id', _g.meeting_id, 'decision_id', _g.decision_id,
    'created_by', _g.created_by, 'created_by_name', (SELECT full_name FROM public.profiles WHERE id = _g.created_by AND deleted_at IS NULL),
    'created_at', _g.created_at,
    'status', public.task_group_status(_g.id),
    'member_count', (SELECT count(DISTINCT task_id) FROM m),
    'counts', jsonb_build_object(
      'todo', (SELECT count(DISTINCT task_id) FROM m WHERE status = 'todo'),
      'in_progress', (SELECT count(DISTINCT task_id) FROM m WHERE status = 'in_progress'),
      'blocked', (SELECT count(DISTINCT task_id) FROM m WHERE status = 'blocked'),
      'done', (SELECT count(DISTINCT task_id) FROM m WHERE status = 'done')),
    'archived', coalesce((SELECT bool_and(archived_at IS NOT NULL) FROM m), false),
    'members', (SELECT coalesce(jsonb_agg(jsonb_build_object('task_id', task_id, 'user_id', user_id, 'full_name', full_name,
        'status', status, 'archived_at', archived_at) ORDER BY full_name NULLS LAST, task_id), '[]'::jsonb) FROM m),
    'mine', EXISTS (SELECT 1 FROM m WHERE user_id = auth.uid()),
    'my_task_id', (SELECT task_id FROM m WHERE user_id = auth.uid() LIMIT 1),
    'can_edit', public.can_edit_task_group(_g.id))
$$;

-- ---------------------------------------------------------------------------------------------------------------
-- Client RPCs: groups

-- Creates the group and one task per member ("@all"). p: scope 'branch', branch_id, title, description, priority,
-- due_date, event_id, decision_id (from a meeting decision), reminders (copied to every member task).
CREATE FUNCTION public.create_task_group(p jsonb) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _branch uuid := nullif(p->>'branch_id', '')::uuid; _region uuid; _t public.tasks; _g public.task_groups;
  _decision public.meeting_decisions; _people uuid[]; _u uuid; _body jsonb; _task uuid;
BEGIN
  PERFORM public.require_privacy_accepted();
  PERFORM public.work_actor();
  IF coalesce(p->>'scope', 'branch') <> 'branch' OR _branch IS NULL THEN RAISE EXCEPTION 'Not allowed'; END IF;
  SELECT region_id INTO _region FROM public.branches WHERE id = _branch;
  IF NOT public.work_scope_valid('branch', _branch, _region) OR NOT public.can_manage_event_scope('branch', _branch, _region) THEN
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
  _people := public.task_group_people(_branch, _region);
  IF coalesce(cardinality(_people), 0) = 0 THEN RAISE EXCEPTION 'This group has no members to assign'; END IF;
  IF cardinality(_people) > 500 THEN RAISE EXCEPTION 'Too many assignees'; END IF;
  INSERT INTO public.task_groups (branch_id, region_id, title, description, priority, due_date, event_id, meeting_id, decision_id, created_by)
  VALUES (_branch, _region, _t.title, _t.description, _t.priority, _t.due_date, _t.event_id, _decision.meeting_id, _decision.id, auth.uid())
  RETURNING * INTO _g;
  _body := public.task_group_body(_g) || CASE WHEN p ? 'reminders' THEN jsonb_build_object('reminders', p->'reminders') ELSE '{}'::jsonb END;
  FOREACH _u IN ARRAY _people LOOP
    _task := public.task_insert('branch', _branch, _region, _body, ARRAY[_u], NULL);
    UPDATE public.tasks SET group_id = _g.id WHERE id = _task;
  END LOOP;
  RETURN _g.id;
END $$;

-- Edits the group; title, description, priority and due date go to every member task.
CREATE FUNCTION public.update_task_group(p_id uuid, p jsonb) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _g public.task_groups; _t public.tasks;
BEGIN
  PERFORM public.require_privacy_accepted();
  PERFORM public.work_actor();
  _g := public.task_group_locked(p_id);
  IF NOT public.can_edit_task_group(p_id) THEN RAISE EXCEPTION 'Not allowed'; END IF;
  _t.id := gen_random_uuid(); _t.scope := 'branch'; _t.branch_id := _g.branch_id; _t.region_id := _g.region_id;
  _t.title := _g.title; _t.description := _g.description; _t.priority := _g.priority; _t.due_date := _g.due_date;
  _t.event_id := _g.event_id; _t.status := 'todo'; _t.remind_before_days := '{}'; _t.repeat_kind := 'none';
  _t := public.task_fields(_t, jsonb_strip_nulls(jsonb_build_object('title', p->'title', 'priority', p->'priority'))
    || CASE WHEN p ? 'description' THEN jsonb_build_object('description', p->'description') ELSE '{}'::jsonb END
    || CASE WHEN p ? 'due_date' THEN jsonb_build_object('due_date', p->'due_date') ELSE '{}'::jsonb END);
  UPDATE public.task_groups SET title = _t.title, description = _t.description, priority = _t.priority, due_date = _t.due_date
  WHERE id = p_id;
  UPDATE public.tasks SET title = _t.title, description = _t.description, priority = _t.priority, due_date = _t.due_date
  WHERE group_id = p_id AND deleted_at IS NULL;
  RETURN p_id;
END $$;

-- Deletes the group: every member task goes to the Recycle Bin, then the group row is removed.
CREATE FUNCTION public.delete_task_group(p_id uuid) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _g public.task_groups; _task uuid; _n integer := 0;
BEGIN
  PERFORM public.require_privacy_accepted();
  PERFORM public.work_actor();
  _g := public.task_group_locked(p_id);
  IF NOT public.can_edit_task_group(p_id) THEN RAISE EXCEPTION 'Not allowed'; END IF;
  FOR _task IN SELECT id FROM public.tasks WHERE group_id = p_id AND deleted_at IS NULL ORDER BY id LOOP
    PERFORM public.task_group_trash_task(_task);
    _n := _n + 1;
  END LOOP;
  DELETE FROM public.task_groups WHERE id = p_id;
  RETURN _n;
END $$;

-- Adds and/or removes members (user ids). A new member gets their own task (and the assignment notice); a removed
-- member's task goes to the Recycle Bin. The group keeps at least one member.
CREATE FUNCTION public.set_task_group_members(p_id uuid, p_add jsonb DEFAULT '[]'::jsonb, p_remove jsonb DEFAULT '[]'::jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _g public.task_groups; _u uuid; _task uuid; _added integer := 0; _removed integer := 0;
  _add uuid[] := public.json_uuid_array(p_add); _remove uuid[] := public.json_uuid_array(p_remove);
BEGIN
  PERFORM public.require_privacy_accepted();
  PERFORM public.work_actor();
  _g := public.task_group_locked(p_id);
  IF NOT public.can_edit_task_group(p_id) THEN RAISE EXCEPTION 'Not allowed'; END IF;
  IF coalesce(cardinality(_add), 0) + coalesce(cardinality(_remove), 0) > 500 THEN RAISE EXCEPTION 'Too many assignees'; END IF;
  FOREACH _u IN ARRAY coalesce(_remove, '{}'::uuid[]) LOOP
    FOR _task IN SELECT t.id FROM public.tasks t JOIN public.task_assignees a ON a.task_id = t.id
                 WHERE t.group_id = p_id AND t.deleted_at IS NULL AND a.user_id = _u LOOP
      PERFORM public.task_group_trash_task(_task);
      _removed := _removed + 1;
    END LOOP;
  END LOOP;
  FOREACH _u IN ARRAY coalesce(_add, '{}'::uuid[]) LOOP
    PERFORM public.task_group_add_member(_g, _u);
    _added := _added + 1;
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM public.tasks WHERE group_id = p_id AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'A task group needs at least one member';
  END IF;
  RETURN jsonb_build_object('added', _added, 'removed', _removed);
END $$;

-- One group with its members, counts and derived status. NULL when not visible.
CREATE FUNCTION public.get_task_group(p_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _g public.task_groups;
BEGIN
  IF NOT public.has_accepted_privacy_notice() OR NOT public.can_view_task_group(p_id) THEN RETURN NULL; END IF;
  SELECT * INTO _g FROM public.task_groups WHERE id = p_id;
  RETURN public.task_group_json(_g);
END $$;

-- Every group the caller can see (at most 500, by due date).
CREATE FUNCTION public.list_task_groups() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(jsonb_agg(public.task_group_json(g) ORDER BY g.due_date NULLS LAST, g.created_at, g.id), '[]'::jsonb)
  FROM (SELECT * FROM public.task_groups g WHERE public.has_accepted_privacy_notice() AND public.can_view_task_group(g.id)
        ORDER BY g.due_date NULLS LAST, g.created_at, g.id LIMIT 500) g
$$;

-- ---------------------------------------------------------------------------------------------------------------
-- Reads that now carry group_id

CREATE OR REPLACE FUNCTION public.task_json(_t public.tasks) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object('id', _t.id, 'scope', _t.scope, 'branch_id', _t.branch_id, 'region_id', _t.region_id,
    'branch', (SELECT name FROM public.branches WHERE id = _t.branch_id), 'region', (SELECT name FROM public.regions WHERE id = _t.region_id),
    'title', _t.title, 'description', _t.description, 'status', _t.status, 'priority', _t.priority, 'due_date', _t.due_date,
    'self_task', _t.self_task, 'created_by', _t.created_by,
    'created_by_name', (SELECT full_name FROM public.profiles WHERE id = _t.created_by AND deleted_at IS NULL),
    'event_id', _t.event_id, 'meeting_id', _t.meeting_id, 'decision_id', _t.decision_id, 'created_at', _t.created_at,
    'archived_at', _t.archived_at, 'group_id', _t.group_id,
    'note_count', (SELECT count(*) FROM public.task_notes WHERE task_id = _t.id),
    'assignees', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'full_name', p.full_name) ORDER BY p.full_name, p.id), '[]'::jsonb)
      FROM public.task_assignees a JOIN public.profiles p ON p.id = a.user_id WHERE a.task_id = _t.id AND p.deleted_at IS NULL),
    'mine', EXISTS (SELECT 1 FROM public.task_assignees a WHERE a.task_id = _t.id AND a.user_id = auth.uid()),
    'can_edit', public.can_edit_task(_t.id), 'can_set_status', public.can_set_task_status(_t.id))
$$;

CREATE OR REPLACE FUNCTION public.get_event_tasks(p_event uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'title', t.title, 'status', t.status, 'due_date', t.due_date,
      'archived_at', t.archived_at, 'group_id', t.group_id)
    ORDER BY t.due_date NULLS LAST, t.created_at, t.id), '[]'::jsonb)
  FROM public.tasks t
  WHERE t.event_id = p_event AND t.deleted_at IS NULL AND public.has_accepted_privacy_notice() AND public.can_view_event(p_event)
    AND public.can_view_task(t.id)
$$;

-- get_meeting as in 20261126090100, with group_id on the decision tasks that belong to a group (one row per group in
-- the UI; the key is left out for ordinary tasks, so existing readers see the same rows), and "From last meeting"
-- without items already carried into a later meeting.
CREATE OR REPLACE FUNCTION public.get_meeting(p_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _m public.meetings; _prev public.meetings; _s public.meeting_series;
BEGIN
  IF NOT public.has_accepted_privacy_notice() OR NOT public.can_view_meeting(p_id) THEN RETURN NULL; END IF;
  SELECT * INTO _m FROM public.meetings WHERE id = p_id;
  IF _m.series_id IS NOT NULL THEN
    SELECT * INTO _s FROM public.meeting_series WHERE id = _m.series_id;
    SELECT * INTO _prev FROM public.meetings WHERE series_id = _m.series_id AND deleted_at IS NULL AND starts_at < _m.starts_at
      ORDER BY starts_at DESC LIMIT 1;
  END IF;
  RETURN public.meeting_json(_m) || jsonb_build_object(
    'invitees', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'full_name', p.full_name) ORDER BY p.full_name, p.id), '[]'::jsonb)
      FROM public.meeting_invitees i JOIN public.profiles p ON p.id = i.user_id WHERE i.meeting_id = p_id AND p.deleted_at IS NULL),
    'agenda', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'position', a.position, 'title', a.title, 'notes', a.notes,
        'resolved', a.resolved, 'standing', a.standing,
        'decisions', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'text', d.text, 'created_at', d.created_at,
            'tasks', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'title', t.title, 'status', t.status)
                          || CASE WHEN t.group_id IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('group_id', t.group_id) END
                        ORDER BY t.created_at), '[]'::jsonb)
                      FROM public.tasks t WHERE t.decision_id = d.id AND t.deleted_at IS NULL AND public.can_view_task(t.id)))
          ORDER BY d.created_at, d.id), '[]'::jsonb) FROM public.meeting_decisions d WHERE d.agenda_item_id = a.id))
      ORDER BY a.position, a.id), '[]'::jsonb) FROM public.meeting_agenda_items a WHERE a.meeting_id = p_id),
    'files', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', f.id, 'kind', f.kind, 'storage_path', f.storage_path,
        'original_name', f.original_name, 'created_at', f.created_at) ORDER BY f.created_at, f.id), '[]'::jsonb)
      FROM public.meeting_files f WHERE f.meeting_id = p_id),
    'series', CASE WHEN _s.id IS NULL THEN NULL ELSE jsonb_build_object('id', _s.id, 'freq', _s.freq, 'interval', _s.interval_count,
      'count', _s.occurrence_count, 'agenda_template', _s.agenda_template,
      'previous_id', (SELECT id FROM public.meetings WHERE series_id = _s.id AND deleted_at IS NULL AND starts_at < _m.starts_at
        AND public.can_view_meeting(id) ORDER BY starts_at DESC LIMIT 1),
      'next_id', (SELECT id FROM public.meetings WHERE series_id = _s.id AND deleted_at IS NULL AND starts_at > _m.starts_at
        AND public.can_view_meeting(id) ORDER BY starts_at LIMIT 1)) END,
    'from_last', CASE WHEN _prev.id IS NULL OR NOT public.can_view_meeting(_prev.id) THEN NULL ELSE jsonb_build_object(
      'meeting_id', _prev.id, 'title', _prev.title, 'starts_at', _prev.starts_at,
      'items', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'title', a.title, 'notes', a.notes) ORDER BY a.position, a.id), '[]'::jsonb)
        FROM public.meeting_agenda_items a WHERE a.meeting_id = _prev.id AND NOT a.resolved AND a.carried_to IS NULL),
      'tasks', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'title', t.title, 'status', t.status, 'due_date', t.due_date,
          'assignees', (SELECT coalesce(jsonb_agg(p.full_name ORDER BY p.full_name), '[]'::jsonb) FROM public.task_assignees x
            JOIN public.profiles p ON p.id = x.user_id WHERE x.task_id = t.id AND p.deleted_at IS NULL))
          ORDER BY t.due_date NULLS LAST, t.created_at, t.id), '[]'::jsonb)
        FROM public.tasks t WHERE t.meeting_id = _prev.id AND t.deleted_at IS NULL AND t.status <> 'done' AND public.can_view_task(t.id))) END);
END $$;

-- ---------------------------------------------------------------------------------------------------------------
-- Meeting carry-over

-- Unresolved, not yet carried agenda items of the last 10 earlier meetings in this scope that the caller may edit,
-- with their decisions and the not-done tasks of each decision (newest meeting first).
CREATE FUNCTION public.list_meeting_carry_over(p_scope text, p_branch uuid DEFAULT NULL, p_region uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF p_scope = 'branch' THEN SELECT region_id INTO p_region FROM public.branches WHERE id = p_branch; END IF;
  IF p_scope = 'national' THEN p_branch := NULL; p_region := NULL; END IF;
  IF NOT public.has_accepted_privacy_notice() OR NOT public.work_scope_valid(p_scope, p_branch, p_region)
    OR NOT public.can_create_meeting(p_scope, p_branch, p_region) THEN RETURN '[]'::jsonb; END IF;
  RETURN (SELECT coalesce(jsonb_agg(jsonb_build_object('meeting_id', m.id, 'meeting_title', m.title, 'starts_at', m.starts_at,
      'items', m.items) ORDER BY m.starts_at DESC, m.id), '[]'::jsonb)
    FROM (SELECT m.id, m.title, m.starts_at,
        (SELECT coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'title', a.title, 'notes', a.notes,
            'decisions', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'text', d.text,
                'tasks', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'title', t.title, 'status', t.status,
                    'group_id', t.group_id,
                    'assignees', (SELECT coalesce(jsonb_agg(p.full_name ORDER BY p.full_name), '[]'::jsonb) FROM public.task_assignees x
                      JOIN public.profiles p ON p.id = x.user_id WHERE x.task_id = t.id AND p.deleted_at IS NULL))
                    ORDER BY t.created_at, t.id), '[]'::jsonb)
                  FROM public.tasks t WHERE t.decision_id = d.id AND t.deleted_at IS NULL AND t.status <> 'done'
                    AND public.can_view_task(t.id)))
              ORDER BY d.created_at, d.id), '[]'::jsonb) FROM public.meeting_decisions d WHERE d.agenda_item_id = a.id))
          ORDER BY a.position, a.id), '[]'::jsonb)
          FROM public.meeting_agenda_items a WHERE a.meeting_id = m.id AND NOT a.resolved AND a.carried_to IS NULL) AS items
      FROM public.meetings m
      WHERE m.deleted_at IS NULL AND m.scope = p_scope AND m.branch_id IS NOT DISTINCT FROM p_branch
        AND m.region_id IS NOT DISTINCT FROM p_region AND m.starts_at < now() AND public.can_edit_meeting(m.id)
        AND EXISTS (SELECT 1 FROM public.meeting_agenda_items a WHERE a.meeting_id = m.id AND NOT a.resolved AND a.carried_to IS NULL)
      ORDER BY m.starts_at DESC, m.id LIMIT 10) m);
END $$;

-- Carries the chosen items into p_meeting. p: [{ item_id, decision_ids: [...], task_ids: [...] }]. Each item is copied
-- (title, notes) to the end of the agenda, each chosen decision is copied under it, and each chosen not-done task of
-- those decisions is moved (meeting_id and decision_id point at the new meeting and decision; a task in a group moves
-- with its whole group). The old item is marked carried_to. Everything or nothing. Returns how many items.
CREATE FUNCTION public.carry_over_agenda(p_meeting uuid, p jsonb) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _target public.meetings; _x jsonb; _item public.meeting_agenda_items; _src public.meetings; _new_item uuid;
  _d public.meeting_decisions; _new_decision uuid; _decisions uuid[]; _tasks uuid[]; _t public.tasks; _n integer := 0;
BEGIN
  PERFORM public.require_privacy_accepted();
  PERFORM public.meeting_editable(p_meeting);
  SELECT * INTO _target FROM public.meetings WHERE id = p_meeting;
  IF jsonb_typeof(p) <> 'array' OR jsonb_array_length(p) > 50 THEN RAISE EXCEPTION 'Not allowed'; END IF;
  FOR _x IN SELECT * FROM jsonb_array_elements(p) LOOP
    SELECT * INTO _item FROM public.meeting_agenda_items WHERE id = nullif(_x->>'item_id', '')::uuid FOR UPDATE;
    IF NOT FOUND OR _item.resolved OR _item.carried_to IS NOT NULL OR _item.meeting_id = p_meeting THEN
      RAISE EXCEPTION 'This agenda item cannot be carried over';
    END IF;
    SELECT * INTO _src FROM public.meetings WHERE id = _item.meeting_id AND deleted_at IS NULL;
    IF NOT FOUND OR NOT public.can_edit_meeting(_src.id) OR _src.scope <> _target.scope
      OR _src.branch_id IS DISTINCT FROM _target.branch_id OR _src.region_id IS DISTINCT FROM _target.region_id THEN
      RAISE EXCEPTION 'This agenda item cannot be carried over';
    END IF;
    _decisions := public.json_uuid_array(_x->'decision_ids');
    _tasks := public.json_uuid_array(_x->'task_ids');
    IF (SELECT count(*) FROM public.meeting_agenda_items WHERE meeting_id = p_meeting) >= 50 THEN RAISE EXCEPTION 'Too many agenda items'; END IF;
    INSERT INTO public.meeting_agenda_items (meeting_id, position, title, notes)
    VALUES (p_meeting, coalesce((SELECT max(position) + 1 FROM public.meeting_agenda_items WHERE meeting_id = p_meeting), 0),
      _item.title, _item.notes)
    RETURNING id INTO _new_item;
    UPDATE public.meeting_agenda_items SET carried_to = _new_item WHERE id = _item.id;
    -- Every chosen task must belong to a chosen decision of this item.
    IF EXISTS (SELECT 1 FROM unnest(coalesce(_tasks, '{}'::uuid[])) x WHERE NOT EXISTS (SELECT 1 FROM public.tasks t
        WHERE t.id = x AND t.deleted_at IS NULL AND t.decision_id = ANY (coalesce(_decisions, '{}'::uuid[])))) THEN
      RAISE EXCEPTION 'This agenda item cannot be carried over';
    END IF;
    FOR _d IN SELECT * FROM public.meeting_decisions WHERE agenda_item_id = _item.id AND id = ANY (coalesce(_decisions, '{}'::uuid[]))
        ORDER BY created_at, id LOOP
      INSERT INTO public.meeting_decisions (meeting_id, agenda_item_id, text, created_by) VALUES (p_meeting, _new_item, _d.text, auth.uid())
      RETURNING id INTO _new_decision;
      FOR _t IN SELECT * FROM public.tasks WHERE decision_id = _d.id AND deleted_at IS NULL AND status <> 'done'
          AND id = ANY (coalesce(_tasks, '{}'::uuid[])) FOR UPDATE LOOP
        IF NOT public.can_view_task(_t.id) THEN RAISE EXCEPTION 'Not allowed'; END IF;
        IF _t.group_id IS NOT NULL THEN
          UPDATE public.task_groups SET meeting_id = p_meeting, decision_id = _new_decision WHERE id = _t.group_id;
          UPDATE public.tasks SET meeting_id = p_meeting, decision_id = _new_decision
          WHERE group_id = _t.group_id AND deleted_at IS NULL AND decision_id = _d.id;
        ELSE
          UPDATE public.tasks SET meeting_id = p_meeting, decision_id = _new_decision WHERE id = _t.id;
        END IF;
      END LOOP;
    END LOOP;
    _n := _n + 1;
  END LOOP;
  RETURN _n;
END $$;

-- ---------------------------------------------------------------------------------------------------------------
-- Grants

REVOKE ALL ON FUNCTION public.task_group_status(uuid), public.task_group_locked(uuid), public.task_group_people(uuid, uuid),
  public.task_group_body(public.task_groups), public.task_group_add_member(public.task_groups, uuid),
  public.task_group_trash_task(uuid), public.task_group_json(public.task_groups) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.can_view_task_group(uuid), public.can_edit_task_group(uuid), public.create_task_group(jsonb),
  public.update_task_group(uuid, jsonb), public.delete_task_group(uuid), public.set_task_group_members(uuid, jsonb, jsonb),
  public.get_task_group(uuid), public.list_task_groups(), public.list_meeting_carry_over(text, uuid, uuid),
  public.carry_over_agenda(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_view_task_group(uuid), public.can_edit_task_group(uuid), public.create_task_group(jsonb),
  public.update_task_group(uuid, jsonb), public.delete_task_group(uuid), public.set_task_group_members(uuid, jsonb, jsonb),
  public.get_task_group(uuid), public.list_task_groups(), public.list_meeting_carry_over(text, uuid, uuid),
  public.carry_over_agenda(uuid, jsonb) TO authenticated;

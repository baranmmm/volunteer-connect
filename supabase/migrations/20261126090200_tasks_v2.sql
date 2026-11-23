-- Tasks v2: archive, notes with @mentions, volunteer assignment, reminders off by default, event tasks for everyone who
-- can see the event.
--
-- * Archive: a done task can be archived (and unarchived) by its assignees and editors. Archived tasks stay readable
--   (task_json.archived_at); the app hides them by default. Archive is not delete. A task that leaves "done" is
--   unarchived automatically.
-- * Notes: a thread per task. Assignees, the creator and the scope's managers add notes; authors edit and delete their
--   own. @mentions may only name people who can see the task; they get a 'task_note_mention' notice. The creator gets
--   'task_note_added' when an assignee writes a note. Notes are read through RLS (can_view_task).
-- * Volunteers may assign themselves and other volunteers of their own branch. Assigning upward (Branch Managers,
--   Regional Directors, National Coordinators) stays a task request.
-- * Reminders are off by default for every new task; existing tasks keep their settings.
-- * get_event_tasks: the linked tasks of an event, for everyone who can see the event (each task only when visible).

ALTER TABLE public.tasks ADD COLUMN archived_at timestamptz, ADD COLUMN archived_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL;
ALTER TABLE public.tasks ALTER COLUMN remind_before_days SET DEFAULT '{}';
CREATE INDEX tasks_archived_by_idx ON public.tasks (archived_by) WHERE archived_by IS NOT NULL;

-- A task that leaves "done" is no longer archived.
CREATE FUNCTION public.tasks_unarchive_on_reopen() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.status <> 'done' THEN NEW.archived_at := NULL; NEW.archived_by := NULL; END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.tasks_unarchive_on_reopen() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER tasks_unarchive_on_reopen BEFORE UPDATE OF status ON public.tasks FOR EACH ROW EXECUTE FUNCTION public.tasks_unarchive_on_reopen();

CREATE TABLE public.task_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  author_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  body text NOT NULL CHECK (char_length(btrim(body)) BETWEEN 1 AND 4000),
  mentions uuid[] NOT NULL DEFAULT '{}' CHECK (cardinality(mentions) <= 20),
  edited boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX task_notes_task_idx ON public.task_notes (task_id, created_at);
CREATE INDEX task_notes_author_idx ON public.task_notes (author_id) WHERE author_id IS NOT NULL;
ALTER TABLE public.task_notes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.task_notes FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.task_notes TO authenticated;
GRANT ALL ON public.task_notes TO service_role;
CREATE POLICY task_notes_read ON public.task_notes FOR SELECT TO authenticated USING (public.can_view_task(task_id));
CREATE POLICY privacy_notice_required ON public.task_notes AS RESTRICTIVE FOR SELECT TO authenticated USING ((SELECT public.has_accepted_privacy_notice()));
CREATE TRIGGER task_notes_touch BEFORE UPDATE ON public.task_notes FOR EACH ROW EXECUTE FUNCTION public.work_touch();

-- ---------------------------------------------------------------------------------------------------------------
-- Who may see a task, for any person (mentions). Mirrors can_view_task.

CREATE FUNCTION public.task_viewer(_task uuid, _uid uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.is_active_person(_uid) AND NOT public.is_follower(_uid)
    AND EXISTS (SELECT 1 FROM public.tasks t WHERE t.id = _task AND t.deleted_at IS NULL AND (
      t.created_by = _uid
      OR EXISTS (SELECT 1 FROM public.task_assignees a WHERE a.task_id = t.id AND a.user_id = _uid)
      OR (t.scope = 'branch' AND public.is_branch_member(_uid, t.branch_id))
      OR (t.scope IN ('branch', 'region') AND EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = _uid AND r.role = 'regional_director' AND r.region_id = t.region_id))
      OR (t.scope = 'region' AND public.has_role(_uid, 'branch_manager')
          AND EXISTS (SELECT 1 FROM public.branches b WHERE b.id = public.get_user_branch(_uid) AND b.region_id = t.region_id))
      OR (t.scope = 'national' AND public.has_role(_uid, 'national_coordinator'))))
$$;

-- ---------------------------------------------------------------------------------------------------------------
-- Assigning: volunteers may also assign other volunteers of their own branch.

CREATE OR REPLACE FUNCTION public.task_assignee_ok(_scope text, _branch uuid, _region uuid, _user uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.is_active_person(_user) AND CASE
    WHEN _scope = 'national' THEN public.is_nc()
      AND public.has_any_role(_user, ARRAY['regional_director', 'branch_manager', 'national_coordinator']::public.app_role[])
    WHEN EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'regional_director' AND region_id = _region)
      AND public.can_manage_event_scope(_scope, _branch, _region) THEN public.in_work_scope('region', NULL, _region, _user)
    WHEN _scope = 'branch' AND public.can_manage_event_scope(_scope, _branch, _region) THEN public.is_branch_member(_user, _branch)
      AND public.has_any_role(_user, ARRAY['volunteer', 'branch_manager']::public.app_role[])
    -- A volunteer: themselves, or another volunteer of their own branch (never upward).
    ELSE _scope = 'branch' AND public.is_branch_member(auth.uid(), _branch) AND public.is_branch_member(_user, _branch)
      AND (_user = auth.uid() OR (public.has_role(_user, 'volunteer')
        AND NOT public.has_any_role(_user, ARRAY['branch_manager', 'regional_director', 'national_coordinator']::public.app_role[]))) END
$$;

-- Create: managers by their rights; a volunteer for themselves and/or volunteers of their branch (themselves when
-- nobody is chosen). Reminders are off unless the form turns them on.
CREATE OR REPLACE FUNCTION public.task_insert(_scope text, _branch uuid, _region uuid, p jsonb, _assignees uuid[], _source uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _t public.tasks; _manager boolean; _decision public.meeting_decisions;
BEGIN
  IF NOT public.can_create_task(_scope, _branch, _region) THEN RAISE EXCEPTION 'Not allowed'; END IF;
  _manager := public.can_manage_event_scope(_scope, _branch, _region);
  _t.id := gen_random_uuid(); _t.scope := _scope; _t.branch_id := _branch; _t.region_id := _region;
  _t.status := 'todo'; _t.priority := 'medium'; _t.remind_before_days := '{}'; _t.repeat_kind := 'none';
  _t := public.task_fields(_t, p);
  _t.self_task := NOT _manager;
  IF NOT _manager AND coalesce(cardinality(_assignees), 0) = 0 THEN _assignees := ARRAY[auth.uid()]; END IF;
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

-- Full edit (editors). The scope does not change. A volunteer's task may now name other volunteers of the branch.
CREATE OR REPLACE FUNCTION public.update_task(p_id uuid, p jsonb) RETURNS uuid
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
  IF p ? 'assignee_ids' THEN
    IF cardinality(public.json_uuid_array(p->'assignee_ids')) = 0 AND _old.self_task THEN RAISE EXCEPTION 'Choose at least one person'; END IF;
    PERFORM public.task_set_assignees(_t, public.json_uuid_array(p->'assignee_ids'));
  END IF;
  PERFORM public.task_status_notice(_t, _old.status);
  RETURN p_id;
END $$;

-- ---------------------------------------------------------------------------------------------------------------
-- Archive

CREATE FUNCTION public.archive_task(p_id uuid, p_archived boolean) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _t public.tasks;
BEGIN
  PERFORM public.require_privacy_accepted();
  PERFORM public.work_actor();
  _t := public.task_locked(p_id);
  IF NOT public.can_set_task_status(p_id) THEN RAISE EXCEPTION 'Not allowed'; END IF;
  IF coalesce(p_archived, false) AND _t.status <> 'done' THEN RAISE EXCEPTION 'Only done tasks can be archived'; END IF;
  UPDATE public.tasks SET archived_at = CASE WHEN p_archived THEN coalesce(_t.archived_at, now()) END,
    archived_by = CASE WHEN p_archived THEN coalesce(_t.archived_by, auth.uid()) END
  WHERE id = p_id;
  RETURN coalesce(p_archived, false);
END $$;

-- "Archive all done": archives the given tasks that are done and that the caller may change. Returns how many.
CREATE FUNCTION public.archive_done_tasks(p_ids jsonb) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _ids uuid[] := public.json_uuid_array(p_ids); _n integer;
BEGIN
  PERFORM public.require_privacy_accepted();
  PERFORM public.work_actor();
  IF cardinality(_ids) > 1000 THEN RAISE EXCEPTION 'Too many tasks'; END IF;
  UPDATE public.tasks t SET archived_at = now(), archived_by = auth.uid()
  WHERE t.id = ANY (_ids) AND t.deleted_at IS NULL AND t.status = 'done' AND t.archived_at IS NULL AND public.can_set_task_status(t.id);
  GET DIAGNOSTICS _n = ROW_COUNT;
  RETURN _n;
END $$;

-- ---------------------------------------------------------------------------------------------------------------
-- Notes

-- Mentioned people: only those who can see the task, never the author; at most 20.
CREATE FUNCTION public.task_note_mentions(_task uuid, p jsonb) RETURNS uuid[]
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _ids uuid[] := ARRAY(SELECT DISTINCT x FROM unnest(public.json_uuid_array(p)) x WHERE x IS NOT NULL AND x <> auth.uid());
BEGIN
  IF cardinality(_ids) > 20 THEN RAISE EXCEPTION 'Too many mentions'; END IF;
  IF EXISTS (SELECT 1 FROM unnest(_ids) x WHERE NOT public.task_viewer(_task, x)) THEN RAISE EXCEPTION 'This person cannot see the task'; END IF;
  RETURN _ids;
END $$;

CREATE FUNCTION public.task_note_notices(_t public.tasks, _note uuid, _mentions uuid[], _previous uuid[]) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _u uuid;
BEGIN
  FOREACH _u IN ARRAY _mentions LOOP
    IF NOT (_u = ANY (coalesce(_previous, '{}'))) THEN
      PERFORM public.notify(_u, 'task_note_mention', 'task', _t.id, _t.title, '/tasks?task=' || _t.id, jsonb_build_object('note_id', _note));
    END IF;
  END LOOP;
END $$;

CREATE FUNCTION public.add_task_note(p_task uuid, p_body text, p_mentions jsonb DEFAULT '[]'::jsonb) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _t public.tasks; _id uuid; _mentions uuid[];
BEGIN
  PERFORM public.require_privacy_accepted();
  PERFORM public.work_actor();
  _t := public.task_locked(p_task);
  IF NOT public.can_set_task_status(p_task) THEN RAISE EXCEPTION 'Not allowed'; END IF;
  IF char_length(btrim(coalesce(p_body, ''))) NOT BETWEEN 1 AND 4000 THEN RAISE EXCEPTION 'Note text is required'; END IF;
  IF (SELECT count(*) FROM public.task_notes WHERE task_id = p_task) >= 500 THEN RAISE EXCEPTION 'Too many notes'; END IF;
  _mentions := public.task_note_mentions(p_task, p_mentions);
  INSERT INTO public.task_notes (task_id, author_id, body, mentions) VALUES (p_task, auth.uid(), btrim(p_body), _mentions) RETURNING id INTO _id;
  PERFORM public.task_note_notices(_t, _id, _mentions, '{}');
  -- The creator hears about notes from assignees (unless already mentioned).
  IF _t.created_by IS NOT NULL AND _t.created_by <> auth.uid() AND NOT (_t.created_by = ANY (_mentions))
    AND EXISTS (SELECT 1 FROM public.task_assignees WHERE task_id = p_task AND user_id = auth.uid()) THEN
    PERFORM public.notify(_t.created_by, 'task_note_added', 'task', _t.id, _t.title, '/tasks?task=' || _t.id, jsonb_build_object('note_id', _id));
  END IF;
  RETURN _id;
END $$;

CREATE FUNCTION public.update_task_note(p_id uuid, p_body text, p_mentions jsonb DEFAULT '[]'::jsonb) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _n public.task_notes; _t public.tasks; _mentions uuid[];
BEGIN
  PERFORM public.require_privacy_accepted();
  PERFORM public.work_actor();
  SELECT * INTO _n FROM public.task_notes WHERE id = p_id FOR UPDATE;
  IF NOT FOUND OR _n.author_id IS DISTINCT FROM auth.uid() OR NOT public.can_view_task(_n.task_id) THEN RAISE EXCEPTION 'Not allowed'; END IF;
  IF char_length(btrim(coalesce(p_body, ''))) NOT BETWEEN 1 AND 4000 THEN RAISE EXCEPTION 'Note text is required'; END IF;
  SELECT * INTO _t FROM public.tasks WHERE id = _n.task_id;
  _mentions := public.task_note_mentions(_n.task_id, p_mentions);
  UPDATE public.task_notes SET body = btrim(p_body), mentions = _mentions, edited = true WHERE id = p_id;
  PERFORM public.task_note_notices(_t, p_id, _mentions, _n.mentions);
  RETURN p_id;
END $$;

CREATE FUNCTION public.delete_task_note(p_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _n public.task_notes;
BEGIN
  PERFORM public.require_privacy_accepted();
  PERFORM public.work_actor();
  SELECT * INTO _n FROM public.task_notes WHERE id = p_id FOR UPDATE;
  IF NOT FOUND OR _n.author_id IS DISTINCT FROM auth.uid() OR NOT public.can_view_task(_n.task_id) THEN RAISE EXCEPTION 'Not allowed'; END IF;
  DELETE FROM public.task_notes WHERE id = p_id;
END $$;

-- The notes of a task (oldest first) with their authors and mentions.
CREATE FUNCTION public.list_task_notes(p_task uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object('id', n.id, 'body', n.body, 'author_id', n.author_id,
      'author_name', (SELECT full_name FROM public.profiles WHERE id = n.author_id AND deleted_at IS NULL),
      'created_at', n.created_at, 'updated_at', n.updated_at, 'edited', n.edited, 'mine', n.author_id = auth.uid(),
      'mentions', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'full_name', p.full_name) ORDER BY p.full_name), '[]'::jsonb)
        FROM public.profiles p WHERE p.id = ANY (n.mentions) AND p.deleted_at IS NULL))
    ORDER BY n.created_at, n.id), '[]'::jsonb)
  FROM public.task_notes n
  WHERE n.task_id = p_task AND public.has_accepted_privacy_notice() AND public.can_view_task(p_task)
$$;

-- People who can see a task (the @mention picker), without the caller.
CREATE FUNCTION public.list_task_mention_people(p_task uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _t public.tasks;
BEGIN
  IF NOT public.has_accepted_privacy_notice() OR NOT public.can_view_task(p_task) THEN RETURN '[]'::jsonb; END IF;
  SELECT * INTO _t FROM public.tasks WHERE id = p_task;
  RETURN (SELECT coalesce(jsonb_agg(x ORDER BY x->>'full_name', x->>'id'), '[]'::jsonb)
    FROM jsonb_array_elements(public.scope_people(CASE WHEN _t.scope = 'national' THEN 'national' ELSE 'region' END, NULL, _t.region_id)) x
    WHERE (x->>'id')::uuid <> auth.uid() AND public.task_viewer(p_task, (x->>'id')::uuid));
END $$;

-- ---------------------------------------------------------------------------------------------------------------
-- Reads

CREATE OR REPLACE FUNCTION public.task_json(_t public.tasks) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object('id', _t.id, 'scope', _t.scope, 'branch_id', _t.branch_id, 'region_id', _t.region_id,
    'branch', (SELECT name FROM public.branches WHERE id = _t.branch_id), 'region', (SELECT name FROM public.regions WHERE id = _t.region_id),
    'title', _t.title, 'description', _t.description, 'status', _t.status, 'priority', _t.priority, 'due_date', _t.due_date,
    'self_task', _t.self_task, 'created_by', _t.created_by,
    'created_by_name', (SELECT full_name FROM public.profiles WHERE id = _t.created_by AND deleted_at IS NULL),
    'event_id', _t.event_id, 'meeting_id', _t.meeting_id, 'decision_id', _t.decision_id, 'created_at', _t.created_at,
    'archived_at', _t.archived_at,
    'note_count', (SELECT count(*) FROM public.task_notes WHERE task_id = _t.id),
    'assignees', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'full_name', p.full_name) ORDER BY p.full_name, p.id), '[]'::jsonb)
      FROM public.task_assignees a JOIN public.profiles p ON p.id = a.user_id WHERE a.task_id = _t.id AND p.deleted_at IS NULL),
    'mine', EXISTS (SELECT 1 FROM public.task_assignees a WHERE a.task_id = _t.id AND a.user_id = auth.uid()),
    'can_edit', public.can_edit_task(_t.id), 'can_set_status', public.can_set_task_status(_t.id))
$$;

-- The linked tasks of an event, for everyone who can see the event (each task only when they can see it).
CREATE OR REPLACE FUNCTION public.get_event_tasks(p_event uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'title', t.title, 'status', t.status, 'due_date', t.due_date,
      'archived_at', t.archived_at)
    ORDER BY t.due_date NULLS LAST, t.created_at, t.id), '[]'::jsonb)
  FROM public.tasks t
  WHERE t.event_id = p_event AND t.deleted_at IS NULL AND public.has_accepted_privacy_notice() AND public.can_view_event(p_event)
    AND public.can_view_task(t.id)
$$;

-- Menu badges: the Tasks badge also counts mentions and notes on tasks.
CREATE OR REPLACE FUNCTION public.get_unread_notification_counts() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object(
    'tasks', count(*) FILTER (WHERE kind IN ('task_assigned', 'task_note_mention', 'task_note_added')),
    'requests', count(*) FILTER (WHERE entity_type IN ('task_request', 'meeting_request')),
    'meetings', count(*) FILTER (WHERE entity_type = 'meeting'),
    'total', count(*))
  FROM public.notifications
  WHERE user_id = auth.uid() AND read_at IS NULL AND public.session_ok() AND public.has_accepted_privacy_notice()
$$;

-- ---------------------------------------------------------------------------------------------------------------
-- Grants

REVOKE ALL ON FUNCTION public.task_viewer(uuid, uuid), public.task_note_mentions(uuid, jsonb),
  public.task_note_notices(public.tasks, uuid, uuid[], uuid[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.archive_task(uuid, boolean), public.archive_done_tasks(jsonb), public.add_task_note(uuid, text, jsonb),
  public.update_task_note(uuid, text, jsonb), public.delete_task_note(uuid), public.list_task_notes(uuid),
  public.list_task_mention_people(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.archive_task(uuid, boolean), public.archive_done_tasks(jsonb), public.add_task_note(uuid, text, jsonb),
  public.update_task_note(uuid, text, jsonb), public.delete_task_note(uuid), public.list_task_notes(uuid),
  public.list_task_mention_people(uuid) TO authenticated;

-- Trustee task notes (approved by the user, 2026-11-26): a trustee may add notes to every task of their own branch
-- that they can read, not only to the tasks assigned to them. Notes only: title, description, assignees, due date,
-- archive state and the status of tasks not assigned to them stay refused (can_edit_task, can_set_task_status and
-- can_archive_task are unchanged). On their own tasks they change the status as before.
--
-- * can_add_task_note(_task) (new, internal): who may add a note. As before everyone allowed by can_set_task_status
--   (assignees, the creator, the scope's managers), plus a trustee on a readable branch task of their own branch.
-- * add_task_note: checks can_add_task_note instead of can_set_task_status. Notices as before (mentions; every
--   assignee; the creator when an assignee writes), and the creator also hears about a trustee's note (a trustee
--   writes as an outside member, like an assignee). Same signature and grants (authenticated).
-- * task_json: new flag can_add_note (drives the note box; the edit controls keep can_edit / can_set_status /
--   can_archive).
-- * Editing and deleting a note stay as before: the author, while they can read the task (update_task_note,
--   delete_task_note are unchanged).
-- Additive: one new helper, two functions replaced with the same signatures. No table, policy, grant or data change.

CREATE FUNCTION public.can_add_task_note(_task uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.can_set_task_status(_task)
    OR (public.is_trustee(auth.uid()) AND public.can_view_task(_task)
      AND EXISTS (SELECT 1 FROM public.tasks t WHERE t.id = _task AND t.deleted_at IS NULL AND t.scope = 'branch'
        AND public.is_branch_member(auth.uid(), t.branch_id)))
$$;

CREATE OR REPLACE FUNCTION public.add_task_note(p_task uuid, p_body text, p_mentions jsonb DEFAULT '[]'::jsonb) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _t public.tasks; _id uuid; _mentions uuid[]; _u uuid;
BEGIN
  PERFORM public.require_privacy_accepted();
  PERFORM public.work_actor();
  _t := public.task_locked(p_task);
  IF NOT public.can_add_task_note(p_task) THEN RAISE EXCEPTION 'Not allowed'; END IF;
  IF char_length(btrim(coalesce(p_body, ''))) NOT BETWEEN 1 AND 4000 THEN RAISE EXCEPTION 'Note text is required'; END IF;
  IF (SELECT count(*) FROM public.task_notes WHERE task_id = p_task) >= 500 THEN RAISE EXCEPTION 'Too many notes'; END IF;
  _mentions := public.task_note_mentions(p_task, p_mentions);
  INSERT INTO public.task_notes (task_id, author_id, body, mentions) VALUES (p_task, auth.uid(), btrim(p_body), _mentions) RETURNING id INTO _id;
  PERFORM public.task_note_notices(_t, _id, _mentions, '{}');
  -- Every assignee (not the author, not someone mentioned: they have the mention notice).
  FOR _u IN SELECT user_id FROM public.task_assignees WHERE task_id = p_task AND user_id <> auth.uid() AND NOT (user_id = ANY (_mentions))
      ORDER BY user_id LOOP
    PERFORM public.task_note_notice(_u, _t, _id);
  END LOOP;
  -- The creator hears about notes from assignees and trustees (unless mentioned, or already told as an assignee).
  IF _t.created_by IS NOT NULL AND _t.created_by <> auth.uid() AND NOT (_t.created_by = ANY (_mentions))
    AND NOT EXISTS (SELECT 1 FROM public.task_assignees WHERE task_id = p_task AND user_id = _t.created_by)
    AND (EXISTS (SELECT 1 FROM public.task_assignees WHERE task_id = p_task AND user_id = auth.uid())
      OR public.is_trustee(auth.uid())) THEN
    PERFORM public.task_note_notice(_t.created_by, _t, _id);
  END IF;
  RETURN _id;
END $$;

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
    'can_edit', public.can_edit_task(_t.id), 'can_set_status', public.can_set_task_status(_t.id),
    'can_archive', public.can_archive_task(_t.id), 'can_add_note', public.can_add_task_note(_t.id))
$$;

-- The new helper is internal (called from SECURITY DEFINER functions only), like can_archive_task.
REVOKE ALL ON FUNCTION public.can_add_task_note(uuid) FROM PUBLIC, anon, authenticated;

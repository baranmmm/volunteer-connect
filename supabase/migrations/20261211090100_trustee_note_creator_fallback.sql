-- Trustee note creator fallback (approved by the user, 2026-11-26): a trustee's note always reaches someone who runs
-- the task. When the task has no creator any more (created_by NULL after an account deletion) or the creator is no
-- longer an active person, the branch's Branch Manager(s) get the note notice (task_note_added, through the same
-- task_note_notice helper as the creator) instead. Same exclusions as before: never the author, nobody twice (a Branch
-- Manager already told as an assignee or mentioned is skipped).
-- Only add_task_note changes (same signature and grants, authenticated). No table, policy, grant or data change.

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
  -- A trustee's note on a task without an active creator: the branch's Branch Managers instead (never the author,
  -- nobody already told as an assignee or mentioned).
  IF public.is_trustee(auth.uid()) AND _t.scope = 'branch'
    AND (_t.created_by IS NULL OR NOT public.is_active_person(_t.created_by)) THEN
    FOR _u IN SELECT r.user_id FROM public.user_roles r
        WHERE r.role = 'branch_manager' AND public.is_active_person(r.user_id) AND public.is_branch_member(r.user_id, _t.branch_id)
          AND r.user_id <> auth.uid() AND r.user_id IS DISTINCT FROM _t.created_by AND NOT (r.user_id = ANY (_mentions))
          AND NOT EXISTS (SELECT 1 FROM public.task_assignees a WHERE a.task_id = p_task AND a.user_id = r.user_id)
        GROUP BY r.user_id ORDER BY r.user_id LOOP
      PERFORM public.task_note_notice(_u, _t, _id);
    END LOOP;
  END IF;
  RETURN _id;
END $$;

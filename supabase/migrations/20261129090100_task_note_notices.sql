-- Task note notices: every assignee hears about a new note on their task ("X added a note to: <task>"), and the creator
-- still hears about notes by assignees. Never the author. Someone @mentioned in the note gets only the mention notice.
-- While unread, further notes on the same task update that one notice ("3 new notes on: <task>"). Note notices are
-- always immediate (like assignments and mentions) but can be turned off (type task_note). Links open the task panel
-- with the note highlighted (/tasks?task=<id>&note=<note id>).

-- task_note joins the types that are always delivered immediately.
CREATE OR REPLACE FUNCTION public.notification_delivery_locked(_type text) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT public.notification_type_locked(_type) OR _type IN ('task_reminder', 'task_note')
$$;

-- Held note notices go out now.
UPDATE public.notifications SET held = false WHERE held AND kind = 'task_note_added';

-- One updating "new notes" notice per person and task while unread.
CREATE FUNCTION public.task_note_notice(_user uuid, _t public.tasks, _note uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _id uuid; _link text := '/tasks?task=' || _t.id || '&note=' || _note;
BEGIN
  IF _user IS NULL OR _user IS NOT DISTINCT FROM auth.uid() THEN RETURN; END IF;
  -- No row lock up front (the UPDATE takes its own); notify() skips a recipient deleted at this moment.
  SELECT id INTO _id FROM public.notifications
  WHERE user_id = _user AND kind = 'task_note_added' AND entity_id = _t.id AND read_at IS NULL AND NOT held
  ORDER BY created_at DESC LIMIT 1;
  IF _id IS NULL THEN
    PERFORM public.notify(_user, 'task_note_added', 'task', _t.id, _t.title, _link, jsonb_build_object('note_id', _note, 'count', 1));
  ELSE
    BEGIN
      UPDATE public.notifications SET actor_id = auth.uid(), title = left(coalesce(_t.title, ''), 300), link = _link, created_at = now(),
        payload = payload || jsonb_build_object('note_id', _note, 'count', coalesce((payload->>'count')::integer, 1) + 1)
      WHERE id = _id;
    EXCEPTION WHEN foreign_key_violation THEN
      RETURN;  -- the author was deleted at this very moment
    END;
  END IF;
END $$;

-- Mentions link to the note too.
CREATE OR REPLACE FUNCTION public.task_note_notices(_t public.tasks, _note uuid, _mentions uuid[], _previous uuid[]) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _u uuid;
BEGIN
  FOREACH _u IN ARRAY _mentions LOOP
    IF NOT (_u = ANY (coalesce(_previous, '{}'))) THEN
      PERFORM public.notify(_u, 'task_note_mention', 'task', _t.id, _t.title, '/tasks?task=' || _t.id || '&note=' || _note,
        jsonb_build_object('note_id', _note));
    END IF;
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.add_task_note(p_task uuid, p_body text, p_mentions jsonb DEFAULT '[]'::jsonb) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _t public.tasks; _id uuid; _mentions uuid[]; _u uuid;
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
  -- Every assignee (not the author, not someone mentioned: they have the mention notice).
  FOR _u IN SELECT user_id FROM public.task_assignees WHERE task_id = p_task AND user_id <> auth.uid() AND NOT (user_id = ANY (_mentions))
      ORDER BY user_id LOOP
    PERFORM public.task_note_notice(_u, _t, _id);
  END LOOP;
  -- The creator hears about notes from assignees (unless mentioned, or already told as an assignee).
  IF _t.created_by IS NOT NULL AND _t.created_by <> auth.uid() AND NOT (_t.created_by = ANY (_mentions))
    AND NOT EXISTS (SELECT 1 FROM public.task_assignees WHERE task_id = p_task AND user_id = _t.created_by)
    AND EXISTS (SELECT 1 FROM public.task_assignees WHERE task_id = p_task AND user_id = auth.uid()) THEN
    PERFORM public.task_note_notice(_t.created_by, _t, _id);
  END IF;
  RETURN _id;
END $$;

REVOKE ALL ON FUNCTION public.task_note_notice(uuid, public.tasks, uuid) FROM PUBLIC, anon, authenticated;

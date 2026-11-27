-- Carry-over from any meeting, into new and existing meetings (docs/meetings.md → "Carry over").
--
-- An unresolved agenda item of any meeting of the same place (past or upcoming, carried before or not) can be copied,
-- with the chosen decisions, into a new meeting or into an existing one. An item can be carried into several meetings,
-- so its copies form a tree: the single forward link meeting_agenda_items.carried_to (one later item) is replaced by
-- meeting_agenda_items.carried_from (the item it was copied from), like meeting_decisions.carried_from.
--
-- Data: every existing carried_to link becomes the copy's carried_from (the same pairs, read the other way); the
-- migration stops and changes nothing if two items ever pointed to the same copy. Read-only preview:
-- scripts/carry-over-anywhere/preview.sql.
--
-- Candidates (carry_over_candidates): items of meetings that are not deleted, of the same place, that the caller can
-- edit, not in the target meeting. A tree of copies shows once, as its most recently created copy, and only while
-- that copy is unresolved; a tree that already has a copy in the target meeting is not offered. Tasks are never moved
-- or copied (20261221090000): they stay on their decision and show under every later copy.

ALTER TABLE public.meeting_agenda_items ADD COLUMN carried_from uuid REFERENCES public.meeting_agenda_items(id) ON DELETE SET NULL;
CREATE INDEX meeting_agenda_items_carried_from_idx ON public.meeting_agenda_items (carried_from) WHERE carried_from IS NOT NULL;

DO $$
DECLARE _bad text; _n integer;
BEGIN
  SELECT string_agg(format('%s (%s): copy of %s items', c.title, c.id, x.n), '; ') INTO _bad
  FROM (SELECT carried_to, count(*) AS n FROM public.meeting_agenda_items WHERE carried_to IS NOT NULL
        GROUP BY carried_to HAVING count(*) > 1) x
  JOIN public.meeting_agenda_items c ON c.id = x.carried_to;
  IF _bad IS NOT NULL THEN
    RAISE EXCEPTION 'Carry-over link change stopped, nothing was changed. One copy with several sources: %', _bad;
  END IF;
  UPDATE public.meeting_agenda_items b SET carried_from = a.id
  FROM public.meeting_agenda_items a WHERE a.carried_to = b.id;
  GET DIAGNOSTICS _n = ROW_COUNT;
  RAISE NOTICE 'Carry-over links converted: %', _n;
END $$;

-- ---------------------------------------------------------------------------------------------------------------
-- Functions that read carried_to are replaced below, before the column goes.

-- The first item of an agenda item's tree (the item itself when it was not copied from another).
CREATE FUNCTION public.agenda_item_root(p_item uuid) RETURNS uuid
LANGUAGE sql STABLE SET search_path = public AS $$
  WITH RECURSIVE up AS (
    SELECT a.id, a.carried_from, 0 AS depth FROM public.meeting_agenda_items a WHERE a.id = p_item
    UNION ALL
    SELECT a.id, a.carried_from, up.depth + 1 FROM public.meeting_agenda_items a JOIN up ON a.id = up.carried_from
    WHERE up.depth < 200
  )
  SELECT id FROM up ORDER BY depth DESC LIMIT 1
$$;
REVOKE ALL ON FUNCTION public.agenda_item_root(uuid) FROM PUBLIC, anon, authenticated;

-- The agenda items that can be carried into a meeting of this place (p_target: that meeting; NULL while creating one).
CREATE FUNCTION public.carry_over_candidates(p_scope text, p_branch uuid, p_region uuid, p_target uuid)
RETURNS TABLE (item_id uuid)
LANGUAGE sql STABLE SET search_path = public AS $$
  WITH RECURSIVE live AS (
    -- Items of meetings of this place that are not deleted (copies in deleted meetings do not count).
    SELECT a.id, a.carried_from, a.meeting_id, a.resolved, a.created_at, m.starts_at AS m_starts
    FROM public.meeting_agenda_items a JOIN public.meetings m ON m.id = a.meeting_id
    WHERE m.deleted_at IS NULL AND m.scope = p_scope AND m.branch_id IS NOT DISTINCT FROM p_branch
      AND m.region_id IS NOT DISTINCT FROM p_region
  ),
  up AS (
    SELECT l.id, l.id AS root, l.carried_from AS next, 0 AS depth FROM live l
    UNION ALL
    SELECT up.id, a.id, a.carried_from, up.depth + 1
    FROM up JOIN public.meeting_agenda_items a ON a.id = up.next WHERE up.depth < 200
  ),
  rooted AS (
    SELECT DISTINCT ON (up.id) up.id, up.root FROM up ORDER BY up.id, up.depth DESC
  ),
  latest AS (
    -- Per tree, the most recently created item that has no copy of its own (the leaf of a chain).
    SELECT DISTINCT ON (r.root) r.root, l.id, l.meeting_id, l.resolved
    FROM live l JOIN rooted r ON r.id = l.id
    WHERE NOT EXISTS (SELECT 1 FROM live c WHERE c.carried_from = l.id)
    ORDER BY r.root, l.created_at DESC, m_starts DESC, l.id DESC
  )
  SELECT x.id FROM latest x
  WHERE NOT x.resolved AND x.meeting_id IS DISTINCT FROM p_target
    AND NOT EXISTS (SELECT 1 FROM live t JOIN rooted r ON r.id = t.id WHERE t.meeting_id = p_target AND r.root = x.root)
    AND public.can_edit_meeting(x.meeting_id)
$$;
REVOKE ALL ON FUNCTION public.carry_over_candidates(text, uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;

-- The picker's list: meetings newest first (at most 100 with something to carry), each with its candidate items,
-- their decisions and the decisions' open tasks (read-only: tasks are shared, never moved).
CREATE FUNCTION public.carry_over_json(p_scope text, p_branch uuid, p_region uuid, p_target uuid) RETURNS jsonb
LANGUAGE sql STABLE SET search_path = public AS $$
  WITH c AS (SELECT item_id FROM public.carry_over_candidates(p_scope, p_branch, p_region, p_target))
  SELECT coalesce(jsonb_agg(jsonb_build_object('meeting_id', m.id, 'meeting_title', m.title, 'starts_at', m.starts_at,
      'items', m.items) ORDER BY m.starts_at DESC, m.id), '[]'::jsonb)
  FROM (SELECT m.id, m.title, m.starts_at,
      (SELECT coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'title', a.title, 'notes', a.notes,
          'decisions', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'text', d.text,
              'tasks', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'title', t.title, 'status', t.status,
                  'group_id', t.group_id,
                  'assignees', (SELECT coalesce(jsonb_agg(p.full_name ORDER BY p.full_name), '[]'::jsonb) FROM public.task_assignees x
                    JOIN public.profiles p ON p.id = x.user_id WHERE x.task_id = t.id AND p.deleted_at IS NULL))
                  ORDER BY t.created_at, t.id), '[]'::jsonb)
                FROM public.tasks t WHERE t.decision_id = ANY (public.decision_lineage(d.id)) AND t.deleted_at IS NULL
                  AND t.status <> 'done' AND public.can_view_task(t.id)))
            ORDER BY d.created_at, d.id), '[]'::jsonb) FROM public.meeting_decisions d WHERE d.agenda_item_id = a.id))
        ORDER BY a.position, a.id), '[]'::jsonb)
        FROM public.meeting_agenda_items a WHERE a.meeting_id = m.id AND a.id IN (SELECT item_id FROM c)) AS items
    FROM public.meetings m
    WHERE m.id IN (SELECT a.meeting_id FROM public.meeting_agenda_items a WHERE a.id IN (SELECT item_id FROM c))
    ORDER BY m.starts_at DESC, m.id LIMIT 100) m
$$;
REVOKE ALL ON FUNCTION public.carry_over_json(text, uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;

-- Creating a meeting (same signature and shape as before; past and upcoming meetings, no 10-meeting limit).
CREATE OR REPLACE FUNCTION public.list_meeting_carry_over(p_scope text, p_branch uuid DEFAULT NULL, p_region uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF p_scope = 'branch' THEN SELECT region_id INTO p_region FROM public.branches WHERE id = p_branch; END IF;
  IF p_scope = 'national' THEN p_branch := NULL; p_region := NULL; END IF;
  IF NOT public.has_accepted_privacy_notice() OR NOT public.work_scope_valid(p_scope, p_branch, p_region)
    OR NOT public.can_create_meeting(p_scope, p_branch, p_region) THEN RETURN '[]'::jsonb; END IF;
  RETURN public.carry_over_json(p_scope, p_branch, p_region, NULL);
END $$;

-- An existing meeting: what can be added to it from other meetings of its place ("Add from other meetings").
CREATE FUNCTION public.list_meeting_carry_in(p_meeting uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _m public.meetings;
BEGIN
  SELECT * INTO _m FROM public.meetings WHERE id = p_meeting AND deleted_at IS NULL;
  IF NOT FOUND OR NOT public.has_accepted_privacy_notice() OR NOT public.can_edit_meeting(p_meeting) THEN
    RETURN '[]'::jsonb;
  END IF;
  RETURN public.carry_over_json(_m.scope, _m.branch_id, _m.region_id, _m.id);
END $$;
REVOKE EXECUTE ON FUNCTION public.list_meeting_carry_in(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_meeting_carry_in(uuid) TO authenticated;

-- Copies the chosen items (appended after the meeting's agenda) and decisions. Any unresolved item of another meeting
-- of the same place can be carried, again and into several meetings, but a meeting holds one copy per tree.
CREATE OR REPLACE FUNCTION public.carry_over_agenda(p_meeting uuid, p jsonb) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _target public.meetings; _x jsonb; _item public.meeting_agenda_items; _src public.meetings; _new_item uuid;
  _d public.meeting_decisions; _decisions uuid[]; _n integer := 0;
BEGIN
  PERFORM public.require_privacy_accepted();
  PERFORM public.meeting_editable(p_meeting);
  -- One carry-in at a time per meeting, so two at once cannot both add the same item.
  SELECT * INTO _target FROM public.meetings WHERE id = p_meeting FOR UPDATE;
  IF jsonb_typeof(p) <> 'array' OR jsonb_array_length(p) > 50 THEN RAISE EXCEPTION 'Not allowed'; END IF;
  FOR _x IN SELECT * FROM jsonb_array_elements(p) LOOP
    SELECT * INTO _item FROM public.meeting_agenda_items WHERE id = nullif(_x->>'item_id', '')::uuid FOR UPDATE;
    IF NOT FOUND OR _item.resolved OR _item.meeting_id = p_meeting THEN
      RAISE EXCEPTION 'This agenda item cannot be carried over';
    END IF;
    SELECT * INTO _src FROM public.meetings WHERE id = _item.meeting_id AND deleted_at IS NULL;
    IF NOT FOUND OR NOT public.can_edit_meeting(_src.id) OR _src.scope <> _target.scope
      OR _src.branch_id IS DISTINCT FROM _target.branch_id OR _src.region_id IS DISTINCT FROM _target.region_id THEN
      RAISE EXCEPTION 'This agenda item cannot be carried over';
    END IF;
    IF EXISTS (SELECT 1 FROM public.meeting_agenda_items a WHERE a.meeting_id = p_meeting
               AND public.agenda_item_root(a.id) = public.agenda_item_root(_item.id)) THEN
      RAISE EXCEPTION 'This agenda item cannot be carried over';
    END IF;
    _decisions := public.json_uuid_array(_x->'decision_ids');
    -- task_ids (from earlier app versions) are accepted and ignored: tasks stay where they were created.
    IF (SELECT count(*) FROM public.meeting_agenda_items WHERE meeting_id = p_meeting) >= 50 THEN RAISE EXCEPTION 'Too many agenda items'; END IF;
    INSERT INTO public.meeting_agenda_items (meeting_id, position, title, notes, carried_from)
    VALUES (p_meeting, coalesce((SELECT max(position) + 1 FROM public.meeting_agenda_items WHERE meeting_id = p_meeting), 0),
      _item.title, _item.notes, _item.id)
    RETURNING id INTO _new_item;
    FOR _d IN SELECT * FROM public.meeting_decisions WHERE agenda_item_id = _item.id AND id = ANY (coalesce(_decisions, '{}'::uuid[]))
        ORDER BY created_at, id LOOP
      -- The copy points to its original: the original's tasks show under it too (they are never moved or copied).
      INSERT INTO public.meeting_decisions (meeting_id, agenda_item_id, text, created_by, carried_from)
      VALUES (p_meeting, _new_item, _d.text, auth.uid(), _d.id);
    END LOOP;
    _n := _n + 1;
  END LOOP;
  RETURN _n;
END $$;

-- "From last meeting": the previous meeting's open items that were not carried anywhere yet (as before).
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
                      FROM public.tasks t WHERE t.decision_id = ANY (public.decision_lineage(d.id)) AND t.deleted_at IS NULL
                        AND public.can_view_task(t.id)))
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
        FROM public.meeting_agenda_items a WHERE a.meeting_id = _prev.id AND NOT a.resolved
          AND NOT EXISTS (SELECT 1 FROM public.meeting_agenda_items c WHERE c.carried_from = a.id)),
      'tasks', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'title', t.title, 'status', t.status, 'due_date', t.due_date,
          'assignees', (SELECT coalesce(jsonb_agg(p.full_name ORDER BY p.full_name), '[]'::jsonb) FROM public.task_assignees x
            JOIN public.profiles p ON p.id = x.user_id WHERE x.task_id = t.id AND p.deleted_at IS NULL))
          ORDER BY t.due_date NULLS LAST, t.created_at, t.id), '[]'::jsonb)
        FROM public.tasks t WHERE t.meeting_id = _prev.id AND t.deleted_at IS NULL AND t.status <> 'done' AND public.can_view_task(t.id))) END);
END $$;

DROP INDEX public.meeting_agenda_items_carried_to_idx;
ALTER TABLE public.meeting_agenda_items DROP COLUMN carried_to;

-- ---------------------------------------------------------------------------------------------------------------
-- Deleting keeps the trees whole

-- An agenda item deleted for good: its copies point to the item it was copied from. The link is read again (not
-- from OLD): one statement can delete several items of a chain (the nightly purge of several meetings), and an earlier
-- row's trigger may have changed it, or deleted the item it pointed to.
CREATE FUNCTION public.meeting_agenda_items_pass_on() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _up uuid;
BEGIN
  SELECT p.id INTO _up FROM public.meeting_agenda_items a JOIN public.meeting_agenda_items p ON p.id = a.carried_from
  WHERE a.id = OLD.id;
  UPDATE public.meeting_agenda_items SET carried_from = _up WHERE carried_from = OLD.id;
  RETURN OLD;
END $$;
REVOKE ALL ON FUNCTION public.meeting_agenda_items_pass_on() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER meeting_agenda_items_pass_on BEFORE DELETE ON public.meeting_agenda_items
  FOR EACH ROW EXECUTE FUNCTION public.meeting_agenda_items_pass_on();

-- A decision deleted for good: its tasks pass to its earliest copy (in a meeting that is not deleted first), and its
-- other copies now hang under that copy, so every copy still shows the tasks. The link is read again, as above (with
-- OLD.carried_from a purge of a chain across several meetings could point a copy at a decision already deleted).
CREATE OR REPLACE FUNCTION public.meeting_decisions_pass_on() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _next public.meeting_decisions; _up uuid;
BEGIN
  SELECT p.id INTO _up FROM public.meeting_decisions d JOIN public.meeting_decisions p ON p.id = d.carried_from
  WHERE d.id = OLD.id;
  SELECT d.* INTO _next FROM public.meeting_decisions d JOIN public.meetings m ON m.id = d.meeting_id
  WHERE d.carried_from = OLD.id ORDER BY (m.deleted_at IS NOT NULL), m.starts_at, d.created_at, d.id LIMIT 1;
  IF FOUND THEN
    UPDATE public.tasks SET decision_id = _next.id, meeting_id = _next.meeting_id WHERE decision_id = OLD.id;
    UPDATE public.task_groups SET decision_id = _next.id, meeting_id = _next.meeting_id WHERE decision_id = OLD.id;
    UPDATE public.meeting_decisions SET carried_from = _up WHERE id = _next.id;
    UPDATE public.meeting_decisions SET carried_from = _next.id WHERE carried_from = OLD.id AND id <> _next.id;
  END IF;
  RETURN OLD;
END $$;

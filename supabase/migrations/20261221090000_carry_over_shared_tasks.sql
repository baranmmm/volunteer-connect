-- Carry-over shares tasks instead of moving them (docs/meetings.md → "Carry-over").
--
-- A carried decision now points to the decision it was copied from (meeting_decisions.carried_from). A task stays on
-- the decision where it was created and shows under that decision and under all of its later copies (never earlier
-- ones): one task, shared status, assignees, notes and dates. carry_over_agenda no longer moves tasks.
--
-- Repair: carry-overs made before this migration moved the decisions' tasks to the copies. For every carried item
-- (meeting_agenda_items.carried_to) each copy is linked to its original, by the item link when one decision was
-- carried, otherwise by identical text within that item pair when exactly one original matches; tasks and "@all"
-- groups that existed before the copy go back to the decision where they were created. The logic is the same as
-- scripts/carry-over-repair/preview.sql (read-only). If any copy or task cannot be matched, the migration stops and
-- changes nothing; the error lists them.
--
-- When a decision is deleted for good, its tasks pass to its copy (a copy in a meeting that is not deleted first), so
-- they never vanish from later meetings.

ALTER TABLE public.meeting_decisions ADD COLUMN carried_from uuid REFERENCES public.meeting_decisions(id) ON DELETE SET NULL;
CREATE INDEX meeting_decisions_carried_from_idx ON public.meeting_decisions (carried_from) WHERE carried_from IS NOT NULL;

-- ---------------------------------------------------------------------------------------------------------------
-- Repair of existing carry-overs

CREATE TEMP TABLE _carry_matched ON COMMIT DROP AS
WITH RECURSIVE
pairs AS (
  SELECT a.id AS src_item, a.meeting_id AS src_meeting, b.id AS copy_item, b.meeting_id AS copy_meeting,
         b.created_at AS carried_at, b.title AS item_title
  FROM public.meeting_agenda_items a JOIN public.meeting_agenda_items b ON b.id = a.carried_to
),
copies AS (
  SELECT p.*, d.id AS copy_decision, d.text AS copy_text, d.created_at AS copy_created
  FROM pairs p JOIN public.meeting_decisions d ON d.agenda_item_id = p.copy_item AND d.created_at = p.carried_at
),
originals AS (
  SELECT p.src_item, d.id AS orig_decision, d.text AS orig_text
  FROM pairs p JOIN public.meeting_decisions d ON d.agenda_item_id = p.src_item AND d.created_at < p.carried_at
),
sizes AS (
  SELECT p.src_item,
         (SELECT count(*) FROM copies c WHERE c.src_item = p.src_item) AS n_copies,
         (SELECT count(*) FROM originals o WHERE o.src_item = p.src_item) AS n_originals
  FROM pairs p
),
same_text AS (
  SELECT c.copy_decision, o.orig_decision
  FROM copies c JOIN originals o ON o.src_item = c.src_item AND o.orig_text = c.copy_text
),
unique_text AS (
  SELECT s.copy_decision, s.orig_decision FROM same_text s
  WHERE (SELECT count(*) FROM same_text x WHERE x.copy_decision = s.copy_decision) = 1
    AND (SELECT count(*) FROM same_text x WHERE x.orig_decision = s.orig_decision) = 1
),
matched AS (
  SELECT c.*,
         CASE WHEN z.n_copies = 1 AND z.n_originals = 1 THEN (SELECT o.orig_decision FROM originals o WHERE o.src_item = c.src_item)
              ELSE (SELECT u.orig_decision FROM unique_text u WHERE u.copy_decision = c.copy_decision) END AS orig_decision,
         CASE WHEN z.n_copies = 1 AND z.n_originals = 1 THEN 'single decision'
              WHEN EXISTS (SELECT 1 FROM unique_text u WHERE u.copy_decision = c.copy_decision) THEN 'identical text'
              ELSE 'UNMATCHED' END AS method
  FROM copies c JOIN sizes z USING (src_item)
),
-- Work on a copy decision: tasks without a group, and "@all" groups (their member tasks follow the group).
work AS (
  SELECT 'task' AS kind, t.id, t.title, t.status::text AS status, t.created_at, t.decision_id, t.deleted_at IS NOT NULL AS deleted,
         NULL::bigint AS members
  FROM public.tasks t WHERE t.group_id IS NULL AND t.decision_id IN (SELECT copy_decision FROM copies)
  UNION ALL
  SELECT 'group', g.id, g.title, NULL, g.created_at, g.decision_id, false,
         (SELECT count(*) FROM public.tasks m WHERE m.group_id = g.id AND m.deleted_at IS NULL)
  FROM public.task_groups g WHERE g.decision_id IN (SELECT copy_decision FROM copies)
),
walk AS (
  SELECT w.kind, w.id, w.created_at AS work_created, w.decision_id AS at_decision, d.created_at AS at_created, 0 AS depth
  FROM work w JOIN public.meeting_decisions d ON d.id = w.decision_id
  UNION ALL
  SELECT k.kind, k.id, k.work_created, m.orig_decision, d.created_at, k.depth + 1
  FROM walk k
  JOIN matched m ON m.copy_decision = k.at_decision AND m.orig_decision IS NOT NULL
  JOIN public.meeting_decisions d ON d.id = m.orig_decision
  WHERE k.work_created < k.at_created
),
final AS (
  SELECT DISTINCT ON (kind, id) kind, id, at_decision, at_created, work_created, depth
  FROM walk ORDER BY kind, id, depth DESC
),
plan AS (
  SELECT w.kind, w.id, w.title, w.status, w.deleted, w.members, w.created_at, m.*,
         CASE WHEN f.work_created < f.at_created THEN 'UNMATCHED'
              WHEN f.depth = 0 THEN 'stays on the copy (created after the copy)'
              ELSE 'moves back' END AS action,
         CASE WHEN f.work_created < f.at_created THEN NULL ELSE f.at_decision END AS target_decision
  FROM work w JOIN final f ON f.kind = w.kind AND f.id = w.id JOIN matched m ON m.copy_decision = w.decision_id
)
SELECT copy_decision, orig_decision, method, copy_meeting FROM matched;

CREATE TEMP TABLE _carry_plan ON COMMIT DROP AS
WITH RECURSIVE
pairs AS (
  SELECT a.id AS src_item, a.meeting_id AS src_meeting, b.id AS copy_item, b.meeting_id AS copy_meeting,
         b.created_at AS carried_at, b.title AS item_title
  FROM public.meeting_agenda_items a JOIN public.meeting_agenda_items b ON b.id = a.carried_to
),
copies AS (
  SELECT p.*, d.id AS copy_decision, d.text AS copy_text, d.created_at AS copy_created
  FROM pairs p JOIN public.meeting_decisions d ON d.agenda_item_id = p.copy_item AND d.created_at = p.carried_at
),
originals AS (
  SELECT p.src_item, d.id AS orig_decision, d.text AS orig_text
  FROM pairs p JOIN public.meeting_decisions d ON d.agenda_item_id = p.src_item AND d.created_at < p.carried_at
),
sizes AS (
  SELECT p.src_item,
         (SELECT count(*) FROM copies c WHERE c.src_item = p.src_item) AS n_copies,
         (SELECT count(*) FROM originals o WHERE o.src_item = p.src_item) AS n_originals
  FROM pairs p
),
same_text AS (
  SELECT c.copy_decision, o.orig_decision
  FROM copies c JOIN originals o ON o.src_item = c.src_item AND o.orig_text = c.copy_text
),
unique_text AS (
  SELECT s.copy_decision, s.orig_decision FROM same_text s
  WHERE (SELECT count(*) FROM same_text x WHERE x.copy_decision = s.copy_decision) = 1
    AND (SELECT count(*) FROM same_text x WHERE x.orig_decision = s.orig_decision) = 1
),
matched AS (
  SELECT c.*,
         CASE WHEN z.n_copies = 1 AND z.n_originals = 1 THEN (SELECT o.orig_decision FROM originals o WHERE o.src_item = c.src_item)
              ELSE (SELECT u.orig_decision FROM unique_text u WHERE u.copy_decision = c.copy_decision) END AS orig_decision,
         CASE WHEN z.n_copies = 1 AND z.n_originals = 1 THEN 'single decision'
              WHEN EXISTS (SELECT 1 FROM unique_text u WHERE u.copy_decision = c.copy_decision) THEN 'identical text'
              ELSE 'UNMATCHED' END AS method
  FROM copies c JOIN sizes z USING (src_item)
),
-- Work on a copy decision: tasks without a group, and "@all" groups (their member tasks follow the group).
work AS (
  SELECT 'task' AS kind, t.id, t.title, t.status::text AS status, t.created_at, t.decision_id, t.deleted_at IS NOT NULL AS deleted,
         NULL::bigint AS members
  FROM public.tasks t WHERE t.group_id IS NULL AND t.decision_id IN (SELECT copy_decision FROM copies)
  UNION ALL
  SELECT 'group', g.id, g.title, NULL, g.created_at, g.decision_id, false,
         (SELECT count(*) FROM public.tasks m WHERE m.group_id = g.id AND m.deleted_at IS NULL)
  FROM public.task_groups g WHERE g.decision_id IN (SELECT copy_decision FROM copies)
),
walk AS (
  SELECT w.kind, w.id, w.created_at AS work_created, w.decision_id AS at_decision, d.created_at AS at_created, 0 AS depth
  FROM work w JOIN public.meeting_decisions d ON d.id = w.decision_id
  UNION ALL
  SELECT k.kind, k.id, k.work_created, m.orig_decision, d.created_at, k.depth + 1
  FROM walk k
  JOIN matched m ON m.copy_decision = k.at_decision AND m.orig_decision IS NOT NULL
  JOIN public.meeting_decisions d ON d.id = m.orig_decision
  WHERE k.work_created < k.at_created
),
final AS (
  SELECT DISTINCT ON (kind, id) kind, id, at_decision, at_created, work_created, depth
  FROM walk ORDER BY kind, id, depth DESC
),
plan AS (
  SELECT w.kind, w.id, w.title, w.status, w.deleted, w.members, w.created_at, m.*,
         CASE WHEN f.work_created < f.at_created THEN 'UNMATCHED'
              WHEN f.depth = 0 THEN 'stays on the copy (created after the copy)'
              ELSE 'moves back' END AS action,
         CASE WHEN f.work_created < f.at_created THEN NULL ELSE f.at_decision END AS target_decision
  FROM work w JOIN final f ON f.kind = w.kind AND f.id = w.id JOIN matched m ON m.copy_decision = w.decision_id
)
SELECT kind, id, title, copy_decision, copy_meeting, action, target_decision FROM plan;

DO $$
DECLARE _unmatched text;
BEGIN
  SELECT string_agg(line, E'\n' ORDER BY line) INTO _unmatched FROM (
    SELECT 'decision ' || c.copy_decision || ' in meeting "' || m.title || '" (' || to_char(m.starts_at AT TIME ZONE 'Europe/London', 'DD Mon YYYY')
             || '): "' || left(d.text, 60) || '"' AS line
    FROM _carry_matched c JOIN public.meeting_decisions d ON d.id = c.copy_decision JOIN public.meetings m ON m.id = c.copy_meeting
    WHERE c.method = 'UNMATCHED'
    UNION ALL
    SELECT p.kind || ' ' || p.id || ' "' || left(p.title, 60) || '" on decision ' || p.copy_decision || ' in meeting "' || m.title || '" ('
             || to_char(m.starts_at AT TIME ZONE 'Europe/London', 'DD Mon YYYY') || ')'
    FROM _carry_plan p JOIN public.meetings m ON m.id = p.copy_meeting
    WHERE p.action = 'UNMATCHED'
  ) x;
  IF _unmatched IS NOT NULL THEN
    RAISE EXCEPTION 'Carry-over repair stopped, nothing was changed. Unmatched:%', E'\n' || _unmatched;
  END IF;

  UPDATE public.meeting_decisions d SET carried_from = c.orig_decision FROM _carry_matched c WHERE d.id = c.copy_decision;
  -- Member tasks follow their group.
  UPDATE public.tasks t SET decision_id = p.target_decision, meeting_id = o.meeting_id
  FROM _carry_plan p JOIN public.meeting_decisions o ON o.id = p.target_decision
  WHERE p.action = 'moves back' AND ((p.kind = 'task' AND t.id = p.id) OR (p.kind = 'group' AND t.group_id = p.id));
  UPDATE public.task_groups g SET decision_id = p.target_decision, meeting_id = o.meeting_id
  FROM _carry_plan p JOIN public.meeting_decisions o ON o.id = p.target_decision
  WHERE p.action = 'moves back' AND p.kind = 'group' AND g.id = p.id;
  RAISE NOTICE 'Carry-over repair: % copies linked, % tasks and % groups moved back',
    (SELECT count(*) FROM _carry_matched), (SELECT count(*) FROM _carry_plan WHERE kind = 'task' AND action = 'moves back'),
    (SELECT count(*) FROM _carry_plan WHERE kind = 'group' AND action = 'moves back');
END $$;

DROP TABLE _carry_plan;
DROP TABLE _carry_matched;

-- ---------------------------------------------------------------------------------------------------------------
-- The chain of a decision (internal helpers for the SECURITY DEFINER reads below)

-- The decision and every earlier decision it was copied from (its tasks show under it).
CREATE FUNCTION public.decision_lineage(p_decision uuid) RETURNS uuid[]
LANGUAGE sql STABLE SET search_path = public AS $$
  WITH RECURSIVE up AS (
    SELECT d.id, d.carried_from, 0 AS depth FROM public.meeting_decisions d WHERE d.id = p_decision
    UNION ALL
    SELECT d.id, d.carried_from, up.depth + 1 FROM public.meeting_decisions d JOIN up ON d.id = up.carried_from WHERE up.depth < 200
  )
  SELECT coalesce(array_agg(id), '{}'::uuid[]) FROM up
$$;
REVOKE ALL ON FUNCTION public.decision_lineage(uuid) FROM PUBLIC, anon, authenticated;

-- The later copies of a decision (not the decision itself).
CREATE FUNCTION public.decision_copies(p_decision uuid) RETURNS uuid[]
LANGUAGE sql STABLE SET search_path = public AS $$
  WITH RECURSIVE down AS (
    SELECT d.id, 1 AS depth FROM public.meeting_decisions d WHERE d.carried_from = p_decision
    UNION ALL
    SELECT d.id, down.depth + 1 FROM public.meeting_decisions d JOIN down ON d.carried_from = down.id WHERE down.depth < 200
  )
  SELECT coalesce(array_agg(id), '{}'::uuid[]) FROM down
$$;
REVOKE ALL ON FUNCTION public.decision_copies(uuid) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- Carry-over links instead of moving

CREATE OR REPLACE FUNCTION public.carry_over_agenda(p_meeting uuid, p jsonb) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _target public.meetings; _x jsonb; _item public.meeting_agenda_items; _src public.meetings; _new_item uuid;
  _d public.meeting_decisions; _decisions uuid[]; _n integer := 0;
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
    -- task_ids (from earlier app versions) are accepted and ignored: tasks stay where they were created.
    IF (SELECT count(*) FROM public.meeting_agenda_items WHERE meeting_id = p_meeting) >= 50 THEN RAISE EXCEPTION 'Too many agenda items'; END IF;
    INSERT INTO public.meeting_agenda_items (meeting_id, position, title, notes)
    VALUES (p_meeting, coalesce((SELECT max(position) + 1 FROM public.meeting_agenda_items WHERE meeting_id = p_meeting), 0),
      _item.title, _item.notes)
    RETURNING id INTO _new_item;
    UPDATE public.meeting_agenda_items SET carried_to = _new_item WHERE id = _item.id;
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

-- ---------------------------------------------------------------------------------------------------------------
-- Reads: a decision lists its own tasks and those of the decisions it was copied from

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
        FROM public.meeting_agenda_items a WHERE a.meeting_id = _prev.id AND NOT a.resolved AND a.carried_to IS NULL),
      'tasks', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'title', t.title, 'status', t.status, 'due_date', t.due_date,
          'assignees', (SELECT coalesce(jsonb_agg(p.full_name ORDER BY p.full_name), '[]'::jsonb) FROM public.task_assignees x
            JOIN public.profiles p ON p.id = x.user_id WHERE x.task_id = t.id AND p.deleted_at IS NULL))
          ORDER BY t.due_date NULLS LAST, t.created_at, t.id), '[]'::jsonb)
        FROM public.tasks t WHERE t.meeting_id = _prev.id AND t.deleted_at IS NULL AND t.status <> 'done' AND public.can_view_task(t.id))) END);
END $$;

CREATE OR REPLACE FUNCTION public.list_meeting_carry_over(p_scope text, p_branch uuid DEFAULT NULL, p_region uuid DEFAULT NULL) RETURNS jsonb
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
                  FROM public.tasks t WHERE t.decision_id = ANY (public.decision_lineage(d.id)) AND t.deleted_at IS NULL
                    AND t.status <> 'done'
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

CREATE OR REPLACE FUNCTION public.list_task_sources() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH visible AS (
    SELECT t.decision_id, t.meeting_id, t.event_id FROM public.tasks t
    WHERE t.deleted_at IS NULL AND public.has_accepted_privacy_notice() AND public.can_view_task(t.id)
  ), ids AS (
    SELECT DISTINCT decision_id, meeting_id, event_id FROM visible
  )
  SELECT jsonb_build_object(
    'decisions', coalesce((
      SELECT jsonb_agg(jsonb_build_object('id', d.id, 'agenda_item_id', a.id, 'agenda_item', a.title,
               'meeting_id', m.id, 'meeting', m.title, 'starts_at', m.starts_at,
               -- Later meetings the decision was carried into (its tasks show there too), for "Also in: …".
               'also_in', (SELECT coalesce(jsonb_agg(jsonb_build_object('meeting_id', lm.id, 'meeting', lm.title, 'starts_at', lm.starts_at)
                   ORDER BY lm.starts_at, lm.id), '[]'::jsonb)
                 FROM public.meeting_decisions ld JOIN public.meetings lm ON lm.id = ld.meeting_id
                 WHERE ld.id = ANY (public.decision_copies(d.id)) AND lm.deleted_at IS NULL AND public.can_view_meeting(lm.id)))
             ORDER BY m.starts_at, a.position, d.id)
      FROM public.meeting_decisions d
      JOIN public.meeting_agenda_items a ON a.id = d.agenda_item_id
      JOIN public.meetings m ON m.id = d.meeting_id
      WHERE d.id IN (SELECT decision_id FROM ids WHERE decision_id IS NOT NULL) AND public.can_view_meeting(m.id)), '[]'::jsonb),
    'meetings', coalesce((
      SELECT jsonb_agg(jsonb_build_object('id', m.id, 'title', m.title, 'starts_at', m.starts_at) ORDER BY m.starts_at, m.id)
      FROM public.meetings m
      WHERE m.id IN (SELECT meeting_id FROM ids WHERE meeting_id IS NOT NULL) AND public.can_view_meeting(m.id)), '[]'::jsonb),
    'events', coalesce((
      SELECT jsonb_agg(jsonb_build_object('id', e.id, 'title', e.title,
               'start', CASE WHEN e.all_day THEN e.start_date::text ELSE e.start_at::text END) ORDER BY e.id)
      FROM public.events e
      WHERE e.id IN (SELECT event_id FROM ids WHERE event_id IS NOT NULL) AND public.can_view_event(e.id)), '[]'::jsonb))
$$;

-- ---------------------------------------------------------------------------------------------------------------
-- A decision deleted for good hands its tasks and its place in the chain to its copy

CREATE FUNCTION public.meeting_decisions_pass_on() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _next public.meeting_decisions;
BEGIN
  SELECT d.* INTO _next FROM public.meeting_decisions d JOIN public.meetings m ON m.id = d.meeting_id
  WHERE d.carried_from = OLD.id ORDER BY (m.deleted_at IS NOT NULL), m.starts_at, d.created_at, d.id LIMIT 1;
  IF FOUND THEN
    UPDATE public.tasks SET decision_id = _next.id, meeting_id = _next.meeting_id WHERE decision_id = OLD.id;
    UPDATE public.task_groups SET decision_id = _next.id, meeting_id = _next.meeting_id WHERE decision_id = OLD.id;
    UPDATE public.meeting_decisions SET carried_from = OLD.carried_from WHERE id = _next.id;
  END IF;
  RETURN OLD;
END $$;
REVOKE ALL ON FUNCTION public.meeting_decisions_pass_on() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER meeting_decisions_pass_on BEFORE DELETE ON public.meeting_decisions
  FOR EACH ROW EXECUTE FUNCTION public.meeting_decisions_pass_on();

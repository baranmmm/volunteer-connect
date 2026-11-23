-- Recurring meetings, agenda follow-up and the meeting form's agenda.
--
-- * A recurring meeting is a series of occurrences (meeting_series): weekly or monthly, every 1-4 weeks/months,
--   2-52 occurrences within 12 months, all created at once. Each occurrence is an ordinary meeting (with its own
--   calendar entry, agenda, decisions, notes and files). London wall-clock time is kept across clock changes.
-- * Edits use the same scopes as recurring events: this / this and following / all (update_meeting_series,
--   delete_meeting_series). Only the edited occurrence's invitees are notified.
-- * Series agenda template: standing items copied into every occurrence; changing the template adds new standing
--   items to the upcoming occurrences.
-- * Agenda items can be marked resolved. get_meeting adds "From last meeting": the previous occurrence's unresolved
--   items and its open tasks (live rows, not copies). get_meeting_series_tasks lists every task created from the
--   series' decisions.

CREATE TABLE public.meeting_series (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  freq text NOT NULL CHECK (freq IN ('weekly', 'monthly')),
  interval_count integer NOT NULL DEFAULT 1 CHECK (interval_count BETWEEN 1 AND 4),
  occurrence_count integer NOT NULL CHECK (occurrence_count BETWEEN 2 AND 52),
  agenda_template jsonb NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(agenda_template) = 'array' AND jsonb_array_length(agenda_template) <= 30),
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX meeting_series_created_by_idx ON public.meeting_series (created_by) WHERE created_by IS NOT NULL;
-- Read through the meeting RPCs only.
ALTER TABLE public.meeting_series ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.meeting_series FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.meeting_series TO service_role;

ALTER TABLE public.meetings ADD COLUMN series_id uuid REFERENCES public.meeting_series(id) ON DELETE SET NULL,
  ADD COLUMN series_position integer;
CREATE INDEX meetings_series_idx ON public.meetings (series_id, starts_at) WHERE series_id IS NOT NULL;

ALTER TABLE public.meeting_agenda_items ADD COLUMN resolved boolean NOT NULL DEFAULT false,
  ADD COLUMN standing boolean NOT NULL DEFAULT false;

-- ---------------------------------------------------------------------------------------------------------------
-- Internal helpers

-- Occurrence times: London wall-clock time kept; i = 0 is the first meeting.
CREATE FUNCTION public.meeting_occurrence_times(_start timestamptz, _end timestamptz, _freq text, _interval integer, _count integer)
RETURNS TABLE (i integer, starts_at timestamptz, ends_at timestamptz)
LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT n, (local_start AT TIME ZONE 'Europe/London'), (local_start AT TIME ZONE 'Europe/London') + (_end - _start)
  FROM generate_series(0, _count - 1) n,
  LATERAL (SELECT (_start AT TIME ZONE 'Europe/London')
    + CASE WHEN _freq = 'monthly' THEN make_interval(months => n * _interval) ELSE make_interval(days => 7 * n * _interval) END AS local_start) x
$$;

-- Agenda titles from a form (array of strings): trimmed, 1-200 characters, at most 30.
CREATE FUNCTION public.agenda_titles(p jsonb) RETURNS text[]
LANGUAGE plpgsql IMMUTABLE SET search_path = public AS $$
DECLARE _t text[];
BEGIN
  IF p IS NULL OR jsonb_typeof(p) <> 'array' THEN RETURN '{}'; END IF;
  _t := ARRAY(SELECT btrim(x) FROM jsonb_array_elements_text(p) WITH ORDINALITY AS a(x, o) WHERE btrim(x) <> '' ORDER BY o);
  IF cardinality(_t) > 30 OR EXISTS (SELECT 1 FROM unnest(_t) x WHERE char_length(x) > 200) THEN RAISE EXCEPTION 'Agenda items are not valid'; END IF;
  RETURN _t;
END $$;

-- Appends agenda items (callers check rights). Standing items come from a series template.
CREATE FUNCTION public.meeting_add_agenda(_meeting uuid, _titles text[], _standing boolean) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _pos integer;
BEGIN
  IF coalesce(cardinality(_titles), 0) = 0 THEN RETURN; END IF;
  SELECT coalesce(max(position) + 1, 0) INTO _pos FROM public.meeting_agenda_items WHERE meeting_id = _meeting;
  IF (SELECT count(*) FROM public.meeting_agenda_items WHERE meeting_id = _meeting) + cardinality(_titles) > 50 THEN
    RAISE EXCEPTION 'Too many agenda items';
  END IF;
  INSERT INTO public.meeting_agenda_items (meeting_id, position, title, standing)
  SELECT _meeting, _pos + o - 1, t, _standing FROM unnest(_titles) WITH ORDINALITY AS a(t, o);
END $$;

-- Applies fields and invitees to one meeting without notices (the other occurrences of a series edit).
CREATE FUNCTION public.meeting_apply_quiet(_old public.meetings, p jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _m public.meetings; _ids uuid[]; _u uuid;
BEGIN
  _m := public.meeting_fields(_old, p);
  UPDATE public.meetings SET title = _m.title, description = _m.description, starts_at = _m.starts_at, ends_at = _m.ends_at,
    location_type = _m.location_type, location = _m.location, online_url = _m.online_url WHERE id = _old.id;
  IF p ? 'invitee_ids' THEN
    _ids := ARRAY(SELECT DISTINCT x FROM unnest(public.json_uuid_array(p->'invitee_ids')) x WHERE x IS NOT NULL);
    IF cardinality(_ids) > 100 THEN RAISE EXCEPTION 'Too many invitees'; END IF;
    FOREACH _u IN ARRAY _ids LOOP
      IF NOT EXISTS (SELECT 1 FROM public.meeting_invitees WHERE meeting_id = _old.id AND user_id = _u)
        AND NOT public.in_work_scope(_old.scope, _old.branch_id, _old.region_id, _u) THEN RAISE EXCEPTION 'Invitee is not in this scope'; END IF;
    END LOOP;
    DELETE FROM public.meeting_invitees WHERE meeting_id = _old.id AND NOT (user_id = ANY (_ids));
    INSERT INTO public.meeting_invitees (meeting_id, user_id, invited_by)
    SELECT _old.id, x, auth.uid() FROM unnest(_ids) x ON CONFLICT DO NOTHING;
  END IF;
END $$;

-- ---------------------------------------------------------------------------------------------------------------
-- Create: one meeting, or a series. p.agenda: agenda titles; p.recurrence: { freq, interval, count }.

CREATE OR REPLACE FUNCTION public.create_meeting(p jsonb) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _scope text := p->>'scope'; _branch uuid := nullif(p->>'branch_id', '')::uuid; _region uuid := nullif(p->>'region_id', '')::uuid;
  _rec jsonb := p->'recurrence'; _agenda text[] := public.agenda_titles(p->'agenda'); _id uuid; _first public.meetings; _series uuid;
  _freq text; _interval integer; _count integer; _occ uuid; r record;
BEGIN
  PERFORM public.require_privacy_accepted();
  PERFORM public.work_actor();
  IF _scope = 'branch' THEN SELECT region_id INTO _region FROM public.branches WHERE id = _branch; END IF;
  IF _scope = 'national' THEN _branch := NULL; _region := NULL; END IF;
  _id := public.meeting_insert(_scope, _branch, _region, p, public.json_uuid_array(p->'invitee_ids'), NULL);
  IF _rec IS NULL OR jsonb_typeof(_rec) <> 'object' THEN
    PERFORM public.meeting_add_agenda(_id, _agenda, false);
    RETURN _id;
  END IF;
  _freq := _rec->>'freq'; _interval := coalesce(nullif(_rec->>'interval', '')::integer, 1); _count := nullif(_rec->>'count', '')::integer;
  IF _freq NOT IN ('weekly', 'monthly') OR _interval NOT BETWEEN 1 AND 4 OR _count IS NULL OR _count NOT BETWEEN 2 AND 52 THEN
    RAISE EXCEPTION 'Repeat settings are not valid';
  END IF;
  SELECT * INTO _first FROM public.meetings WHERE id = _id;
  IF (SELECT max(t.starts_at) FROM public.meeting_occurrence_times(_first.starts_at, _first.ends_at, _freq, _interval, _count) t)
     > _first.starts_at + interval '12 months' THEN
    RAISE EXCEPTION 'A recurring meeting can span at most 12 months';
  END IF;
  INSERT INTO public.meeting_series (freq, interval_count, occurrence_count, agenda_template, created_by)
  VALUES (_freq, _interval, _count, to_jsonb(_agenda), auth.uid()) RETURNING id INTO _series;
  UPDATE public.meetings SET series_id = _series, series_position = 1 WHERE id = _id;
  PERFORM public.meeting_add_agenda(_id, _agenda, true);
  FOR r IN SELECT * FROM public.meeting_occurrence_times(_first.starts_at, _first.ends_at, _freq, _interval, _count) t WHERE t.i > 0 LOOP
    INSERT INTO public.meetings (scope, branch_id, region_id, title, description, starts_at, ends_at, location_type, location, online_url,
      created_by, series_id, series_position)
    VALUES (_first.scope, _first.branch_id, _first.region_id, _first.title, _first.description, r.starts_at, r.ends_at, _first.location_type,
      _first.location, _first.online_url, auth.uid(), _series, r.i + 1)
    RETURNING id INTO _occ;
    -- Invitees were told once, about the first occurrence.
    INSERT INTO public.meeting_invitees (meeting_id, user_id, invited_by)
    SELECT _occ, user_id, auth.uid() FROM public.meeting_invitees WHERE meeting_id = _id;
    PERFORM public.meeting_add_agenda(_occ, _agenda, true);
  END LOOP;
  RETURN _id;
END $$;

-- Edit an occurrence: 'this', 'following' (this and later ones) or 'all'. A time change moves every chosen occurrence
-- by the same amount; the other fields and the invitees are copied. Returns how many occurrences changed.
CREATE FUNCTION public.update_meeting_series(p_id uuid, p_mode text, p jsonb) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _m public.meetings; _o public.meetings; _delta interval; _duration interval; _q jsonb; _n integer := 0;
BEGIN
  PERFORM public.require_privacy_accepted();
  PERFORM public.work_actor();
  _m := public.meeting_locked(p_id);
  IF NOT public.can_edit_meeting(p_id) THEN RAISE EXCEPTION 'Not allowed'; END IF;
  IF p_mode NOT IN ('this', 'following', 'all') THEN RAISE EXCEPTION 'Not allowed'; END IF;
  IF p_mode = 'this' OR _m.series_id IS NULL THEN
    PERFORM public.update_meeting(p_id, p);
    RETURN 1;
  END IF;
  IF p ? 'starts_at' THEN
    _delta := (p->>'starts_at')::timestamptz - _m.starts_at;
    _duration := coalesce((p->>'ends_at')::timestamptz, (p->>'starts_at')::timestamptz + (_m.ends_at - _m.starts_at)) - (p->>'starts_at')::timestamptz;
  END IF;
  FOR _o IN SELECT * FROM public.meetings WHERE series_id = _m.series_id AND deleted_at IS NULL
      AND (p_mode = 'all' OR starts_at >= _m.starts_at) ORDER BY starts_at FOR UPDATE LOOP
    IF NOT public.can_edit_meeting(_o.id) THEN CONTINUE; END IF;
    _q := p - 'starts_at' - 'ends_at';
    IF _delta IS NOT NULL THEN
      _q := _q || jsonb_build_object('starts_at', _o.starts_at + _delta, 'ends_at', _o.starts_at + _delta + _duration);
    END IF;
    IF _o.id = p_id THEN PERFORM public.update_meeting(p_id, _q); ELSE PERFORM public.meeting_apply_quiet(_o, _q); END IF;
    _n := _n + 1;
  END LOOP;
  RETURN _n;
END $$;

-- Delete an occurrence: 'this', 'following' or 'all' (each goes to the Recycle Bin). Returns how many were deleted.
CREATE FUNCTION public.delete_meeting_series(p_id uuid, p_mode text) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _m public.meetings; _o uuid; _n integer := 0;
BEGIN
  PERFORM public.require_privacy_accepted();
  PERFORM public.work_actor();
  _m := public.meeting_locked(p_id);
  IF NOT public.can_edit_meeting(p_id) THEN RAISE EXCEPTION 'Not allowed'; END IF;
  IF p_mode NOT IN ('this', 'following', 'all') THEN RAISE EXCEPTION 'Not allowed'; END IF;
  IF p_mode = 'this' OR _m.series_id IS NULL THEN PERFORM public.delete_meeting(p_id); RETURN 1; END IF;
  FOR _o IN SELECT id FROM public.meetings WHERE series_id = _m.series_id AND deleted_at IS NULL
      AND (p_mode = 'all' OR starts_at >= _m.starts_at) ORDER BY starts_at LOOP
    IF public.can_edit_meeting(_o) THEN PERFORM public.delete_meeting(_o); _n := _n + 1; END IF;
  END LOOP;
  RETURN _n;
END $$;

-- The series' standing agenda items. New items are added to the upcoming occurrences that do not have them yet.
CREATE FUNCTION public.set_meeting_series_agenda(p_id uuid, p_titles jsonb) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _m public.meetings; _titles text[] := public.agenda_titles(p_titles); _o uuid; _missing text[]; _n integer := 0;
BEGIN
  PERFORM public.require_privacy_accepted();
  PERFORM public.meeting_editable(p_id);
  SELECT * INTO _m FROM public.meetings WHERE id = p_id;
  IF _m.series_id IS NULL THEN RAISE EXCEPTION 'Not a recurring meeting'; END IF;
  UPDATE public.meeting_series SET agenda_template = to_jsonb(_titles) WHERE id = _m.series_id;
  FOR _o IN SELECT id FROM public.meetings WHERE series_id = _m.series_id AND deleted_at IS NULL AND starts_at > now() LOOP
    IF NOT public.can_edit_meeting(_o) THEN CONTINUE; END IF;
    _missing := ARRAY(SELECT t FROM unnest(_titles) WITH ORDINALITY AS a(t, o)
      WHERE NOT EXISTS (SELECT 1 FROM public.meeting_agenda_items i WHERE i.meeting_id = _o AND lower(i.title) = lower(t)) ORDER BY o);
    IF cardinality(_missing) > 0 THEN PERFORM public.meeting_add_agenda(_o, _missing, true); _n := _n + 1; END IF;
  END LOOP;
  RETURN _n;
END $$;

-- Agenda items of the create form for one meeting (editors), e.g. right after it was created.
CREATE FUNCTION public.add_agenda_items(p_meeting uuid, p_titles jsonb) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _titles text[] := public.agenda_titles(p_titles);
BEGIN
  PERFORM public.require_privacy_accepted();
  PERFORM public.meeting_editable(p_meeting);
  PERFORM public.meeting_add_agenda(p_meeting, _titles, false);
  RETURN coalesce(cardinality(_titles), 0);
END $$;

-- Resolved / open agenda item (editors). Unresolved items show under "From last meeting" in the next occurrence.
CREATE FUNCTION public.set_agenda_item_resolved(p_id uuid, p_resolved boolean) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _meeting uuid;
BEGIN
  PERFORM public.require_privacy_accepted();
  SELECT meeting_id INTO _meeting FROM public.meeting_agenda_items WHERE id = p_id;
  IF _meeting IS NULL THEN RAISE EXCEPTION 'Not allowed'; END IF;
  PERFORM public.meeting_editable(_meeting);
  UPDATE public.meeting_agenda_items SET resolved = coalesce(p_resolved, false) WHERE id = p_id;
  RETURN coalesce(p_resolved, false);
END $$;

-- Who can change a meeting's invitees only (without other fields): the editors (used by the event form).
CREATE FUNCTION public.set_meeting_invitees(p_id uuid, p_invitee_ids jsonb) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _m public.meetings;
BEGIN
  PERFORM public.require_privacy_accepted();
  PERFORM public.work_actor();
  _m := public.meeting_locked(p_id);
  IF NOT public.can_edit_meeting(p_id) THEN RAISE EXCEPTION 'Not allowed'; END IF;
  RETURN coalesce(cardinality(public.meeting_set_invitees(_m, public.json_uuid_array(p_invitee_ids))), 0);
END $$;

-- ---------------------------------------------------------------------------------------------------------------
-- Reads

CREATE OR REPLACE FUNCTION public.meeting_json(_m public.meetings) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object('id', _m.id, 'scope', _m.scope, 'branch_id', _m.branch_id, 'region_id', _m.region_id,
    'branch', (SELECT name FROM public.branches WHERE id = _m.branch_id), 'region', (SELECT name FROM public.regions WHERE id = _m.region_id),
    'title', _m.title, 'description', _m.description, 'starts_at', _m.starts_at, 'ends_at', _m.ends_at,
    'location_type', _m.location_type, 'location', _m.location, 'online_url', _m.online_url, 'status', _m.status,
    'created_by', _m.created_by, 'created_by_name', (SELECT full_name FROM public.profiles WHERE id = _m.created_by AND deleted_at IS NULL),
    'invitee_count', (SELECT count(*) FROM public.meeting_invitees WHERE meeting_id = _m.id),
    'invited', EXISTS (SELECT 1 FROM public.meeting_invitees WHERE meeting_id = _m.id AND user_id = auth.uid()),
    'can_edit', public.can_edit_meeting(_m.id),
    'event_id', _m.event_id, 'series_id', _m.series_id, 'series_position', _m.series_position,
    'series_count', (SELECT occurrence_count FROM public.meeting_series WHERE id = _m.series_id))
$$;

-- One meeting with invitees, agenda (resolved/standing), decisions and their tasks, files, its series and "From last
-- meeting" (the previous occurrence's unresolved agenda items and open tasks). NULL when not visible.
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
            'tasks', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'title', t.title, 'status', t.status) ORDER BY t.created_at), '[]'::jsonb)
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
        FROM public.meeting_agenda_items a WHERE a.meeting_id = _prev.id AND NOT a.resolved),
      'tasks', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'title', t.title, 'status', t.status, 'due_date', t.due_date,
          'assignees', (SELECT coalesce(jsonb_agg(p.full_name ORDER BY p.full_name), '[]'::jsonb) FROM public.task_assignees x
            JOIN public.profiles p ON p.id = x.user_id WHERE x.task_id = t.id AND p.deleted_at IS NULL))
          ORDER BY t.due_date NULLS LAST, t.created_at, t.id), '[]'::jsonb)
        FROM public.tasks t WHERE t.meeting_id = _prev.id AND t.deleted_at IS NULL AND t.status <> 'done' AND public.can_view_task(t.id))) END);
END $$;

-- Every task created from a decision in this meeting's series (one meeting when it is not recurring), with the
-- occurrence it came from. Only tasks the caller can see.
CREATE FUNCTION public.get_meeting_series_tasks(p_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _m public.meetings;
BEGIN
  IF NOT public.has_accepted_privacy_notice() OR NOT public.can_view_meeting(p_id) THEN RETURN '[]'::jsonb; END IF;
  SELECT * INTO _m FROM public.meetings WHERE id = p_id;
  RETURN (SELECT coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'title', t.title, 'status', t.status, 'due_date', t.due_date,
      'meeting_id', m.id, 'meeting_starts_at', m.starts_at,
      'assignees', (SELECT coalesce(jsonb_agg(p.full_name ORDER BY p.full_name), '[]'::jsonb) FROM public.task_assignees x
        JOIN public.profiles p ON p.id = x.user_id WHERE x.task_id = t.id AND p.deleted_at IS NULL))
      ORDER BY m.starts_at, t.created_at, t.id), '[]'::jsonb)
    FROM public.tasks t JOIN public.meetings m ON m.id = t.meeting_id
    WHERE t.deleted_at IS NULL AND m.deleted_at IS NULL AND public.can_view_task(t.id)
      AND (m.id = p_id OR (_m.series_id IS NOT NULL AND m.series_id = _m.series_id)));
END $$;

-- ---------------------------------------------------------------------------------------------------------------
-- Grants

REVOKE ALL ON FUNCTION public.meeting_occurrence_times(timestamptz, timestamptz, text, integer, integer), public.agenda_titles(jsonb),
  public.meeting_add_agenda(uuid, text[], boolean), public.meeting_apply_quiet(public.meetings, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.update_meeting_series(uuid, text, jsonb), public.delete_meeting_series(uuid, text),
  public.set_meeting_series_agenda(uuid, jsonb), public.add_agenda_items(uuid, jsonb), public.set_agenda_item_resolved(uuid, boolean),
  public.set_meeting_invitees(uuid, jsonb), public.get_meeting_series_tasks(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_meeting_series(uuid, text, jsonb), public.delete_meeting_series(uuid, text),
  public.set_meeting_series_agenda(uuid, jsonb), public.add_agenda_items(uuid, jsonb), public.set_agenda_item_resolved(uuid, boolean),
  public.set_meeting_invitees(uuid, jsonb), public.get_meeting_series_tasks(uuid) TO authenticated;

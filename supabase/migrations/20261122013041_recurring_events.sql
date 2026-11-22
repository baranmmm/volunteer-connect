-- A2r: recurring events.
--
-- A series (public.event_series) stores an RFC 5545 RRULE, evaluated in Europe/London wall-clock time, plus the
-- fields every occurrence copies. Each occurrence is an ordinary public.events row with series_id and a
-- recurrence_key (its original London start), so events RLS (can_view_event / can_manage_event), scope rules,
-- the calendar and future per-occurrence registrations work unchanged.
--
-- Files belong to the series: they hang off a hidden "media holder" events row (series_template = true), so the
-- existing upload, archive, restore and purge code is reused. Occurrences show the holder's files.
--
-- Rules: RLS on, no anon writes, SECURITY DEFINER functions pin search_path and are granted to authenticated
-- only after revoking PUBLIC/anon. Internal helpers are not executable by clients.

-- ---------------------------------------------------------------------------------------------------------
-- 1. Schema
-- ---------------------------------------------------------------------------------------------------------
CREATE TABLE public.event_series (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rule text NOT NULL CHECK (length(rule) BETWEEN 10 AND 500),
  timezone text NOT NULL DEFAULT 'Europe/London' CHECK (timezone = 'Europe/London'),
  all_day boolean NOT NULL DEFAULT false,
  dtstart_local timestamp NOT NULL,
  duration_minutes integer CHECK (duration_minutes IS NULL OR duration_minutes > 0),
  span_days integer NOT NULL DEFAULT 0 CHECK (span_days >= 0),
  status text NOT NULL DEFAULT 'published' CHECK (status IN ('draft', 'published')),
  title text NOT NULL,
  description text NOT NULL DEFAULT '',
  location text NOT NULL DEFAULT '',
  location_type text NOT NULL DEFAULT 'in_person',
  online_url text,
  organizer text NOT NULL,
  category text NOT NULL,
  capacity integer,
  scope text NOT NULL CHECK (scope IN ('branch', 'region')),
  branch_id uuid REFERENCES public.branches(id),
  region_id uuid NOT NULL REFERENCES public.regions(id),
  media_event_id uuid,
  generated_until timestamp,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  deleted_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL
);

ALTER TABLE public.events
  ADD COLUMN series_id uuid REFERENCES public.event_series(id) ON DELETE SET NULL,
  ADD COLUMN recurrence_key timestamp,
  ADD COLUMN series_exception boolean NOT NULL DEFAULT false,
  ADD COLUMN series_template boolean NOT NULL DEFAULT false,
  ADD COLUMN deleted_with_series boolean NOT NULL DEFAULT false;
-- One row per (series, original start); deleted rows keep their key, so regeneration never brings them back.
ALTER TABLE public.events ADD CONSTRAINT events_series_occurrence_key UNIQUE (series_id, recurrence_key);
ALTER TABLE public.event_series ADD CONSTRAINT event_series_media_event_id_fkey
  FOREIGN KEY (media_event_id) REFERENCES public.events(id) ON DELETE SET NULL;
CREATE INDEX event_series_media_event_idx ON public.event_series(media_event_id);
CREATE INDEX event_series_deleted_idx ON public.event_series(deleted_at) WHERE deleted_at IS NOT NULL;

REVOKE ALL ON public.event_series FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.event_series TO authenticated;
GRANT ALL ON public.event_series TO service_role;
ALTER TABLE public.event_series ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.recycle_bin_audit_log DROP CONSTRAINT IF EXISTS recycle_bin_audit_log_item_type_check;
ALTER TABLE public.recycle_bin_audit_log ADD CONSTRAINT recycle_bin_audit_log_item_type_check CHECK (item_type IN ('event', 'user', 'series'));

-- ---------------------------------------------------------------------------------------------------------
-- 2. Visibility helpers and policies
-- ---------------------------------------------------------------------------------------------------------
CREATE FUNCTION public.can_view_series(_series uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.event_series s WHERE s.id = _series AND s.deleted_at IS NULL AND (
      public.can_manage_event_scope(s.scope, s.branch_id, s.region_id)
      OR EXISTS (SELECT 1 FROM public.events e WHERE e.series_id = s.id AND NOT e.series_template
                 AND e.deleted_at IS NULL AND public.can_view_event(e.id))))
$$;

-- Media of a series holder is visible to anyone who can see one of the series' live occurrences.
CREATE FUNCTION public.can_view_event_media(_event uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.can_view_event(_event) OR EXISTS (
    SELECT 1 FROM public.event_series s JOIN public.events o ON o.series_id = s.id
    WHERE s.media_event_id = _event AND s.deleted_at IS NULL AND o.deleted_at IS NULL
      AND NOT o.series_template AND public.can_view_event(o.id))
$$;

CREATE POLICY event_series_read ON public.event_series FOR SELECT TO authenticated USING (public.can_view_series(id));

-- Media holders are never listed as events.
DROP POLICY events_read ON public.events;
CREATE POLICY events_read ON public.events FOR SELECT TO authenticated
  USING (deleted_at IS NULL AND NOT series_template AND public.can_view_event(id));

DROP POLICY event_media_read ON public.event_media;
CREATE POLICY event_media_read ON public.event_media FOR SELECT TO authenticated USING (public.can_view_event_media(event_id));

CREATE OR REPLACE FUNCTION public.can_read_event_file(_path text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.event_media WHERE storage_path = _path AND public.can_view_event_media(event_id))
$$;

-- Occurrences deleted together with their series, and media holders, are restored only as part of the series.
CREATE OR REPLACE FUNCTION public.can_restore_event(_event uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.events e WHERE e.id = _event AND e.deleted_at > now() - interval '30 days'
                 AND NOT e.deleted_with_series AND NOT e.series_template
                 AND public.can_manage_recycle_scope(auth.uid(), e.branch_id, e.region_id))
  AND NOT EXISTS (SELECT 1 FROM public.event_deletion_jobs WHERE event_id = _event AND operation NOT IN ('restore', 'archive'));
$$;

-- ---------------------------------------------------------------------------------------------------------
-- 3. Guard trigger: series bookkeeping only through the series functions (they set app.series_op = on for
--    their transaction). A content/time/status change to an occurrence made any other way (update_event,
--    cancel_event) marks it as an exception, so later "all events" edits and regeneration leave it alone.
-- ---------------------------------------------------------------------------------------------------------
CREATE FUNCTION public.events_series_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF coalesce(current_setting('app.series_op', true), '') = 'on' THEN RETURN NEW; END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.series_id IS NOT NULL OR NEW.series_template OR NEW.series_exception OR NEW.deleted_with_series OR NEW.recurrence_key IS NOT NULL THEN
      RAISE EXCEPTION 'Not allowed';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.series_template THEN RAISE EXCEPTION 'Not allowed'; END IF;
  IF NEW.series_id IS DISTINCT FROM OLD.series_id OR NEW.recurrence_key IS DISTINCT FROM OLD.recurrence_key
     OR NEW.series_template IS DISTINCT FROM OLD.series_template OR NEW.deleted_with_series IS DISTINCT FROM OLD.deleted_with_series
     OR (OLD.series_exception AND NOT NEW.series_exception) THEN
    RAISE EXCEPTION 'Not allowed';
  END IF;
  IF NEW.series_id IS NOT NULL AND ROW(NEW.title, NEW.description, NEW.location, NEW.location_type, NEW.online_url, NEW.organizer,
       NEW.category, NEW.capacity, NEW.all_day, NEW.start_at, NEW.end_at, NEW.start_date, NEW.end_date, NEW.status)
     IS DISTINCT FROM ROW(OLD.title, OLD.description, OLD.location, OLD.location_type, OLD.online_url, OLD.organizer,
       OLD.category, OLD.capacity, OLD.all_day, OLD.start_at, OLD.end_at, OLD.start_date, OLD.end_date, OLD.status) THEN
    NEW.series_exception := true;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER events_series_guard BEFORE INSERT OR UPDATE ON public.events FOR EACH ROW EXECUTE FUNCTION public.events_series_guard();

-- The guard's bypass flag is scoped to one series function call: each caller restores the previous value on
-- exit, so nested calls (create_series -> series_generate) keep it and nothing after the call inherits it.
CREATE FUNCTION public.series_op_begin() RETURNS text LANGUAGE plpgsql SET search_path = public AS $$
DECLARE _prev text := current_setting('app.series_op', true);
BEGIN
  PERFORM set_config('app.series_op', 'on', true);
  RETURN coalesce(_prev, '');
END $$;
CREATE FUNCTION public.series_op_end(_prev text) RETURNS void LANGUAGE sql SET search_path = public AS $$
  SELECT set_config('app.series_op', coalesce(_prev, ''), true)
$$;

-- ---------------------------------------------------------------------------------------------------------
-- 4. RRULE expansion (pure). Supports FREQ=DAILY|WEEKLY|MONTHLY|YEARLY, INTERVAL, COUNT, UNTIL (date or UTC
--    date-time), BYDAY (weekly: MO..SU list; monthly: one ordinal like 3SA or -1FR), BYMONTHDAY (1..31 or -1).
--    Works on London wall-clock timestamps, so occurrences keep their local time across DST changes.
--    COUNT is counted from dtstart. Returns occurrences in [_from, _to], at most _limit of them.
-- ---------------------------------------------------------------------------------------------------------
CREATE FUNCTION public.series_expand(_rule text, _dtstart timestamp, _from timestamp, _to timestamp, _limit integer)
RETURNS SETOF timestamp LANGUAGE plpgsql IMMUTABLE SET search_path = public AS $$
DECLARE
  _days constant text[] := ARRAY['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];
  _part text; _k text; _v text;
  _freq text; _interval integer := 1; _count integer; _until timestamp; _byday text[]; _bymonthday integer;
  _time interval := _dtstart - date_trunc('day', _dtstart);
  _i integer := 0; _n integer := 0; _emitted integer := 0;
  _cands timestamp[]; _cand timestamp; _first date; _last date; _date date; _d integer; _nth integer; _wd integer;
BEGIN
  IF _rule IS NULL OR _rule !~ '^[A-Z0-9=;,+-]+$' THEN RAISE EXCEPTION 'Invalid recurrence rule'; END IF;
  FOREACH _part IN ARRAY string_to_array(_rule, ';') LOOP
    _k := split_part(_part, '=', 1); _v := split_part(_part, '=', 2);
    IF _v = '' THEN RAISE EXCEPTION 'Invalid recurrence rule'; END IF;
    CASE _k
      WHEN 'FREQ' THEN
        IF _v NOT IN ('DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY') THEN RAISE EXCEPTION 'Invalid recurrence rule'; END IF;
        _freq := _v;
      WHEN 'INTERVAL' THEN
        IF _v !~ '^[1-9][0-9]{0,2}$' THEN RAISE EXCEPTION 'Invalid recurrence rule'; END IF;
        _interval := _v::integer;
      WHEN 'COUNT' THEN
        IF _v !~ '^[1-9][0-9]{0,3}$' THEN RAISE EXCEPTION 'Invalid recurrence rule'; END IF;
        _count := _v::integer;
      WHEN 'UNTIL' THEN
        IF _v ~ '^[0-9]{8}$' THEN
          _until := make_timestamp(substr(_v, 1, 4)::int, substr(_v, 5, 2)::int, substr(_v, 7, 2)::int, 23, 59, 59);
        ELSIF _v ~ '^[0-9]{8}T[0-9]{6}Z$' THEN
          _until := (make_timestamp(substr(_v, 1, 4)::int, substr(_v, 5, 2)::int, substr(_v, 7, 2)::int,
                                    substr(_v, 10, 2)::int, substr(_v, 12, 2)::int, substr(_v, 14, 2)::int)
                     AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/London';
        ELSE RAISE EXCEPTION 'Invalid recurrence rule'; END IF;
      WHEN 'BYDAY' THEN
        _byday := string_to_array(_v, ',');
        IF EXISTS (SELECT 1 FROM unnest(_byday) d WHERE d !~ '^(-1|[1-5])?(MO|TU|WE|TH|FR|SA|SU)$') THEN RAISE EXCEPTION 'Invalid recurrence rule'; END IF;
      WHEN 'BYMONTHDAY' THEN
        IF _v !~ '^(-1|[1-9]|[12][0-9]|3[01])$' THEN RAISE EXCEPTION 'Invalid recurrence rule'; END IF;
        _bymonthday := _v::integer;
      WHEN 'WKST' THEN NULL;
      ELSE RAISE EXCEPTION 'Invalid recurrence rule';
    END CASE;
  END LOOP;
  IF _freq IS NULL OR (_count IS NOT NULL AND _until IS NOT NULL) THEN RAISE EXCEPTION 'Invalid recurrence rule'; END IF;
  IF _byday IS NOT NULL AND (
       (_freq = 'WEEKLY' AND EXISTS (SELECT 1 FROM unnest(_byday) d WHERE d ~ '^-?[0-9]'))
    OR (_freq = 'MONTHLY' AND (cardinality(_byday) <> 1 OR _byday[1] !~ '^(-1|[1-5])' OR _bymonthday IS NOT NULL))
    OR _freq IN ('DAILY', 'YEARLY')) THEN
    RAISE EXCEPTION 'Invalid recurrence rule';
  END IF;
  IF _bymonthday IS NOT NULL AND _freq <> 'MONTHLY' THEN RAISE EXCEPTION 'Invalid recurrence rule'; END IF;
  IF _limit IS NULL OR _limit < 1 THEN RETURN; END IF;

  LOOP
    EXIT WHEN _i > 5000;  -- hard bound on periods
    IF _freq = 'DAILY' THEN
      _cands := ARRAY[_dtstart + (_i * _interval) * interval '1 day'];
    ELSIF _freq = 'WEEKLY' THEN
      _cands := ARRAY(
        SELECT date_trunc('week', _dtstart) + (_i * _interval) * interval '1 week'
               + (array_position(_days, d) - 1) * interval '1 day' + _time
        FROM unnest(coalesce(_byday, ARRAY[_days[extract(isodow FROM _dtstart)::int]])) d ORDER BY 1);
    ELSIF _freq = 'MONTHLY' THEN
      _first := (date_trunc('month', _dtstart) + (_i * _interval) * interval '1 month')::date;
      _last := (_first + interval '1 month' - interval '1 day')::date;
      _date := NULL;
      IF _byday IS NOT NULL THEN
        _nth := substring(_byday[1] FROM '^(-?[0-9])')::int;
        _wd := array_position(_days, right(_byday[1], 2));
        IF _nth > 0 THEN
          _date := _first + ((_wd - extract(isodow FROM _first)::int + 7) % 7) + (_nth - 1) * 7;
        ELSE
          _date := _last - ((extract(isodow FROM _last)::int - _wd + 7) % 7);
        END IF;
        IF _date > _last THEN _date := NULL; END IF;
      ELSE
        _d := coalesce(_bymonthday, extract(day FROM _dtstart)::int);
        IF _d = -1 THEN _date := _last;
        ELSIF _d <= extract(day FROM _last)::int THEN _date := _first + (_d - 1);
        END IF;
      END IF;
      _cands := CASE WHEN _date IS NULL THEN ARRAY[]::timestamp[] ELSE ARRAY[_date + _time] END;
    ELSE -- YEARLY: same month and day; 29 February only in leap years
      _cand := _dtstart + (_i * _interval) * interval '1 year';
      _cands := CASE WHEN extract(day FROM _cand) = extract(day FROM _dtstart) THEN ARRAY[_cand] ELSE ARRAY[]::timestamp[] END;
    END IF;

    FOREACH _cand IN ARRAY _cands LOOP
      CONTINUE WHEN _cand < _dtstart;
      IF _until IS NOT NULL AND _cand > _until THEN RETURN; END IF;
      IF _count IS NOT NULL AND _n >= _count THEN RETURN; END IF;
      _n := _n + 1;
      IF _cand > _to THEN RETURN; END IF;
      IF _cand >= _from THEN
        RETURN NEXT _cand;
        _emitted := _emitted + 1;
        IF _emitted >= _limit THEN RETURN; END IF;
      END IF;
    END LOOP;
    _i := _i + 1;
  END LOOP;
END $$;

-- Replaces COUNT/UNTIL with UNTIL just before _before (London wall clock). Used when a series is split.
CREATE FUNCTION public.series_rule_until(_rule text, _before timestamp, _all_day boolean) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT array_to_string(array_append(
    ARRAY(SELECT p FROM unnest(string_to_array(_rule, ';')) p WHERE p !~ '^(COUNT|UNTIL)='),
    'UNTIL=' || CASE WHEN _all_day THEN to_char((_before - interval '1 day')::date, 'YYYYMMDD')
                     ELSE to_char(((_before - interval '1 second') AT TIME ZONE 'Europe/London') AT TIME ZONE 'UTC', 'YYYYMMDD"T"HH24MISS"Z"') END), ';')
$$;

-- Replaces COUNT with a new value (the occurrences left after a split).
CREATE FUNCTION public.series_rule_count(_rule text, _count integer) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT array_to_string(array_append(
    ARRAY(SELECT p FROM unnest(string_to_array(_rule, ';')) p WHERE p !~ '^COUNT='), 'COUNT=' || greatest(_count, 1)), ';')
$$;

-- ---------------------------------------------------------------------------------------------------------
-- 5. Generation: at most _limit new occurrences per call, never more than 12 months ahead, never an occurrence
--    that has already ended. Existing keys (including deleted occurrences and exceptions) are skipped.
-- ---------------------------------------------------------------------------------------------------------
CREATE FUNCTION public.series_generate(_series uuid, _limit integer DEFAULT 100) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _s public.event_series; _now_local timestamp := now() AT TIME ZONE 'Europe/London';
  _to timestamp; _from timestamp; _cand timestamp; _last timestamp; _inserted integer := 0; _id uuid;
  _start timestamptz; _end timestamptz; _prev text;
BEGIN
  SELECT * INTO _s FROM public.event_series WHERE id = _series FOR UPDATE;
  IF NOT FOUND OR _s.deleted_at IS NOT NULL THEN RETURN 0; END IF;
  _prev := public.series_op_begin();
  _to := date_trunc('day', _now_local) + interval '12 months' + interval '1 day' - interval '1 second';
  _from := coalesce(_s.generated_until + interval '1 second', _s.dtstart_local);
  IF _from > _to THEN PERFORM public.series_op_end(_prev); RETURN 0; END IF;
  FOR _cand IN SELECT * FROM public.series_expand(_s.rule, _s.dtstart_local, _from, _to, 100000) LOOP
    _last := _cand;
    _id := NULL;
    IF _s.all_day THEN
      CONTINUE WHEN (_cand::date + _s.span_days) < _now_local::date;
      INSERT INTO public.events (title, description, location, location_type, online_url, organizer, category, capacity,
        scope, branch_id, region_id, status, created_by, all_day, start_date, end_date, start_at, end_at, series_id, recurrence_key)
      VALUES (_s.title, _s.description, _s.location, _s.location_type, _s.online_url, _s.organizer, _s.category, _s.capacity,
        _s.scope, _s.branch_id, _s.region_id, _s.status, _s.created_by, true, _cand::date, _cand::date + _s.span_days, NULL, NULL, _s.id, _cand)
      ON CONFLICT (series_id, recurrence_key) DO NOTHING RETURNING id INTO _id;
    ELSE
      _start := _cand AT TIME ZONE 'Europe/London';
      _end := (_cand + make_interval(mins => _s.duration_minutes)) AT TIME ZONE 'Europe/London';
      CONTINUE WHEN _end < now();
      INSERT INTO public.events (title, description, location, location_type, online_url, organizer, category, capacity,
        scope, branch_id, region_id, status, created_by, all_day, start_date, end_date, start_at, end_at, series_id, recurrence_key)
      VALUES (_s.title, _s.description, _s.location, _s.location_type, _s.online_url, _s.organizer, _s.category, _s.capacity,
        _s.scope, _s.branch_id, _s.region_id, _s.status, _s.created_by, false, NULL, NULL, _start, _end, _s.id, _cand)
      ON CONFLICT (series_id, recurrence_key) DO NOTHING RETURNING id INTO _id;
    END IF;
    IF _id IS NOT NULL THEN _inserted := _inserted + 1; END IF;
    EXIT WHEN _inserted >= _limit;
  END LOOP;
  UPDATE public.event_series SET generated_until = CASE WHEN _inserted >= _limit THEN _last ELSE _to END WHERE id = _series;
  PERFORM public.series_op_end(_prev);
  RETURN _inserted;
END $$;

-- Daily horizon extension for open-ended series (pg_cron below, when available).
CREATE FUNCTION public.extend_all_series() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _id uuid; _total integer := 0;
BEGIN
  FOR _id IN SELECT id FROM public.event_series
             WHERE deleted_at IS NULL AND (generated_until IS NULL OR generated_until < (now() AT TIME ZONE 'Europe/London') + interval '12 months')
             ORDER BY generated_until NULLS FIRST LIMIT 500 LOOP
    _total := _total + public.series_generate(_id, 100);
  END LOOP;
  RETURN _total;
END $$;

-- Removes series rows whose 30-day Recycle Bin period is over and whose events are all purged.
CREATE FUNCTION public.purge_expired_series() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _n integer;
BEGIN
  DELETE FROM public.event_series s
  WHERE s.deleted_at < now() - interval '30 days'
    AND NOT EXISTS (SELECT 1 FROM public.events e WHERE e.series_id = s.id)
    AND (s.media_event_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.events h WHERE h.id = s.media_event_id));
  GET DIAGNOSTICS _n = ROW_COUNT;
  RETURN _n;
END $$;

-- ---------------------------------------------------------------------------------------------------------
-- 6. Client-facing series functions
-- ---------------------------------------------------------------------------------------------------------
-- Normalises the timing in _data (London wall clock) for a new or edited series.
CREATE FUNCTION public.series_timing(_data jsonb, OUT all_day boolean, OUT dtstart_local timestamp, OUT duration_minutes integer, OUT span_days integer)
LANGUAGE plpgsql STABLE SET search_path = public AS $$
BEGIN
  all_day := coalesce((_data->>'all_day')::boolean, false);
  IF all_day THEN
    IF nullif(_data->>'start_date', '') IS NULL THEN RAISE EXCEPTION 'Required publish fields missing'; END IF;
    dtstart_local := (_data->>'start_date')::date::timestamp;
    span_days := coalesce(nullif(_data->>'end_date', '')::date, (_data->>'start_date')::date) - (_data->>'start_date')::date;
    IF span_days < 0 THEN RAISE EXCEPTION 'Event end must be after start'; END IF;
    duration_minutes := NULL;
  ELSE
    IF nullif(_data->>'start_at', '') IS NULL OR nullif(_data->>'end_at', '') IS NULL THEN RAISE EXCEPTION 'Required publish fields missing'; END IF;
    dtstart_local := (_data->>'start_at')::timestamptz AT TIME ZONE 'Europe/London';
    duration_minutes := ceil(extract(epoch FROM (_data->>'end_at')::timestamptz - (_data->>'start_at')::timestamptz) / 60)::integer;
    IF duration_minutes <= 0 THEN RAISE EXCEPTION 'Event end must be after start'; END IF;
    span_days := 0;
  END IF;
END $$;

CREATE FUNCTION public.create_series(_data jsonb, _rule text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _branch uuid := nullif(_data->>'branch_id', '')::uuid; _scope text := _data->>'scope'; _region uuid;
  _status text := coalesce(nullif(_data->>'status', ''), 'published'); _t record; _sid uuid; _mid uuid; _first uuid; _n integer; _prev text;
BEGIN
  PERFORM id FROM public.profiles WHERE id = auth.uid() FOR UPDATE;
  IF _status NOT IN ('draft', 'published') THEN RAISE EXCEPTION 'Invalid event values'; END IF;
  IF _status = 'draft' AND _branch IS NULL AND _scope IS DISTINCT FROM 'region' THEN
    IF public.has_role(auth.uid(), 'regional_director') THEN _scope := 'region'; ELSE _branch := public.get_user_branch(auth.uid()); _scope := 'branch'; END IF;
  END IF;
  IF _scope = 'branch' THEN SELECT region_id INTO _region FROM public.branches WHERE id = _branch;
  ELSE SELECT region_id INTO _region FROM public.user_roles WHERE user_id = auth.uid() AND role = 'regional_director' LIMIT 1; END IF;
  IF NOT public.can_manage_event_scope(_scope, _branch, _region) THEN RAISE EXCEPTION 'Not allowed'; END IF;
  SELECT * INTO _t FROM public.series_timing(_data);
  PERFORM 1 FROM public.series_expand(upper(_rule), _t.dtstart_local, _t.dtstart_local, _t.dtstart_local, 1);  -- validates the rule
  _prev := public.series_op_begin();
  INSERT INTO public.events (title, description, location, location_type, online_url, organizer, category, capacity,
    scope, branch_id, region_id, status, created_by, all_day, series_template)
  VALUES (_data->>'title', coalesce(_data->>'description', ''), coalesce(_data->>'location', ''), coalesce(nullif(_data->>'location_type', ''), 'in_person'),
    nullif(_data->>'online_url', ''), coalesce(nullif(trim(_data->>'organizer'), ''), 'Dialogue Society'), coalesce(_data->>'category', 'dialogue'),
    nullif(_data->>'capacity', '')::integer, _scope, _branch, _region, 'draft', auth.uid(), _t.all_day, true)
  RETURNING id INTO _mid;
  INSERT INTO public.event_series (rule, all_day, dtstart_local, duration_minutes, span_days, status, title, description, location,
    location_type, online_url, organizer, category, capacity, scope, branch_id, region_id, media_event_id, created_by)
  SELECT upper(_rule), _t.all_day, _t.dtstart_local, _t.duration_minutes, _t.span_days, _status, e.title, e.description, e.location,
    e.location_type, e.online_url, e.organizer, e.category, e.capacity, e.scope, e.branch_id, e.region_id, e.id, auth.uid()
  FROM public.events e WHERE e.id = _mid
  RETURNING id INTO _sid;
  _n := public.series_generate(_sid, 100);
  SELECT id INTO _first FROM public.events WHERE series_id = _sid ORDER BY recurrence_key LIMIT 1;
  IF _first IS NULL THEN RAISE EXCEPTION 'Recurrence has no upcoming events'; END IF;
  INSERT INTO public.event_audit_log (actor_id, event_id, action, scope, branch_id, region_id) VALUES (auth.uid(), _sid, 'series_created', _scope, _branch, _region);
  PERFORM public.series_op_end(_prev);
  RETURN jsonb_build_object('series_id', _sid, 'event_id', _first, 'media_event_id', _mid, 'count', _n);
END $$;

-- Series details for the event page and "Add to calendar"; also extends the 12-month horizon (bounded).
CREATE FUNCTION public.open_series(_series uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _s public.event_series;
BEGIN
  IF NOT public.can_view_series(_series) THEN RAISE EXCEPTION 'Not allowed'; END IF;
  SELECT * INTO _s FROM public.event_series WHERE id = _series;
  IF _s.generated_until IS NULL OR _s.generated_until < (now() AT TIME ZONE 'Europe/London') + interval '11 months' THEN
    PERFORM public.series_generate(_series, 100);
  END IF;
  RETURN jsonb_build_object(
    'id', _s.id, 'rule', _s.rule, 'timezone', _s.timezone, 'all_day', _s.all_day,
    'dtstart_local', to_char(_s.dtstart_local, 'YYYY-MM-DD"T"HH24:MI:SS'), 'duration_minutes', _s.duration_minutes, 'span_days', _s.span_days,
    'status', _s.status, 'media_event_id', _s.media_event_id,
    'exdates', coalesce((SELECT jsonb_agg(to_char(e.recurrence_key, 'YYYY-MM-DD"T"HH24:MI:SS') ORDER BY e.recurrence_key)
                         FROM public.events e WHERE e.series_id = _s.id AND e.deleted_at IS NOT NULL AND NOT e.deleted_with_series), '[]'::jsonb));
END $$;

-- Edit an occurrence: 'this' (exception), 'following' (split the series here) or 'all'.
-- Time-of-day/duration/rule changes regenerate future, non-exception occurrences; past ones keep their times.
CREATE FUNCTION public.update_series_event(_event uuid, _mode text, _data jsonb, _rule text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _e public.events; _s public.event_series; _old uuid; _t record; _new_rule text; _dt timestamp; _timing boolean; _rule_changed boolean;
  _status text := coalesce(nullif(_data->>'status', ''), 'published'); _target uuid; _remaining integer; _done integer; _first uuid; _prev text;
BEGIN
  PERFORM id FROM public.profiles WHERE id = auth.uid() FOR UPDATE;
  SELECT * INTO _e FROM public.events WHERE id = _event FOR UPDATE;
  IF NOT FOUND OR _e.series_id IS NULL OR _e.series_template OR _e.deleted_at IS NOT NULL OR NOT public.can_manage_event(_event) THEN RAISE EXCEPTION 'Not allowed'; END IF;
  SELECT * INTO _s FROM public.event_series WHERE id = _e.series_id FOR UPDATE;
  IF _s.deleted_at IS NOT NULL OR NOT public.can_manage_event_scope(_s.scope, _s.branch_id, _s.region_id) THEN RAISE EXCEPTION 'Not allowed'; END IF;
  IF _mode NOT IN ('this', 'following', 'all') THEN RAISE EXCEPTION 'Invalid event values'; END IF;

  IF _mode = 'this' THEN
    -- update_event re-checks permissions; the guard trigger marks the occurrence as an exception.
    PERFORM public.update_event(_event, _data || jsonb_build_object('scope', _s.scope, 'branch_id', _s.branch_id));
    RETURN jsonb_build_object('series_id', _s.id, 'event_id', _event);
  END IF;

  IF _status NOT IN ('draft', 'published') THEN RAISE EXCEPTION 'Invalid event values'; END IF;
  IF length(trim(coalesce(_data->>'title', ''))) = 0 THEN RAISE EXCEPTION 'Event title and organizer are required'; END IF;
  SELECT * INTO _t FROM public.series_timing(_data);
  _old := _s.id;
  -- The client sends _rule only when the user changed the recurrence; otherwise the series rule is kept.
  _new_rule := upper(coalesce(nullif(_rule, ''), _s.rule));
  _rule_changed := nullif(_rule, '') IS NOT NULL AND upper(_rule) <> _s.rule;
  PERFORM 1 FROM public.series_expand(_new_rule, _t.dtstart_local, _t.dtstart_local, _t.dtstart_local, 1);
  _prev := public.series_op_begin();

  IF _mode = 'all' THEN
    -- Keep the series' first date; take the new time of day (or the new all-day span).
    _dt := CASE WHEN _t.all_day THEN _s.dtstart_local::date::timestamp ELSE _s.dtstart_local::date + (_t.dtstart_local - date_trunc('day', _t.dtstart_local)) END;
    _timing := _rule_changed OR _dt <> _s.dtstart_local OR _t.all_day <> _s.all_day
               OR _t.duration_minutes IS DISTINCT FROM _s.duration_minutes OR _t.span_days <> _s.span_days;
    _target := _s.id;
  ELSE -- following: a new series from this occurrence on; the old one ends just before it
    _dt := _t.dtstart_local;
    _timing := _rule_changed OR _dt <> _e.recurrence_key OR _t.all_day <> _s.all_day
               OR _t.duration_minutes IS DISTINCT FROM _s.duration_minutes OR _t.span_days <> _s.span_days;
    IF nullif(_rule, '') IS NULL AND _s.rule ~ '(^|;)COUNT=' THEN
      SELECT count(*) INTO _done FROM public.series_expand(_s.rule, _s.dtstart_local, _s.dtstart_local, _e.recurrence_key - interval '1 second', 100000);
      _remaining := substring(_s.rule FROM 'COUNT=([0-9]+)')::int - _done;
      _new_rule := public.series_rule_count(_new_rule, _remaining);
    END IF;
    INSERT INTO public.event_series (rule, all_day, dtstart_local, duration_minutes, span_days, status, title, description, location,
      location_type, online_url, organizer, category, capacity, scope, branch_id, region_id, media_event_id, created_by)
    VALUES (_new_rule, _t.all_day, _dt, _t.duration_minutes, _t.span_days, _status, trim(_data->>'title'), coalesce(_data->>'description', ''),
      coalesce(_data->>'location', ''), coalesce(nullif(_data->>'location_type', ''), 'in_person'), nullif(_data->>'online_url', ''),
      coalesce(nullif(trim(_data->>'organizer'), ''), 'Dialogue Society'), coalesce(_data->>'category', _s.category), nullif(_data->>'capacity', '')::integer,
      _s.scope, _s.branch_id, _s.region_id, _s.media_event_id, _s.created_by)
    RETURNING id INTO _target;
    UPDATE public.event_series SET rule = public.series_rule_until(rule, _e.recurrence_key, all_day), updated_at = now() WHERE id = _s.id;
    -- Exceptions and deleted occurrences from here on move to the new series unchanged.
    UPDATE public.events SET series_id = _target WHERE series_id = _s.id AND recurrence_key >= _e.recurrence_key AND (series_exception OR deleted_at IS NOT NULL);
    IF NOT _timing THEN
      UPDATE public.events SET series_id = _target WHERE series_id = _s.id AND recurrence_key >= _e.recurrence_key;
      UPDATE public.event_series SET generated_until = _s.generated_until WHERE id = _target;
    END IF;
  END IF;

  UPDATE public.event_series SET rule = CASE WHEN _mode = 'all' THEN _new_rule ELSE rule END,
    all_day = _t.all_day, dtstart_local = _dt, duration_minutes = _t.duration_minutes, span_days = _t.span_days, status = _status,
    title = trim(_data->>'title'), description = coalesce(_data->>'description', ''), location = coalesce(_data->>'location', ''),
    location_type = coalesce(nullif(_data->>'location_type', ''), 'in_person'), online_url = nullif(_data->>'online_url', ''),
    organizer = coalesce(nullif(trim(_data->>'organizer'), ''), 'Dialogue Society'), category = coalesce(_data->>'category', category),
    capacity = nullif(_data->>'capacity', '')::integer, updated_at = now()
  WHERE id = _target;
  SELECT * INTO _s FROM public.event_series WHERE id = _target;

  -- Content of every live, non-exception occurrence.
  UPDATE public.events SET title = _s.title, description = _s.description, location = _s.location, location_type = _s.location_type,
    online_url = _s.online_url, organizer = _s.organizer, category = _s.category, capacity = _s.capacity
  WHERE series_id = _target AND NOT series_exception AND deleted_at IS NULL;
  -- Status only for occurrences that have not ended (a published occurrence may not end in the past).
  UPDATE public.events SET status = _s.status
  WHERE series_id = _target AND NOT series_exception AND deleted_at IS NULL AND status <> _s.status AND status <> 'cancelled'
    AND coalesce(end_at, (coalesce(end_date, start_date) + 1)::timestamp AT TIME ZONE 'Europe/London') > now();

  IF _timing THEN
    -- 'all': future occurrences of the series; 'following': the old series' occurrences from here on.
    DELETE FROM public.events WHERE series_id = CASE WHEN _mode = 'all' THEN _target ELSE _old END
      AND NOT series_exception AND deleted_at IS NULL AND recurrence_key >= CASE WHEN _mode = 'all' THEN (now() AT TIME ZONE 'Europe/London') ELSE _e.recurrence_key END;
    UPDATE public.event_series SET generated_until = NULL WHERE id = _target;
    PERFORM public.series_generate(_target, 100);
  END IF;
  INSERT INTO public.event_audit_log (actor_id, event_id, action, scope, branch_id, region_id) VALUES (auth.uid(), _target, 'series_updated', _s.scope, _s.branch_id, _s.region_id);
  SELECT id INTO _first FROM public.events WHERE series_id = _target AND deleted_at IS NULL AND recurrence_key >= coalesce(_e.recurrence_key, '-infinity') ORDER BY recurrence_key LIMIT 1;
  PERFORM public.series_op_end(_prev);
  RETURN jsonb_build_object('series_id', _target, 'event_id', coalesce(_first, _event));
END $$;

-- Soft-deletes a series ('all') or this-and-following ('following', split first) into the Recycle Bin as one item.
-- Returns the media holder's file paths when the holder goes too, for the server to archive; then call
-- finish_series_deletion. ('this' uses delete_event.)
CREATE FUNCTION public.delete_series(_event uuid, _mode text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _e public.events; _s public.event_series; _target uuid; _paths jsonb := '[]'::jsonb; _n integer; _remaining integer; _done integer; _rule text; _prev text;
BEGIN
  PERFORM id FROM public.profiles WHERE id = auth.uid() FOR UPDATE;
  SELECT * INTO _e FROM public.events WHERE id = _event FOR UPDATE;
  IF NOT FOUND OR _e.series_id IS NULL OR _e.series_template OR _e.deleted_at IS NOT NULL OR NOT public.can_manage_event(_event) THEN RAISE EXCEPTION 'Not allowed'; END IF;
  SELECT * INTO _s FROM public.event_series WHERE id = _e.series_id FOR UPDATE;
  IF _s.deleted_at IS NOT NULL OR NOT public.can_manage_event_scope(_s.scope, _s.branch_id, _s.region_id) THEN RAISE EXCEPTION 'Not allowed'; END IF;
  IF _mode NOT IN ('following', 'all') THEN RAISE EXCEPTION 'Invalid event values'; END IF;
  _prev := public.series_op_begin();
  _target := _s.id;
  IF _mode = 'following' AND EXISTS (SELECT 1 FROM public.events WHERE series_id = _s.id AND deleted_at IS NULL AND NOT series_template AND recurrence_key < _e.recurrence_key) THEN
    _rule := _s.rule;
    IF _rule ~ '(^|;)COUNT=' THEN
      SELECT count(*) INTO _done FROM public.series_expand(_s.rule, _s.dtstart_local, _s.dtstart_local, _e.recurrence_key - interval '1 second', 100000);
      _remaining := substring(_rule FROM 'COUNT=([0-9]+)')::int - _done;
      _rule := public.series_rule_count(_rule, _remaining);
    END IF;
    INSERT INTO public.event_series (rule, all_day, dtstart_local, duration_minutes, span_days, status, title, description, location,
      location_type, online_url, organizer, category, capacity, scope, branch_id, region_id, media_event_id, generated_until, created_by)
    VALUES (_rule, _s.all_day, _e.recurrence_key, _s.duration_minutes, _s.span_days, _s.status, _s.title, _s.description, _s.location,
      _s.location_type, _s.online_url, _s.organizer, _s.category, _s.capacity, _s.scope, _s.branch_id, _s.region_id, _s.media_event_id, _s.generated_until, _s.created_by)
    RETURNING id INTO _target;
    UPDATE public.event_series SET rule = public.series_rule_until(rule, _e.recurrence_key, all_day), updated_at = now() WHERE id = _s.id;
    UPDATE public.events SET series_id = _target WHERE series_id = _s.id AND recurrence_key >= _e.recurrence_key;
  END IF;

  UPDATE public.events SET deleted_at = now(), deleted_by = auth.uid(), deleted_with_series = true
  WHERE series_id = _target AND deleted_at IS NULL AND NOT series_template;
  GET DIAGNOSTICS _n = ROW_COUNT;
  UPDATE public.event_series SET deleted_at = now(), deleted_by = auth.uid(), updated_at = now() WHERE id = _target;
  -- The media holder goes only when no live series still uses it.
  IF _s.media_event_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.event_series o WHERE o.media_event_id = _s.media_event_id AND o.deleted_at IS NULL)
     AND EXISTS (SELECT 1 FROM public.events h WHERE h.id = _s.media_event_id AND h.deleted_at IS NULL) THEN
    UPDATE public.events SET deleted_at = now(), deleted_by = auth.uid(), deleted_with_series = true WHERE id = _s.media_event_id;
    INSERT INTO public.event_deletion_jobs (event_id, requested_by, operation) VALUES (_s.media_event_id, auth.uid(), 'archive') ON CONFLICT (event_id) DO NOTHING;
    SELECT coalesce(jsonb_agg(path ORDER BY path), '[]'::jsonb) INTO _paths FROM (
      SELECT storage_path AS path FROM public.event_media WHERE event_id = _s.media_event_id
      UNION SELECT name FROM storage.objects WHERE bucket_id = 'event-media' AND name LIKE _s.media_event_id::text || '/%') files;
  END IF;
  INSERT INTO public.event_audit_log (actor_id, event_id, action, scope, branch_id, region_id) VALUES (auth.uid(), _target, 'series_deleted', _s.scope, _s.branch_id, _s.region_id);
  INSERT INTO public.recycle_bin_audit_log (actor_id, item_type, item_id, action, branch_id, region_id) VALUES (auth.uid(), 'series', _target, 'delete', _s.branch_id, _s.region_id);
  PERFORM public.series_op_end(_prev);
  RETURN jsonb_build_object('series_id', _target, 'paths', _paths, 'count', _n, 'deleted', false);
END $$;

CREATE FUNCTION public.finish_series_deletion(_series uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _s public.event_series;
BEGIN
  SELECT * INTO _s FROM public.event_series WHERE id = _series FOR UPDATE;
  IF NOT FOUND OR _s.deleted_at IS NULL OR NOT public.can_manage_recycle_scope(auth.uid(), _s.branch_id, _s.region_id) THEN RAISE EXCEPTION 'Not allowed'; END IF;
  IF _s.media_event_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.event_deletion_jobs WHERE event_id = _s.media_event_id AND operation = 'archive') THEN
    IF EXISTS (SELECT 1 FROM storage.objects WHERE bucket_id = 'event-media' AND name LIKE _s.media_event_id::text || '/%') THEN RAISE EXCEPTION 'Event files still exist'; END IF;
    DELETE FROM public.event_deletion_jobs WHERE event_id = _s.media_event_id AND operation = 'archive';
  END IF;
  RETURN jsonb_build_object('paths', '[]'::jsonb, 'deleted', true);
END $$;

-- Restores a deleted series and the occurrences deleted with it (and its media holder) in one step.
-- First call returns the holder's archived paths for the server to move back; then call with _finalize.
CREATE FUNCTION public.restore_series(_series uuid, _finalize boolean DEFAULT false) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _s public.event_series; _holder_deleted boolean := false; _paths jsonb := '[]'::jsonb; _prev text;
BEGIN
  PERFORM id FROM public.profiles WHERE id = auth.uid() FOR UPDATE;
  SELECT * INTO _s FROM public.event_series WHERE id = _series FOR UPDATE;
  IF NOT FOUND OR _s.deleted_at IS NULL OR _s.deleted_at <= now() - interval '30 days'
     OR NOT public.can_manage_recycle_scope(auth.uid(), _s.branch_id, _s.region_id)
     OR EXISTS (SELECT 1 FROM public.event_deletion_jobs j JOIN public.events e ON e.id = j.event_id
                WHERE (e.series_id = _series OR e.id = _s.media_event_id) AND j.operation NOT IN ('archive', 'restore')) THEN
    RAISE EXCEPTION 'Item cannot be restored';
  END IF;
  SELECT EXISTS (SELECT 1 FROM public.events WHERE id = _s.media_event_id AND deleted_at IS NOT NULL) INTO _holder_deleted;
  IF _holder_deleted THEN
    INSERT INTO public.event_deletion_jobs (event_id, requested_by, operation) VALUES (_s.media_event_id, auth.uid(), 'restore')
    ON CONFLICT (event_id) DO UPDATE SET operation = 'restore', requested_by = auth.uid() WHERE event_deletion_jobs.operation IN ('archive', 'restore');
    SELECT coalesce(jsonb_agg(storage_path ORDER BY storage_path), '[]'::jsonb) INTO _paths FROM public.event_media WHERE event_id = _s.media_event_id;
  END IF;
  IF NOT _finalize THEN RETURN jsonb_build_object('paths', _paths, 'deleted', false); END IF;

  _prev := public.series_op_begin();
  IF _holder_deleted THEN
    DELETE FROM public.event_media m WHERE event_id = _s.media_event_id AND NOT EXISTS (
      SELECT 1 FROM storage.objects o WHERE o.bucket_id = 'event-media' AND (o.name = m.storage_path OR o.name = 'deleted/' || m.storage_path));
    IF EXISTS (SELECT 1 FROM public.event_media m WHERE m.event_id = _s.media_event_id AND NOT EXISTS (
      SELECT 1 FROM storage.objects o WHERE o.bucket_id = 'event-media' AND o.name = m.storage_path)) THEN RAISE EXCEPTION 'Event restoration files missing'; END IF;
    UPDATE public.events SET deleted_at = NULL, deleted_by = NULL, deleted_with_series = false WHERE id = _s.media_event_id;
    DELETE FROM public.event_deletion_jobs WHERE event_id = _s.media_event_id;
  END IF;
  UPDATE public.events SET deleted_at = NULL, deleted_by = NULL, deleted_with_series = false WHERE series_id = _series AND deleted_with_series;
  UPDATE public.event_series SET deleted_at = NULL, deleted_by = NULL, updated_at = now() WHERE id = _series;
  INSERT INTO public.event_audit_log (actor_id, event_id, action, scope, branch_id, region_id) VALUES (auth.uid(), _series, 'series_restored', _s.scope, _s.branch_id, _s.region_id);
  INSERT INTO public.recycle_bin_audit_log (actor_id, item_type, item_id, action, branch_id, region_id) VALUES (auth.uid(), 'series', _series, 'restore', _s.branch_id, _s.region_id);
  PERFORM public.series_op_end(_prev);
  RETURN jsonb_build_object('paths', '[]'::jsonb, 'deleted', false);
END $$;

-- ---------------------------------------------------------------------------------------------------------
-- 7. Recycle Bin: a deleted series is one item ("Series: <title>, N events")
-- ---------------------------------------------------------------------------------------------------------
DROP FUNCTION public.list_recycle_bin(text, text, integer);
CREATE FUNCTION public.list_recycle_bin(_type text DEFAULT 'all', _search text DEFAULT '', _offset integer DEFAULT 0)
RETURNS TABLE(id uuid, type text, title text, role text, branch text, region text, deleted_by_name text, deleted_at timestamptz,
              days_left integer, can_restore boolean, self_requested boolean, event_count integer, total_count bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles p JOIN user_roles r ON r.user_id = p.id WHERE p.id = auth.uid() AND p.status = 'active' AND p.deleted_at IS NULL AND r.role IN ('branch_manager', 'regional_director')) THEN RAISE EXCEPTION 'Not allowed'; END IF;
  IF _type NOT IN ('all', 'event', 'user', 'series') THEN RAISE EXCEPTION 'Not allowed'; END IF;
  RETURN QUERY WITH items AS (
    SELECT e.id, 'event'::text AS type, e.title, NULL::text AS role, b.name AS branch, r.name AS region, p.full_name AS deleted_by_name, e.deleted_at,
      greatest(0, ceil(extract(epoch FROM (e.deleted_at + interval '30 days' - now())) / 86400))::integer AS days_left,
      public.can_restore_event(e.id) AS can_restore, false AS self_requested, NULL::integer AS event_count
    FROM events e JOIN regions r ON r.id = e.region_id LEFT JOIN branches b ON b.id = e.branch_id LEFT JOIN profiles p ON p.id = e.deleted_by
    WHERE e.deleted_at IS NOT NULL AND NOT e.series_template AND NOT e.deleted_with_series AND public.can_manage_recycle_scope(auth.uid(), e.branch_id, e.region_id)
    UNION ALL
    SELECT s.id, 'series', s.title, NULL, b.name, r.name, p.full_name, s.deleted_at,
      greatest(0, ceil(extract(epoch FROM (s.deleted_at + interval '30 days' - now())) / 86400))::integer,
      s.deleted_at > now() - interval '30 days' AND NOT EXISTS (SELECT 1 FROM event_deletion_jobs j JOIN events x ON x.id = j.event_id
        WHERE (x.series_id = s.id OR x.id = s.media_event_id) AND j.operation NOT IN ('archive', 'restore')),
      false, (SELECT count(*) FROM events x WHERE x.series_id = s.id AND x.deleted_with_series)::integer
    FROM event_series s JOIN regions r ON r.id = s.region_id LEFT JOIN branches b ON b.id = s.branch_id LEFT JOIN profiles p ON p.id = s.deleted_by
    WHERE s.deleted_at IS NOT NULL AND public.can_manage_recycle_scope(auth.uid(), s.branch_id, s.region_id)
    UNION ALL
    SELECT u.id, 'user', u.full_name, (SELECT ur.role::text FROM user_roles ur WHERE ur.user_id = u.id ORDER BY CASE ur.role WHEN 'branch_manager' THEN 0 ELSE 1 END LIMIT 1), b.name, r.name, p.full_name, u.deleted_at,
      greatest(0, ceil(extract(epoch FROM (u.deleted_at + interval '30 days' - now())) / 86400))::integer,
      NOT st.self_requested AND st.operation IN ('deleted', 'restore') AND u.deleted_at > now() - interval '30 days', st.self_requested, NULL::integer
    FROM profiles u JOIN user_deletion_state st ON st.target_id = u.id JOIN branches b ON b.id = u.branch_id JOIN regions r ON r.id = b.region_id LEFT JOIN profiles p ON p.id = u.deleted_by
    WHERE u.deleted_at IS NOT NULL AND public.can_manage_deleted_user(auth.uid(), u.id)
  ) SELECT i.id, i.type, i.title, i.role, i.branch, i.region, i.deleted_by_name, i.deleted_at, i.days_left, i.can_restore, i.self_requested, i.event_count, count(*) OVER ()
    FROM items i
    WHERE (_type = 'all' OR i.type = _type OR (_type = 'event' AND i.type = 'series'))
      AND (coalesce(_search, '') = '' OR position(lower(left(_search, 200)) IN lower(i.title)) > 0)
    ORDER BY i.deleted_at DESC, i.id LIMIT 50 OFFSET greatest(0, least(_offset, 1000000));
END $$;

CREATE OR REPLACE FUNCTION public.restore_item(_type text, _id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _p public.profiles; _s public.user_deletion_state;
BEGIN
  IF _type = 'event' THEN RETURN public.restore_event(_id, false); END IF;
  IF _type = 'series' THEN RETURN public.restore_series(_id, false); END IF;
  IF _type <> 'user' THEN RAISE EXCEPTION 'Not allowed'; END IF;
  PERFORM id FROM profiles WHERE id = auth.uid() FOR UPDATE;
  SELECT * INTO _p FROM profiles WHERE id = _id FOR UPDATE;
  SELECT * INTO _s FROM user_deletion_state WHERE target_id = _id FOR UPDATE;
  IF NOT FOUND OR NOT public.can_manage_deleted_user(auth.uid(), _id) OR _s.self_requested OR _p.deleted_at <= now() - interval '30 days' OR _s.operation NOT IN ('deleted', 'restore') THEN RAISE EXCEPTION 'Item cannot be restored'; END IF;
  UPDATE user_deletion_state SET operation = 'restore', operation_actor = auth.uid(), updated_at = now() WHERE target_id = _id;
  RETURN jsonb_build_object('paths', '[]'::jsonb, 'deleted', false);
END $$;

-- Permanent deletion of a series: queues every event deleted with it (and the holder) for manual purge and
-- returns their ids; the server purges them one by one (purge_event) and then the series row.
CREATE OR REPLACE FUNCTION public.permanent_delete_item(_type text, _id uuid, _confirmation text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _e public.events; _paths jsonb; _s public.event_series; _ids jsonb;
BEGIN
  IF _confirmation IS DISTINCT FROM 'DELETE' THEN RAISE EXCEPTION 'Permanent deletion confirmation required'; END IF;
  PERFORM id FROM profiles WHERE id = auth.uid() FOR UPDATE;
  IF _type = 'user' THEN
    IF NOT public.can_manage_deleted_user(auth.uid(), _id) THEN RAISE EXCEPTION 'Not allowed'; END IF;
    RETURN public.prepare_user_purge(_id, auth.uid());
  ELSIF _type = 'series' THEN
    SELECT * INTO _s FROM event_series WHERE id = _id FOR UPDATE;
    IF NOT FOUND OR _s.deleted_at IS NULL OR NOT public.can_manage_recycle_scope(auth.uid(), _s.branch_id, _s.region_id) THEN RAISE EXCEPTION 'Not allowed'; END IF;
    INSERT INTO event_deletion_jobs (event_id, operation, requested_by)
      SELECT x.id, 'manual_purge', auth.uid() FROM events x
      WHERE (x.series_id = _id AND x.deleted_with_series) OR (x.id = _s.media_event_id AND x.deleted_at IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM event_series o WHERE o.media_event_id = _s.media_event_id AND o.id <> _id))
    ON CONFLICT (event_id) DO UPDATE SET operation = 'manual_purge', requested_by = auth.uid();
    SELECT coalesce(jsonb_agg(j.event_id), '[]'::jsonb) INTO _ids FROM event_deletion_jobs j JOIN events x ON x.id = j.event_id
      WHERE j.operation = 'manual_purge' AND ((x.series_id = _id AND x.deleted_with_series) OR x.id = _s.media_event_id);
    INSERT INTO recycle_bin_audit_log (actor_id, item_type, item_id, action, branch_id, region_id) VALUES (auth.uid(), 'series', _id, 'permanent_delete', _s.branch_id, _s.region_id);
    RETURN jsonb_build_object('paths', '[]'::jsonb, 'deleted', false, 'events', _ids);
  ELSIF _type <> 'event' THEN RAISE EXCEPTION 'Not allowed'; END IF;
  SELECT * INTO _e FROM events WHERE id = _id FOR UPDATE;
  IF NOT FOUND OR _e.deleted_at IS NULL OR _e.series_template OR _e.deleted_with_series OR NOT public.can_manage_recycle_scope(auth.uid(), _e.branch_id, _e.region_id)
     OR EXISTS (SELECT 1 FROM event_deletion_jobs WHERE event_id = _id AND operation NOT IN ('archive', 'manual_purge')) THEN RAISE EXCEPTION 'Not allowed'; END IF;
  INSERT INTO event_deletion_jobs (event_id, operation, requested_by) VALUES (_id, 'manual_purge', auth.uid())
  ON CONFLICT (event_id) DO UPDATE SET operation = 'manual_purge', requested_by = auth.uid();
  SELECT coalesce(jsonb_agg(name ORDER BY name), '[]'::jsonb) INTO _paths FROM storage.objects WHERE bucket_id = 'event-media' AND (name LIKE _id::text || '/%' OR name LIKE 'deleted/' || _id::text || '/%');
  RETURN jsonb_build_object('paths', _paths, 'deleted', false);
END $$;

-- Removes a series row after the server purged all its events (manual permanent deletion).
CREATE FUNCTION public.finish_series_purge(_series uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.events WHERE series_id = _series) THEN RAISE EXCEPTION 'Event files still exist'; END IF;
  DELETE FROM public.event_series WHERE id = _series AND deleted_at IS NOT NULL;
END $$;

-- ---------------------------------------------------------------------------------------------------------
-- 8. Grants: revoke from PUBLIC/anon (and authenticated), then grant only what clients call.
-- ---------------------------------------------------------------------------------------------------------
REVOKE ALL ON FUNCTION
  public.can_view_series(uuid), public.can_view_event_media(uuid), public.events_series_guard(), public.series_op_begin(), public.series_op_end(text),
  public.series_expand(text, timestamp, timestamp, timestamp, integer), public.series_rule_until(text, timestamp, boolean),
  public.series_rule_count(text, integer), public.series_generate(uuid, integer), public.extend_all_series(), public.purge_expired_series(),
  public.series_timing(jsonb), public.create_series(jsonb, text), public.open_series(uuid), public.update_series_event(uuid, text, jsonb, text),
  public.delete_series(uuid, text), public.finish_series_deletion(uuid), public.restore_series(uuid, boolean),
  public.list_recycle_bin(text, text, integer), public.finish_series_purge(uuid)
FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.can_read_event_file(text), public.can_restore_event(uuid), public.restore_item(text, uuid),
  public.permanent_delete_item(text, uuid, text) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION
  public.can_view_series(uuid), public.can_view_event_media(uuid), public.create_series(jsonb, text), public.open_series(uuid),
  public.update_series_event(uuid, text, jsonb, text), public.delete_series(uuid, text), public.finish_series_deletion(uuid),
  public.restore_series(uuid, boolean), public.list_recycle_bin(text, text, integer)
TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_read_event_file(text), public.can_restore_event(uuid), public.restore_item(text, uuid),
  public.permanent_delete_item(text, uuid, text) TO authenticated;
-- Server-only (service role): manual series purge, nightly cleanup and horizon extension.
GRANT EXECUTE ON FUNCTION public.finish_series_purge(uuid), public.purge_expired_series(), public.extend_all_series() TO service_role;

-- ---------------------------------------------------------------------------------------------------------
-- 9. Daily horizon extension with pg_cron when the extension is available (skipped otherwise; event pages
--    also extend their series through open_series, so nothing depends on this job or on app deployment).
-- ---------------------------------------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'pg_cron') THEN
    CREATE EXTENSION IF NOT EXISTS pg_cron;
    PERFORM cron.schedule('extend-event-series', '15 2 * * *', 'SELECT public.extend_all_series()');
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pg_cron not available, series horizon is extended on open/edit only: %', SQLERRM;
END $$;

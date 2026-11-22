-- A2b: event registrations, capacity and waitlist.
--
-- * event_registrations: one row per (event, user). Cancelling and registering again reuses the row.
--   Clients only SELECT (own rows; managers: rows of events they manage). Every write goes through the
--   SECURITY DEFINER RPCs below, which lock the event row first (last-seat race, FIFO promotion).
-- * events.registration_enabled / event_series.registration_enabled; events.capacity already existed.
-- * Lifecycle: an AFTER UPDATE trigger on events sets notices (cancelled / removed / changed), clears the
--   'event_removed' notice on restore and promotes the waitlist when capacity grows. Soft-deleting a user
--   cancels their upcoming registrations and promotes the waitlist. GDPR erasure (profile row deleted)
--   anonymises the rows (user_id -> NULL, ON DELETE SET NULL), so counts and attendance stay intact.
--   Purging an event (Recycle Bin, after 30 days) removes its registrations with it (ON DELETE CASCADE).
-- * Recurring events (A2r): update_series_event never deletes and regenerates an occurrence that has an
--   active (registered/waitlisted) registration. Such an occurrence is kept with the same id, moved to the
--   new timing when the new rule still has an occurrence that London day, otherwise left as it is, and in
--   both cases marked series_exception. The ids kept off-rule are returned so the UI can warn.
--   series_generate (and so the extend-event-series cron job) only inserts, ON CONFLICT DO NOTHING.

-- 1. Columns ---------------------------------------------------------------------------------------------
ALTER TABLE public.events ADD COLUMN registration_enabled boolean NOT NULL DEFAULT true;
ALTER TABLE public.event_series ADD COLUMN registration_enabled boolean NOT NULL DEFAULT true;
ALTER TABLE public.events ADD CONSTRAINT events_capacity_positive CHECK (capacity IS NULL OR capacity > 0);
ALTER TABLE public.event_series ADD CONSTRAINT event_series_capacity_positive CHECK (capacity IS NULL OR capacity > 0);

-- 2. Table -----------------------------------------------------------------------------------------------
CREATE TABLE public.event_registrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  -- NULL only after GDPR erasure of the user (anonymised row, kept for counts and attendance).
  user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  status text NOT NULL CHECK (status IN ('registered', 'waitlisted', 'cancelled', 'attended', 'no_show')),
  show_name boolean NOT NULL DEFAULT false,
  registered_at timestamptz NOT NULL DEFAULT clock_timestamp(),  -- FIFO order, distinct within one transaction
  cancelled_at timestamptz,
  attendance_marked_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  attendance_marked_at timestamptz,
  notice text CHECK (notice IN ('promoted', 'event_cancelled', 'event_removed', 'event_changed')),
  notice_seen_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT event_registrations_event_user_key UNIQUE (event_id, user_id),
  CONSTRAINT event_registrations_anonymised CHECK (user_id IS NOT NULL OR (NOT show_name AND notice IS NULL))
);
CREATE INDEX event_registrations_event_status_idx ON public.event_registrations (event_id, status);
CREATE INDEX event_registrations_user_status_idx ON public.event_registrations (user_id, status);
CREATE INDEX event_registrations_waitlist_idx ON public.event_registrations (event_id, status, registered_at);

ALTER TABLE public.event_registrations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.event_registrations FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.event_registrations TO authenticated;
GRANT ALL ON public.event_registrations TO service_role;

-- Own rows, while the event is not in the Recycle Bin (event RLS applies inside the subquery).
CREATE POLICY event_registrations_read_own ON public.event_registrations FOR SELECT TO authenticated
  USING (user_id = auth.uid() AND EXISTS (
    SELECT 1 FROM public.events e WHERE e.id = event_id AND e.deleted_at IS NULL AND NOT e.series_template));
-- Managers (BM: own branch, RD: own region) read every row of the events they manage.
CREATE POLICY event_registrations_read_managed ON public.event_registrations FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.events e WHERE e.id = event_id AND e.deleted_at IS NULL
      AND public.can_manage_event_scope(e.scope, e.branch_id, e.region_id)));

-- updated_at, and anonymisation when the user is erased (FK SET NULL fires this UPDATE trigger).
CREATE FUNCTION public.event_registrations_touch() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.updated_at := now();
  IF NEW.user_id IS NULL THEN NEW.show_name := false; NEW.notice := NULL; NEW.notice_seen_at := NULL; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER event_registrations_touch BEFORE UPDATE ON public.event_registrations
  FOR EACH ROW EXECUTE FUNCTION public.event_registrations_touch();

-- 3. Internal helpers (not callable by clients) ------------------------------------------------------------
-- Start / end instants of an event; all-day events use London calendar days.
CREATE FUNCTION public.event_starts(_e public.events) RETURNS timestamptz LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT CASE WHEN _e.all_day THEN (_e.start_date::timestamp AT TIME ZONE 'Europe/London') ELSE _e.start_at END
$$;
CREATE FUNCTION public.event_ends(_e public.events) RETURNS timestamptz LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT CASE WHEN _e.all_day THEN ((coalesce(_e.end_date, _e.start_date) + 1)::timestamp AT TIME ZONE 'Europe/London') ELSE _e.end_at END
$$;

-- Counts only. Seats are taken by registered, attended and no_show rows.
CREATE FUNCTION public.registration_counts(_event uuid)
RETURNS TABLE (seats integer, waitlisted integer, cancelled integer, attended integer, no_show integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT count(*) FILTER (WHERE status IN ('registered', 'attended', 'no_show'))::integer,
         count(*) FILTER (WHERE status = 'waitlisted')::integer,
         count(*) FILTER (WHERE status = 'cancelled')::integer,
         count(*) FILTER (WHERE status = 'attended')::integer,
         count(*) FILTER (WHERE status = 'no_show')::integer
  FROM public.event_registrations WHERE event_id = _event
$$;

-- Names of registered volunteers who chose to show them (no e-mail). Kept apart from the counts.
CREATE FUNCTION public.registration_public_names(_event uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(jsonb_agg(p.full_name ORDER BY r.registered_at, r.id), '[]'::jsonb)
  FROM public.event_registrations r JOIN public.profiles p ON p.id = r.user_id
  WHERE r.event_id = _event AND r.show_name AND r.status IN ('registered', 'attended', 'no_show')
    AND p.deleted_at IS NULL AND length(trim(p.full_name)) > 0
$$;

-- Whether the caller may see registrant names for this event at all ("counts only" mode otherwise).
-- Every viewer may today; a future National Coordinator role will get counts only (return false here).
CREATE FUNCTION public.registrant_names_visible(_event uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT _event IS NOT NULL
$$;

-- 1-based waitlist position of a registration (FIFO by registered_at), NULL when not waitlisted.
CREATE FUNCTION public.registration_position(_r public.event_registrations) RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE WHEN _r.status <> 'waitlisted' THEN NULL ELSE 1 + (
    SELECT count(*)::integer FROM public.event_registrations w
    WHERE w.event_id = _r.event_id AND w.status = 'waitlisted' AND (w.registered_at, w.id) < (_r.registered_at, _r.id)) END
$$;

CREATE FUNCTION public.registration_result(_r public.event_registrations) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object('registration_id', _r.id, 'status', _r.status, 'waitlist_position', public.registration_position(_r))
$$;

-- Promotes the oldest waitlisted registrations while seats are free. The caller holds the event row lock.
CREATE FUNCTION public.promote_waitlist(_event uuid) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _e public.events; _n integer := 0; _r uuid;
BEGIN
  SELECT * INTO _e FROM public.events WHERE id = _event;
  IF NOT FOUND OR _e.deleted_at IS NOT NULL OR _e.status <> 'published' OR _e.series_template
     OR coalesce(public.event_starts(_e) <= now(), true) THEN RETURN 0; END IF;
  LOOP
    EXIT WHEN _e.capacity IS NOT NULL AND (SELECT seats FROM public.registration_counts(_event)) >= _e.capacity;
    SELECT id INTO _r FROM public.event_registrations WHERE event_id = _event AND status = 'waitlisted'
      ORDER BY registered_at, id LIMIT 1 FOR UPDATE;
    EXIT WHEN NOT FOUND;
    UPDATE public.event_registrations SET status = 'registered', notice = 'promoted', notice_seen_at = NULL WHERE id = _r;
    _n := _n + 1;
  END LOOP;
  RETURN _n;
END $$;

-- 4. Client RPCs -------------------------------------------------------------------------------------------
CREATE FUNCTION public.register_for_event(p_event_id uuid, p_show_name boolean DEFAULT false) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid uuid := auth.uid(); _e public.events; _r public.event_registrations; _existing boolean; _status text;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not signed in'; END IF;
  PERFORM id FROM public.profiles WHERE id = _uid FOR UPDATE;
  SELECT * INTO _e FROM public.events WHERE id = p_event_id FOR UPDATE;
  IF NOT FOUND OR _e.series_template OR NOT public.can_view_event(p_event_id) THEN RAISE EXCEPTION 'Not allowed'; END IF;
  SELECT * INTO _r FROM public.event_registrations WHERE event_id = p_event_id AND user_id = _uid FOR UPDATE;
  _existing := FOUND;
  IF _existing AND _r.status <> 'cancelled' THEN RETURN public.registration_result(_r); END IF;  -- idempotent
  IF _e.status <> 'published' OR NOT _e.registration_enabled
     OR EXISTS (SELECT 1 FROM public.event_deletion_jobs WHERE event_id = p_event_id) THEN RAISE EXCEPTION 'Registration is closed'; END IF;
  IF coalesce(public.event_ends(_e) <= now(), true) THEN RAISE EXCEPTION 'Event has ended'; END IF;
  _status := CASE WHEN _e.capacity IS NULL OR (SELECT seats FROM public.registration_counts(p_event_id)) < _e.capacity
             THEN 'registered' ELSE 'waitlisted' END;
  IF _existing THEN
    UPDATE public.event_registrations SET status = _status, registered_at = clock_timestamp(), cancelled_at = NULL,
      show_name = coalesce(p_show_name, false), notice = NULL, notice_seen_at = NULL,
      attendance_marked_by = NULL, attendance_marked_at = NULL
    WHERE id = _r.id RETURNING * INTO _r;
  ELSE
    INSERT INTO public.event_registrations (event_id, user_id, status, show_name)
    VALUES (p_event_id, _uid, _status, coalesce(p_show_name, false)) RETURNING * INTO _r;
  END IF;
  RETURN public.registration_result(_r);
END $$;

CREATE FUNCTION public.cancel_registration(p_event_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid uuid := auth.uid(); _e public.events; _r public.event_registrations; _was text;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not signed in'; END IF;
  PERFORM id FROM public.profiles WHERE id = _uid FOR UPDATE;
  SELECT * INTO _e FROM public.events WHERE id = p_event_id FOR UPDATE;
  IF NOT FOUND OR _e.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'Not allowed'; END IF;
  SELECT * INTO _r FROM public.event_registrations WHERE event_id = p_event_id AND user_id = _uid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Registration not found'; END IF;
  IF _r.status = 'cancelled' THEN RETURN public.registration_result(_r); END IF;  -- idempotent
  IF _r.status NOT IN ('registered', 'waitlisted') OR coalesce(public.event_starts(_e) <= now(), false) THEN RAISE EXCEPTION 'Event has started'; END IF;
  _was := _r.status;
  UPDATE public.event_registrations SET status = 'cancelled', cancelled_at = now(), notice = NULL, notice_seen_at = NULL
  WHERE id = _r.id RETURNING * INTO _r;
  IF _was = 'registered' THEN PERFORM public.promote_waitlist(p_event_id); END IF;
  RETURN public.registration_result(_r);
END $$;

CREATE FUNCTION public.set_registration_show_name(p_event_id uuid, p_show_name boolean) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid uuid := auth.uid();
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not signed in'; END IF;
  UPDATE public.event_registrations r SET show_name = coalesce(p_show_name, false)
  WHERE r.event_id = p_event_id AND r.user_id = _uid
    AND EXISTS (SELECT 1 FROM public.events e WHERE e.id = r.event_id AND e.deleted_at IS NULL);
  IF NOT FOUND THEN RAISE EXCEPTION 'Registration not found'; END IF;
END $$;

CREATE FUNCTION public.get_event_registration_summary(p_event_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid uuid := auth.uid(); _e public.events; _c record; _mine public.event_registrations; _names boolean;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not signed in'; END IF;
  SELECT * INTO _e FROM public.events WHERE id = p_event_id;
  IF NOT FOUND OR _e.series_template OR NOT public.can_view_event(p_event_id) THEN RAISE EXCEPTION 'Not allowed'; END IF;
  SELECT * INTO _c FROM public.registration_counts(p_event_id);
  SELECT * INTO _mine FROM public.event_registrations WHERE event_id = p_event_id AND user_id = _uid;
  _names := public.registrant_names_visible(p_event_id);
  RETURN jsonb_build_object(
    'capacity', _e.capacity, 'registration_enabled', _e.registration_enabled,
    'registered_count', _c.seats, 'waitlisted_count', _c.waitlisted,
    'spots_left', CASE WHEN _e.capacity IS NULL THEN NULL ELSE greatest(_e.capacity - _c.seats, 0) END,
    'over_capacity', _e.capacity IS NOT NULL AND _c.seats > _e.capacity,
    'my_registration_id', _mine.id, 'my_status', _mine.status, 'my_show_name', coalesce(_mine.show_name, false),
    'my_waitlist_position', CASE WHEN _mine.id IS NULL THEN NULL ELSE public.registration_position(_mine) END,
    'names_visible', _names,
    'names', CASE WHEN _names THEN public.registration_public_names(p_event_id) ELSE '[]'::jsonb END);
END $$;

CREATE FUNCTION public.get_event_registrations(p_event_id uuid)
RETURNS TABLE (id uuid, user_id uuid, full_name text, email text, status text, show_name boolean, registered_at timestamptz,
  cancelled_at timestamptz, attendance_marked_at timestamptz, attendance_marked_by_name text, waitlist_position integer)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _e public.events;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not signed in'; END IF;
  SELECT * INTO _e FROM public.events WHERE events.id = p_event_id;
  IF NOT FOUND OR _e.deleted_at IS NOT NULL OR _e.series_template OR NOT public.can_manage_event_scope(_e.scope, _e.branch_id, _e.region_id) THEN
    RAISE EXCEPTION 'Not allowed';
  END IF;
  RETURN QUERY
    SELECT r.id, r.user_id, p.full_name, p.email, r.status, r.show_name, r.registered_at, r.cancelled_at, r.attendance_marked_at,
      m.full_name, public.registration_position(r)
    FROM public.event_registrations r
    LEFT JOIN public.profiles p ON p.id = r.user_id
    LEFT JOIN public.profiles m ON m.id = r.attendance_marked_by
    WHERE r.event_id = p_event_id
    ORDER BY CASE r.status WHEN 'registered' THEN 0 WHEN 'attended' THEN 0 WHEN 'no_show' THEN 0 WHEN 'waitlisted' THEN 1 ELSE 2 END,
      r.registered_at, r.id;
END $$;

CREATE FUNCTION public.mark_attendance(p_registration_id uuid, p_status text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid uuid := auth.uid(); _event uuid; _e public.events; _r public.event_registrations;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not signed in'; END IF;
  IF p_status IS NULL OR p_status NOT IN ('attended', 'no_show') THEN RAISE EXCEPTION 'Invalid attendance status'; END IF;
  PERFORM id FROM public.profiles WHERE id = _uid FOR UPDATE;
  SELECT event_id INTO _event FROM public.event_registrations WHERE id = p_registration_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Not allowed'; END IF;
  SELECT * INTO _e FROM public.events WHERE id = _event FOR UPDATE;
  IF _e.deleted_at IS NOT NULL OR NOT public.can_manage_event_scope(_e.scope, _e.branch_id, _e.region_id) THEN RAISE EXCEPTION 'Not allowed'; END IF;
  IF coalesce(public.event_starts(_e) > now(), true) THEN RAISE EXCEPTION 'Event has not started'; END IF;
  SELECT * INTO _r FROM public.event_registrations WHERE id = p_registration_id FOR UPDATE;
  IF _r.status NOT IN ('registered', 'attended', 'no_show') THEN RAISE EXCEPTION 'Invalid attendance status'; END IF;
  UPDATE public.event_registrations SET status = p_status, attendance_marked_by = _uid, attendance_marked_at = now() WHERE id = _r.id;
END $$;

CREATE FUNCTION public.dismiss_registration_notice(p_registration_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not signed in'; END IF;
  UPDATE public.event_registrations SET notice_seen_at = now()
  WHERE id = p_registration_id AND user_id = auth.uid() AND notice IS NOT NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Registration not found'; END IF;
END $$;

-- Dashboard: upcoming registrations/waitlist, plus unseen notices (also for events now in the Recycle Bin,
-- with the title only; such events are never linked).
CREATE FUNCTION public.get_my_registrations()
RETURNS TABLE (registration_id uuid, event_id uuid, title text, all_day boolean, start_at timestamptz, end_at timestamptz,
  start_date date, end_date date, event_status text, event_removed boolean, status text, waitlist_position integer, notice text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not signed in'; END IF;
  RETURN QUERY
    SELECT r.id, e.id, e.title, e.all_day, e.start_at, e.end_at, e.start_date, e.end_date, e.status, e.deleted_at IS NOT NULL,
      r.status, public.registration_position(r), CASE WHEN r.notice_seen_at IS NULL THEN r.notice END
    FROM public.event_registrations r JOIN public.events e ON e.id = r.event_id
    WHERE r.user_id = auth.uid() AND NOT e.series_template AND (
      (r.status IN ('registered', 'waitlisted') AND e.deleted_at IS NULL AND coalesce(public.event_ends(e) > now(), false))
      OR (r.notice IS NOT NULL AND r.notice_seen_at IS NULL))
    ORDER BY public.event_starts(e) NULLS LAST, r.id
    LIMIT 100;
END $$;

-- 5. Lifecycle triggers ------------------------------------------------------------------------------------
CREATE FUNCTION public.events_registration_sync() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.series_template THEN RETURN NULL; END IF;
  IF OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN
    UPDATE public.event_registrations SET notice = 'event_removed', notice_seen_at = NULL
    WHERE event_id = NEW.id AND status IN ('registered', 'waitlisted') AND user_id IS NOT NULL;
    RETURN NULL;
  END IF;
  IF OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NULL THEN
    UPDATE public.event_registrations SET notice = NULL, notice_seen_at = NULL WHERE event_id = NEW.id AND notice = 'event_removed';
    RETURN NULL;
  END IF;
  IF NEW.deleted_at IS NOT NULL THEN RETURN NULL; END IF;
  IF OLD.status <> 'cancelled' AND NEW.status = 'cancelled' THEN
    UPDATE public.event_registrations SET notice = 'event_cancelled', notice_seen_at = NULL
    WHERE event_id = NEW.id AND status IN ('registered', 'waitlisted') AND user_id IS NOT NULL;
    RETURN NULL;
  END IF;
  IF NEW.status = 'published' AND ROW(NEW.all_day, NEW.start_at, NEW.end_at, NEW.start_date, NEW.end_date, NEW.location, NEW.location_type, NEW.online_url)
     IS DISTINCT FROM ROW(OLD.all_day, OLD.start_at, OLD.end_at, OLD.start_date, OLD.end_date, OLD.location, OLD.location_type, OLD.online_url) THEN
    UPDATE public.event_registrations SET notice = 'event_changed', notice_seen_at = NULL
    WHERE event_id = NEW.id AND status IN ('registered', 'waitlisted') AND user_id IS NOT NULL;
  END IF;
  -- More seats (or unlimited): promote FIFO. Fewer seats: nobody is removed; new registrations wait.
  IF NEW.capacity IS DISTINCT FROM OLD.capacity AND (NEW.capacity IS NULL OR (OLD.capacity IS NOT NULL AND NEW.capacity > OLD.capacity)) THEN
    PERFORM public.promote_waitlist(NEW.id);
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER events_registration_sync AFTER UPDATE ON public.events
  FOR EACH ROW EXECUTE FUNCTION public.events_registration_sync();

-- Soft-deleting a user (admin deletion or erasure request) cancels their upcoming registrations and fills
-- the freed seats from the waitlist. Restoring the user does not reopen them.
CREATE FUNCTION public.profiles_registration_sync() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _r record;
BEGIN
  IF OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN
    FOR _r IN SELECT g.id, g.event_id, g.status FROM public.event_registrations g JOIN public.events e ON e.id = g.event_id
              WHERE g.user_id = NEW.id AND g.status IN ('registered', 'waitlisted') AND coalesce(public.event_starts(e) > now(), true)
              ORDER BY g.event_id LOOP
      PERFORM 1 FROM public.events WHERE id = _r.event_id FOR UPDATE;
      UPDATE public.event_registrations SET status = 'cancelled', cancelled_at = now(), notice = NULL, notice_seen_at = NULL WHERE id = _r.id;
      IF _r.status = 'registered' THEN PERFORM public.promote_waitlist(_r.event_id); END IF;
    END LOOP;
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER profiles_registration_sync AFTER UPDATE OF deleted_at ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.profiles_registration_sync();

-- 6. Events and series: registration_enabled, registration-safe series edits --------------------------------
CREATE OR REPLACE FUNCTION public.create_event(_data jsonb) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _id uuid; _branch uuid := nullif(_data->>'branch_id', '')::uuid; _region uuid; _scope text := _data->>'scope';
BEGIN
  PERFORM id FROM profiles WHERE id = auth.uid() FOR UPDATE;
  IF _data->>'status' = 'draft' AND _branch IS NULL AND _scope IS DISTINCT FROM 'region' THEN
    IF public.has_role(auth.uid(), 'regional_director') THEN _scope := 'region'; ELSE _branch := public.get_user_branch(auth.uid()); _scope := 'branch'; END IF;
  END IF;
  IF _scope = 'branch' THEN SELECT region_id INTO _region FROM branches WHERE id = _branch; ELSE SELECT region_id INTO _region FROM user_roles WHERE user_id = auth.uid() AND role = 'regional_director' LIMIT 1; END IF;
  IF NOT public.can_manage_event_scope(_scope, _branch, _region) THEN RAISE EXCEPTION 'Not allowed'; END IF;
  IF _data->>'status' IS NULL OR _data->>'status' NOT IN ('draft', 'published') THEN RAISE EXCEPTION 'Invalid event values'; END IF;
  INSERT INTO events (title, description, location, start_at, end_at, all_day, start_date, end_date, location_type, online_url, organizer, category, capacity,
    registration_enabled, scope, branch_id, region_id, status, created_by)
  VALUES (_data->>'title', coalesce(_data->>'description', ''), coalesce(_data->>'location', ''), nullif(_data->>'start_at', '')::timestamptz,
    nullif(_data->>'end_at', '')::timestamptz, coalesce((_data->>'all_day')::boolean, false), nullif(_data->>'start_date', '')::date,
    nullif(_data->>'end_date', '')::date, coalesce(nullif(_data->>'location_type', ''), 'in_person'), nullif(_data->>'online_url', ''),
    coalesce(nullif(trim(_data->>'organizer'), ''), 'Dialogue Society'), coalesce(_data->>'category', 'dialogue'), nullif(_data->>'capacity', '')::integer,
    coalesce((_data->>'registration_enabled')::boolean, true), _scope, _branch, _region, _data->>'status', auth.uid())
  RETURNING id INTO _id;
  RETURN _id;
END $$;

CREATE OR REPLACE FUNCTION public.update_event(_event uuid, _data jsonb) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _branch uuid := nullif(_data->>'branch_id', '')::uuid; _region uuid; _scope text := _data->>'scope'; _old_status text; _old_reg boolean;
BEGIN
  PERFORM id FROM public.profiles WHERE id = auth.uid() FOR UPDATE;
  SELECT status, registration_enabled INTO _old_status, _old_reg FROM public.events WHERE id = _event FOR UPDATE;
  IF NOT FOUND OR NOT public.can_manage_event(_event) THEN RAISE EXCEPTION 'Not allowed'; END IF;
  IF _scope = 'branch' THEN SELECT region_id INTO _region FROM public.branches WHERE id = _branch; ELSE SELECT region_id INTO _region FROM public.user_roles WHERE user_id = auth.uid() AND role = 'regional_director' LIMIT 1; END IF;
  IF NOT public.can_manage_event_scope(_scope, _branch, _region) THEN RAISE EXCEPTION 'Not allowed'; END IF;
  IF _data->>'status' IS NULL OR _data->>'status' NOT IN ('draft', 'published', 'cancelled') OR (_old_status = 'cancelled' AND _data->>'status' <> 'cancelled') OR (_old_status <> 'cancelled' AND _data->>'status' = 'cancelled') THEN RAISE EXCEPTION 'Invalid event values'; END IF;
  UPDATE public.events SET title = _data->>'title', description = coalesce(_data->>'description', ''), location = coalesce(_data->>'location', ''),
    start_at = nullif(_data->>'start_at', '')::timestamptz, end_at = nullif(_data->>'end_at', '')::timestamptz, all_day = coalesce((_data->>'all_day')::boolean, false),
    start_date = nullif(_data->>'start_date', '')::date, end_date = nullif(_data->>'end_date', '')::date, location_type = coalesce(nullif(_data->>'location_type', ''), 'in_person'),
    online_url = nullif(_data->>'online_url', ''), organizer = coalesce(nullif(trim(_data->>'organizer'), ''), 'Dialogue Society'), category = _data->>'category',
    capacity = nullif(_data->>'capacity', '')::integer, registration_enabled = coalesce((_data->>'registration_enabled')::boolean, _old_reg),
    scope = _scope, branch_id = _branch, region_id = _region, status = _data->>'status'
  WHERE id = _event;
END $$;

-- Same guard as A2r; registration_enabled now also makes an occurrence an exception.
CREATE OR REPLACE FUNCTION public.events_series_guard() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
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
       NEW.category, NEW.capacity, NEW.registration_enabled, NEW.all_day, NEW.start_at, NEW.end_at, NEW.start_date, NEW.end_date, NEW.status)
     IS DISTINCT FROM ROW(OLD.title, OLD.description, OLD.location, OLD.location_type, OLD.online_url, OLD.organizer,
       OLD.category, OLD.capacity, OLD.registration_enabled, OLD.all_day, OLD.start_at, OLD.end_at, OLD.start_date, OLD.end_date, OLD.status) THEN
    NEW.series_exception := true;
  END IF;
  RETURN NEW;
END $$;

-- Unchanged from A2r except registration_enabled; inserts only, never touches existing occurrences.
CREATE OR REPLACE FUNCTION public.series_generate(_series uuid, _limit integer DEFAULT 100) RETURNS integer
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
      INSERT INTO public.events (title, description, location, location_type, online_url, organizer, category, capacity, registration_enabled,
        scope, branch_id, region_id, status, created_by, all_day, start_date, end_date, start_at, end_at, series_id, recurrence_key)
      VALUES (_s.title, _s.description, _s.location, _s.location_type, _s.online_url, _s.organizer, _s.category, _s.capacity, _s.registration_enabled,
        _s.scope, _s.branch_id, _s.region_id, _s.status, _s.created_by, true, _cand::date, _cand::date + _s.span_days, NULL, NULL, _s.id, _cand)
      ON CONFLICT (series_id, recurrence_key) DO NOTHING RETURNING id INTO _id;
    ELSE
      _start := _cand AT TIME ZONE 'Europe/London';
      _end := (_cand + make_interval(mins => _s.duration_minutes)) AT TIME ZONE 'Europe/London';
      CONTINUE WHEN _end < now();
      INSERT INTO public.events (title, description, location, location_type, online_url, organizer, category, capacity, registration_enabled,
        scope, branch_id, region_id, status, created_by, all_day, start_date, end_date, start_at, end_at, series_id, recurrence_key)
      VALUES (_s.title, _s.description, _s.location, _s.location_type, _s.online_url, _s.organizer, _s.category, _s.capacity, _s.registration_enabled,
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

CREATE OR REPLACE FUNCTION public.create_series(_data jsonb, _rule text) RETURNS jsonb
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
  INSERT INTO public.events (title, description, location, location_type, online_url, organizer, category, capacity, registration_enabled,
    scope, branch_id, region_id, status, created_by, all_day, series_template)
  VALUES (_data->>'title', coalesce(_data->>'description', ''), coalesce(_data->>'location', ''), coalesce(nullif(_data->>'location_type', ''), 'in_person'),
    nullif(_data->>'online_url', ''), coalesce(nullif(trim(_data->>'organizer'), ''), 'Dialogue Society'), coalesce(_data->>'category', 'dialogue'),
    nullif(_data->>'capacity', '')::integer, coalesce((_data->>'registration_enabled')::boolean, true), _scope, _branch, _region, 'draft', auth.uid(), _t.all_day, true)
  RETURNING id INTO _mid;
  INSERT INTO public.event_series (rule, all_day, dtstart_local, duration_minutes, span_days, status, title, description, location,
    location_type, online_url, organizer, category, capacity, registration_enabled, scope, branch_id, region_id, media_event_id, created_by)
  SELECT upper(_rule), _t.all_day, _t.dtstart_local, _t.duration_minutes, _t.span_days, _status, e.title, e.description, e.location,
    e.location_type, e.online_url, e.organizer, e.category, e.capacity, e.registration_enabled, e.scope, e.branch_id, e.region_id, e.id, auth.uid()
  FROM public.events e WHERE e.id = _mid
  RETURNING id INTO _sid;
  _n := public.series_generate(_sid, 100);
  SELECT id INTO _first FROM public.events WHERE series_id = _sid ORDER BY recurrence_key LIMIT 1;
  IF _first IS NULL THEN RAISE EXCEPTION 'Recurrence has no upcoming events'; END IF;
  INSERT INTO public.event_audit_log (actor_id, event_id, action, scope, branch_id, region_id) VALUES (auth.uid(), _sid, 'series_created', _scope, _branch, _region);
  PERFORM public.series_op_end(_prev);
  RETURN jsonb_build_object('series_id', _sid, 'event_id', _first, 'media_event_id', _mid, 'count', _n);
END $$;

-- A2r update_series_event with registration protection (see the header). Returns 'kept_off_rule': ids of
-- registered occurrences the new rule no longer produces (kept as exceptions; the UI warns the manager).
CREATE OR REPLACE FUNCTION public.update_series_event(_event uuid, _mode text, _data jsonb, _rule text DEFAULT NULL::text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _e public.events; _s public.event_series; _old uuid; _t record; _new_rule text; _dt timestamp; _timing boolean; _rule_changed boolean;
  _status text := coalesce(nullif(_data->>'status', ''), 'published'); _target uuid; _remaining integer; _done integer; _first uuid; _prev text;
  _del_series uuid; _from timestamp; _protected uuid[] := '{}'; _p public.events; _cand timestamp; _kept jsonb := '[]'::jsonb;
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
    RETURN jsonb_build_object('series_id', _s.id, 'event_id', _event, 'kept_off_rule', '[]'::jsonb);
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
      location_type, online_url, organizer, category, capacity, registration_enabled, scope, branch_id, region_id, media_event_id, created_by)
    VALUES (_new_rule, _t.all_day, _dt, _t.duration_minutes, _t.span_days, _status, trim(_data->>'title'), coalesce(_data->>'description', ''),
      coalesce(_data->>'location', ''), coalesce(nullif(_data->>'location_type', ''), 'in_person'), nullif(_data->>'online_url', ''),
      coalesce(nullif(trim(_data->>'organizer'), ''), 'Dialogue Society'), coalesce(_data->>'category', _s.category), nullif(_data->>'capacity', '')::integer,
      coalesce((_data->>'registration_enabled')::boolean, _s.registration_enabled),
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
    capacity = nullif(_data->>'capacity', '')::integer, registration_enabled = coalesce((_data->>'registration_enabled')::boolean, registration_enabled),
    updated_at = now()
  WHERE id = _target;
  SELECT * INTO _s FROM public.event_series WHERE id = _target;

  -- Content of every live, non-exception occurrence.
  UPDATE public.events SET title = _s.title, description = _s.description, location = _s.location, location_type = _s.location_type,
    online_url = _s.online_url, organizer = _s.organizer, category = _s.category, capacity = _s.capacity, registration_enabled = _s.registration_enabled
  WHERE series_id = _target AND NOT series_exception AND deleted_at IS NULL;
  -- Status only for occurrences that have not ended (a published occurrence may not end in the past).
  UPDATE public.events SET status = _s.status
  WHERE series_id = _target AND NOT series_exception AND deleted_at IS NULL AND status <> _s.status AND status <> 'cancelled'
    AND coalesce(end_at, (coalesce(end_date, start_date) + 1)::timestamp AT TIME ZONE 'Europe/London') > now();

  IF _timing THEN
    -- 'all': future occurrences of the series; 'following': the old series' occurrences from here on.
    _del_series := CASE WHEN _mode = 'all' THEN _target ELSE _old END;
    _from := CASE WHEN _mode = 'all' THEN (now() AT TIME ZONE 'Europe/London') ELSE _e.recurrence_key END;
    -- Occurrences with an active registration are never deleted and regenerated.
    SELECT coalesce(array_agg(x.id), '{}') INTO _protected FROM public.events x
    WHERE x.series_id = _del_series AND NOT x.series_exception AND x.deleted_at IS NULL AND x.recurrence_key >= _from
      AND EXISTS (SELECT 1 FROM public.event_registrations g WHERE g.event_id = x.id AND g.status IN ('registered', 'waitlisted'));
    DELETE FROM public.events WHERE series_id = _del_series AND NOT series_exception AND deleted_at IS NULL AND recurrence_key >= _from
      AND NOT (id = ANY (_protected));
    FOR _p IN SELECT * FROM public.events WHERE id = ANY (_protected) ORDER BY recurrence_key FOR UPDATE LOOP
      -- The new rule's occurrence on the same London day, if it has one that has not ended and is free.
      SELECT c INTO _cand FROM public.series_expand(_s.rule, _s.dtstart_local, _p.recurrence_key::date::timestamp,
        _p.recurrence_key::date::timestamp + interval '1 day' - interval '1 second', 1) c;
      IF _cand IS NOT NULL AND (CASE WHEN _s.all_day THEN (_cand::date + _s.span_days) >= (now() AT TIME ZONE 'Europe/London')::date
                                     ELSE ((_cand + make_interval(mins => _s.duration_minutes)) AT TIME ZONE 'Europe/London') > now() END)
         AND NOT EXISTS (SELECT 1 FROM public.events o WHERE o.series_id = _target AND o.recurrence_key = _cand AND o.id <> _p.id) THEN
        UPDATE public.events SET series_id = _target, recurrence_key = _cand, series_exception = true,
          title = _s.title, description = _s.description, location = _s.location, location_type = _s.location_type, online_url = _s.online_url,
          organizer = _s.organizer, category = _s.category, capacity = _s.capacity, registration_enabled = _s.registration_enabled,
          all_day = _s.all_day,
          start_at = CASE WHEN _s.all_day THEN NULL ELSE _cand AT TIME ZONE 'Europe/London' END,
          end_at = CASE WHEN _s.all_day THEN NULL ELSE (_cand + make_interval(mins => _s.duration_minutes)) AT TIME ZONE 'Europe/London' END,
          start_date = CASE WHEN _s.all_day THEN _cand::date END,
          end_date = CASE WHEN _s.all_day THEN _cand::date + _s.span_days END
        WHERE id = _p.id;
      ELSE
        UPDATE public.events SET series_id = _target, series_exception = true,
          title = _s.title, description = _s.description, location = _s.location, location_type = _s.location_type, online_url = _s.online_url,
          organizer = _s.organizer, category = _s.category, capacity = _s.capacity, registration_enabled = _s.registration_enabled
        WHERE id = _p.id;
        _kept := _kept || to_jsonb(_p.id);
      END IF;
    END LOOP;
    UPDATE public.event_series SET generated_until = NULL WHERE id = _target;
    PERFORM public.series_generate(_target, 100);
  END IF;
  INSERT INTO public.event_audit_log (actor_id, event_id, action, scope, branch_id, region_id) VALUES (auth.uid(), _target, 'series_updated', _s.scope, _s.branch_id, _s.region_id);
  SELECT id INTO _first FROM public.events WHERE series_id = _target AND deleted_at IS NULL AND recurrence_key >= coalesce(_e.recurrence_key, '-infinity') ORDER BY recurrence_key LIMIT 1;
  PERFORM public.series_op_end(_prev);
  RETURN jsonb_build_object('series_id', _target, 'event_id', coalesce(_first, _event), 'kept_off_rule', _kept);
END $$;

-- 7. Grants ------------------------------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.event_registrations_touch() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.event_starts(public.events) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.event_ends(public.events) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.registration_counts(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.registration_public_names(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.registrant_names_visible(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.registration_position(public.event_registrations) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.registration_result(public.event_registrations) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.promote_waitlist(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.events_registration_sync() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.profiles_registration_sync() FROM PUBLIC, anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.register_for_event(uuid, boolean) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.cancel_registration(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.set_registration_show_name(uuid, boolean) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_event_registration_summary(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_event_registrations(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.mark_attendance(uuid, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.dismiss_registration_notice(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_my_registrations() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.register_for_event(uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_registration(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_registration_show_name(uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_event_registration_summary(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_event_registrations(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_attendance(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.dismiss_registration_notice(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_registrations() TO authenticated;

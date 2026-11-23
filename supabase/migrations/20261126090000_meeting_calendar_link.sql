-- One calendar: every meeting is also a calendar entry (an event with category 'meeting'), one linked record.
--
-- * meetings.event_id links a meeting to its event. The shared fields (title, description, start/end, place, cancelled)
--   are kept identical by triggers in the same transaction: a change on either side updates the other. The guard
--   setting app.meeting_sync stops the mirror from echoing back.
-- * Creating a meeting (create_meeting, an approved meeting request) creates its event; creating an event with the
--   category 'meeting' (create_event) creates its meeting.
-- * Visibility: a meeting's event is visible exactly to the people who can see the meeting (creator, invitees, the
--   scope's managers). Meetings are never public: their events are members-only, never listed by the public
--   functions or the ICS feed, and have no registration, capacity or waitlist.
-- * Delete/restore: a meeting goes to the Recycle Bin as a meeting; its event is not deleted separately, it simply
--   becomes invisible with the meeting (can_view_event follows can_view_meeting) and comes back on restore. Purging the
--   meeting removes the event too. Deleting a meeting's event directly is refused (delete the meeting).
-- * Upcoming-event counts (dashboards, regions tree) do not count meetings.

ALTER TABLE public.meetings ADD COLUMN event_id uuid REFERENCES public.events(id);
CREATE UNIQUE INDEX meetings_event_idx ON public.meetings (event_id) WHERE event_id IS NOT NULL;

-- ---------------------------------------------------------------------------------------------------------------
-- Event validation: the 'meeting' category and its rules.

CREATE OR REPLACE FUNCTION public.validate_event()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE _today date := (now() AT TIME ZONE 'Europe/London')::date; _times_changed boolean; _meeting boolean := NEW.category = 'meeting';
BEGIN
 IF _meeting THEN
  -- A meeting's calendar entry: members only, never registration, always with times and a place.
  IF coalesce(NEW.organizer, '') = '' THEN
   NEW.organizer := coalesce((SELECT full_name FROM public.profiles WHERE id = NEW.created_by), 'Meeting');
  END IF;
  NEW.audience := 'members'; NEW.registration_enabled := false; NEW.capacity := NULL; NEW.all_day := false; NEW.is_external := false;
  NEW.status := CASE WHEN NEW.status = 'cancelled' THEN 'cancelled' ELSE 'published' END;
  IF NEW.series_id IS NOT NULL OR NEW.series_template THEN RAISE EXCEPTION 'Recurring meetings are created from the meeting form'; END IF;
  IF NEW.start_at IS NULL OR NEW.end_at IS NULL OR NEW.end_at <= NEW.start_at OR NEW.end_at > NEW.start_at + interval '7 days' THEN
   RAISE EXCEPTION 'End must be after start';
  END IF;
  IF coalesce(NEW.location_type, 'in_person') = 'in_person' AND length(trim(coalesce(NEW.location, ''))) = 0 THEN RAISE EXCEPTION 'Location is required'; END IF;
 END IF;
 IF NEW.title IS NULL OR length(trim(NEW.title))=0 OR length(NEW.title)>200 OR NEW.organizer IS NULL OR length(NEW.organizer)>200 THEN RAISE EXCEPTION 'Event title and organizer are required'; END IF;
 IF NEW.category IS NULL OR NEW.category NOT IN ('dialogue','dinner','interfaith','community','education','other','meeting') OR NEW.scope IS NULL OR NEW.scope NOT IN ('branch','region','national') OR NEW.audience IS NULL OR NEW.audience NOT IN ('public','members') OR NEW.status IS NULL OR NEW.status NOT IN ('draft','published','cancelled') OR NEW.all_day IS NULL OR NEW.location_type IS NULL OR NEW.location_type NOT IN ('in_person','online') THEN RAISE EXCEPTION 'Invalid event values'; END IF;
 -- All-day events are London calendar dates; timed events are instants. Never keep both.
 IF NEW.all_day THEN NEW.start_at:=NULL; NEW.end_at:=NULL; ELSE NEW.start_date:=NULL; NEW.end_date:=NULL; END IF;
 IF NEW.location_type='in_person' THEN NEW.online_url:=NULL; END IF;
 NEW.online_url := nullif(btrim(coalesce(NEW.online_url,'')),'');
 IF NEW.online_url IS NOT NULL AND (length(NEW.online_url)>2000 OR NEW.online_url !~ '^https://[^\s/?#]+\.[^\s]*$') THEN RAISE EXCEPTION 'Online meeting link must use https'; END IF;
 IF (NEW.start_at IS NOT NULL AND NOT isfinite(NEW.start_at)) OR (NEW.end_at IS NOT NULL AND (NOT isfinite(NEW.end_at) OR NEW.end_at<NEW.start_at)) OR (NEW.end_date IS NOT NULL AND NEW.start_date IS NOT NULL AND NEW.end_date<NEW.start_date) OR (NEW.end_date IS NOT NULL AND NEW.start_date IS NULL) OR (NEW.capacity IS NOT NULL AND NEW.capacity<1) THEN RAISE EXCEPTION 'Invalid event dates or capacity'; END IF;
 _times_changed := TG_OP='INSERT' OR ROW(NEW.all_day,NEW.start_at,NEW.end_at,NEW.start_date,NEW.end_date,NEW.status) IS DISTINCT FROM ROW(OLD.all_day,OLD.start_at,OLD.end_at,OLD.start_date,OLD.end_date,OLD.status);
 IF _times_changed AND NEW.start_at IS NOT NULL AND NEW.end_at IS NOT NULL AND NEW.end_at<=NEW.start_at THEN RAISE EXCEPTION 'Event end must be after start'; END IF;
 IF NEW.status='published' THEN
  IF NEW.all_day AND NEW.start_date IS NOT NULL THEN NEW.end_date:=coalesce(NEW.end_date,NEW.start_date); END IF;
  IF TG_OP='INSERT' OR ROW(NEW.title,NEW.all_day,NEW.start_at,NEW.end_at,NEW.start_date,NEW.end_date,NEW.location,NEW.location_type,NEW.online_url,NEW.category,NEW.scope,NEW.branch_id,NEW.region_id,NEW.status) IS DISTINCT FROM ROW(OLD.title,OLD.all_day,OLD.start_at,OLD.end_at,OLD.start_date,OLD.end_date,OLD.location,OLD.location_type,OLD.online_url,OLD.category,OLD.scope,OLD.branch_id,OLD.region_id,OLD.status) THEN
   IF (NEW.all_day AND NEW.start_date IS NULL) OR (NOT NEW.all_day AND (NEW.start_at IS NULL OR NEW.end_at IS NULL))
      OR (NEW.location_type='in_person' AND length(trim(NEW.location))=0) OR (NEW.location_type='online' AND NEW.online_url IS NULL) THEN RAISE EXCEPTION 'Required publish fields missing'; END IF;
  END IF;
  -- Meetings may be recorded after they took place; events may not be published in the past.
  IF NOT _meeting AND _times_changed AND ((NEW.all_day AND NEW.end_date<_today) OR (NOT NEW.all_day AND NEW.end_at<now())) THEN RAISE EXCEPTION 'Published event cannot end in the past'; END IF;
 END IF;
 IF (NEW.scope='branch' AND NOT EXISTS(SELECT 1 FROM branches WHERE id=NEW.branch_id AND region_id=NEW.region_id)) OR (NEW.scope='region' AND (NEW.branch_id IS NOT NULL OR NEW.region_id IS NULL))
    OR (NEW.scope='national' AND (NEW.branch_id IS NOT NULL OR NEW.region_id IS NOT NULL)) THEN RAISE EXCEPTION 'Invalid event scope'; END IF;
 IF TG_OP='INSERT' AND NEW.branch_id IS NOT NULL AND EXISTS(SELECT 1 FROM branches WHERE id=NEW.branch_id AND deleted_at IS NOT NULL) THEN RAISE EXCEPTION 'Branch not found'; END IF;
 NEW.title:=trim(NEW.title); NEW.organizer:=trim(NEW.organizer); NEW.updated_at:=now(); RETURN NEW;
END $function$;

-- ---------------------------------------------------------------------------------------------------------------
-- Visibility: a meeting's event follows the meeting. Public and upcoming counts never include meetings.

CREATE OR REPLACE FUNCTION public.can_view_event(_event uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND status = 'active' AND deleted_at IS NULL)
    AND public.session_ok()
    AND EXISTS (SELECT 1 FROM public.events e WHERE e.id = _event AND e.deleted_at IS NULL AND (
      -- A meeting's calendar entry: exactly the people who can see the meeting.
      (e.category = 'meeting' AND EXISTS (SELECT 1 FROM public.meetings m WHERE m.event_id = e.id AND public.can_view_meeting(m.id)))
      OR (e.category <> 'meeting' AND (
      -- Public events: every signed-in member and follower; a cancelled one only for people registered to it.
      (e.audience = 'public' AND (e.status = 'published' OR (e.status = 'cancelled'
        AND EXISTS (SELECT 1 FROM public.event_registrations r WHERE r.event_id = e.id AND r.user_id = auth.uid()))))
      OR (public.is_member(auth.uid()) AND (
        EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'regional_director' AND region_id = e.region_id)
        OR (e.scope = 'branch' AND e.branch_id = public.get_user_branch(auth.uid()) AND (e.status IN ('published', 'cancelled') OR public.has_role(auth.uid(), 'branch_manager')))
        OR (e.scope = 'region' AND e.status IN ('published', 'cancelled') AND EXISTS (SELECT 1 FROM public.profiles p JOIN public.branches b ON b.id = p.branch_id WHERE p.id = auth.uid() AND b.region_id = e.region_id))
        OR (e.scope = 'national' AND e.status IN ('published', 'cancelled'))))
      -- National Coordinators: every published or cancelled event, and national drafts.
      OR (public.is_nc() AND (e.status IN ('published', 'cancelled') OR e.scope = 'national'))))))
$function$;

CREATE OR REPLACE FUNCTION public.is_public_event(_e events)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT _e.audience = 'public' AND _e.category <> 'meeting' AND _e.deleted_at IS NULL AND NOT _e.series_template AND _e.status IN ('published', 'cancelled')
    AND NOT EXISTS (SELECT 1 FROM public.branches WHERE id = _e.branch_id AND deleted_at IS NOT NULL)
    AND NOT EXISTS (SELECT 1 FROM public.regions WHERE id = _e.region_id AND deleted_at IS NOT NULL)
$function$;

CREATE OR REPLACE FUNCTION public.event_is_upcoming(_e events)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT _e.deleted_at IS NULL AND NOT _e.series_template AND _e.category <> 'meeting' AND _e.status = 'published'
    AND coalesce(public.event_ends(_e) > now(), false)
$function$;

-- ---------------------------------------------------------------------------------------------------------------
-- Sync (internal). app.meeting_sync = 'on' while one side writes the other, so the mirror does not echo back.

CREATE FUNCTION public.meeting_sync_active() RETURNS boolean
LANGUAGE sql STABLE SET search_path = public AS $$ SELECT coalesce(current_setting('app.meeting_sync', true), '') = 'on' $$;

CREATE FUNCTION public.meeting_sync(_on boolean) RETURNS void
LANGUAGE sql VOLATILE SET search_path = public AS $$ SELECT set_config('app.meeting_sync', CASE WHEN _on THEN 'on' ELSE '' END, true) $$;

-- A new meeting without an event (create_meeting, meeting requests, recurring meetings): create its event first.
CREATE FUNCTION public.meetings_create_event() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _event uuid;
BEGIN
  IF NEW.event_id IS NOT NULL OR public.meeting_sync_active() THEN RETURN NEW; END IF;
  PERFORM public.meeting_sync(true);
  INSERT INTO public.events (title, description, location, start_at, end_at, organizer, category, capacity, scope, branch_id, region_id,
    status, created_by, all_day, location_type, online_url, registration_enabled, audience)
  VALUES (NEW.title, coalesce(NEW.description, ''), coalesce(NEW.location, ''), NEW.starts_at, NEW.ends_at, '', 'meeting', NULL, NEW.scope,
    NEW.branch_id, NEW.region_id, CASE WHEN NEW.status = 'cancelled' THEN 'cancelled' ELSE 'published' END, NEW.created_by, false,
    NEW.location_type, NEW.online_url, false, 'members')
  RETURNING id INTO _event;
  PERFORM public.meeting_sync(false);
  NEW.event_id := _event;
  RETURN NEW;
END $$;
CREATE TRIGGER meetings_create_event BEFORE INSERT ON public.meetings FOR EACH ROW EXECUTE FUNCTION public.meetings_create_event();

-- A meeting changed: copy the shared fields to its event.
CREATE FUNCTION public.meetings_to_event() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF public.meeting_sync_active() OR NEW.event_id IS NULL THEN RETURN NEW; END IF;
  IF ROW(NEW.title, NEW.description, NEW.starts_at, NEW.ends_at, NEW.location_type, NEW.location, NEW.online_url, NEW.status = 'cancelled')
     IS NOT DISTINCT FROM ROW(OLD.title, OLD.description, OLD.starts_at, OLD.ends_at, OLD.location_type, OLD.location, OLD.online_url, OLD.status = 'cancelled') THEN
    RETURN NEW;
  END IF;
  PERFORM public.meeting_sync(true);
  UPDATE public.events SET title = NEW.title, description = coalesce(NEW.description, ''), start_at = NEW.starts_at, end_at = NEW.ends_at,
    location_type = NEW.location_type, location = coalesce(NEW.location, ''), online_url = NEW.online_url,
    status = CASE WHEN NEW.status = 'cancelled' THEN 'cancelled' ELSE 'published' END
  WHERE id = NEW.event_id;
  PERFORM public.meeting_sync(false);
  RETURN NEW;
END $$;
CREATE TRIGGER meetings_to_event AFTER UPDATE ON public.meetings FOR EACH ROW EXECUTE FUNCTION public.meetings_to_event();

-- A new event with the category 'meeting' (create_event): create its meeting (no invitees yet).
CREATE FUNCTION public.events_create_meeting() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.category <> 'meeting' OR public.meeting_sync_active() THEN RETURN NULL; END IF;
  PERFORM public.meeting_sync(true);
  INSERT INTO public.meetings (scope, branch_id, region_id, title, description, starts_at, ends_at, location_type, location, online_url,
    status, created_by, event_id)
  VALUES (NEW.scope, NEW.branch_id, NEW.region_id, NEW.title, nullif(NEW.description, ''), NEW.start_at, NEW.end_at, NEW.location_type,
    nullif(btrim(NEW.location), ''), NEW.online_url, CASE WHEN NEW.status = 'cancelled' THEN 'cancelled' ELSE 'scheduled' END,
    NEW.created_by, NEW.id);
  PERFORM public.meeting_sync(false);
  RETURN NULL;
END $$;
CREATE TRIGGER events_create_meeting AFTER INSERT ON public.events FOR EACH ROW EXECUTE FUNCTION public.events_create_meeting();

-- Guard: a meeting's event keeps its category, and is deleted through its meeting (the Recycle Bin item is the meeting).
CREATE FUNCTION public.events_meeting_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF public.meeting_sync_active() THEN RETURN NEW; END IF;
  IF (OLD.category = 'meeting') <> (NEW.category = 'meeting') THEN RAISE EXCEPTION 'The category of a meeting cannot change'; END IF;
  IF NEW.category = 'meeting' AND NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL THEN RAISE EXCEPTION 'Delete the meeting instead'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER events_meeting_guard BEFORE UPDATE ON public.events FOR EACH ROW EXECUTE FUNCTION public.events_meeting_guard();

-- An event of a meeting changed (event form, cancel_event): copy the shared fields to the meeting and tell the invitees.
CREATE FUNCTION public.events_to_meeting() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _m public.meetings; _u uuid; _status text;
BEGIN
  IF NEW.category <> 'meeting' OR public.meeting_sync_active() THEN RETURN NULL; END IF;
  SELECT * INTO _m FROM public.meetings WHERE event_id = NEW.id FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  _status := CASE WHEN NEW.status = 'cancelled' THEN 'cancelled' WHEN _m.status = 'cancelled' THEN 'scheduled' ELSE _m.status END;
  IF ROW(NEW.title, nullif(NEW.description, ''), NEW.start_at, NEW.end_at, NEW.location_type, nullif(btrim(NEW.location), ''), NEW.online_url, _status)
     IS NOT DISTINCT FROM ROW(_m.title, _m.description, _m.starts_at, _m.ends_at, _m.location_type, _m.location, _m.online_url, _m.status) THEN
    RETURN NULL;
  END IF;
  PERFORM public.meeting_sync(true);
  UPDATE public.meetings SET title = NEW.title, description = nullif(NEW.description, ''), starts_at = NEW.start_at, ends_at = NEW.end_at,
    location_type = NEW.location_type, location = CASE WHEN NEW.location_type = 'online' THEN NULL ELSE nullif(btrim(NEW.location), '') END,
    online_url = NEW.online_url, status = _status
  WHERE id = _m.id;
  PERFORM public.meeting_sync(false);
  IF _status = 'cancelled' AND _m.status <> 'cancelled' THEN
    FOR _u IN SELECT user_id FROM public.meeting_invitees WHERE meeting_id = _m.id LOOP
      PERFORM public.notify(_u, 'meeting_cancelled', 'meeting', _m.id, NEW.title, '/meetings/' || _m.id, jsonb_build_object('starts_at', NEW.start_at));
    END LOOP;
  ELSIF ROW(NEW.start_at, NEW.end_at, NEW.location_type, coalesce(btrim(NEW.location), ''), coalesce(NEW.online_url, ''))
     IS DISTINCT FROM ROW(_m.starts_at, _m.ends_at, _m.location_type, coalesce(_m.location, ''), coalesce(_m.online_url, '')) THEN
    FOR _u IN SELECT user_id FROM public.meeting_invitees WHERE meeting_id = _m.id LOOP
      PERFORM public.notify(_u, 'meeting_changed', 'meeting', _m.id, NEW.title, '/meetings/' || _m.id, jsonb_build_object('starts_at', NEW.start_at));
    END LOOP;
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER events_to_meeting AFTER UPDATE ON public.events FOR EACH ROW EXECUTE FUNCTION public.events_to_meeting();

-- Meetings keep their files in meeting-files; their events have no event media.
CREATE FUNCTION public.event_media_not_for_meetings() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.events WHERE id = NEW.event_id AND category = 'meeting') THEN RAISE EXCEPTION 'Add files on the meeting page'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER event_media_not_for_meetings BEFORE INSERT ON public.event_media FOR EACH ROW EXECUTE FUNCTION public.event_media_not_for_meetings();

REVOKE ALL ON FUNCTION public.meeting_sync_active(), public.meeting_sync(boolean), public.meetings_create_event(), public.meetings_to_event(),
  public.events_create_meeting(), public.events_meeting_guard(), public.events_to_meeting(), public.event_media_not_for_meetings()
  FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- Existing meetings get their calendar entry.

DO $$
DECLARE _m public.meetings; _event uuid;
BEGIN
  PERFORM public.meeting_sync(true);
  FOR _m IN SELECT * FROM public.meetings WHERE event_id IS NULL LOOP
    INSERT INTO public.events (title, description, location, start_at, end_at, organizer, category, capacity, scope, branch_id, region_id,
      status, created_by, all_day, location_type, online_url, registration_enabled, audience)
    VALUES (_m.title, coalesce(_m.description, ''), coalesce(_m.location, ''), _m.starts_at, _m.ends_at, '', 'meeting', NULL, _m.scope,
      _m.branch_id, _m.region_id, CASE WHEN _m.status = 'cancelled' THEN 'cancelled' ELSE 'published' END, _m.created_by, false,
      _m.location_type, _m.online_url, false, 'members')
    RETURNING id INTO _event;
    UPDATE public.meetings SET event_id = _event WHERE id = _m.id;
  END LOOP;
  PERFORM public.meeting_sync(false);
END $$;

ALTER TABLE public.meetings ALTER COLUMN event_id SET NOT NULL;

-- ---------------------------------------------------------------------------------------------------------------
-- Purging a meeting (after its files) removes its calendar entry too.

CREATE OR REPLACE FUNCTION public.purge_meeting(_id uuid, _finalize boolean DEFAULT false) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _m public.meetings; _paths jsonb;
BEGIN
  SELECT * INTO _m FROM public.meetings WHERE id = _id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('paths', '[]'::jsonb, 'deleted', true); END IF;
  IF _m.deleted_at IS NULL OR (_m.purge_requested_at IS NULL AND _m.deleted_at >= now() - interval '30 days') THEN RAISE EXCEPTION 'Item cannot be purged'; END IF;
  SELECT coalesce(jsonb_agg(o.name ORDER BY o.name), '[]'::jsonb) INTO _paths FROM storage.objects o
    WHERE o.bucket_id = 'meeting-files' AND o.name LIKE _id::text || '/%';
  IF NOT _finalize THEN RETURN jsonb_build_object('paths', _paths, 'deleted', false); END IF;
  IF _paths <> '[]'::jsonb THEN RAISE EXCEPTION 'Meeting files still exist'; END IF;
  DELETE FROM public.meetings WHERE id = _id;
  DELETE FROM public.events WHERE id = _m.event_id AND category = 'meeting';
  IF _m.purge_requested_at IS NULL THEN
    INSERT INTO public.recycle_bin_audit_log (actor_id, item_type, item_id, action, branch_id, region_id)
      VALUES (NULL, 'meeting', _id, 'permanent_delete', _m.branch_id, _m.region_id);
  END IF;
  RETURN jsonb_build_object('paths', '[]'::jsonb, 'deleted', true);
END $$;
REVOKE ALL ON FUNCTION public.purge_meeting(uuid, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purge_meeting(uuid, boolean) TO service_role;

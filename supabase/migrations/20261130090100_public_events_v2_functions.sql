-- Public events v2: functions.
-- Rules:
-- * Guest registrations, subscribers, the email queue and the landing data are reached only by server code with the
--   service role (after Turnstile / honeypot / rate limits): every such function is REVOKEd from PUBLIC, anon and
--   authenticated. anon gets nothing new.
-- * Manager functions (attendees, gallery, past events, videos, announcements) are authenticated RPCs that start with
--   require_privacy_accepted() and check the event's management scope. National Coordinators see attendees as counts
--   only (get_event_attendees refuses, like get_event_registrations).
-- * Event emails (confirmation, update, reminder, cancellation, announcement) are only for public events (not
--   meetings, not past-event records), for members and confirmed guests alike. They are queued in email_outbox; the
--   server sender renders them at send time from the current data and sends through Brevo within the daily limit.

-- ─── Seats count places ──────────────────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.registration_counts(_event uuid)
RETURNS TABLE(seats integer, waitlisted integer, cancelled integer, attended integer, no_show integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(sum(places) FILTER (WHERE status IN ('registered', 'attended', 'no_show')), 0)::integer,
         count(*) FILTER (WHERE status = 'waitlisted')::integer,
         count(*) FILTER (WHERE status = 'cancelled')::integer,
         count(*) FILTER (WHERE status = 'attended')::integer,
         count(*) FILTER (WHERE status = 'no_show')::integer
  FROM public.event_registrations WHERE event_id = _event
$$;

-- FIFO: the first in the queue is promoted only when all of its places fit (nobody jumps the queue).
CREATE OR REPLACE FUNCTION public.promote_waitlist(_event uuid) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _e public.events; _n integer := 0; _r public.event_registrations;
BEGIN
  SELECT * INTO _e FROM public.events WHERE id = _event;
  IF NOT FOUND OR _e.deleted_at IS NOT NULL OR _e.status <> 'published' OR _e.series_template
     OR coalesce(public.event_starts(_e) <= now(), true) THEN RETURN 0; END IF;
  LOOP
    SELECT * INTO _r FROM public.event_registrations WHERE event_id = _event AND status = 'waitlisted'
      ORDER BY registered_at, id LIMIT 1 FOR UPDATE;
    EXIT WHEN NOT FOUND;
    EXIT WHEN _e.capacity IS NOT NULL AND (SELECT seats FROM public.registration_counts(_event)) + _r.places > _e.capacity;
    UPDATE public.event_registrations SET status = 'registered',
      notice = CASE WHEN guest THEN NULL ELSE 'promoted' END, notice_seen_at = NULL WHERE id = _r.id;
    _n := _n + 1;
  END LOOP;
  RETURN _n;
END $$;

-- ─── Event validation: past-event records, location "To be announced", cover image for public events ─────────────

CREATE OR REPLACE FUNCTION public.validate_event() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
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
 -- Past-event records are created only by create_past_event (or the service role: the import) and stay records.
 IF TG_OP = 'UPDATE' THEN
  NEW.past_record := OLD.past_record;
 ELSIF NEW.past_record AND current_user <> 'service_role' AND coalesce(current_setting('app.past_event', true), '') <> 'on' THEN
  RAISE EXCEPTION 'Not allowed';
 END IF;
 IF NEW.past_record THEN
  IF _meeting OR NEW.series_id IS NOT NULL OR NEW.series_template THEN RAISE EXCEPTION 'Invalid event values'; END IF;
  NEW.audience := 'public'; NEW.registration_enabled := false; NEW.capacity := NULL; NEW.all_day := true; NEW.location_tba := false;
  NEW.status := 'published'; NEW.max_places := 1;
  NEW.end_date := coalesce(NEW.end_date, NEW.start_date);
  IF NEW.start_date IS NULL OR NEW.start_date < date '1990-01-01' OR NEW.end_date > _today OR NEW.end_date < NEW.start_date THEN
   RAISE EXCEPTION 'Past event date must be in the past';
  END IF;
 END IF;
 IF _meeting OR NEW.location_type IS DISTINCT FROM 'in_person' THEN NEW.location_tba := false; END IF;
 IF NEW.location_tba THEN NEW.location := ''; END IF;
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
  IF TG_OP='INSERT' OR ROW(NEW.title,NEW.all_day,NEW.start_at,NEW.end_at,NEW.start_date,NEW.end_date,NEW.location,NEW.location_type,NEW.online_url,NEW.category,NEW.scope,NEW.branch_id,NEW.region_id,NEW.status,NEW.location_tba) IS DISTINCT FROM ROW(OLD.title,OLD.all_day,OLD.start_at,OLD.end_at,OLD.start_date,OLD.end_date,OLD.location,OLD.location_type,OLD.online_url,OLD.category,OLD.scope,OLD.branch_id,OLD.region_id,OLD.status,OLD.location_tba) THEN
   -- Date and time are always required; an in-person place may be "To be announced"; past records need no place.
   IF (NEW.all_day AND NEW.start_date IS NULL) OR (NOT NEW.all_day AND (NEW.start_at IS NULL OR NEW.end_at IS NULL))
      OR (NEW.location_type='in_person' AND length(trim(NEW.location))=0 AND NOT NEW.location_tba AND NOT NEW.past_record)
      OR (NEW.location_type='online' AND NEW.online_url IS NULL) THEN RAISE EXCEPTION 'Required publish fields missing'; END IF;
  END IF;
  -- Meetings may be recorded after they took place, and past-event records are; other events may not be published in the past.
  IF NOT _meeting AND NOT NEW.past_record AND _times_changed AND ((NEW.all_day AND NEW.end_date<_today) OR (NOT NEW.all_day AND NEW.end_at<now())) THEN RAISE EXCEPTION 'Published event cannot end in the past'; END IF;
  -- A public event needs a cover image (its first image, or the series' first image) to be published. Checked when it
  -- becomes published or public; direct service-role writes (seed data, the import) are trusted.
  IF NEW.audience='public' AND NOT _meeting AND NOT NEW.past_record AND NOT NEW.series_template AND current_user <> 'service_role'
     AND (TG_OP='INSERT' OR OLD.status IS DISTINCT FROM 'published' OR OLD.audience IS DISTINCT FROM 'public')
     AND public.public_event_image_path(NEW) IS NULL THEN RAISE EXCEPTION 'Public events need a cover image'; END IF;
 END IF;
 IF (NEW.scope='branch' AND NOT EXISTS(SELECT 1 FROM branches WHERE id=NEW.branch_id AND region_id=NEW.region_id)) OR (NEW.scope='region' AND (NEW.branch_id IS NOT NULL OR NEW.region_id IS NULL))
    OR (NEW.scope='national' AND (NEW.branch_id IS NOT NULL OR NEW.region_id IS NOT NULL)) THEN RAISE EXCEPTION 'Invalid event scope'; END IF;
 IF TG_OP='INSERT' AND NEW.branch_id IS NOT NULL AND EXISTS(SELECT 1 FROM branches WHERE id=NEW.branch_id AND deleted_at IS NOT NULL) THEN RAISE EXCEPTION 'Branch not found'; END IF;
 NEW.title:=trim(NEW.title); NEW.organizer:=trim(NEW.organizer); NEW.updated_at:=now(); RETURN NEW;
END $$;

-- iCalendar SEQUENCE: +1 whenever a published event's time or place changes or it is cancelled (after validation).
CREATE FUNCTION public.events_ics_sequence() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN NEW.ics_sequence := 0; RETURN NEW; END IF;
  NEW.ics_sequence := OLD.ics_sequence;
  IF OLD.status = 'published' AND (NEW.status = 'cancelled' OR (OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL)
     OR ROW(NEW.all_day, NEW.start_at, NEW.end_at, NEW.start_date, NEW.end_date, NEW.location, NEW.location_type, NEW.online_url, NEW.location_tba)
        IS DISTINCT FROM ROW(OLD.all_day, OLD.start_at, OLD.end_at, OLD.start_date, OLD.end_date, OLD.location, OLD.location_type, OLD.online_url, OLD.location_tba)) THEN
    NEW.ics_sequence := OLD.ics_sequence + 1;
  END IF;
  RETURN NEW;
END $$;
-- BEFORE triggers run in name order: after validate_event.
CREATE TRIGGER zz_events_ics_sequence BEFORE INSERT OR UPDATE ON public.events FOR EACH ROW EXECUTE FUNCTION public.events_ics_sequence();

-- create_event / update_event also take location_tba and max_places (places one registration may book).
CREATE OR REPLACE FUNCTION public.create_event(_data jsonb) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _id uuid; _branch uuid := nullif(_data->>'branch_id', '')::uuid; _region uuid; _scope text := _data->>'scope';
BEGIN
  PERFORM public.require_privacy_accepted();
  PERFORM id FROM profiles WHERE id = auth.uid() FOR UPDATE;
  IF _data->>'status' = 'draft' AND _branch IS NULL AND _scope IS DISTINCT FROM 'region' AND _scope IS DISTINCT FROM 'national' THEN
    IF public.is_nc() THEN _scope := 'national'; ELSIF public.has_role(auth.uid(), 'regional_director') THEN _scope := 'region'; ELSE _branch := public.get_user_branch(auth.uid()); _scope := 'branch'; END IF;
  END IF;
  IF _scope = 'national' THEN _branch := NULL; _region := NULL; ELSIF _scope = 'branch' THEN SELECT region_id INTO _region FROM branches WHERE id = _branch; ELSE SELECT region_id INTO _region FROM user_roles WHERE user_id = auth.uid() AND role = 'regional_director' LIMIT 1; END IF;
  IF NOT public.can_manage_event_scope(_scope, _branch, _region) THEN RAISE EXCEPTION 'Not allowed'; END IF;
  IF _data->>'status' IS NULL OR _data->>'status' NOT IN ('draft', 'published') THEN RAISE EXCEPTION 'Invalid event values'; END IF;
  INSERT INTO events (title, description, location, start_at, end_at, all_day, start_date, end_date, location_type, online_url, organizer, category, capacity,
    registration_enabled, audience, scope, branch_id, region_id, status, created_by, location_tba, max_places)
  VALUES (_data->>'title', coalesce(_data->>'description', ''), coalesce(_data->>'location', ''), nullif(_data->>'start_at', '')::timestamptz,
    nullif(_data->>'end_at', '')::timestamptz, coalesce((_data->>'all_day')::boolean, false), nullif(_data->>'start_date', '')::date,
    nullif(_data->>'end_date', '')::date, coalesce(nullif(_data->>'location_type', ''), 'in_person'), nullif(_data->>'online_url', ''),
    coalesce(nullif(trim(_data->>'organizer'), ''), 'Dialogue Society'), coalesce(_data->>'category', 'dialogue'), nullif(_data->>'capacity', '')::integer,
    coalesce((_data->>'registration_enabled')::boolean, true), coalesce(nullif(_data->>'audience', ''), 'members'), _scope, _branch, _region, _data->>'status', auth.uid(),
    coalesce((_data->>'location_tba')::boolean, false), coalesce(nullif(_data->>'max_places', '')::integer, 1))
  RETURNING id INTO _id;
  RETURN _id;
END $$;

CREATE OR REPLACE FUNCTION public.update_event(_event uuid, _data jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _branch uuid := nullif(_data->>'branch_id', '')::uuid; _region uuid; _scope text := _data->>'scope'; _old_status text; _old_reg boolean; _past boolean;
BEGIN
  PERFORM public.require_privacy_accepted();
  PERFORM id FROM public.profiles WHERE id = auth.uid() FOR UPDATE;
  SELECT status, registration_enabled, past_record INTO _old_status, _old_reg, _past FROM public.events WHERE id = _event FOR UPDATE;
  IF NOT FOUND OR NOT public.can_manage_event(_event) THEN RAISE EXCEPTION 'Not allowed'; END IF;
  IF _past THEN RAISE EXCEPTION 'Past events are edited from the past event form'; END IF;
  IF _scope = 'national' THEN _branch := NULL; _region := NULL; ELSIF _scope = 'branch' THEN SELECT region_id INTO _region FROM public.branches WHERE id = _branch; ELSE SELECT region_id INTO _region FROM public.user_roles WHERE user_id = auth.uid() AND role = 'regional_director' LIMIT 1; END IF;
  IF NOT public.can_manage_event_scope(_scope, _branch, _region) THEN RAISE EXCEPTION 'Not allowed'; END IF;
  IF _data->>'status' IS NULL OR _data->>'status' NOT IN ('draft', 'published', 'cancelled') OR (_old_status = 'cancelled' AND _data->>'status' <> 'cancelled') OR (_old_status <> 'cancelled' AND _data->>'status' = 'cancelled') THEN RAISE EXCEPTION 'Invalid event values'; END IF;
  UPDATE public.events SET title = _data->>'title', description = coalesce(_data->>'description', ''), location = coalesce(_data->>'location', ''),
    start_at = nullif(_data->>'start_at', '')::timestamptz, end_at = nullif(_data->>'end_at', '')::timestamptz, all_day = coalesce((_data->>'all_day')::boolean, false),
    start_date = nullif(_data->>'start_date', '')::date, end_date = nullif(_data->>'end_date', '')::date, location_type = coalesce(nullif(_data->>'location_type', ''), 'in_person'),
    online_url = nullif(_data->>'online_url', ''), organizer = coalesce(nullif(trim(_data->>'organizer'), ''), 'Dialogue Society'), category = _data->>'category',
    capacity = nullif(_data->>'capacity', '')::integer, registration_enabled = coalesce((_data->>'registration_enabled')::boolean, _old_reg), audience = coalesce(nullif(_data->>'audience', ''), audience),
    scope = _scope, branch_id = _branch, region_id = _region, status = _data->>'status',
    location_tba = coalesce((_data->>'location_tba')::boolean, location_tba), max_places = coalesce(nullif(_data->>'max_places', '')::integer, max_places)
  WHERE id = _event;
END $$;

-- ─── Public JSON: places left, TBA, places per registration ──────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.public_event_json(_e public.events) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object(
    'id', _e.id, 'title', _e.title, 'description', _e.description, 'status', _e.status, 'scope', _e.scope,
    'all_day', _e.all_day, 'start_at', _e.start_at, 'end_at', _e.end_at, 'start_date', _e.start_date, 'end_date', _e.end_date,
    'branch_id', _e.branch_id, 'branch', b.name, 'region_id', _e.region_id, 'region', r.name, 'category', _e.category,
    'location', CASE WHEN _e.location_type = 'in_person' AND NOT _e.location_tba THEN nullif(btrim(_e.location), '') END,
    'location_tba', _e.location_type = 'in_person' AND _e.location_tba,
    'is_online', _e.location_type = 'online',
    'organizer', CASE WHEN _e.is_external THEN _e.organizer END,
    'registration', public.public_registration_state(_e),
    'spots_left', CASE WHEN _e.capacity IS NULL OR public.public_registration_state(_e) = 'closed' THEN NULL
      ELSE greatest(_e.capacity - (SELECT seats FROM public.registration_counts(_e.id)), 0) END,
    'max_places', _e.max_places,
    'past_record', _e.past_record,
    'has_image', public.public_event_image_path(_e) IS NOT NULL)
  FROM (SELECT 1) one LEFT JOIN public.branches b ON b.id = _e.branch_id LEFT JOIN public.regions r ON r.id = _e.region_id
$$;

-- ─── Email queue ─────────────────────────────────────────────────────────────────────────────────────────────────

CREATE FUNCTION public.email_daily_limit() RETURNS integer LANGUAGE sql IMMUTABLE SET search_path = public AS $$ SELECT 300 $$;

-- 1 transactional, 2 reminders, 3 announcements.
CREATE FUNCTION public.email_priority(_template text) RETURNS smallint
LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT (CASE WHEN _template IN ('event_reminder', 'task_reminder') THEN 2 WHEN _template = 'event_announcement' THEN 3 ELSE 1 END)::smallint
$$;

CREATE FUNCTION public.email_outbox_defaults() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.priority := public.email_priority(NEW.template);
  RETURN NEW;
END $$;
CREATE TRIGGER email_outbox_defaults BEFORE INSERT ON public.email_outbox FOR EACH ROW EXECUTE FUNCTION public.email_outbox_defaults();

-- Internal: queue one email. Coalescing templates keep one pending row per recipient (registration / subscriber):
-- the content is rendered at send time, so a newer change simply rides on the pending row.
CREATE FUNCTION public.enqueue_email(_template text, _registration uuid, _subscriber uuid, _event uuid, _payload jsonb DEFAULT '{}'::jsonb,
  _dedupe text DEFAULT NULL) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _id uuid;
BEGIN
  IF _template IN ('guest_confirm', 'registration_confirmed', 'event_update', 'subscriber_confirm') THEN
    SELECT id INTO _id FROM public.email_outbox
    WHERE status = 'pending' AND template = _template
      AND registration_id IS NOT DISTINCT FROM _registration AND subscriber_id IS NOT DISTINCT FROM _subscriber
    ORDER BY created_at LIMIT 1;
    IF _id IS NOT NULL THEN
      UPDATE public.email_outbox SET payload = coalesce(_payload, '{}'::jsonb) WHERE id = _id;
      RETURN _id;
    END IF;
  END IF;
  INSERT INTO public.email_outbox (user_id, registration_id, subscriber_id, event_id, template, payload, dedupe_key)
  VALUES ((SELECT user_id FROM public.event_registrations WHERE id = _registration), _registration, _subscriber, _event, _template,
    coalesce(_payload, '{}'::jsonb), _dedupe)
  ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING
  RETURNING id INTO _id;
  RETURN _id;
END $$;

-- Whether an event sends attendee emails.
CREATE FUNCTION public.event_sends_emails(_e public.events) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT _e.audience = 'public' AND _e.category <> 'meeting' AND NOT _e.past_record AND NOT _e.series_template
$$;

-- Whether a registration gets event emails: a member, or a guest who confirmed their email.
CREATE FUNCTION public.registration_reachable(_r public.event_registrations) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE WHEN _r.guest THEN EXISTS (SELECT 1 FROM public.event_guests g WHERE g.registration_id = _r.id AND g.confirmed_at IS NOT NULL)
    ELSE _r.user_id IS NOT NULL END
$$;

-- Registration emails: confirmation (registered or waitlisted, also after a promotion) and the person's own cancellation.
CREATE FUNCTION public.event_registrations_emails() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _e public.events; _old text := CASE WHEN TG_OP = 'UPDATE' THEN OLD.status END;
BEGIN
  IF _old IS NOT DISTINCT FROM NEW.status THEN RETURN NULL; END IF;
  SELECT * INTO _e FROM public.events WHERE id = NEW.event_id;
  IF NOT FOUND OR NOT public.event_sends_emails(_e) OR NOT public.registration_reachable(NEW) THEN RETURN NULL; END IF;
  IF NEW.status IN ('registered', 'waitlisted') AND (_old IS NULL OR _old IN ('pending', 'cancelled', 'waitlisted')) THEN
    PERFORM public.enqueue_email('registration_confirmed', NEW.id, NULL, NEW.event_id,
      jsonb_build_object('status', NEW.status, 'promoted', _old = 'waitlisted'));
  ELSIF NEW.status = 'cancelled' AND _old IN ('registered', 'waitlisted') THEN
    -- A confirmation not sent yet is no longer true.
    UPDATE public.email_outbox SET status = 'cancelled' WHERE registration_id = NEW.id AND status = 'pending'
      AND template IN ('registration_confirmed', 'event_update', 'event_reminder');
    PERFORM public.enqueue_email('registration_cancelled', NEW.id, NULL, NEW.event_id, '{}'::jsonb);
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER event_registrations_emails AFTER INSERT OR UPDATE OF status ON public.event_registrations
  FOR EACH ROW EXECUTE FUNCTION public.event_registrations_emails();

-- Event emails: cancellation (cancelled or removed) and time/place updates (also "To be announced" -> a real place).
CREATE FUNCTION public.events_public_emails() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _r public.event_registrations;
BEGIN
  IF NOT public.event_sends_emails(NEW) OR OLD.status <> 'published' THEN RETURN NULL; END IF;
  IF NEW.status = 'cancelled' OR (OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL) THEN
    FOR _r IN SELECT * FROM public.event_registrations WHERE event_id = NEW.id AND status IN ('registered', 'waitlisted') ORDER BY id LOOP
      CONTINUE WHEN NOT public.registration_reachable(_r);
      UPDATE public.email_outbox SET status = 'cancelled' WHERE registration_id = _r.id AND status = 'pending'
        AND template IN ('registration_confirmed', 'event_update', 'event_reminder');
      PERFORM public.enqueue_email('event_cancelled', _r.id, NULL, NEW.id, '{}'::jsonb, 'event_cancelled:' || _r.id || ':' || NEW.ics_sequence);
    END LOOP;
    RETURN NULL;
  END IF;
  IF NEW.status = 'published' AND NEW.deleted_at IS NULL AND NEW.ics_sequence > OLD.ics_sequence THEN
    FOR _r IN SELECT * FROM public.event_registrations WHERE event_id = NEW.id AND status IN ('registered', 'waitlisted') ORDER BY id LOOP
      CONTINUE WHEN NOT public.registration_reachable(_r);
      PERFORM public.enqueue_email('event_update', _r.id, NULL, NEW.id,
        jsonb_build_object('location_announced', OLD.location_tba AND NOT NEW.location_tba));
    END LOOP;
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER events_public_emails AFTER UPDATE ON public.events FOR EACH ROW EXECUTE FUNCTION public.events_public_emails();

-- Reminders 2 days (London dates) before the start, for registered (not waitlisted) members and confirmed guests.
-- Idempotent (one per registration and start date).
CREATE FUNCTION public.enqueue_event_reminders() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _n integer := 0; _x record; _day date := (now() AT TIME ZONE 'Europe/London')::date + 2;
BEGIN
  FOR _x IN
    SELECT r.id, r.event_id, (public.event_starts(e) AT TIME ZONE 'Europe/London')::date AS start_day
    FROM public.events e JOIN public.event_registrations r ON r.event_id = e.id
    WHERE public.event_sends_emails(e) AND e.status = 'published' AND e.deleted_at IS NULL
      AND (public.event_starts(e) AT TIME ZONE 'Europe/London')::date = _day AND public.event_starts(e) > now()
      AND r.status = 'registered' AND public.registration_reachable(r)
    ORDER BY r.id
  LOOP
    IF public.enqueue_email('event_reminder', _x.id, NULL, _x.event_id, '{}'::jsonb, 'event_reminder:' || _x.id || ':' || _x.start_day) IS NOT NULL THEN
      _n := _n + 1;
    END IF;
  END LOOP;
  RETURN _n;
END $$;

-- The sender claims a batch: rows by priority (transactional, reminders, announcements), oldest first, never more than
-- what is left of today's limit (London day; sent and in-flight rows count). Each row comes with its recipient, or a
-- skip reason when it no longer applies (the sender then marks it skipped). Stale claims (crashed sender) return.
CREATE FUNCTION public.claim_email_batch(p_max integer DEFAULT 20, p_max_priority integer DEFAULT 3)
RETURNS TABLE (id uuid, template text, priority smallint, payload jsonb, attempts integer, user_id uuid, registration_id uuid,
  subscriber_id uuid, event_id uuid, notification_id uuid, to_email text, to_name text, skip_reason text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
#variable_conflict use_column
DECLARE _day_start timestamptz := ((now() AT TIME ZONE 'Europe/London')::date)::timestamp AT TIME ZONE 'Europe/London'; _room integer;
  _o public.email_outbox; _email text; _name text; _skip text; _r public.event_registrations; _e public.events; _s public.subscribers;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('email_outbox_claim'));
  UPDATE public.email_outbox o SET status = 'pending', claimed_at = NULL WHERE o.status = 'sending' AND o.claimed_at < now() - interval '15 minutes';
  SELECT public.email_daily_limit() - count(*) INTO _room FROM public.email_outbox o
  WHERE (o.status = 'sent' AND o.sent_at >= _day_start) OR o.status = 'sending';
  _room := least(greatest(_room, 0), greatest(coalesce(p_max, 20), 0), 100);
  IF _room = 0 THEN RETURN; END IF;
  FOR _o IN
    WITH picked AS (
      SELECT o.id FROM public.email_outbox o
      WHERE o.status = 'pending' AND o.priority <= coalesce(p_max_priority, 3) AND coalesce(o.not_before, '-infinity') <= now()
      ORDER BY o.priority, o.created_at, o.id LIMIT _room FOR UPDATE SKIP LOCKED)
    UPDATE public.email_outbox o SET status = 'sending', claimed_at = now(), attempts = o.attempts + 1
    FROM picked WHERE o.id = picked.id RETURNING o.*
  LOOP
    _email := NULL; _name := NULL; _skip := NULL; _r := NULL; _e := NULL; _s := NULL;
    IF _o.registration_id IS NOT NULL THEN
      SELECT * INTO _r FROM public.event_registrations r WHERE r.id = _o.registration_id;
      SELECT * INTO _e FROM public.events e WHERE e.id = _r.event_id;
      IF _r.guest THEN
        SELECT g.email, g.full_name INTO _email, _name FROM public.event_guests g WHERE g.registration_id = _r.id;
      ELSE
        SELECT p.email, p.full_name INTO _email, _name FROM public.profiles p
        WHERE p.id = _r.user_id AND p.status = 'active' AND p.deleted_at IS NULL;
      END IF;
      _skip := CASE
        WHEN _email IS NULL THEN 'no_recipient'
        WHEN _o.template = 'guest_confirm' AND _r.status <> 'pending' THEN 'not_pending'
        WHEN _o.template IN ('registration_confirmed', 'event_update') AND _r.status NOT IN ('registered', 'waitlisted') THEN 'not_registered'
        WHEN _o.template = 'event_reminder' AND (_r.status <> 'registered' OR _e.status <> 'published' OR _e.deleted_at IS NOT NULL
          OR coalesce(public.event_starts(_e) <= now(), true)) THEN 'not_due'
        WHEN _o.template IN ('registration_confirmed', 'event_update', 'event_reminder', 'guest_confirm')
          AND (_e.deleted_at IS NOT NULL OR _e.status <> 'published') THEN 'event_closed' END;
    ELSIF _o.subscriber_id IS NOT NULL THEN
      SELECT * INTO _s FROM public.subscribers s WHERE s.id = _o.subscriber_id;
      _email := _s.email; _name := _s.full_name;
      IF _o.template = 'event_announcement' THEN SELECT * INTO _e FROM public.events e WHERE e.id = _o.event_id; END IF;
      _skip := CASE
        WHEN _email IS NULL OR _s.unsubscribed_at IS NOT NULL THEN 'unsubscribed'
        WHEN _o.template = 'subscriber_confirm' AND _s.confirmed_at IS NOT NULL THEN 'already_confirmed'
        WHEN _o.template = 'event_announcement' AND _s.confirmed_at IS NULL THEN 'not_confirmed'
        WHEN _o.template = 'event_announcement' AND (_e.id IS NULL OR NOT public.is_public_event(_e) OR _e.status <> 'published'
          OR coalesce(public.event_starts(_e) <= now(), true)) THEN 'event_closed' END;
    ELSIF _o.user_id IS NOT NULL THEN
      SELECT p.email, p.full_name INTO _email, _name FROM public.profiles p
      WHERE p.id = _o.user_id AND p.status = 'active' AND p.deleted_at IS NULL;
      _skip := CASE WHEN _email IS NULL THEN 'no_recipient' END;
    ELSE
      _email := _o.to_email;
      _skip := CASE WHEN _email IS NULL THEN 'no_recipient' END;
    END IF;
    id := _o.id; template := _o.template; priority := _o.priority; payload := _o.payload; attempts := _o.attempts;
    user_id := _o.user_id; registration_id := _o.registration_id; subscriber_id := _o.subscriber_id; event_id := _o.event_id;
    notification_id := _o.notification_id; to_email := _email; to_name := _name; skip_reason := _skip;
    RETURN NEXT;
  END LOOP;
END $$;

-- The sender's result for a claimed row: 'sent', 'skipped' or 'retry' (an error; after 5 attempts the row fails).
CREATE FUNCTION public.finish_email(p_id uuid, p_result text, p_error text DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF p_result NOT IN ('sent', 'skipped', 'retry') THEN RAISE EXCEPTION 'Invalid email result'; END IF;
  UPDATE public.email_outbox SET
    status = CASE p_result WHEN 'sent' THEN 'sent' WHEN 'skipped' THEN 'skipped' ELSE CASE WHEN attempts >= 5 THEN 'failed' ELSE 'pending' END END,
    sent_at = CASE WHEN p_result = 'sent' THEN now() ELSE sent_at END,
    claimed_at = NULL,
    not_before = CASE WHEN p_result = 'retry' THEN now() + attempts * interval '10 minutes' ELSE not_before END,
    last_error = CASE WHEN p_result = 'sent' THEN NULL ELSE left(p_error, 500) END
  WHERE id = p_id AND status = 'sending';
END $$;

-- What the sender needs to render an event email (server only; includes the full event row).
CREATE FUNCTION public.email_event_context(p_registration uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object('registration', jsonb_build_object('id', r.id, 'status', r.status, 'places', r.places, 'guest', r.guest,
      'waitlist_position', public.registration_position(r)),
    'event', to_jsonb(e) - 'created_by' - 'deleted_by', 'branch', b.name, 'region', rg.name)
  FROM public.event_registrations r JOIN public.events e ON e.id = r.event_id
  LEFT JOIN public.branches b ON b.id = e.branch_id LEFT JOIN public.regions rg ON rg.id = e.region_id
  WHERE r.id = p_registration
$$;

-- ─── Signed-out forms: rate limits ───────────────────────────────────────────────────────────────────────────────

-- One hit on a bucket (e.g. "guest:ip:<hash>"); false once p_max hits are reached in the current window.
CREATE FUNCTION public.public_rate_hit(p_bucket text, p_window_seconds integer, p_max integer) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _w timestamptz := to_timestamp(floor(extract(epoch FROM now()) / p_window_seconds) * p_window_seconds); _hits integer;
BEGIN
  IF p_window_seconds NOT BETWEEN 1 AND 86400 OR p_max < 1 THEN RAISE EXCEPTION 'Invalid rate limit'; END IF;
  INSERT INTO public.public_rate_limits AS l (bucket, window_start, hits) VALUES (left(p_bucket, 200), _w, 1)
  ON CONFLICT (bucket, window_start) DO UPDATE SET hits = l.hits + 1 RETURNING hits INTO _hits;
  RETURN _hits <= p_max;
END $$;

-- ─── Guest registration (server only) ────────────────────────────────────────────────────────────────────────────

CREATE FUNCTION public.guest_event_open(_e public.events) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.is_public_event(_e) AND NOT _e.past_record AND _e.status = 'published' AND _e.registration_enabled
    AND coalesce(public.event_ends(_e) > now(), false)
    AND NOT EXISTS (SELECT 1 FROM public.event_deletion_jobs WHERE event_id = _e.id)
$$;

-- A guest asks to register: the registration waits ('pending', no seat) until the email link is opened. The answer is
-- the same whatever the state, so the form never reveals who is registered. Repeated requests for one address are
-- throttled (at most 3 emails an hour for that address).
CREATE FUNCTION public.guest_register(p_event uuid, p_name text, p_email text, p_phone text, p_places integer, p_keep_informed boolean)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _e public.events; _email text := lower(btrim(coalesce(p_email, ''))); _name text := btrim(coalesce(p_name, ''));
  _phone text := nullif(btrim(coalesce(p_phone, '')), ''); _r public.event_registrations; _id uuid;
BEGIN
  IF char_length(_name) NOT BETWEEN 1 AND 120 OR char_length(_email) > 254 OR _email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'
     OR char_length(coalesce(_phone, '')) > 40 THEN RAISE EXCEPTION 'Invalid guest details'; END IF;
  SELECT * INTO _e FROM public.events WHERE id = p_event FOR UPDATE;
  IF NOT FOUND OR NOT public.guest_event_open(_e) THEN RAISE EXCEPTION 'Registration is closed'; END IF;
  IF coalesce(p_places, 0) NOT BETWEEN 1 AND _e.max_places THEN RAISE EXCEPTION 'Invalid number of places'; END IF;
  IF (SELECT count(*) FROM public.email_outbox o JOIN public.event_guests g ON g.registration_id = o.registration_id
      WHERE g.email = _email AND o.created_at > now() - interval '1 hour') >= 3 THEN
    RETURN jsonb_build_object('registration_id', NULL, 'action', 'throttled');
  END IF;
  SELECT r.* INTO _r FROM public.event_registrations r JOIN public.event_guests g ON g.registration_id = r.id
  WHERE g.event_id = p_event AND g.email = _email FOR UPDATE OF r;
  IF FOUND AND _r.status IN ('registered', 'waitlisted', 'attended', 'no_show') THEN
    -- Already registered: send the confirmation (with the cancel link) again.
    IF _r.status IN ('registered', 'waitlisted') THEN
      PERFORM public.enqueue_email('registration_confirmed', _r.id, NULL, p_event, jsonb_build_object('status', _r.status, 'resent', true));
    END IF;
    RETURN jsonb_build_object('registration_id', _r.id, 'action', 'already');
  ELSIF FOUND THEN
    UPDATE public.event_registrations SET status = 'pending', places = p_places, registered_at = clock_timestamp(), cancelled_at = NULL,
      attendance_marked_by = NULL, attendance_marked_at = NULL WHERE id = _r.id;
    UPDATE public.event_guests SET full_name = _name, phone = _phone, keep_informed = coalesce(p_keep_informed, false), confirmed_at = NULL,
      updated_at = now() WHERE registration_id = _r.id;
    _id := _r.id;
  ELSE
    INSERT INTO public.event_registrations (event_id, user_id, status, show_name, places, guest)
    VALUES (p_event, NULL, 'pending', false, p_places, true) RETURNING id INTO _id;
    INSERT INTO public.event_guests (registration_id, event_id, full_name, email, phone, keep_informed)
    VALUES (_id, p_event, _name, _email, _phone, coalesce(p_keep_informed, false));
  END IF;
  PERFORM public.enqueue_email('guest_confirm', _id, NULL, p_event, '{}'::jsonb);
  RETURN jsonb_build_object('registration_id', _id, 'action', 'confirm_sent');
END $$;

-- The email link: the seat is taken now (registered, or the waitlist when full). Links of pending registrations work
-- for 48 hours. "Keep me informed" makes the guest a confirmed subscriber (the link is the double opt-in).
CREATE FUNCTION public.guest_confirm(p_registration uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _event uuid; _e public.events; _r public.event_registrations; _g public.event_guests; _status text;
BEGIN
  SELECT event_id INTO _event FROM public.event_registrations WHERE id = p_registration AND guest;
  IF NOT FOUND THEN RAISE EXCEPTION 'Link is no longer valid'; END IF;
  SELECT * INTO _e FROM public.events WHERE id = _event FOR UPDATE;
  SELECT * INTO _r FROM public.event_registrations WHERE id = p_registration FOR UPDATE;
  SELECT * INTO _g FROM public.event_guests WHERE registration_id = p_registration FOR UPDATE;
  IF _r.status <> 'pending' THEN
    RETURN public.registration_result(_r) || jsonb_build_object('event_id', _event);
  END IF;
  IF _r.registered_at < now() - interval '48 hours' THEN RAISE EXCEPTION 'Link is no longer valid'; END IF;
  IF NOT public.guest_event_open(_e) THEN RAISE EXCEPTION 'Registration is closed'; END IF;
  UPDATE public.event_guests SET confirmed_at = now(), updated_at = now() WHERE registration_id = p_registration;
  _status := CASE WHEN _e.capacity IS NULL OR (SELECT seats FROM public.registration_counts(_event)) + _r.places <= _e.capacity
    THEN 'registered' ELSE 'waitlisted' END;
  UPDATE public.event_registrations SET status = _status, registered_at = clock_timestamp() WHERE id = p_registration RETURNING * INTO _r;
  IF _g.keep_informed THEN
    INSERT INTO public.subscribers AS s (email, full_name, branch_id, consent_at, source, confirmed_at)
    VALUES (_g.email, _g.full_name, _e.branch_id, _g.updated_at, 'event_registration', now())
    ON CONFLICT (email) DO UPDATE SET confirmed_at = coalesce(s.confirmed_at, now()), unsubscribed_at = NULL,
      consent_at = CASE WHEN s.unsubscribed_at IS NOT NULL OR s.confirmed_at IS NULL THEN excluded.consent_at ELSE s.consent_at END,
      full_name = coalesce(s.full_name, excluded.full_name), updated_at = now();
  END IF;
  RETURN public.registration_result(_r) || jsonb_build_object('event_id', _event);
END $$;

-- The cancel link (before the start). A freed seat goes to the waitlist.
CREATE FUNCTION public.guest_cancel(p_registration uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _event uuid; _e public.events; _r public.event_registrations; _was text;
BEGIN
  SELECT event_id INTO _event FROM public.event_registrations WHERE id = p_registration AND guest;
  IF NOT FOUND THEN RAISE EXCEPTION 'Link is no longer valid'; END IF;
  SELECT * INTO _e FROM public.events WHERE id = _event FOR UPDATE;
  SELECT * INTO _r FROM public.event_registrations WHERE id = p_registration FOR UPDATE;
  IF _r.status = 'cancelled' THEN RETURN public.registration_result(_r) || jsonb_build_object('event_id', _event); END IF;
  IF _r.status NOT IN ('pending', 'registered', 'waitlisted') OR coalesce(public.event_starts(_e) <= now(), false) THEN
    RAISE EXCEPTION 'Event has started';
  END IF;
  _was := _r.status;
  UPDATE public.event_registrations SET status = 'cancelled', cancelled_at = now() WHERE id = p_registration RETURNING * INTO _r;
  IF _was = 'registered' THEN PERFORM public.promote_waitlist(_event); END IF;
  RETURN public.registration_result(_r) || jsonb_build_object('event_id', _event);
END $$;

-- The confirm / cancel pages: the registration's state and the event's public fields.
CREATE FUNCTION public.guest_registration_view(p_registration uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object('registration_id', r.id, 'status', r.status, 'places', r.places, 'full_name', g.full_name,
    'waitlist_position', public.registration_position(r),
    'event', CASE WHEN public.is_public_event(e) THEN public.public_event_json(e) END)
  FROM public.event_registrations r JOIN public.event_guests g ON g.registration_id = r.id JOIN public.events e ON e.id = r.event_id
  WHERE r.id = p_registration AND r.guest
$$;

-- ─── Subscribers (server only) ───────────────────────────────────────────────────────────────────────────────────

-- "Get event updates": a confirmation email is always required (double opt-in). The answer never reveals whether the
-- address is already subscribed. Re-sending is throttled (10 minutes).
CREATE FUNCTION public.subscriber_signup(p_email text, p_name text, p_branch uuid, p_source text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _email text := lower(btrim(coalesce(p_email, ''))); _name text := nullif(btrim(coalesce(p_name, '')), ''); _s public.subscribers;
BEGIN
  IF char_length(_email) > 254 OR _email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' OR char_length(coalesce(_name, '')) > 120
     OR p_source NOT IN ('landing', 'event_registration') THEN RAISE EXCEPTION 'Invalid subscriber details'; END IF;
  IF p_branch IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.branches WHERE id = p_branch AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'Branch not found';
  END IF;
  SELECT * INTO _s FROM public.subscribers WHERE email = _email FOR UPDATE;
  IF FOUND AND _s.confirmed_at IS NOT NULL AND _s.unsubscribed_at IS NULL THEN
    RETURN jsonb_build_object('subscriber_id', _s.id, 'action', 'already');
  END IF;
  IF FOUND AND _s.confirm_sent_at > now() - interval '10 minutes' THEN
    RETURN jsonb_build_object('subscriber_id', _s.id, 'action', 'throttled');
  END IF;
  IF FOUND THEN
    UPDATE public.subscribers SET full_name = _name, branch_id = p_branch, consent_at = now(), source = p_source,
      confirmed_at = NULL, unsubscribed_at = NULL, confirm_sent_at = now(), updated_at = now()
    WHERE id = _s.id RETURNING * INTO _s;
  ELSE
    INSERT INTO public.subscribers (email, full_name, branch_id, source, confirm_sent_at)
    VALUES (_email, _name, p_branch, p_source, now()) RETURNING * INTO _s;
  END IF;
  PERFORM public.enqueue_email('subscriber_confirm', NULL, _s.id, NULL, '{}'::jsonb);
  RETURN jsonb_build_object('subscriber_id', _s.id, 'action', 'confirm_sent');
END $$;

CREATE FUNCTION public.subscriber_confirm(p_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _s public.subscribers;
BEGIN
  SELECT * INTO _s FROM public.subscribers WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Link is no longer valid'; END IF;
  IF _s.unsubscribed_at IS NOT NULL THEN RETURN jsonb_build_object('state', 'unsubscribed'); END IF;
  IF _s.confirmed_at IS NULL THEN
    IF _s.confirm_sent_at < now() - interval '7 days' THEN RAISE EXCEPTION 'Link is no longer valid'; END IF;
    UPDATE public.subscribers SET confirmed_at = now(), updated_at = now() WHERE id = p_id;
  END IF;
  RETURN jsonb_build_object('state', 'confirmed');
END $$;

-- Unsubscribe: no more announcements; the name is removed, the address stays only as "do not email".
CREATE FUNCTION public.subscriber_unsubscribe(p_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.subscribers SET unsubscribed_at = coalesce(unsubscribed_at, now()), full_name = NULL, updated_at = now() WHERE id = p_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Link is no longer valid'; END IF;
  UPDATE public.email_outbox SET status = 'cancelled' WHERE subscriber_id = p_id AND status = 'pending';
  RETURN jsonb_build_object('state', 'unsubscribed');
END $$;

-- ─── Managers ────────────────────────────────────────────────────────────────────────────────────────────────────

-- Existing list: guests appear with their name, pending (unconfirmed) guests are not listed.
CREATE OR REPLACE FUNCTION public.get_event_registrations(p_event_id uuid)
RETURNS TABLE(id uuid, user_id uuid, full_name text, email text, status text, show_name boolean, registered_at timestamptz,
  cancelled_at timestamptz, attendance_marked_at timestamptz, attendance_marked_by_name text, waitlist_position integer)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _e public.events;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not signed in'; END IF;
  SELECT * INTO _e FROM public.events WHERE events.id = p_event_id;
  IF NOT FOUND OR _e.deleted_at IS NOT NULL OR _e.series_template OR NOT public.can_manage_event_scope(_e.scope, _e.branch_id, _e.region_id) THEN
    RAISE EXCEPTION 'Not allowed';
  END IF;
  IF public.has_role(auth.uid(), 'national_coordinator') THEN RAISE EXCEPTION 'Registrant details are not available'; END IF;
  RETURN QUERY
    SELECT r.id, r.user_id, coalesce(p.full_name, g.full_name), coalesce(p.email, g.email), r.status, r.show_name, r.registered_at,
      r.cancelled_at, r.attendance_marked_at, m.full_name, public.registration_position(r)
    FROM public.event_registrations r
    LEFT JOIN public.profiles p ON p.id = r.user_id
    LEFT JOIN public.event_guests g ON g.registration_id = r.id
    LEFT JOIN public.profiles m ON m.id = r.attendance_marked_by
    WHERE r.event_id = p_event_id AND r.status <> 'pending'
    ORDER BY CASE r.status WHEN 'registered' THEN 0 WHEN 'attended' THEN 0 WHEN 'no_show' THEN 0 WHEN 'waitlisted' THEN 1 ELSE 2 END,
      r.registered_at, r.id;
END $$;

-- Attendee list for scope managers: members and guests together (CSV export and check-in). National Coordinators:
-- counts only (get_event_registration_summary).
CREATE FUNCTION public.get_event_attendees(p_event_id uuid)
RETURNS TABLE(registration_id uuid, kind text, user_id uuid, full_name text, email text, phone text, places integer, status text,
  registered_at timestamptz, cancelled_at timestamptz, checked_in_at timestamptz, checked_in_by_name text, waitlist_position integer)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _e public.events;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not signed in'; END IF;
  SELECT * INTO _e FROM public.events WHERE events.id = p_event_id;
  IF NOT FOUND OR _e.deleted_at IS NOT NULL OR _e.series_template OR NOT public.can_manage_event_scope(_e.scope, _e.branch_id, _e.region_id) THEN
    RAISE EXCEPTION 'Not allowed';
  END IF;
  IF public.has_role(auth.uid(), 'national_coordinator') THEN RAISE EXCEPTION 'Registrant details are not available'; END IF;
  RETURN QUERY
    SELECT r.id, CASE WHEN r.guest THEN 'guest' ELSE 'member' END, r.user_id, coalesce(p.full_name, g.full_name),
      coalesce(p.email, g.email), coalesce(p.phone, g.phone), r.places, r.status, r.registered_at, r.cancelled_at,
      CASE WHEN r.status = 'attended' THEN r.attendance_marked_at END, CASE WHEN r.status = 'attended' THEN m.full_name END,
      public.registration_position(r)
    FROM public.event_registrations r
    LEFT JOIN public.profiles p ON p.id = r.user_id
    LEFT JOIN public.event_guests g ON g.registration_id = r.id
    LEFT JOIN public.profiles m ON m.id = r.attendance_marked_by
    WHERE r.event_id = p_event_id AND r.status <> 'pending'
    ORDER BY CASE r.status WHEN 'registered' THEN 0 WHEN 'attended' THEN 0 WHEN 'no_show' THEN 0 WHEN 'waitlisted' THEN 1 ELSE 2 END,
      r.registered_at, r.id;
END $$;

-- Check-in: attended / no_show, and 'registered' undoes a mark.
CREATE OR REPLACE FUNCTION public.mark_attendance(p_registration_id uuid, p_status text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid uuid := auth.uid(); _event uuid; _e public.events; _r public.event_registrations;
BEGIN
  PERFORM public.require_privacy_accepted();
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not signed in'; END IF;
  IF p_status IS NULL OR p_status NOT IN ('attended', 'no_show', 'registered') THEN RAISE EXCEPTION 'Invalid attendance status'; END IF;
  PERFORM id FROM public.profiles WHERE id = _uid FOR UPDATE;
  SELECT event_id INTO _event FROM public.event_registrations WHERE id = p_registration_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Not allowed'; END IF;
  SELECT * INTO _e FROM public.events WHERE id = _event FOR UPDATE;
  IF _e.deleted_at IS NOT NULL OR NOT public.can_manage_event_scope(_e.scope, _e.branch_id, _e.region_id) THEN RAISE EXCEPTION 'Not allowed'; END IF;
  IF public.has_role(_uid, 'national_coordinator') THEN RAISE EXCEPTION 'Registrant details are not available'; END IF;
  IF coalesce(public.event_starts(_e) > now(), true) THEN RAISE EXCEPTION 'Event has not started'; END IF;
  SELECT * INTO _r FROM public.event_registrations WHERE id = p_registration_id FOR UPDATE;
  IF _r.status NOT IN ('registered', 'attended', 'no_show') THEN RAISE EXCEPTION 'Invalid attendance status'; END IF;
  UPDATE public.event_registrations SET status = p_status,
    attendance_marked_by = CASE WHEN p_status = 'registered' THEN NULL ELSE _uid END,
    attendance_marked_at = CASE WHEN p_status = 'registered' THEN NULL ELSE now() END
  WHERE id = _r.id;
END $$;

-- Photos: past-event records hold up to 12 files, other events 5.
CREATE OR REPLACE FUNCTION public.add_event_media(_event uuid, _kind text, _extension text, _original_name text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _id uuid:=gen_random_uuid(); _position integer; _name text := nullif(left(btrim(coalesce(_original_name,'')),255),''); _past boolean;
BEGIN
  PERFORM public.require_privacy_accepted();
 _extension := CASE WHEN lower(_extension) = 'jpeg' THEN 'jpg' ELSE lower(_extension) END;
 PERFORM id FROM public.profiles WHERE id=auth.uid() FOR UPDATE;
 SELECT past_record INTO _past FROM public.events WHERE id=_event FOR UPDATE;
 IF NOT FOUND OR NOT public.can_manage_event(_event) THEN RAISE EXCEPTION 'Not allowed'; END IF;
 IF _kind IS NULL OR _extension IS NULL OR NOT ((_kind='image' AND _extension IN ('jpg','png','webp')) OR (_kind='pdf' AND _extension='pdf') OR (_kind='document' AND _extension IN ('docx','pptx'))) THEN RAISE EXCEPTION 'Invalid event file'; END IF;
 IF _past AND _kind <> 'image' THEN RAISE EXCEPTION 'Invalid event file'; END IF;
 SELECT count(*) INTO _position FROM public.event_media WHERE event_id=_event;
 IF _past AND _position>=12 THEN RAISE EXCEPTION 'Maximum 12 photos per past event'; END IF;
 IF NOT _past AND _position>=5 THEN RAISE EXCEPTION 'Maximum 5 files per event'; END IF;
 INSERT INTO public.event_media(id,event_id,storage_path,kind,position,uploaded_by,original_name) VALUES(_id,_event,_event::text||'/'||_id::text||'.'||_extension,_kind,_position,auth.uid(),_name);
 RETURN _id;
END $$;

-- "Show in public gallery" (images of public events) and the image size (set by the uploader after resizing).
CREATE FUNCTION public.set_event_media_gallery(p_media uuid, p_in_gallery boolean) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _m public.event_media; _e public.events;
BEGIN
  PERFORM public.require_privacy_accepted();
  SELECT * INTO _m FROM public.event_media WHERE id = p_media;
  IF NOT FOUND THEN RAISE EXCEPTION 'Not allowed'; END IF;
  SELECT * INTO _e FROM public.events WHERE id = _m.event_id FOR UPDATE;
  IF NOT public.can_manage_event(_e.id) THEN RAISE EXCEPTION 'Not allowed'; END IF;
  IF coalesce(p_in_gallery, false) AND (_m.kind <> 'image' OR _e.audience <> 'public' OR _e.category = 'meeting') THEN
    RAISE EXCEPTION 'Only photos of public events can be shown in the gallery';
  END IF;
  UPDATE public.event_media SET in_gallery = coalesce(p_in_gallery, false), updated_at = now() WHERE id = p_media;
END $$;

CREATE FUNCTION public.set_event_media_size(p_media uuid, p_width integer, p_height integer) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _event uuid;
BEGIN
  PERFORM public.require_privacy_accepted();
  SELECT event_id INTO _event FROM public.event_media WHERE id = p_media AND kind = 'image';
  IF NOT FOUND OR NOT public.can_manage_event(_event) THEN RAISE EXCEPTION 'Not allowed'; END IF;
  IF p_width NOT BETWEEN 1 AND 20000 OR p_height NOT BETWEEN 1 AND 20000 THEN RAISE EXCEPTION 'Invalid event file'; END IF;
  UPDATE public.event_media SET width = p_width, height = p_height, updated_at = now() WHERE id = p_media;
END $$;

-- Past events: a public record of an event that already took place (date in the past, photos, optional videos).
-- No branch = a national record (National Coordinators).
CREATE FUNCTION public.create_past_event(p_title text, p_date date, p_branch uuid, p_description text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _id uuid; _region uuid; _scope text := CASE WHEN p_branch IS NULL THEN 'national' ELSE 'branch' END;
BEGIN
  PERFORM public.require_privacy_accepted();
  PERFORM id FROM public.profiles WHERE id = auth.uid() FOR UPDATE;
  IF p_branch IS NOT NULL THEN SELECT region_id INTO _region FROM public.branches WHERE id = p_branch AND deleted_at IS NULL; END IF;
  IF NOT public.can_manage_event_scope(_scope, p_branch, _region) THEN RAISE EXCEPTION 'Not allowed'; END IF;
  IF char_length(coalesce(p_description, '')) > 5000 THEN RAISE EXCEPTION 'Invalid event values'; END IF;
  PERFORM set_config('app.past_event', 'on', true);
  INSERT INTO public.events (title, description, location, organizer, category, scope, branch_id, region_id, status, audience,
    all_day, start_date, end_date, registration_enabled, past_record, created_by)
  VALUES (p_title, coalesce(p_description, ''), '', 'Dialogue Society', 'other', _scope, p_branch, _region, 'published', 'public',
    true, p_date, p_date, false, true, auth.uid())
  RETURNING id INTO _id;
  PERFORM set_config('app.past_event', '', true);
  RETURN _id;
END $$;

CREATE FUNCTION public.update_past_event(p_id uuid, p_title text, p_date date, p_branch uuid, p_description text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _region uuid; _scope text := CASE WHEN p_branch IS NULL THEN 'national' ELSE 'branch' END;
BEGIN
  PERFORM public.require_privacy_accepted();
  PERFORM id FROM public.profiles WHERE id = auth.uid() FOR UPDATE;
  PERFORM id FROM public.events WHERE id = p_id AND past_record AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND OR NOT public.can_manage_event(p_id) THEN RAISE EXCEPTION 'Not allowed'; END IF;
  IF p_branch IS NOT NULL THEN SELECT region_id INTO _region FROM public.branches WHERE id = p_branch AND deleted_at IS NULL; END IF;
  IF NOT public.can_manage_event_scope(_scope, p_branch, _region) THEN RAISE EXCEPTION 'Not allowed'; END IF;
  IF char_length(coalesce(p_description, '')) > 5000 THEN RAISE EXCEPTION 'Invalid event values'; END IF;
  UPDATE public.events SET title = p_title, description = coalesce(p_description, ''), start_date = p_date, end_date = p_date,
    scope = _scope, branch_id = p_branch, region_id = _region
  WHERE id = p_id;
END $$;

-- Highlights: YouTube links on public events (the server stores the poster afterwards).
CREATE FUNCTION public.add_event_video(p_event uuid, p_youtube_id text, p_title text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _id uuid; _e public.events;
BEGIN
  PERFORM public.require_privacy_accepted();
  SELECT * INTO _e FROM public.events WHERE id = p_event FOR UPDATE;
  IF NOT FOUND OR _e.deleted_at IS NOT NULL OR NOT public.can_manage_event(p_event) THEN RAISE EXCEPTION 'Not allowed'; END IF;
  IF _e.audience <> 'public' OR _e.category = 'meeting' THEN RAISE EXCEPTION 'Videos can be added to public events only'; END IF;
  IF p_youtube_id IS NULL OR p_youtube_id !~ '^[A-Za-z0-9_-]{11}$' THEN RAISE EXCEPTION 'Invalid YouTube link'; END IF;
  IF (SELECT count(*) FROM public.event_videos WHERE event_id = p_event) >= 6 THEN RAISE EXCEPTION 'Maximum 6 videos per event'; END IF;
  INSERT INTO public.event_videos (event_id, youtube_id, title, position, created_by)
  VALUES (p_event, p_youtube_id, left(btrim(coalesce(p_title, '')), 300), (SELECT count(*) FROM public.event_videos WHERE event_id = p_event), auth.uid())
  ON CONFLICT (coalesce(event_id, '00000000-0000-0000-0000-000000000000'::uuid), youtube_id) DO NOTHING
  RETURNING id INTO _id;
  IF _id IS NULL THEN RAISE EXCEPTION 'This video is already added'; END IF;
  RETURN _id;
END $$;

CREATE FUNCTION public.list_event_videos(p_event uuid) RETURNS TABLE(id uuid, youtube_id text, title text, has_thumb boolean, "position" integer)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.can_view_event(p_event) THEN RAISE EXCEPTION 'Not allowed'; END IF;
  RETURN QUERY SELECT v.id, v.youtube_id, v.title, v.thumb_path IS NOT NULL, v.position FROM public.event_videos v
    WHERE v.event_id = p_event ORDER BY v.position, v.created_at;
END $$;

-- Removal: the server first removes the stored poster (path from here), then the row.
CREATE FUNCTION public.get_event_video_for_removal(p_id uuid) RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _v public.event_videos;
BEGIN
  SELECT * INTO _v FROM public.event_videos WHERE id = p_id;
  IF NOT FOUND OR _v.event_id IS NULL OR NOT public.can_manage_event(_v.event_id) THEN RAISE EXCEPTION 'Not allowed'; END IF;
  RETURN _v.thumb_path;
END $$;

CREATE FUNCTION public.delete_event_video(p_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _v public.event_videos;
BEGIN
  PERFORM public.require_privacy_accepted();
  SELECT * INTO _v FROM public.event_videos WHERE id = p_id;
  IF NOT FOUND OR _v.event_id IS NULL OR NOT public.can_manage_event(_v.event_id) THEN RAISE EXCEPTION 'Not allowed'; END IF;
  IF _v.thumb_path IS NOT NULL AND EXISTS (SELECT 1 FROM storage.objects WHERE bucket_id = 'event-media' AND name = _v.thumb_path) THEN
    RAISE EXCEPTION 'Remove stored file first';
  END IF;
  DELETE FROM public.event_videos WHERE id = p_id;
  WITH ordered AS (SELECT v.id, row_number() OVER (ORDER BY v.position, v.created_at) - 1 AS pos FROM public.event_videos v WHERE v.event_id = _v.event_id)
  UPDATE public.event_videos v SET position = ordered.pos FROM ordered WHERE v.id = ordered.id;
END $$;

-- Server only: the stored poster of a video.
CREATE FUNCTION public.set_event_video_thumb(p_id uuid, p_path text) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE public.event_videos SET thumb_path = p_path WHERE id = p_id
$$;

-- "Announce to subscribers": queues the announcement for confirmed subscribers whose interest matches the target
-- (subscribers without a branch interest get every announcement). Targets within the manager's own reach: a branch
-- (its manager, its RD, an NC), a region (its RD, an NC), everyone (NCs). Once per subscriber and event. p_dry_run
-- only counts the recipients.
CREATE FUNCTION public.announce_event(p_event uuid, p_target text, p_branch uuid DEFAULT NULL, p_region uuid DEFAULT NULL,
  p_dry_run boolean DEFAULT false) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _e public.events; _region uuid := p_region; _n integer := 0; _s uuid;
BEGIN
  PERFORM public.require_privacy_accepted();
  PERFORM id FROM public.profiles WHERE id = auth.uid() FOR UPDATE;
  SELECT * INTO _e FROM public.events WHERE id = p_event FOR UPDATE;
  IF NOT FOUND OR NOT public.can_manage_event(p_event) THEN RAISE EXCEPTION 'Not allowed'; END IF;
  IF NOT (public.is_public_event(_e) AND _e.status = 'published' AND NOT _e.past_record AND coalesce(public.event_starts(_e) > now(), false)) THEN
    RAISE EXCEPTION 'Only upcoming public events can be announced';
  END IF;
  IF p_target = 'branch' THEN
    SELECT region_id INTO _region FROM public.branches WHERE id = p_branch AND deleted_at IS NULL;
    IF NOT FOUND OR NOT (public.is_nc() OR public.can_manage_event_scope('branch', p_branch, _region)) THEN RAISE EXCEPTION 'Not allowed'; END IF;
  ELSIF p_target = 'region' THEN
    IF p_region IS NULL OR NOT (public.is_nc() OR public.can_manage_event_scope('region', NULL, p_region)) THEN RAISE EXCEPTION 'Not allowed'; END IF;
  ELSIF p_target = 'all' THEN
    IF NOT public.is_nc() THEN RAISE EXCEPTION 'Not allowed'; END IF;
  ELSE
    RAISE EXCEPTION 'Not allowed';
  END IF;
  IF p_dry_run THEN
    SELECT count(*) INTO _n FROM public.subscribers s
    WHERE s.confirmed_at IS NOT NULL AND s.unsubscribed_at IS NULL
      AND (p_target = 'all' OR s.branch_id IS NULL OR (p_target = 'branch' AND s.branch_id = p_branch)
        OR (p_target = 'region' AND s.branch_id IN (SELECT id FROM public.branches WHERE region_id = p_region)))
      AND NOT EXISTS (SELECT 1 FROM public.email_outbox o WHERE o.dedupe_key = 'announce:' || p_event || ':' || s.id);
    RETURN _n;
  END IF;
  FOR _s IN SELECT s.id FROM public.subscribers s
    WHERE s.confirmed_at IS NOT NULL AND s.unsubscribed_at IS NULL
      AND (p_target = 'all' OR s.branch_id IS NULL OR (p_target = 'branch' AND s.branch_id = p_branch)
        OR (p_target = 'region' AND s.branch_id IN (SELECT id FROM public.branches WHERE region_id = p_region)))
    ORDER BY s.id
  LOOP
    IF public.enqueue_email('event_announcement', NULL, _s, p_event, '{}'::jsonb, 'announce:' || p_event || ':' || _s) IS NOT NULL THEN
      _n := _n + 1;
    END IF;
  END LOOP;
  INSERT INTO public.event_announcements (event_id, target, branch_id, region_id, recipients, created_by)
  VALUES (p_event, p_target, CASE WHEN p_target = 'branch' THEN p_branch END, CASE WHEN p_target <> 'all' THEN _region END, _n, auth.uid());
  RETURN _n;
END $$;

CREATE FUNCTION public.get_event_announcements(p_event uuid)
RETURNS TABLE(id uuid, target text, branch text, region text, recipients integer, created_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.can_manage_event(p_event) THEN RAISE EXCEPTION 'Not allowed'; END IF;
  RETURN QUERY SELECT a.id, a.target, b.name, r.name, a.recipients, a.created_at FROM public.event_announcements a
    LEFT JOIN public.branches b ON b.id = a.branch_id LEFT JOIN public.regions r ON r.id = a.region_id
    WHERE a.event_id = p_event ORDER BY a.created_at DESC;
END $$;

-- ─── Landing page data (server only; the server signs image links and strips storage paths) ─────────────────────

CREATE FUNCTION public.public_landing_data() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object(
    'upcoming', coalesce((SELECT jsonb_agg(public.public_event_json(x) || jsonb_build_object('image_path', public.public_event_image_path(x))
        ORDER BY public.event_starts(x), x.id)
      FROM (SELECT e.* FROM public.events e WHERE public.is_public_event(e) AND e.status = 'published' AND NOT e.past_record
        AND public.event_ends(e) >= now() AND public.event_starts(e) <= now() + interval '12 months'
        ORDER BY public.event_starts(e), e.id LIMIT 60) x), '[]'::jsonb),
    'gallery', coalesce((SELECT jsonb_agg(g ORDER BY g->>'date' DESC, g->>'event_id') FROM (
      SELECT jsonb_build_object('event_id', e.id, 'title', e.title, 'date', coalesce(e.start_date, (e.start_at AT TIME ZONE 'Europe/London')::date),
        'branch', b.name, 'description', e.description, 'past_record', e.past_record,
        'photos', (SELECT jsonb_agg(jsonb_build_object('id', m.id, 'path', m.storage_path, 'width', m.width, 'height', m.height) ORDER BY m.position, m.created_at)
          FROM public.event_media m WHERE m.event_id = e.id AND m.in_gallery AND m.kind = 'image')) AS g
      FROM public.events e LEFT JOIN public.branches b ON b.id = e.branch_id
      WHERE public.is_public_event(e) AND e.status = 'published' AND public.event_ends(e) < now()
        AND EXISTS (SELECT 1 FROM public.event_media m WHERE m.event_id = e.id AND m.in_gallery AND m.kind = 'image')
      ORDER BY public.event_starts(e) DESC, e.id LIMIT 24) q), '[]'::jsonb),
    'highlights', coalesce((SELECT jsonb_agg(jsonb_build_object('id', v.id, 'youtube_id', v.youtube_id, 'title', v.title,
        'thumb_path', v.thumb_path, 'event_id', v.event_id) ORDER BY v.created_at DESC, v.id)
      FROM (SELECT v.* FROM public.event_videos v LEFT JOIN public.events e ON e.id = v.event_id
        WHERE v.event_id IS NULL OR (public.is_public_event(e) AND e.status = 'published')
        ORDER BY v.created_at DESC, v.id LIMIT 12) v), '[]'::jsonb),
    'stats', jsonb_build_object(
      'events_held', (SELECT count(*) FROM public.events e WHERE public.is_public_event(e) AND e.status = 'published' AND public.event_ends(e) < now()),
      'registrations', (SELECT coalesce(sum(r.places), 0) FROM public.event_registrations r JOIN public.events e ON e.id = r.event_id
        WHERE public.is_public_event(e) AND e.status = 'published' AND r.status IN ('registered', 'attended')),
      'branches', (SELECT count(*) FROM public.branches WHERE deleted_at IS NULL)))
$$;

-- ─── Retention (nightly) ─────────────────────────────────────────────────────────────────────────────────────────

-- * guest registrations 12 months after the event ended (the guest's details go with them; a confirmed subscriber
--   keeps only the subscriber row);
-- * unconfirmed guest registrations after 48 hours, unconfirmed subscribers after 7 days;
-- * finished outbox rows after 30 days (they name the recipient), rate-limit windows after 2 days.
CREATE FUNCTION public.purge_guest_data() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _guests integer; _pending integer; _subs integer; _outbox integer; _limits integer;
BEGIN
  DELETE FROM public.event_registrations r USING public.events e
  WHERE r.event_id = e.id AND r.guest AND public.event_ends(e) < now() - interval '12 months';
  GET DIAGNOSTICS _guests = ROW_COUNT;
  DELETE FROM public.event_registrations WHERE guest AND status = 'pending' AND registered_at < now() - interval '48 hours';
  GET DIAGNOSTICS _pending = ROW_COUNT;
  DELETE FROM public.subscribers WHERE confirmed_at IS NULL AND unsubscribed_at IS NULL AND coalesce(confirm_sent_at, created_at) < now() - interval '7 days';
  GET DIAGNOSTICS _subs = ROW_COUNT;
  DELETE FROM public.email_outbox WHERE status IN ('sent', 'skipped', 'failed', 'cancelled') AND coalesce(sent_at, created_at) < now() - interval '30 days';
  GET DIAGNOSTICS _outbox = ROW_COUNT;
  DELETE FROM public.public_rate_limits WHERE window_start < now() - interval '2 days';
  GET DIAGNOSTICS _limits = ROW_COUNT;
  RETURN jsonb_build_object('guest_registrations', _guests, 'pending_guests', _pending, 'unconfirmed_subscribers', _subs,
    'outbox', _outbox, 'rate_limits', _limits);
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'pg_cron') THEN
    CREATE EXTENSION IF NOT EXISTS pg_cron;
    PERFORM cron.schedule('purge-guest-data', '40 2 * * *', 'SELECT public.purge_guest_data()');
  END IF;
END $$;

-- ─── Grants ──────────────────────────────────────────────────────────────────────────────────────────────────────

-- Internal and server-only functions: no client may call them.
REVOKE ALL ON FUNCTION
  public.email_daily_limit(), public.email_priority(text), public.email_outbox_defaults(),
  public.enqueue_email(text, uuid, uuid, uuid, jsonb, text), public.event_sends_emails(public.events),
  public.registration_reachable(public.event_registrations), public.event_registrations_emails(), public.events_public_emails(),
  public.events_ics_sequence(), public.enqueue_event_reminders(), public.claim_email_batch(integer, integer),
  public.finish_email(uuid, text, text), public.email_event_context(uuid), public.public_rate_hit(text, integer, integer),
  public.guest_event_open(public.events), public.guest_register(uuid, text, text, text, integer, boolean), public.guest_confirm(uuid),
  public.guest_cancel(uuid), public.guest_registration_view(uuid), public.subscriber_signup(text, text, uuid, text),
  public.subscriber_confirm(uuid), public.subscriber_unsubscribe(uuid), public.set_event_video_thumb(uuid, text),
  public.public_landing_data(), public.purge_guest_data()
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION
  public.enqueue_event_reminders(), public.claim_email_batch(integer, integer), public.finish_email(uuid, text, text),
  public.email_event_context(uuid), public.public_rate_hit(text, integer, integer),
  public.guest_register(uuid, text, text, text, integer, boolean), public.guest_confirm(uuid), public.guest_cancel(uuid),
  public.guest_registration_view(uuid), public.subscriber_signup(text, text, uuid, text), public.subscriber_confirm(uuid),
  public.subscriber_unsubscribe(uuid), public.set_event_video_thumb(uuid, text), public.public_landing_data(), public.purge_guest_data()
TO service_role;

-- Manager RPCs: signed-in people only (each checks the event's management scope).
REVOKE ALL ON FUNCTION
  public.get_event_attendees(uuid), public.set_event_media_gallery(uuid, boolean), public.set_event_media_size(uuid, integer, integer),
  public.create_past_event(text, date, uuid, text), public.update_past_event(uuid, text, date, uuid, text),
  public.add_event_video(uuid, text, text), public.list_event_videos(uuid), public.get_event_video_for_removal(uuid),
  public.delete_event_video(uuid), public.announce_event(uuid, text, uuid, uuid, boolean), public.get_event_announcements(uuid)
FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION
  public.get_event_attendees(uuid), public.set_event_media_gallery(uuid, boolean), public.set_event_media_size(uuid, integer, integer),
  public.create_past_event(text, date, uuid, text), public.update_past_event(uuid, text, date, uuid, text),
  public.add_event_video(uuid, text, text), public.list_event_videos(uuid), public.get_event_video_for_removal(uuid),
  public.delete_event_video(uuid), public.announce_event(uuid, text, uuid, uuid, boolean), public.get_event_announcements(uuid)
TO authenticated;

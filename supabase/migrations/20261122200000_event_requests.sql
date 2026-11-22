-- A3: event requests. Volunteers request branch events; branch managers request region events (they create
-- branch events directly and cannot create region events); regional directors create events directly.
-- Reviewers: the branch's BM or the region's RD for branch requests, only the region's RD for region requests
-- (can_manage_event_scope). Clients only read (RLS); every write is a SECURITY DEFINER RPC.
-- All-day requests store London calendar dates (*_date columns), never timestamps (same rule as events).

-- 1. Table --------------------------------------------------------------------------------------------------
CREATE TABLE public.event_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  scope text NOT NULL CHECK (scope IN ('branch', 'region')),
  branch_id uuid REFERENCES public.branches(id),
  region_id uuid NOT NULL REFERENCES public.regions(id),
  title text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 120),
  description text CHECK (length(description) <= 2000),
  reason text CHECK (length(reason) <= 1000),
  all_day boolean NOT NULL DEFAULT false,
  proposed_start timestamptz,
  proposed_end timestamptz,
  proposed_start_date date,
  proposed_end_date date,
  alt_start timestamptz,
  alt_end timestamptz,
  alt_start_date date,
  alt_end_date date,
  location_text text CHECK (length(location_text) <= 500),
  is_online boolean NOT NULL DEFAULT false,
  online_url text CHECK (online_url IS NULL OR (length(online_url) <= 2000 AND online_url ~ '^https://[^\s/?#]+\.[^\s]*$')),
  expected_attendees integer CHECK (expected_attendees IS NULL OR expected_attendees BETWEEN 1 AND 100000),
  status text NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted', 'under_review', 'approved', 'declined', 'withdrawn')),
  decline_reason text CHECK (length(decline_reason) <= 1000),
  reviewer_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  event_id uuid REFERENCES public.events(id) ON DELETE SET NULL,
  notice text CHECK (notice IN ('under_review', 'approved', 'declined')),
  notice_seen_at timestamptz,
  deleted_at timestamptz,
  deleted_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT event_requests_scope_branch_check CHECK ((scope = 'branch' AND branch_id IS NOT NULL) OR (scope = 'region' AND branch_id IS NULL)),
  -- Timed requests: instants with end after start. All-day requests: London dates, end on or after start.
  CONSTRAINT event_requests_dates_check CHECK (CASE WHEN all_day THEN
      proposed_start IS NULL AND proposed_end IS NULL AND alt_start IS NULL AND alt_end IS NULL
      AND proposed_start_date IS NOT NULL AND (proposed_end_date IS NULL OR proposed_end_date >= proposed_start_date)
      AND (alt_end_date IS NULL OR (alt_start_date IS NOT NULL AND alt_end_date >= alt_start_date))
    ELSE
      proposed_start_date IS NULL AND proposed_end_date IS NULL AND alt_start_date IS NULL AND alt_end_date IS NULL
      AND proposed_start IS NOT NULL AND proposed_end IS NOT NULL AND proposed_end > proposed_start
      AND (alt_start IS NULL) = (alt_end IS NULL) AND (alt_start IS NULL OR alt_end > alt_start)
    END),
  CONSTRAINT event_requests_online_check CHECK (is_online OR online_url IS NULL),
  CONSTRAINT event_requests_decline_check CHECK (status <> 'declined' OR length(btrim(coalesce(decline_reason, ''))) >= 10),
  CONSTRAINT event_requests_event_check CHECK (event_id IS NULL OR status = 'approved')
);
CREATE INDEX event_requests_branch_idx ON public.event_requests (status, scope, branch_id);
CREATE INDEX event_requests_region_idx ON public.event_requests (status, scope, region_id);
CREATE INDEX event_requests_requester_idx ON public.event_requests (requester_id, status);
CREATE INDEX event_requests_deleted_idx ON public.event_requests (deleted_at) WHERE deleted_at IS NOT NULL;
CREATE INDEX event_requests_event_idx ON public.event_requests (event_id) WHERE event_id IS NOT NULL;

ALTER TABLE public.event_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.event_requests FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.event_requests TO authenticated;
GRANT ALL ON public.event_requests TO service_role;

-- Own requests, and the requests a reviewer manages; Recycle Bin rows never show in normal reads.
CREATE POLICY event_requests_read_own ON public.event_requests FOR SELECT TO authenticated
  USING (requester_id = auth.uid() AND deleted_at IS NULL);
CREATE POLICY event_requests_read_managed ON public.event_requests FOR SELECT TO authenticated
  USING (deleted_at IS NULL AND public.can_manage_event_scope(scope, branch_id, region_id));

-- Recycle Bin and the nightly cleanup know the new item type.
ALTER TABLE public.recycle_bin_audit_log DROP CONSTRAINT IF EXISTS recycle_bin_audit_log_item_type_check;
ALTER TABLE public.recycle_bin_audit_log ADD CONSTRAINT recycle_bin_audit_log_item_type_check
  CHECK (item_type IN ('event', 'user', 'series', 'event_request'));
ALTER TABLE public.event_cleanup_audit ADD COLUMN requests_purged integer NOT NULL DEFAULT 0;

-- 2. Triggers -----------------------------------------------------------------------------------------------
-- updated_at; an erased requester (FK SET NULL) leaves no pending notice behind.
CREATE FUNCTION public.event_requests_touch() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.updated_at := now();
  IF NEW.requester_id IS NULL THEN NEW.notice := NULL; NEW.notice_seen_at := NULL; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER event_requests_touch BEFORE UPDATE ON public.event_requests FOR EACH ROW EXECUTE FUNCTION public.event_requests_touch();

-- A soft-deleted user's open requests are withdrawn; restoring the user does not reopen them.
CREATE FUNCTION public.profiles_event_request_sync() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN
    UPDATE public.event_requests SET status = 'withdrawn', notice = NULL, notice_seen_at = NULL
    WHERE requester_id = NEW.id AND status IN ('submitted', 'under_review');
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER profiles_event_request_sync AFTER UPDATE OF deleted_at ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.profiles_event_request_sync();

-- 3. Internal helpers (no client EXECUTE) -------------------------------------------------------------------
-- The signed-in, active, not deleted caller.
CREATE FUNCTION public.event_request_actor() RETURNS uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not signed in'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND status = 'active' AND deleted_at IS NULL) THEN RAISE EXCEPTION 'Not allowed'; END IF;
  RETURN auth.uid();
END $$;

-- "Counts only" boundary: who may count requests in a scope vs. who may see a request's details. Today both are
-- the reviewers (can_manage_event_scope); a future National Coordinator would get counts without details.
CREATE FUNCTION public.event_request_countable(_scope text, _branch uuid, _region uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.can_manage_event_scope(_scope, _branch, _region)
$$;
CREATE FUNCTION public.can_review_event_request(_r public.event_requests) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT _r.deleted_at IS NULL AND public.can_manage_event_scope(_r.scope, _r.branch_id, _r.region_id)
$$;

-- Parses and validates request input (title, dates, place, attendees) into a row; raises a mapped message.
CREATE FUNCTION public.event_request_fields(p jsonb) RETURNS public.event_requests
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.event_requests; _today date := (now() AT TIME ZONE 'Europe/London')::date;
BEGIN
  IF p IS NULL OR jsonb_typeof(p) <> 'object' THEN RAISE EXCEPTION 'Invalid request values'; END IF;
  r.title := btrim(coalesce(p->>'title', ''));
  IF r.title = '' THEN RAISE EXCEPTION 'Request title is required'; END IF;
  r.description := nullif(btrim(coalesce(p->>'description', '')), '');
  r.reason := nullif(btrim(coalesce(p->>'reason', '')), '');
  r.location_text := nullif(btrim(coalesce(p->>'location_text', '')), '');
  IF length(r.title) > 120 OR length(r.description) > 2000 OR length(r.reason) > 1000 OR length(r.location_text) > 500 THEN
    RAISE EXCEPTION 'Invalid request values';
  END IF;
  BEGIN
    r.all_day := coalesce((p->>'all_day')::boolean, false);
    r.is_online := coalesce((p->>'is_online')::boolean, false);
    r.expected_attendees := nullif(p->>'expected_attendees', '')::integer;
    IF r.all_day THEN
      r.proposed_start_date := nullif(p->>'proposed_start_date', '')::date;
      r.proposed_end_date := nullif(p->>'proposed_end_date', '')::date;
      r.alt_start_date := nullif(p->>'alt_start_date', '')::date;
      r.alt_end_date := nullif(p->>'alt_end_date', '')::date;
    ELSE
      r.proposed_start := nullif(p->>'proposed_start', '')::timestamptz;
      r.proposed_end := nullif(p->>'proposed_end', '')::timestamptz;
      r.alt_start := nullif(p->>'alt_start', '')::timestamptz;
      r.alt_end := nullif(p->>'alt_end', '')::timestamptz;
    END IF;
  EXCEPTION WHEN data_exception THEN RAISE EXCEPTION 'Invalid request values';
  END;
  IF r.expected_attendees IS NOT NULL AND (r.expected_attendees < 1 OR r.expected_attendees > 100000) THEN RAISE EXCEPTION 'Invalid request values'; END IF;
  IF r.all_day THEN
    IF r.proposed_start_date IS NULL THEN RAISE EXCEPTION 'Proposed date is required'; END IF;
    IF r.proposed_end_date < r.proposed_start_date OR r.alt_end_date < r.alt_start_date THEN RAISE EXCEPTION 'Event end must be after start'; END IF;
    IF r.alt_end_date IS NOT NULL AND r.alt_start_date IS NULL THEN RAISE EXCEPTION 'Invalid request values'; END IF;
    IF r.proposed_start_date <= _today OR r.alt_start_date <= _today THEN RAISE EXCEPTION 'Proposed date must be in the future'; END IF;
  ELSE
    IF r.proposed_start IS NULL OR r.proposed_end IS NULL THEN RAISE EXCEPTION 'Proposed date is required'; END IF;
    IF NOT isfinite(r.proposed_start) OR NOT isfinite(r.proposed_end) OR (r.alt_start IS NULL) <> (r.alt_end IS NULL)
       OR (r.alt_start IS NOT NULL AND (NOT isfinite(r.alt_start) OR NOT isfinite(r.alt_end))) THEN RAISE EXCEPTION 'Invalid request values'; END IF;
    IF r.proposed_end <= r.proposed_start OR r.alt_end <= r.alt_start THEN RAISE EXCEPTION 'Event end must be after start'; END IF;
    IF r.proposed_start <= now() OR r.alt_start <= now() THEN RAISE EXCEPTION 'Proposed date must be in the future'; END IF;
  END IF;
  r.online_url := CASE WHEN r.is_online THEN nullif(btrim(coalesce(p->>'online_url', '')), '') END;
  IF r.online_url IS NOT NULL AND (length(r.online_url) > 2000 OR r.online_url !~ '^https://[^\s/?#]+\.[^\s]*$') THEN
    RAISE EXCEPTION 'Online meeting link must use https';
  END IF;
  RETURN r;
END $$;

-- One request as the API returns it. Requester names only for reviewers; the event id only when visible.
CREATE FUNCTION public.event_request_json(_r public.event_requests) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object(
    'id', _r.id, 'scope', _r.scope, 'branch_id', _r.branch_id, 'region_id', _r.region_id,
    'branch_name', (SELECT name FROM public.branches WHERE id = _r.branch_id),
    'region_name', (SELECT name FROM public.regions WHERE id = _r.region_id),
    'title', _r.title, 'description', _r.description, 'reason', _r.reason, 'all_day', _r.all_day,
    'proposed_start', _r.proposed_start, 'proposed_end', _r.proposed_end,
    'proposed_start_date', _r.proposed_start_date, 'proposed_end_date', _r.proposed_end_date,
    'alt_start', _r.alt_start, 'alt_end', _r.alt_end, 'alt_start_date', _r.alt_start_date, 'alt_end_date', _r.alt_end_date,
    'location_text', _r.location_text, 'is_online', _r.is_online, 'online_url', _r.online_url,
    'expected_attendees', _r.expected_attendees, 'status', _r.status, 'decline_reason', _r.decline_reason,
    'reviewed_at', _r.reviewed_at, 'created_at', _r.created_at, 'updated_at', _r.updated_at,
    'reviewer_name', (SELECT full_name FROM public.profiles WHERE id = _r.reviewer_id),
    'requester_name', CASE WHEN own THEN NULL ELSE (SELECT full_name FROM public.profiles WHERE id = _r.requester_id) END,
    'event_id', CASE WHEN _r.event_id IS NOT NULL AND public.can_view_event(_r.event_id) THEN _r.event_id END,
    'notice', CASE WHEN own AND _r.notice_seen_at IS NULL THEN _r.notice END,
    'is_own', own,
    'can_edit', own AND _r.status = 'submitted',
    'can_withdraw', own AND _r.status = 'submitted',
    'can_review', NOT own AND _r.status IN ('submitted', 'under_review') AND public.can_review_event_request(_r),
    'can_delete', (own AND _r.status <> 'approved') OR public.can_review_event_request(_r))
  FROM (SELECT _r.requester_id IS NOT DISTINCT FROM auth.uid() AND _r.requester_id IS NOT NULL AS own) o
$$;

-- The locked, visible-to-caller request row (own or reviewable), or 'Request not found'.
CREATE FUNCTION public.event_request_locked(_id uuid) RETURNS public.event_requests
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.event_requests;
BEGIN
  SELECT * INTO r FROM public.event_requests WHERE id = _id FOR UPDATE;
  IF NOT FOUND OR r.deleted_at IS NOT NULL OR NOT (r.requester_id = auth.uid() OR public.can_review_event_request(r)) THEN
    RAISE EXCEPTION 'Request not found';
  END IF;
  RETURN r;
END $$;

-- Recycle Bin restore (called by restore_item). The status is kept: open requests were withdrawn on delete.
CREATE FUNCTION public.restore_event_request(_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.event_requests;
BEGIN
  PERFORM public.event_request_actor();
  SELECT * INTO r FROM public.event_requests WHERE id = _id FOR UPDATE;
  IF NOT FOUND OR r.deleted_at IS NULL OR r.deleted_at <= now() - interval '30 days'
     OR NOT public.can_manage_recycle_scope(auth.uid(), r.branch_id, r.region_id) THEN RAISE EXCEPTION 'Item cannot be restored'; END IF;
  UPDATE public.event_requests SET deleted_at = NULL, deleted_by = NULL WHERE id = _id;
  INSERT INTO public.recycle_bin_audit_log (actor_id, item_type, item_id, action, branch_id, region_id)
    VALUES (auth.uid(), 'event_request', _id, 'restore', r.branch_id, r.region_id);
  RETURN jsonb_build_object('paths', '[]'::jsonb, 'deleted', false);
END $$;

-- 4. Client RPCs --------------------------------------------------------------------------------------------
-- Volunteers: branch requests for their own branch. Branch managers: region requests for their region.
-- Regional directors create events directly. At most 5 open (submitted / under review) requests per user.
CREATE FUNCTION public.submit_event_request(p jsonb) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid uuid := public.event_request_actor(); r public.event_requests; _scope text; _branch uuid; _region uuid; _id uuid;
BEGIN
  PERFORM id FROM public.profiles WHERE id = _uid FOR UPDATE; -- serialises the open-request limit per user
  IF public.has_role(_uid, 'regional_director') THEN RAISE EXCEPTION 'Regional directors create events directly'; END IF;
  _scope := CASE WHEN public.has_role(_uid, 'branch_manager') THEN 'region' ELSE 'branch' END;
  IF coalesce(nullif(p->>'scope', ''), _scope) <> _scope THEN
    IF _scope = 'region' THEN RAISE EXCEPTION 'Branch managers create branch events directly'; END IF;
    RAISE EXCEPTION 'Not allowed';
  END IF;
  _branch := public.get_user_branch(_uid);
  SELECT region_id INTO _region FROM public.branches WHERE id = _branch;
  IF _region IS NULL THEN RAISE EXCEPTION 'Not allowed'; END IF;
  IF (SELECT count(*) FROM public.event_requests WHERE requester_id = _uid AND status IN ('submitted', 'under_review') AND deleted_at IS NULL) >= 5 THEN
    RAISE EXCEPTION 'Too many open requests';
  END IF;
  r := public.event_request_fields(p);
  INSERT INTO public.event_requests (requester_id, scope, branch_id, region_id, title, description, reason, all_day,
    proposed_start, proposed_end, proposed_start_date, proposed_end_date, alt_start, alt_end, alt_start_date, alt_end_date,
    location_text, is_online, online_url, expected_attendees)
  VALUES (_uid, _scope, CASE WHEN _scope = 'branch' THEN _branch END, _region, r.title, r.description, r.reason, r.all_day,
    r.proposed_start, r.proposed_end, r.proposed_start_date, r.proposed_end_date, r.alt_start, r.alt_end, r.alt_start_date, r.alt_end_date,
    r.location_text, r.is_online, r.online_url, r.expected_attendees)
  RETURNING id INTO _id;
  RETURN _id;
END $$;

-- Requester only, while still submitted (not yet under review). Scope and branch never change.
CREATE FUNCTION public.update_event_request(p_id uuid, p jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid uuid := public.event_request_actor(); cur public.event_requests; r public.event_requests;
BEGIN
  cur := public.event_request_locked(p_id);
  IF cur.requester_id IS DISTINCT FROM _uid THEN RAISE EXCEPTION 'Not allowed'; END IF;
  IF cur.status <> 'submitted' THEN RAISE EXCEPTION 'Request can no longer be changed'; END IF;
  r := public.event_request_fields(p);
  UPDATE public.event_requests SET title = r.title, description = r.description, reason = r.reason, all_day = r.all_day,
    proposed_start = r.proposed_start, proposed_end = r.proposed_end, proposed_start_date = r.proposed_start_date, proposed_end_date = r.proposed_end_date,
    alt_start = r.alt_start, alt_end = r.alt_end, alt_start_date = r.alt_start_date, alt_end_date = r.alt_end_date,
    location_text = r.location_text, is_online = r.is_online, online_url = r.online_url, expected_attendees = r.expected_attendees
  WHERE id = p_id;
END $$;

CREATE FUNCTION public.withdraw_event_request(p_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid uuid := public.event_request_actor(); cur public.event_requests;
BEGIN
  cur := public.event_request_locked(p_id);
  IF cur.requester_id IS DISTINCT FROM _uid THEN RAISE EXCEPTION 'Not allowed'; END IF;
  IF cur.status <> 'submitted' THEN RAISE EXCEPTION 'Request can no longer be changed'; END IF;
  UPDATE public.event_requests SET status = 'withdrawn', notice = NULL, notice_seen_at = NULL WHERE id = p_id;
END $$;

-- Reviewer checks shared by start review / approve / decline (row already locked by the caller).
CREATE FUNCTION public.event_request_review_check(_r public.event_requests) RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF _r.requester_id = auth.uid() THEN RAISE EXCEPTION 'You cannot review your own request'; END IF;
  IF NOT public.can_review_event_request(_r) THEN RAISE EXCEPTION 'Request not found'; END IF;
  IF _r.status NOT IN ('submitted', 'under_review') THEN RAISE EXCEPTION 'Request already decided'; END IF;
END $$;

CREATE FUNCTION public.start_review_event_request(p_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid uuid := public.event_request_actor(); cur public.event_requests;
BEGIN
  cur := public.event_request_locked(p_id);
  PERFORM public.event_request_review_check(cur);
  IF cur.status <> 'submitted' THEN RAISE EXCEPTION 'Request already under review'; END IF;
  UPDATE public.event_requests SET status = 'under_review', reviewer_id = _uid, notice = 'under_review', notice_seen_at = NULL WHERE id = p_id;
END $$;

-- Creates a DRAFT event through create_event (same scope and permission rules) from the request plus allowed
-- overrides; the approver becomes its creator. The row lock makes a second (or concurrent) approval fail.
CREATE FUNCTION public.approve_event_request(p_id uuid, p_overrides jsonb DEFAULT '{}'::jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid uuid := public.event_request_actor(); cur public.event_requests; _over jsonb; _event uuid;
BEGIN
  cur := public.event_request_locked(p_id);
  PERFORM public.event_request_review_check(cur);
  IF p_overrides IS NOT NULL AND jsonb_typeof(p_overrides) <> 'object' THEN RAISE EXCEPTION 'Invalid request values'; END IF;
  SELECT coalesce(jsonb_object_agg(key, value), '{}'::jsonb) INTO _over FROM jsonb_each(coalesce(p_overrides, '{}'::jsonb))
  WHERE key IN ('title', 'description', 'location', 'location_type', 'online_url', 'organizer', 'category', 'all_day',
                'start_date', 'end_date', 'start_at', 'end_at', 'capacity', 'registration_enabled');
  _event := public.create_event(
    jsonb_build_object('title', cur.title, 'description', coalesce(cur.description, ''), 'location', coalesce(cur.location_text, ''),
      'location_type', CASE WHEN cur.is_online THEN 'online' ELSE 'in_person' END, 'online_url', cur.online_url,
      'organizer', 'Dialogue Society', 'category', 'dialogue', 'all_day', cur.all_day,
      'start_date', cur.proposed_start_date, 'end_date', cur.proposed_end_date, 'start_at', cur.proposed_start, 'end_at', cur.proposed_end,
      'capacity', NULL, 'registration_enabled', true)
    || _over
    || jsonb_build_object('scope', cur.scope, 'branch_id', cur.branch_id, 'status', 'draft'));
  UPDATE public.event_requests SET status = 'approved', reviewer_id = _uid, reviewed_at = now(), event_id = _event,
    notice = 'approved', notice_seen_at = NULL WHERE id = p_id;
  RETURN jsonb_build_object('request_id', p_id, 'event_id', _event);
END $$;

CREATE FUNCTION public.decline_event_request(p_id uuid, p_reason text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid uuid := public.event_request_actor(); cur public.event_requests; _reason text := btrim(coalesce(p_reason, ''));
BEGIN
  cur := public.event_request_locked(p_id);
  PERFORM public.event_request_review_check(cur);
  IF length(_reason) < 10 OR length(_reason) > 1000 THEN RAISE EXCEPTION 'Decline reason is required'; END IF;
  UPDATE public.event_requests SET status = 'declined', decline_reason = _reason, reviewer_id = _uid, reviewed_at = now(),
    notice = 'declined', notice_seen_at = NULL WHERE id = p_id;
END $$;

CREATE FUNCTION public.list_my_event_requests() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid uuid := public.event_request_actor();
BEGIN
  RETURN coalesce((SELECT jsonb_agg(public.event_request_json(r) ORDER BY r.created_at DESC, r.id)
    FROM public.event_requests r WHERE r.requester_id = _uid AND r.deleted_at IS NULL), '[]'::jsonb);
END $$;

-- p_status: NULL (all), 'submitted', 'under_review' or 'decided' (approved, declined, withdrawn). 50 per page.
CREATE FUNCTION public.list_managed_event_requests(p_status text DEFAULT NULL, p_offset integer DEFAULT 0) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid uuid := public.event_request_actor(); _total bigint; _rows jsonb;
BEGIN
  IF p_status IS NOT NULL AND p_status NOT IN ('submitted', 'under_review', 'decided') THEN RAISE EXCEPTION 'Invalid request values'; END IF;
  -- Paginate in SQL (oldest open request first; decided: most recent decision first) before building rows.
  WITH visible AS (
    SELECT r AS q, row_number() OVER (ORDER BY CASE WHEN p_status = 'decided' THEN coalesce(r.reviewed_at, r.updated_at) END DESC NULLS LAST, r.created_at, r.id) AS n
    FROM public.event_requests r
    WHERE r.deleted_at IS NULL AND public.can_manage_event_scope(r.scope, r.branch_id, r.region_id)
      AND (p_status IS NULL OR (p_status = 'decided' AND r.status IN ('approved', 'declined', 'withdrawn')) OR r.status = p_status)
  ), page AS (
    SELECT q, n FROM visible ORDER BY n LIMIT 50 OFFSET greatest(0, least(coalesce(p_offset, 0), 1000000))
  )
  SELECT (SELECT count(*) FROM visible), coalesce((SELECT jsonb_agg(public.event_request_json(q) ORDER BY n) FROM page), '[]'::jsonb)
  INTO _total, _rows;
  RETURN jsonb_build_object('total', _total, 'rows', _rows);
END $$;

CREATE FUNCTION public.get_event_request(p_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid uuid := public.event_request_actor(); r public.event_requests;
BEGIN
  SELECT * INTO r FROM public.event_requests WHERE id = p_id;
  IF NOT FOUND OR r.deleted_at IS NOT NULL OR NOT (r.requester_id = _uid OR public.can_review_event_request(r)) THEN RAISE EXCEPTION 'Request not found'; END IF;
  RETURN public.event_request_json(r);
END $$;

-- Counts only (dashboard card and menu badge): open requests the caller may count. Zero for everyone else.
CREATE FUNCTION public.get_pending_event_request_count() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid uuid := public.event_request_actor(); _submitted bigint; _review bigint;
BEGIN
  SELECT count(*) FILTER (WHERE status = 'submitted'), count(*) FILTER (WHERE status = 'under_review') INTO _submitted, _review
  FROM public.event_requests
  WHERE deleted_at IS NULL AND status IN ('submitted', 'under_review') AND requester_id IS DISTINCT FROM _uid
    AND public.event_request_countable(scope, branch_id, region_id);
  RETURN jsonb_build_object('submitted', _submitted, 'under_review', _review, 'total', _submitted + _review);
END $$;

CREATE FUNCTION public.dismiss_event_request_notice(p_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid uuid := public.event_request_actor();
BEGIN
  UPDATE public.event_requests SET notice_seen_at = now()
  WHERE id = p_id AND requester_id = _uid AND deleted_at IS NULL AND notice IS NOT NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Request not found'; END IF;
END $$;

-- Recycle Bin: the requester while not approved, or a reviewer of the request's scope.
CREATE FUNCTION public.delete_event_request(p_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid uuid := public.event_request_actor(); cur public.event_requests;
BEGIN
  cur := public.event_request_locked(p_id);
  IF NOT ((cur.requester_id = _uid AND cur.status <> 'approved') OR public.can_review_event_request(cur)) THEN RAISE EXCEPTION 'Not allowed'; END IF;
  -- An open request is withdrawn first, so a restore never reopens it: the 5-open limit cannot be bypassed by
  -- delete / submit / restore, and nothing reappears unannounced in a reviewer's queue.
  UPDATE public.event_requests SET deleted_at = now(), deleted_by = _uid,
    status = CASE WHEN status IN ('submitted', 'under_review') THEN 'withdrawn' ELSE status END,
    notice = CASE WHEN status IN ('submitted', 'under_review') THEN NULL ELSE notice END,
    notice_seen_at = CASE WHEN status IN ('submitted', 'under_review') THEN NULL ELSE notice_seen_at END
  WHERE id = p_id;
  INSERT INTO public.recycle_bin_audit_log (actor_id, item_type, item_id, action, branch_id, region_id)
    VALUES (_uid, 'event_request', p_id, 'delete', cur.branch_id, cur.region_id);
END $$;

-- Nightly cleanup (service role): requests in the Recycle Bin for more than 30 days.
CREATE FUNCTION public.purge_expired_event_requests() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _n integer;
BEGIN
  WITH gone AS (DELETE FROM public.event_requests WHERE deleted_at < now() - interval '30 days' RETURNING id, branch_id, region_id)
  INSERT INTO public.recycle_bin_audit_log (actor_id, item_type, item_id, action, branch_id, region_id)
    SELECT NULL, 'event_request', id, 'permanent_delete', branch_id, region_id FROM gone;
  GET DIAGNOSTICS _n = ROW_COUNT;
  RETURN _n;
END $$;

-- 5. Recycle Bin dispatch: the new 'event_request' type ---------------------------------------------------
CREATE OR REPLACE FUNCTION public.list_recycle_bin(_type text DEFAULT 'all', _search text DEFAULT '', _offset integer DEFAULT 0)
RETURNS TABLE(id uuid, type text, title text, role text, branch text, region text, deleted_by_name text, deleted_at timestamptz,
              days_left integer, can_restore boolean, self_requested boolean, event_count integer, total_count bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles p JOIN user_roles r ON r.user_id = p.id WHERE p.id = auth.uid() AND p.status = 'active' AND p.deleted_at IS NULL AND r.role IN ('branch_manager', 'regional_director')) THEN RAISE EXCEPTION 'Not allowed'; END IF;
  IF _type NOT IN ('all', 'event', 'user', 'series', 'event_request') THEN RAISE EXCEPTION 'Not allowed'; END IF;
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
    UNION ALL
    SELECT q.id, 'event_request', q.title, NULL, b.name, r.name, p.full_name, q.deleted_at,
      greatest(0, ceil(extract(epoch FROM (q.deleted_at + interval '30 days' - now())) / 86400))::integer,
      q.deleted_at > now() - interval '30 days', false, NULL::integer
    FROM event_requests q JOIN regions r ON r.id = q.region_id LEFT JOIN branches b ON b.id = q.branch_id LEFT JOIN profiles p ON p.id = q.deleted_by
    WHERE q.deleted_at IS NOT NULL AND public.can_manage_recycle_scope(auth.uid(), q.branch_id, q.region_id)
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
  IF _type = 'event_request' THEN RETURN public.restore_event_request(_id); END IF;
  IF _type <> 'user' THEN RAISE EXCEPTION 'Not allowed'; END IF;
  PERFORM id FROM profiles WHERE id = auth.uid() FOR UPDATE;
  SELECT * INTO _p FROM profiles WHERE id = _id FOR UPDATE;
  SELECT * INTO _s FROM user_deletion_state WHERE target_id = _id FOR UPDATE;
  IF NOT FOUND OR NOT public.can_manage_deleted_user(auth.uid(), _id) OR _s.self_requested OR _p.deleted_at <= now() - interval '30 days' OR _s.operation NOT IN ('deleted', 'restore') THEN RAISE EXCEPTION 'Item cannot be restored'; END IF;
  UPDATE user_deletion_state SET operation = 'restore', operation_actor = auth.uid(), updated_at = now() WHERE target_id = _id;
  RETURN jsonb_build_object('paths', '[]'::jsonb, 'deleted', false);
END $$;

-- An event request has no external resources (files, Auth), so permanent deletion finishes here ('deleted': true).
CREATE OR REPLACE FUNCTION public.permanent_delete_item(_type text, _id uuid, _confirmation text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _e public.events; _paths jsonb; _s public.event_series; _ids jsonb; _q public.event_requests;
BEGIN
  IF _confirmation IS DISTINCT FROM 'DELETE' THEN RAISE EXCEPTION 'Permanent deletion confirmation required'; END IF;
  PERFORM id FROM profiles WHERE id = auth.uid() FOR UPDATE;
  IF _type = 'user' THEN
    IF NOT public.can_manage_deleted_user(auth.uid(), _id) THEN RAISE EXCEPTION 'Not allowed'; END IF;
    RETURN public.prepare_user_purge(_id, auth.uid());
  ELSIF _type = 'event_request' THEN
    SELECT * INTO _q FROM event_requests WHERE id = _id FOR UPDATE;
    IF NOT FOUND OR _q.deleted_at IS NULL OR NOT public.can_manage_recycle_scope(auth.uid(), _q.branch_id, _q.region_id) THEN RAISE EXCEPTION 'Not allowed'; END IF;
    DELETE FROM event_requests WHERE id = _id;
    INSERT INTO recycle_bin_audit_log (actor_id, item_type, item_id, action, branch_id, region_id) VALUES (auth.uid(), 'event_request', _id, 'permanent_delete', _q.branch_id, _q.region_id);
    RETURN jsonb_build_object('paths', '[]'::jsonb, 'deleted', true);
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

-- 6. Grants -------------------------------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.event_requests_touch(), public.profiles_event_request_sync(), public.event_request_actor(),
  public.event_request_countable(text, uuid, uuid), public.can_review_event_request(public.event_requests),
  public.event_request_fields(jsonb), public.event_request_json(public.event_requests), public.event_request_locked(uuid),
  public.event_request_review_check(public.event_requests), public.restore_event_request(uuid)
FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.purge_expired_event_requests() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purge_expired_event_requests() TO service_role;

REVOKE ALL ON FUNCTION public.submit_event_request(jsonb), public.update_event_request(uuid, jsonb), public.withdraw_event_request(uuid),
  public.start_review_event_request(uuid), public.approve_event_request(uuid, jsonb), public.decline_event_request(uuid, text),
  public.list_my_event_requests(), public.list_managed_event_requests(text, integer), public.get_event_request(uuid),
  public.get_pending_event_request_count(), public.dismiss_event_request_notice(uuid), public.delete_event_request(uuid)
FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_event_request(jsonb), public.update_event_request(uuid, jsonb), public.withdraw_event_request(uuid),
  public.start_review_event_request(uuid), public.approve_event_request(uuid, jsonb), public.decline_event_request(uuid, text),
  public.list_my_event_requests(), public.list_managed_event_requests(text, integer), public.get_event_request(uuid),
  public.get_pending_event_request_count(), public.dismiss_event_request_notice(uuid), public.delete_event_request(uuid)
TO authenticated;

-- Redefined Recycle Bin functions keep their signatures (CREATE OR REPLACE, no new overloads); grants restated.
REVOKE ALL ON FUNCTION public.list_recycle_bin(text, text, integer), public.restore_item(text, uuid),
  public.permanent_delete_item(text, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_recycle_bin(text, text, integer), public.restore_item(text, uuid),
  public.permanent_delete_item(text, uuid, text) TO authenticated;

-- A3 revision: request types and manager editing.
--  * 'proposal' (unchanged): suggest an event we could organise; approval creates a DRAFT.
--  * 'external': an event someone else organises (seen on a leaflet, invited to); approval PUBLISHES it with
--    is_external = true and organizer = organizer_name. Publish fields must be complete, otherwise approval fails.
--  * Reviewers edit open requests (manager_update_event_request) instead of approval overrides; editing moves the
--    request to under_review so the requester can no longer change it at the same time.
--  * Attachments (leaflet / invitation): up to 3 JPG/PNG/WebP/PDF files, 10 MB, in the private bucket
--    'event-request-files'. A row is reserved through an RPC before upload (server-generated path); only the
--    requester and the request's reviewers can read them (5-minute signed URLs); on approval they are copied to the
--    event's media. Storage objects are always removed through Storage before rows (purge is two-phase).

-- 1. Columns -------------------------------------------------------------------------------------------------
ALTER TABLE public.event_requests
  ADD COLUMN request_type text NOT NULL DEFAULT 'proposal' CHECK (request_type IN ('proposal', 'external')),
  ADD COLUMN organizer_name text CHECK (length(btrim(organizer_name)) BETWEEN 1 AND 120),
  ADD COLUMN source text CHECK (source IN ('leaflet', 'invitation', 'website', 'other')),
  ADD COLUMN source_url text CHECK (source_url IS NULL OR (length(source_url) <= 2000 AND source_url ~ '^https://[^\s/?#]+\.[^\s]*$')),
  ADD COLUMN notes text CHECK (length(notes) <= 1000),
  ADD COLUMN category text CHECK (category IN ('dialogue', 'dinner', 'interfaith', 'community', 'education', 'other')),
  ADD COLUMN last_edited_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN last_edited_at timestamptz,
  ADD COLUMN purge_requested_at timestamptz;
ALTER TABLE public.event_requests
  ADD CONSTRAINT event_requests_external_check CHECK (request_type <> 'external' OR (
    organizer_name IS NOT NULL AND source IS NOT NULL AND reason IS NULL AND expected_attendees IS NULL
    AND alt_start IS NULL AND alt_end IS NULL AND alt_start_date IS NULL AND alt_end_date IS NULL)),
  ADD CONSTRAINT event_requests_proposal_check CHECK (request_type <> 'proposal' OR (
    organizer_name IS NULL AND source IS NULL AND source_url IS NULL AND notes IS NULL));
CREATE INDEX event_requests_editor_idx ON public.event_requests (last_edited_by) WHERE last_edited_by IS NOT NULL;

ALTER TABLE public.events ADD COLUMN is_external boolean NOT NULL DEFAULT false;

-- 2. Attachments -----------------------------------------------------------------------------------------------
CREATE TABLE public.event_request_media (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES public.event_requests(id) ON DELETE CASCADE,
  storage_path text NOT NULL UNIQUE,
  kind text NOT NULL CHECK (kind IN ('image', 'pdf')),
  original_name text CHECK (length(original_name) <= 255),
  uploaded_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp() -- keeps upload order inside one transaction
);
CREATE INDEX event_request_media_request_idx ON public.event_request_media (request_id, created_at);
ALTER TABLE public.event_request_media ENABLE ROW LEVEL SECURITY;
-- No client privileges at all: rows are listed through list_event_request_media.
REVOKE ALL ON public.event_request_media FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.event_request_media TO service_role;

-- Private bucket; Storage enforces the MIME list and the 10 MB limit on every upload.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('event-request-files', 'event-request-files', false, 10485760, ARRAY['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
ON CONFLICT (id) DO UPDATE SET public = false, file_size_limit = EXCLUDED.file_size_limit, allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Storage policy helpers (like can_read_event_file): authenticated must be able to execute them because
-- storage.objects RLS runs as the caller; each only answers for the caller's own access to one path.
CREATE FUNCTION public.can_read_event_request_file(_path text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.event_request_media m JOIN public.event_requests r ON r.id = m.request_id
    WHERE m.storage_path = _path AND r.deleted_at IS NULL
      AND EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND status = 'active' AND deleted_at IS NULL)
      AND (r.requester_id = auth.uid() OR public.can_review_event_request(r)))
$$;
-- Writes (upload, remove) only while the request is open: the requester while submitted, reviewers while open.
CREATE FUNCTION public.can_write_event_request_file(_path text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.event_request_media m JOIN public.event_requests r ON r.id = m.request_id
    WHERE m.storage_path = _path AND r.deleted_at IS NULL
      AND EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND status = 'active' AND deleted_at IS NULL)
      AND ((r.requester_id = auth.uid() AND r.status = 'submitted')
        OR (r.status IN ('submitted', 'under_review') AND r.requester_id IS DISTINCT FROM auth.uid() AND public.can_review_event_request(r))))
$$;
CREATE POLICY event_request_files_read ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'event-request-files' AND public.can_read_event_request_file(name));
CREATE POLICY event_request_files_upload ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'event-request-files' AND public.can_write_event_request_file(name)
    AND lower(storage.extension(name)) IN ('jpg', 'png', 'webp', 'pdf'));
CREATE POLICY event_request_files_delete ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'event-request-files' AND public.can_write_event_request_file(name));

-- 3. Validation (per type) -------------------------------------------------------------------------------------
-- Replaces event_request_fields(jsonb): same rules plus the type-specific fields. Old signature dropped below.
CREATE FUNCTION public.event_request_fields(p jsonb, _type text) RETURNS public.event_requests
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.event_requests; _today date := (now() AT TIME ZONE 'Europe/London')::date;
BEGIN
  IF p IS NULL OR jsonb_typeof(p) <> 'object' OR _type NOT IN ('proposal', 'external') THEN RAISE EXCEPTION 'Invalid request values'; END IF;
  r.request_type := _type;
  r.title := btrim(coalesce(p->>'title', ''));
  IF r.title = '' THEN RAISE EXCEPTION 'Request title is required'; END IF;
  r.description := nullif(btrim(coalesce(p->>'description', '')), '');
  r.location_text := nullif(btrim(coalesce(p->>'location_text', '')), '');
  r.category := nullif(p->>'category', '');
  IF length(r.title) > 120 OR length(r.description) > 2000 OR length(r.location_text) > 500
     OR (r.category IS NOT NULL AND r.category NOT IN ('dialogue', 'dinner', 'interfaith', 'community', 'education', 'other')) THEN
    RAISE EXCEPTION 'Invalid request values';
  END IF;
  IF _type = 'proposal' THEN
    r.reason := nullif(btrim(coalesce(p->>'reason', '')), '');
    IF length(r.reason) > 1000 THEN RAISE EXCEPTION 'Invalid request values'; END IF;
  ELSE
    r.organizer_name := nullif(btrim(coalesce(p->>'organizer_name', '')), '');
    r.source := nullif(p->>'source', '');
    r.source_url := nullif(btrim(coalesce(p->>'source_url', '')), '');
    r.notes := nullif(btrim(coalesce(p->>'notes', '')), '');
    IF r.organizer_name IS NULL THEN RAISE EXCEPTION 'Organiser is required'; END IF;
    IF r.source IS NULL OR r.source NOT IN ('leaflet', 'invitation', 'website', 'other') THEN RAISE EXCEPTION 'Invalid request source'; END IF;
    IF length(r.organizer_name) > 120 OR length(r.notes) > 1000 THEN RAISE EXCEPTION 'Invalid request values'; END IF;
    IF r.source_url IS NOT NULL AND (length(r.source_url) > 2000 OR r.source_url !~ '^https://[^\s/?#]+\.[^\s]*$') THEN
      RAISE EXCEPTION 'Source link must use https';
    END IF;
  END IF;
  BEGIN
    r.all_day := coalesce((p->>'all_day')::boolean, false);
    r.is_online := coalesce((p->>'is_online')::boolean, false);
    IF _type = 'proposal' THEN r.expected_attendees := nullif(p->>'expected_attendees', '')::integer; END IF;
    IF r.all_day THEN
      r.proposed_start_date := nullif(p->>'proposed_start_date', '')::date;
      r.proposed_end_date := nullif(p->>'proposed_end_date', '')::date;
      IF _type = 'proposal' THEN
        r.alt_start_date := nullif(p->>'alt_start_date', '')::date;
        r.alt_end_date := nullif(p->>'alt_end_date', '')::date;
      END IF;
    ELSE
      r.proposed_start := nullif(p->>'proposed_start', '')::timestamptz;
      r.proposed_end := nullif(p->>'proposed_end', '')::timestamptz;
      IF _type = 'proposal' THEN
        r.alt_start := nullif(p->>'alt_start', '')::timestamptz;
        r.alt_end := nullif(p->>'alt_end', '')::timestamptz;
      END IF;
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

-- Writes the validated fields of `r` onto request `_id` (never scope, branch, region, type, requester or status).
CREATE FUNCTION public.event_request_apply(_id uuid, r public.event_requests) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE public.event_requests SET title = r.title, description = r.description, reason = r.reason, all_day = r.all_day,
    proposed_start = r.proposed_start, proposed_end = r.proposed_end, proposed_start_date = r.proposed_start_date, proposed_end_date = r.proposed_end_date,
    alt_start = r.alt_start, alt_end = r.alt_end, alt_start_date = r.alt_start_date, alt_end_date = r.alt_end_date,
    location_text = r.location_text, is_online = r.is_online, online_url = r.online_url, expected_attendees = r.expected_attendees,
    organizer_name = r.organizer_name, source = r.source, source_url = r.source_url, notes = r.notes, category = r.category
  WHERE id = _id
$$;

-- 4. JSON shape --------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.event_request_json(_r public.event_requests) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object(
    'id', _r.id, 'request_type', _r.request_type, 'scope', _r.scope, 'branch_id', _r.branch_id, 'region_id', _r.region_id,
    'branch_name', (SELECT name FROM public.branches WHERE id = _r.branch_id),
    'region_name', (SELECT name FROM public.regions WHERE id = _r.region_id),
    'title', _r.title, 'description', _r.description, 'reason', _r.reason, 'all_day', _r.all_day,
    'proposed_start', _r.proposed_start, 'proposed_end', _r.proposed_end,
    'proposed_start_date', _r.proposed_start_date, 'proposed_end_date', _r.proposed_end_date,
    'alt_start', _r.alt_start, 'alt_end', _r.alt_end, 'alt_start_date', _r.alt_start_date, 'alt_end_date', _r.alt_end_date,
    'location_text', _r.location_text, 'is_online', _r.is_online, 'online_url', _r.online_url,
    'expected_attendees', _r.expected_attendees, 'organizer_name', _r.organizer_name, 'source', _r.source,
    'source_url', _r.source_url, 'notes', _r.notes, 'category', _r.category,
    'status', _r.status, 'decline_reason', _r.decline_reason,
    'reviewed_at', _r.reviewed_at, 'created_at', _r.created_at, 'updated_at', _r.updated_at,
    'reviewer_name', (SELECT full_name FROM public.profiles WHERE id = _r.reviewer_id),
    'requester_name', CASE WHEN own THEN NULL ELSE (SELECT full_name FROM public.profiles WHERE id = _r.requester_id) END,
    'edited_by_manager', _r.last_edited_at IS NOT NULL,
    'last_edited_at', _r.last_edited_at,
    'last_edited_by_name', CASE WHEN own THEN NULL ELSE (SELECT full_name FROM public.profiles WHERE id = _r.last_edited_by) END,
    'attachment_count', (SELECT count(*) FROM public.event_request_media WHERE request_id = _r.id),
    'event_id', CASE WHEN _r.event_id IS NOT NULL AND public.can_view_event(_r.event_id) THEN _r.event_id END,
    'notice', CASE WHEN own AND _r.notice_seen_at IS NULL THEN _r.notice END,
    'is_own', own,
    'can_edit', own AND _r.status = 'submitted',
    'can_withdraw', own AND _r.status = 'submitted',
    'can_review', NOT own AND _r.status IN ('submitted', 'under_review') AND public.can_review_event_request(_r),
    'can_delete', (own AND _r.status <> 'approved') OR public.can_review_event_request(_r))
  FROM (SELECT _r.requester_id IS NOT DISTINCT FROM auth.uid() AND _r.requester_id IS NOT NULL AS own) o
$$;

-- 5. Requester RPCs (type-aware) -------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.submit_event_request(p jsonb) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid uuid := public.event_request_actor(); r public.event_requests; _scope text; _branch uuid; _region uuid; _id uuid;
  _type text := coalesce(nullif(p->>'request_type', ''), 'proposal');
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
  r := public.event_request_fields(p - 'category', _type); -- the category is set by reviewers
  INSERT INTO public.event_requests (requester_id, request_type, scope, branch_id, region_id, title, description, reason, all_day,
    proposed_start, proposed_end, proposed_start_date, proposed_end_date, alt_start, alt_end, alt_start_date, alt_end_date,
    location_text, is_online, online_url, expected_attendees, organizer_name, source, source_url, notes)
  VALUES (_uid, _type, _scope, CASE WHEN _scope = 'branch' THEN _branch END, _region, r.title, r.description, r.reason, r.all_day,
    r.proposed_start, r.proposed_end, r.proposed_start_date, r.proposed_end_date, r.alt_start, r.alt_end, r.alt_start_date, r.alt_end_date,
    r.location_text, r.is_online, r.online_url, r.expected_attendees, r.organizer_name, r.source, r.source_url, r.notes)
  RETURNING id INTO _id;
  RETURN _id;
END $$;

CREATE OR REPLACE FUNCTION public.update_event_request(p_id uuid, p jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid uuid := public.event_request_actor(); cur public.event_requests; r public.event_requests;
BEGIN
  cur := public.event_request_locked(p_id);
  IF cur.requester_id IS DISTINCT FROM _uid THEN RAISE EXCEPTION 'Not allowed'; END IF;
  IF cur.status <> 'submitted' THEN RAISE EXCEPTION 'Request can no longer be changed'; END IF;
  IF coalesce(nullif(p->>'request_type', ''), cur.request_type) <> cur.request_type THEN RAISE EXCEPTION 'Request scope and type cannot be changed'; END IF;
  -- The requester keeps the manager-only category untouched.
  r := public.event_request_fields((p - 'category') || jsonb_build_object('category', cur.category), cur.request_type);
  PERFORM public.event_request_apply(p_id, r);
END $$;

-- 6. Reviewer editing ---------------------------------------------------------------------------------------------
-- Same validation as the requester's form; scope, branch, region, type, requester and status cannot be changed.
-- Editing moves a submitted request to under_review, which locks the requester out of editing at the same time.
CREATE FUNCTION public.manager_update_event_request(p_id uuid, p jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid uuid := public.event_request_actor(); cur public.event_requests; r public.event_requests;
BEGIN
  cur := public.event_request_locked(p_id);
  PERFORM public.event_request_review_check(cur);
  IF p IS NULL OR jsonb_typeof(p) <> 'object' THEN RAISE EXCEPTION 'Invalid request values'; END IF;
  IF (p ? 'request_type' AND p->>'request_type' IS DISTINCT FROM cur.request_type)
     OR (p ? 'scope' AND p->>'scope' IS DISTINCT FROM cur.scope)
     OR (p ? 'branch_id' AND nullif(p->>'branch_id', '') IS DISTINCT FROM cur.branch_id::text)
     OR (p ? 'region_id' AND p->>'region_id' IS DISTINCT FROM cur.region_id::text)
     OR (p ? 'requester_id' AND p->>'requester_id' IS DISTINCT FROM cur.requester_id::text)
     OR (p ? 'status' AND p->>'status' IS DISTINCT FROM cur.status) THEN
    RAISE EXCEPTION 'Request scope and type cannot be changed';
  END IF;
  r := public.event_request_fields(p, cur.request_type);
  PERFORM public.event_request_apply(p_id, r);
  UPDATE public.event_requests SET last_edited_by = _uid, last_edited_at = now(), status = 'under_review', reviewer_id = _uid,
    notice = CASE WHEN status = 'submitted' THEN 'under_review' ELSE notice END,
    notice_seen_at = CASE WHEN status = 'submitted' THEN NULL ELSE notice_seen_at END
  WHERE id = p_id;
END $$;

-- 7. Approval -------------------------------------------------------------------------------------------------------
-- Overrides are gone: reviewers edit the request first (one editing path). Proposals become a DRAFT; external
-- requests are PUBLISHED (publish fields required). Attachments get event_media rows (within the 5-file limit)
-- and the server copies the files; returns the copies to make.
DROP FUNCTION public.approve_event_request(uuid, jsonb);
CREATE FUNCTION public.approve_event_request(p_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid uuid := public.event_request_actor(); cur public.event_requests; _event uuid; _external boolean; _copies jsonb := '[]'::jsonb;
  _m public.event_request_media; _media uuid; _ext text; _pos integer := 0;
BEGIN
  cur := public.event_request_locked(p_id);
  PERFORM public.event_request_review_check(cur);
  _external := cur.request_type = 'external';
  IF _external AND (cur.category IS NULL
     OR (cur.all_day AND cur.proposed_start_date IS NULL) OR (NOT cur.all_day AND (cur.proposed_start IS NULL OR cur.proposed_end IS NULL))
     OR (cur.is_online AND cur.online_url IS NULL) OR (NOT cur.is_online AND cur.location_text IS NULL)) THEN
    RAISE EXCEPTION 'Required publish fields missing';
  END IF;
  _event := public.create_event(jsonb_build_object('title', cur.title, 'description', coalesce(cur.description, ''),
    'location', coalesce(cur.location_text, ''), 'location_type', CASE WHEN cur.is_online THEN 'online' ELSE 'in_person' END,
    'online_url', cur.online_url, 'organizer', CASE WHEN _external THEN cur.organizer_name ELSE 'Dialogue Society' END,
    'category', coalesce(cur.category, 'dialogue'), 'all_day', cur.all_day,
    'start_date', cur.proposed_start_date, 'end_date', cur.proposed_end_date, 'start_at', cur.proposed_start, 'end_at', cur.proposed_end,
    'capacity', NULL, 'registration_enabled', true, 'scope', cur.scope, 'branch_id', cur.branch_id,
    'status', CASE WHEN _external THEN 'published' ELSE 'draft' END));
  IF _external THEN UPDATE public.events SET is_external = true WHERE id = _event; END IF;
  FOR _m IN SELECT * FROM public.event_request_media WHERE request_id = p_id ORDER BY CASE WHEN kind = 'image' THEN 0 ELSE 1 END, created_at, id LIMIT 5 LOOP
    _media := gen_random_uuid();
    _ext := lower(regexp_replace(_m.storage_path, '^.*\.', ''));
    INSERT INTO public.event_media (id, event_id, storage_path, kind, position, uploaded_by, original_name)
    VALUES (_media, _event, _event::text || '/' || _media::text || '.' || _ext, _m.kind, _pos, _uid, _m.original_name);
    _copies := _copies || jsonb_build_object('media_id', _media, 'from', _m.storage_path, 'to', _event::text || '/' || _media::text || '.' || _ext);
    _pos := _pos + 1;
  END LOOP;
  UPDATE public.event_requests SET status = 'approved', reviewer_id = _uid, reviewed_at = now(), event_id = _event,
    notice = 'approved', notice_seen_at = NULL WHERE id = p_id;
  RETURN jsonb_build_object('request_id', p_id, 'event_id', _event, 'published', _external, 'copies', _copies);
END $$;

-- Possible duplicates for the review screen (warning only): visible events on the same London day whose title
-- contains the request title or the other way round (case-insensitive).
CREATE FUNCTION public.get_event_request_duplicates(p_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid uuid := public.event_request_actor(); r public.event_requests; _day date;
BEGIN
  SELECT * INTO r FROM public.event_requests WHERE id = p_id;
  IF NOT FOUND OR NOT public.can_review_event_request(r) THEN RAISE EXCEPTION 'Request not found'; END IF;
  _day := CASE WHEN r.all_day THEN r.proposed_start_date ELSE (r.proposed_start AT TIME ZONE 'Europe/London')::date END;
  RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('id', e.id, 'title', e.title, 'status', e.status, 'all_day', e.all_day,
      'start_at', e.start_at, 'start_date', e.start_date) ORDER BY e.start_at, e.start_date, e.id)
    FROM public.events e
    WHERE e.deleted_at IS NULL AND NOT e.series_template AND e.region_id = r.region_id
      AND (r.event_id IS NULL OR e.id <> r.event_id)
      AND (CASE WHEN e.all_day THEN _day BETWEEN e.start_date AND coalesce(e.end_date, e.start_date)
                ELSE (e.start_at AT TIME ZONE 'Europe/London')::date = _day END)
      AND (position(lower(r.title) IN lower(e.title)) > 0 OR position(lower(e.title) IN lower(r.title)) > 0)
      AND public.can_view_event(e.id)), '[]'::jsonb);
END $$;

-- 8. Attachment RPCs --------------------------------------------------------------------------------------------------
-- Reserves a server-generated path for one upload; at most 3 files per request.
CREATE FUNCTION public.add_event_request_media(p_request_id uuid, p_kind text, p_extension text, p_original_name text DEFAULT '') RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid uuid := public.event_request_actor(); cur public.event_requests; _id uuid := gen_random_uuid();
  _ext text := CASE WHEN lower(p_extension) = 'jpeg' THEN 'jpg' ELSE lower(p_extension) END; _path text;
BEGIN
  cur := public.event_request_locked(p_request_id);
  IF NOT ((cur.requester_id = _uid AND cur.status = 'submitted')
     OR (cur.requester_id IS DISTINCT FROM _uid AND cur.status IN ('submitted', 'under_review') AND public.can_review_event_request(cur))) THEN
    RAISE EXCEPTION 'Request can no longer be changed';
  END IF;
  IF p_kind IS NULL OR _ext IS NULL OR NOT ((p_kind = 'image' AND _ext IN ('jpg', 'png', 'webp')) OR (p_kind = 'pdf' AND _ext = 'pdf')) THEN
    RAISE EXCEPTION 'Invalid request file';
  END IF;
  IF (SELECT count(*) FROM public.event_request_media WHERE request_id = p_request_id) >= 3 THEN RAISE EXCEPTION 'Maximum 3 files per request'; END IF;
  _path := p_request_id::text || '/' || _id::text || '.' || _ext;
  INSERT INTO public.event_request_media (id, request_id, storage_path, kind, original_name, uploaded_by)
  VALUES (_id, p_request_id, _path, p_kind, nullif(left(btrim(coalesce(p_original_name, '')), 255), ''), _uid);
  RETURN jsonb_build_object('id', _id, 'storage_path', _path, 'kind', p_kind);
END $$;

-- Removes a reserved/uploaded attachment row; the stored file must be removed through Storage first.
CREATE FUNCTION public.delete_event_request_media(p_media_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid uuid := public.event_request_actor(); _m public.event_request_media;
BEGIN
  SELECT * INTO _m FROM public.event_request_media WHERE id = p_media_id FOR UPDATE;
  IF NOT FOUND OR NOT public.can_write_event_request_file(_m.storage_path) THEN RAISE EXCEPTION 'Not allowed'; END IF;
  IF EXISTS (SELECT 1 FROM storage.objects WHERE bucket_id = 'event-request-files' AND name = _m.storage_path) THEN RAISE EXCEPTION 'Remove stored file first'; END IF;
  DELETE FROM public.event_request_media WHERE id = p_media_id;
END $$;

CREATE FUNCTION public.list_event_request_media(p_request_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid uuid := public.event_request_actor(); r public.event_requests;
BEGIN
  SELECT * INTO r FROM public.event_requests WHERE id = p_request_id;
  IF NOT FOUND OR r.deleted_at IS NOT NULL OR NOT (r.requester_id = _uid OR public.can_review_event_request(r)) THEN RAISE EXCEPTION 'Request not found'; END IF;
  RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('id', m.id, 'storage_path', m.storage_path, 'kind', m.kind, 'original_name', m.original_name,
      'uploaded', EXISTS (SELECT 1 FROM storage.objects o WHERE o.bucket_id = 'event-request-files' AND o.name = m.storage_path)) ORDER BY m.created_at, m.id)
    FROM public.event_request_media m WHERE m.request_id = p_request_id), '[]'::jsonb);
END $$;

-- 9. Purge: Storage first, then rows ---------------------------------------------------------------------------------
-- Manual permanent deletion: with stored files the RPC returns their paths (deleted: false); the server removes them
-- and then calls purge_event_request (service role), which refuses while any file is still stored.
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
    INSERT INTO recycle_bin_audit_log (actor_id, item_type, item_id, action, branch_id, region_id) VALUES (auth.uid(), 'event_request', _id, 'permanent_delete', _q.branch_id, _q.region_id);
    SELECT coalesce(jsonb_agg(o.name ORDER BY o.name), '[]'::jsonb) INTO _paths FROM storage.objects o
      WHERE o.bucket_id = 'event-request-files' AND o.name LIKE _id::text || '/%';
    IF _paths <> '[]'::jsonb THEN
      UPDATE event_requests SET purge_requested_at = now() WHERE id = _id;
      RETURN jsonb_build_object('paths', _paths, 'deleted', false, 'bucket', 'event-request-files');
    END IF;
    DELETE FROM event_requests WHERE id = _id;
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

-- Service role only. Without _finalize: the stored paths of a request in the Recycle Bin that may be purged (manual
-- purge requested, or 30 days passed). With _finalize: deletes the row once no file is stored any more.
CREATE FUNCTION public.purge_event_request(_id uuid, _finalize boolean DEFAULT false) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _q public.event_requests; _paths jsonb;
BEGIN
  SELECT * INTO _q FROM public.event_requests WHERE id = _id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('paths', '[]'::jsonb, 'deleted', true); END IF;
  IF _q.deleted_at IS NULL OR (_q.purge_requested_at IS NULL AND _q.deleted_at >= now() - interval '30 days') THEN RAISE EXCEPTION 'Item cannot be purged'; END IF;
  SELECT coalesce(jsonb_agg(o.name ORDER BY o.name), '[]'::jsonb) INTO _paths FROM storage.objects o
    WHERE o.bucket_id = 'event-request-files' AND o.name LIKE _id::text || '/%';
  IF NOT _finalize THEN RETURN jsonb_build_object('paths', _paths, 'deleted', false); END IF;
  IF _paths <> '[]'::jsonb THEN RAISE EXCEPTION 'Event files still exist'; END IF;
  DELETE FROM public.event_requests WHERE id = _id;
  IF _q.purge_requested_at IS NULL THEN
    INSERT INTO public.recycle_bin_audit_log (actor_id, item_type, item_id, action, branch_id, region_id)
      VALUES (NULL, 'event_request', _id, 'permanent_delete', _q.branch_id, _q.region_id);
  END IF;
  RETURN jsonb_build_object('paths', '[]'::jsonb, 'deleted', true);
END $$;

-- Nightly cleanup: only requests without stored files; the server purges the others first through purge_event_request.
CREATE OR REPLACE FUNCTION public.purge_expired_event_requests() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _n integer;
BEGIN
  WITH gone AS (
    DELETE FROM public.event_requests q WHERE q.deleted_at < now() - interval '30 days'
      AND NOT EXISTS (SELECT 1 FROM storage.objects o WHERE o.bucket_id = 'event-request-files' AND o.name LIKE q.id::text || '/%')
    RETURNING id, branch_id, region_id)
  INSERT INTO public.recycle_bin_audit_log (actor_id, item_type, item_id, action, branch_id, region_id)
    SELECT NULL, 'event_request', id, 'permanent_delete', branch_id, region_id FROM gone;
  GET DIAGNOSTICS _n = ROW_COUNT;
  RETURN _n;
END $$;

-- A manual purge that has started (files being removed) can no longer be restored.
CREATE OR REPLACE FUNCTION public.restore_event_request(_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.event_requests;
BEGIN
  PERFORM public.event_request_actor();
  SELECT * INTO r FROM public.event_requests WHERE id = _id FOR UPDATE;
  IF NOT FOUND OR r.deleted_at IS NULL OR r.deleted_at <= now() - interval '30 days' OR r.purge_requested_at IS NOT NULL
     OR NOT public.can_manage_recycle_scope(auth.uid(), r.branch_id, r.region_id) THEN RAISE EXCEPTION 'Item cannot be restored'; END IF;
  UPDATE public.event_requests SET deleted_at = NULL, deleted_by = NULL WHERE id = _id;
  INSERT INTO public.recycle_bin_audit_log (actor_id, item_type, item_id, action, branch_id, region_id)
    VALUES (auth.uid(), 'event_request', _id, 'restore', r.branch_id, r.region_id);
  RETURN jsonb_build_object('paths', '[]'::jsonb, 'deleted', false);
END $$;

-- 10. Old overloads and grants --------------------------------------------------------------------------------------
DROP FUNCTION public.event_request_fields(jsonb);

REVOKE ALL ON FUNCTION public.event_request_fields(jsonb, text), public.event_request_apply(uuid, public.event_requests),
  public.event_request_json(public.event_requests), public.restore_event_request(uuid), public.purge_event_request(uuid, boolean),
  public.purge_expired_event_requests()
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purge_event_request(uuid, boolean), public.purge_expired_event_requests() TO service_role;

REVOKE ALL ON FUNCTION public.can_read_event_request_file(text), public.can_write_event_request_file(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_read_event_request_file(text), public.can_write_event_request_file(text) TO authenticated;

REVOKE ALL ON FUNCTION public.submit_event_request(jsonb), public.update_event_request(uuid, jsonb), public.manager_update_event_request(uuid, jsonb),
  public.approve_event_request(uuid), public.get_event_request_duplicates(uuid), public.add_event_request_media(uuid, text, text, text),
  public.delete_event_request_media(uuid), public.list_event_request_media(uuid), public.permanent_delete_item(text, uuid, text)
FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_event_request(jsonb), public.update_event_request(uuid, jsonb), public.manager_update_event_request(uuid, jsonb),
  public.approve_event_request(uuid), public.get_event_request_duplicates(uuid), public.add_event_request_media(uuid, text, text, text),
  public.delete_event_request_media(uuid), public.list_event_request_media(uuid), public.permanent_delete_item(text, uuid, text)
TO authenticated;

-- Server-side privacy notice enforcement for every client-callable SECURITY DEFINER write RPC.
-- Reads were already restricted (RESTRICTIVE privacy_notice_required policies) and server functions use requireMember;
-- a member who has not confirmed the current notice could still call these RPCs straight through PostgREST.
--
-- Each function below is redefined from its current definition with one added first statement:
--   PERFORM public.require_privacy_accepted();
-- Nothing else changes. CREATE OR REPLACE keeps the existing grants (authenticated only, no anon).
--
-- Not checked on purpose:
--   accept_privacy_notice                         – the confirmation itself.
--   request_account_deletion, cancel_account_deletion – erasure must not depend on accepting the notice
--                                                   (the confirmation screen links to account deletion).
--   Service-role calls (auth.uid() IS NULL)       – cleanup jobs and server-only purge RPCs.

CREATE FUNCTION public.require_privacy_accepted() RETURNS void
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.has_accepted_privacy_notice() THEN
    RAISE EXCEPTION 'Privacy notice not accepted' USING ERRCODE = '42501';
  END IF;
END
$$;
-- Called only from inside the SECURITY DEFINER functions below (as their owner); never directly by clients.
REVOKE ALL ON FUNCTION public.require_privacy_accepted() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.add_event_media(_event uuid, _kind text, _extension text, _original_name text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _id uuid:=gen_random_uuid(); _position integer; _name text := nullif(left(btrim(coalesce(_original_name,'')),255),'');
BEGIN
  PERFORM public.require_privacy_accepted();
 _extension := CASE WHEN lower(_extension) = 'jpeg' THEN 'jpg' ELSE lower(_extension) END;
 PERFORM id FROM public.profiles WHERE id=auth.uid() FOR UPDATE;
 PERFORM id FROM public.events WHERE id=_event FOR UPDATE;
 IF NOT FOUND OR NOT public.can_manage_event(_event) THEN RAISE EXCEPTION 'Not allowed'; END IF;
 IF _kind IS NULL OR _extension IS NULL OR NOT ((_kind='image' AND _extension IN ('jpg','png','webp')) OR (_kind='pdf' AND _extension='pdf') OR (_kind='document' AND _extension IN ('docx','pptx'))) THEN RAISE EXCEPTION 'Invalid event file'; END IF;
 SELECT count(*) INTO _position FROM public.event_media WHERE event_id=_event;
 IF _position>=5 THEN RAISE EXCEPTION 'Maximum 5 files per event'; END IF;
 INSERT INTO public.event_media(id,event_id,storage_path,kind,position,uploaded_by,original_name) VALUES(_id,_event,_event::text||'/'||_id::text||'.'||_extension,_kind,_position,auth.uid(),_name);
 RETURN _id;
END $function$;

CREATE OR REPLACE FUNCTION public.add_event_request_media(p_request_id uuid, p_kind text, p_extension text, p_original_name text DEFAULT ''::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _uid uuid := public.event_request_actor(); cur public.event_requests; _id uuid := gen_random_uuid();
  _ext text := CASE WHEN lower(p_extension) = 'jpeg' THEN 'jpg' ELSE lower(p_extension) END; _path text;
BEGIN
  PERFORM public.require_privacy_accepted();
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
END $function$;

CREATE OR REPLACE FUNCTION public.approve_event_request(p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _uid uuid := public.event_request_actor(); cur public.event_requests; _event uuid; _external boolean; _copies jsonb := '[]'::jsonb;
  _m public.event_request_media; _media uuid; _ext text; _pos integer := 0;
BEGIN
  PERFORM public.require_privacy_accepted();
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
END $function$;

CREATE OR REPLACE FUNCTION public.cancel_event(_event uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public.require_privacy_accepted();
 PERFORM id FROM public.profiles WHERE id=auth.uid() FOR UPDATE;
 PERFORM id FROM public.events WHERE id=_event FOR UPDATE;
 IF NOT FOUND OR NOT public.can_manage_event(_event) THEN RAISE EXCEPTION 'Not allowed'; END IF;
 UPDATE public.events SET status='cancelled' WHERE id=_event;
END $function$;

CREATE OR REPLACE FUNCTION public.cancel_registration(p_event_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _uid uuid := auth.uid(); _e public.events; _r public.event_registrations; _was text;
BEGIN
  PERFORM public.require_privacy_accepted();
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
END $function$;

CREATE OR REPLACE FUNCTION public.create_event(_data jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _id uuid; _branch uuid := nullif(_data->>'branch_id', '')::uuid; _region uuid; _scope text := _data->>'scope';
BEGIN
  PERFORM public.require_privacy_accepted();
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
END $function$;

CREATE OR REPLACE FUNCTION public.create_series(_data jsonb, _rule text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _branch uuid := nullif(_data->>'branch_id', '')::uuid; _scope text := _data->>'scope'; _region uuid;
  _status text := coalesce(nullif(_data->>'status', ''), 'published'); _t record; _sid uuid; _mid uuid; _first uuid; _n integer; _prev text;
BEGIN
  PERFORM public.require_privacy_accepted();
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
END $function$;

CREATE OR REPLACE FUNCTION public.decline_event_request(p_id uuid, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _uid uuid := public.event_request_actor(); cur public.event_requests; _reason text := btrim(coalesce(p_reason, ''));
BEGIN
  PERFORM public.require_privacy_accepted();
  cur := public.event_request_locked(p_id);
  PERFORM public.event_request_review_check(cur);
  IF length(_reason) < 10 OR length(_reason) > 1000 THEN RAISE EXCEPTION 'Decline reason is required'; END IF;
  UPDATE public.event_requests SET status = 'declined', decline_reason = _reason, reviewer_id = _uid, reviewed_at = now(),
    notice = 'declined', notice_seen_at = NULL WHERE id = p_id;
END $function$;

CREATE OR REPLACE FUNCTION public.delete_event(_event uuid, _title text DEFAULT NULL::text, _complete boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _e public.events; _paths jsonb;
BEGIN
  PERFORM public.require_privacy_accepted();
 PERFORM id FROM profiles WHERE id=auth.uid() FOR UPDATE;
 SELECT * INTO _e FROM events WHERE id=_event FOR UPDATE;
 IF NOT FOUND OR NOT public.can_manage_event_scope(_e.scope,_e.branch_id,_e.region_id) OR EXISTS(SELECT 1 FROM event_deletion_jobs WHERE event_id=_event AND operation NOT IN ('archive')) THEN RAISE EXCEPTION 'Not allowed'; END IF;
 IF _e.deleted_at IS NULL THEN
  IF NOT public.can_manage_event(_event) THEN RAISE EXCEPTION 'Not allowed'; END IF;
  UPDATE events SET deleted_at=now(),deleted_by=auth.uid() WHERE id=_event;
  INSERT INTO event_audit_log(actor_id,event_id,action,scope,branch_id,region_id) VALUES(auth.uid(),_event,'event_deleted',_e.scope,_e.branch_id,_e.region_id);
  INSERT INTO recycle_bin_audit_log(actor_id,item_type,item_id,action,branch_id,region_id) VALUES(auth.uid(),'event',_event,'delete',_e.branch_id,_e.region_id);
 END IF;
 IF _complete THEN
  IF EXISTS(SELECT 1 FROM storage.objects WHERE bucket_id='event-media' AND name LIKE _event::text||'/%') THEN RAISE EXCEPTION 'Event files still exist'; END IF;
  DELETE FROM event_deletion_jobs WHERE event_id=_event AND operation='archive';
  RETURN jsonb_build_object('paths','[]'::jsonb,'deleted',true);
 END IF;
 INSERT INTO event_deletion_jobs(event_id,requested_by,operation) VALUES(_event,auth.uid(),'archive') ON CONFLICT(event_id) DO NOTHING;
 SELECT coalesce(jsonb_agg(path ORDER BY path),'[]'::jsonb) INTO _paths FROM (SELECT storage_path AS path FROM event_media WHERE event_id=_event UNION SELECT name FROM storage.objects WHERE bucket_id='event-media' AND name LIKE _event::text||'/%') files;
 RETURN jsonb_build_object('paths',_paths,'deleted',true);
END $function$;

CREATE OR REPLACE FUNCTION public.delete_event_media(_media uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _event uuid;
BEGIN
  PERFORM public.require_privacy_accepted();
 PERFORM id FROM public.profiles WHERE id=auth.uid() FOR UPDATE;
 SELECT event_id INTO _event FROM public.event_media WHERE id=_media;
 PERFORM id FROM public.events WHERE id=_event FOR UPDATE;
 IF NOT FOUND OR NOT public.can_manage_event(_event) THEN RAISE EXCEPTION 'Not allowed'; END IF;
 IF EXISTS(SELECT 1 FROM storage.objects o JOIN public.event_media m ON m.storage_path=o.name WHERE m.id=_media AND o.bucket_id='event-media') THEN RAISE EXCEPTION 'Remove stored file first'; END IF;
 DELETE FROM public.event_media WHERE id=_media;
 WITH ordered AS (SELECT id,row_number() OVER(ORDER BY CASE WHEN kind='image' THEN 0 ELSE 1 END,position,id)-1 AS pos FROM public.event_media WHERE event_id=_event)
 UPDATE public.event_media m SET position=ordered.pos,updated_at=now() FROM ordered WHERE m.id=ordered.id;
END $function$;

CREATE OR REPLACE FUNCTION public.delete_event_request(p_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _uid uuid := public.event_request_actor(); cur public.event_requests;
BEGIN
  PERFORM public.require_privacy_accepted();
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
END $function$;

CREATE OR REPLACE FUNCTION public.delete_event_request_media(p_media_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _uid uuid := public.event_request_actor(); _m public.event_request_media;
BEGIN
  PERFORM public.require_privacy_accepted();
  SELECT * INTO _m FROM public.event_request_media WHERE id = p_media_id FOR UPDATE;
  IF NOT FOUND OR NOT public.can_write_event_request_file(_m.storage_path) THEN RAISE EXCEPTION 'Not allowed'; END IF;
  IF EXISTS (SELECT 1 FROM storage.objects WHERE bucket_id = 'event-request-files' AND name = _m.storage_path) THEN RAISE EXCEPTION 'Remove stored file first'; END IF;
  DELETE FROM public.event_request_media WHERE id = p_media_id;
END $function$;

CREATE OR REPLACE FUNCTION public.delete_series(_event uuid, _mode text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _e public.events; _s public.event_series; _target uuid; _paths jsonb := '[]'::jsonb; _n integer; _remaining integer; _done integer; _rule text; _prev text;
BEGIN
  PERFORM public.require_privacy_accepted();
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
END $function$;

CREATE OR REPLACE FUNCTION public.dismiss_event_request_notice(p_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _uid uuid := public.event_request_actor();
BEGIN
  PERFORM public.require_privacy_accepted();
  UPDATE public.event_requests SET notice_seen_at = now()
  WHERE id = p_id AND requester_id = _uid AND deleted_at IS NULL AND notice IS NOT NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Request not found'; END IF;
END $function$;

CREATE OR REPLACE FUNCTION public.dismiss_registration_notice(p_registration_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public.require_privacy_accepted();
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not signed in'; END IF;
  UPDATE public.event_registrations SET notice_seen_at = now()
  WHERE id = p_registration_id AND user_id = auth.uid() AND notice IS NOT NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Registration not found'; END IF;
END $function$;

CREATE OR REPLACE FUNCTION public.finish_series_deletion(_series uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _s public.event_series;
BEGIN
  PERFORM public.require_privacy_accepted();
  SELECT * INTO _s FROM public.event_series WHERE id = _series FOR UPDATE;
  IF NOT FOUND OR _s.deleted_at IS NULL OR NOT public.can_manage_recycle_scope(auth.uid(), _s.branch_id, _s.region_id) THEN RAISE EXCEPTION 'Not allowed'; END IF;
  IF _s.media_event_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.event_deletion_jobs WHERE event_id = _s.media_event_id AND operation = 'archive') THEN
    IF EXISTS (SELECT 1 FROM storage.objects WHERE bucket_id = 'event-media' AND name LIKE _s.media_event_id::text || '/%') THEN RAISE EXCEPTION 'Event files still exist'; END IF;
    DELETE FROM public.event_deletion_jobs WHERE event_id = _s.media_event_id AND operation = 'archive';
  END IF;
  RETURN jsonb_build_object('paths', '[]'::jsonb, 'deleted', true);
END $function$;

CREATE OR REPLACE FUNCTION public.manager_update_event_request(p_id uuid, p jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _uid uuid := public.event_request_actor(); cur public.event_requests; r public.event_requests;
BEGIN
  PERFORM public.require_privacy_accepted();
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
END $function$;

CREATE OR REPLACE FUNCTION public.mark_attendance(p_registration_id uuid, p_status text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _uid uuid := auth.uid(); _event uuid; _e public.events; _r public.event_registrations;
BEGIN
  PERFORM public.require_privacy_accepted();
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
END $function$;

CREATE OR REPLACE FUNCTION public.permanent_delete_item(_type text, _id uuid, _confirmation text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _e public.events; _paths jsonb; _s public.event_series; _ids jsonb; _q public.event_requests;
BEGIN
  PERFORM public.require_privacy_accepted();
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
END $function$;

CREATE OR REPLACE FUNCTION public.register_for_event(p_event_id uuid, p_show_name boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _uid uuid := auth.uid(); _e public.events; _r public.event_registrations; _existing boolean; _status text;
BEGIN
  PERFORM public.require_privacy_accepted();
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
      show_name = _r.show_name AND coalesce(p_show_name, true), notice = NULL, notice_seen_at = NULL,
      attendance_marked_by = NULL, attendance_marked_at = NULL
    WHERE id = _r.id RETURNING * INTO _r;
  ELSE
    INSERT INTO public.event_registrations (event_id, user_id, status, show_name)
    VALUES (p_event_id, _uid, _status, coalesce(p_show_name, true)) RETURNING * INTO _r;
  END IF;
  RETURN public.registration_result(_r);
END $function$;

CREATE OR REPLACE FUNCTION public.reorder_event_media(_event uuid, _ids uuid[])
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _count integer;
BEGIN
  PERFORM public.require_privacy_accepted();
 PERFORM id FROM public.profiles WHERE id=auth.uid() FOR UPDATE;
 PERFORM id FROM public.events WHERE id=_event FOR UPDATE;
 IF NOT FOUND OR NOT public.can_manage_event(_event) THEN RAISE EXCEPTION 'Not allowed'; END IF;
 SELECT count(*) INTO _count FROM public.event_media WHERE event_id=_event;
 IF _ids IS NULL OR cardinality(_ids)<>_count OR (SELECT count(DISTINCT i) FROM unnest(_ids) i)<>_count OR EXISTS(SELECT 1 FROM unnest(_ids) i WHERE i IS NULL OR NOT EXISTS(SELECT 1 FROM public.event_media WHERE id=i AND event_id=_event)) THEN RAISE EXCEPTION 'Invalid event file order'; END IF;
 IF _count>0 AND (SELECT kind FROM public.event_media WHERE id=_ids[1])<>'image' AND EXISTS(SELECT 1 FROM public.event_media WHERE event_id=_event AND kind='image') THEN RAISE EXCEPTION 'Cover must be an image'; END IF;
 UPDATE public.event_media m SET position=a.ord-1,updated_at=now() FROM unnest(_ids) WITH ORDINALITY a(id,ord) WHERE m.id=a.id AND m.event_id=_event;
END $function$;

CREATE OR REPLACE FUNCTION public.restore_event(_event uuid, _finalize boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _e public.events; _paths jsonb;
BEGIN
  PERFORM public.require_privacy_accepted();
 PERFORM id FROM profiles WHERE id=auth.uid() FOR UPDATE;
 SELECT * INTO _e FROM events WHERE id=_event FOR UPDATE;
 IF NOT FOUND OR NOT public.can_restore_event(_event) THEN RAISE EXCEPTION 'Event cannot be restored'; END IF;
 INSERT INTO event_deletion_jobs(event_id,requested_by,operation) VALUES(_event,auth.uid(),'restore') ON CONFLICT(event_id) DO UPDATE SET operation='restore',requested_by=auth.uid() WHERE event_deletion_jobs.operation IN ('archive','restore');
 SELECT coalesce(jsonb_agg(storage_path ORDER BY storage_path),'[]'::jsonb) INTO _paths FROM event_media WHERE event_id=_event;
 IF NOT _finalize THEN RETURN jsonb_build_object('paths',_paths,'deleted',false); END IF;
 -- Failed reservations are discarded; real archived files must have been restored through Storage.
 DELETE FROM event_media m WHERE event_id=_event AND NOT EXISTS(SELECT 1 FROM storage.objects o WHERE o.bucket_id='event-media' AND (o.name=m.storage_path OR o.name='deleted/'||m.storage_path));
 IF EXISTS(SELECT 1 FROM event_media m WHERE m.event_id=_event AND NOT EXISTS(SELECT 1 FROM storage.objects o WHERE o.bucket_id='event-media' AND o.name=m.storage_path)) THEN RAISE EXCEPTION 'Event restoration files missing'; END IF;
 UPDATE events SET deleted_at=NULL,deleted_by=NULL WHERE id=_event;
 INSERT INTO event_audit_log(actor_id,event_id,action,scope,branch_id,region_id) VALUES(auth.uid(),_event,'event_restored',_e.scope,_e.branch_id,_e.region_id);
 INSERT INTO recycle_bin_audit_log(actor_id,item_type,item_id,action,branch_id,region_id) VALUES(auth.uid(),'event',_event,'restore',_e.branch_id,_e.region_id);
 DELETE FROM event_deletion_jobs WHERE event_id=_event;
 RETURN jsonb_build_object('paths','[]'::jsonb,'deleted',false);
END $function$;

CREATE OR REPLACE FUNCTION public.restore_item(_type text, _id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _p public.profiles; _s public.user_deletion_state;
BEGIN
  PERFORM public.require_privacy_accepted();
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
END $function$;

CREATE OR REPLACE FUNCTION public.restore_series(_series uuid, _finalize boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _s public.event_series; _holder_deleted boolean := false; _paths jsonb := '[]'::jsonb; _prev text;
BEGIN
  PERFORM public.require_privacy_accepted();
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
END $function$;

CREATE OR REPLACE FUNCTION public.set_consent_preferences(p_photo_consent boolean, p_updates_email_consent boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public.require_privacy_accepted();
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not signed in'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND deleted_at IS NULL) THEN RAISE EXCEPTION 'Not allowed'; END IF;
  IF p_photo_consent IS NULL OR p_updates_email_consent IS NULL THEN RAISE EXCEPTION 'Invalid consent values'; END IF;
  INSERT INTO public.consent_preferences AS c (user_id, photo_consent, photo_consent_changed_at, updates_email_consent, updates_email_consent_changed_at)
  VALUES (auth.uid(), p_photo_consent, now(), p_updates_email_consent, now())
  ON CONFLICT (user_id) DO UPDATE SET
    photo_consent = EXCLUDED.photo_consent,
    photo_consent_changed_at = CASE WHEN c.photo_consent IS DISTINCT FROM EXCLUDED.photo_consent THEN now() ELSE c.photo_consent_changed_at END,
    updates_email_consent = EXCLUDED.updates_email_consent,
    updates_email_consent_changed_at = CASE WHEN c.updates_email_consent IS DISTINCT FROM EXCLUDED.updates_email_consent THEN now() ELSE c.updates_email_consent_changed_at END,
    updated_at = now();
  RETURN public.get_privacy_status();
END $function$;

CREATE OR REPLACE FUNCTION public.set_registration_show_name(p_event_id uuid, p_show_name boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _uid uuid := auth.uid();
BEGIN
  PERFORM public.require_privacy_accepted();
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not signed in'; END IF;
  UPDATE public.event_registrations r SET show_name = coalesce(p_show_name, false)
  WHERE r.event_id = p_event_id AND r.user_id = _uid
    AND EXISTS (SELECT 1 FROM public.events e WHERE e.id = r.event_id AND e.deleted_at IS NULL);
  IF NOT FOUND THEN RAISE EXCEPTION 'Registration not found'; END IF;
END $function$;

CREATE OR REPLACE FUNCTION public.set_user_branch(_target uuid, _branch uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _actor uuid := auth.uid(); _old uuid; _region uuid;
BEGIN
  PERFORM public.require_privacy_accepted();
 IF _actor IS NULL OR _actor = _target THEN RAISE EXCEPTION 'You cannot move your own branch'; END IF;
 PERFORM id FROM public.profiles WHERE id = _actor FOR UPDATE;
 IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = _actor AND status = 'active') OR NOT public.has_role(_actor, 'regional_director') THEN RAISE EXCEPTION 'Only active Regional Directors can move users'; END IF;
 SELECT region_id INTO _region FROM public.user_roles WHERE user_id = _actor AND role = 'regional_director' LIMIT 1;
 SELECT branch_id INTO _old FROM public.profiles WHERE id = _target FOR UPDATE;
 IF NOT public.can_manage_user(_actor, _target) THEN RAISE EXCEPTION 'You cannot manage this user'; END IF;
 IF NOT EXISTS (SELECT 1 FROM public.branches WHERE id = _branch AND region_id = _region) THEN RAISE EXCEPTION 'The new branch must belong to your region'; END IF;
 IF _old IS NOT DISTINCT FROM _branch THEN RETURN; END IF;
 UPDATE public.profiles SET branch_id = _branch WHERE id = _target;
 INSERT INTO public.user_audit_log(actor_id, target_id, action, old_value, new_value) VALUES (_actor, _target, 'branch_change', _old::text, _branch::text);
END $function$;

CREATE OR REPLACE FUNCTION public.set_user_role(_target uuid, _role app_role)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _actor uuid := auth.uid(); _old public.app_role;
BEGIN
  PERFORM public.require_privacy_accepted();
 IF _role IS NULL OR _role NOT IN ('volunteer', 'branch_manager') THEN
  RAISE EXCEPTION 'Role must be Volunteer or Branch Manager; Regional Director cannot be assigned';
 END IF;
 IF _actor IS NULL OR _actor = _target THEN RAISE EXCEPTION 'You cannot change your own role'; END IF;
 PERFORM id FROM public.profiles WHERE id = _actor FOR UPDATE;
 IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = _actor AND status = 'active') OR NOT public.has_role(_actor, 'regional_director') THEN RAISE EXCEPTION 'Only active Regional Directors can change roles'; END IF;
 PERFORM id FROM public.profiles WHERE id = _target FOR UPDATE;
 IF NOT public.can_manage_user(_actor, _target) THEN RAISE EXCEPTION 'You cannot manage this user'; END IF;
 SELECT role INTO _old FROM public.user_roles WHERE user_id = _target AND role IN ('volunteer','branch_manager') ORDER BY CASE WHEN role = 'branch_manager' THEN 0 ELSE 1 END LIMIT 1;
 IF _old = _role AND (SELECT count(*) FROM public.user_roles WHERE user_id = _target) = 1 THEN RETURN; END IF;
 DELETE FROM public.user_roles WHERE user_id = _target AND role IN ('volunteer','branch_manager');
 INSERT INTO public.user_roles(user_id, role) VALUES (_target, _role);
 INSERT INTO public.user_audit_log(actor_id, target_id, action, old_value, new_value) VALUES (_actor, _target, 'role_change', _old::text, _role::text);
END $function$;

CREATE OR REPLACE FUNCTION public.set_user_status(_target uuid, _status profile_status)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _actor uuid := auth.uid(); _old public.profile_status;
BEGIN
  PERFORM public.require_privacy_accepted();
 IF _actor IS NULL OR _actor = _target THEN RAISE EXCEPTION 'You cannot change your own status'; END IF;
 PERFORM id FROM public.profiles WHERE id = _actor FOR UPDATE;
 SELECT status INTO _old FROM public.profiles WHERE id = _target FOR UPDATE;
 IF NOT public.can_manage_user(_actor, _target) THEN RAISE EXCEPTION 'Not allowed'; END IF;
 IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = _actor AND status = 'active') THEN RAISE EXCEPTION 'Not allowed'; END IF;
 IF _status IS NULL THEN RAISE EXCEPTION 'Status is required'; END IF;
 IF _old = _status THEN RETURN; END IF;
 UPDATE public.profiles SET status = _status WHERE id = _target;
 INSERT INTO public.user_audit_log(actor_id, target_id, action, old_value, new_value) VALUES (_actor, _target, 'status_change', _old::text, _status::text);
END $function$;

CREATE OR REPLACE FUNCTION public.start_review_event_request(p_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _uid uuid := public.event_request_actor(); cur public.event_requests;
BEGIN
  PERFORM public.require_privacy_accepted();
  cur := public.event_request_locked(p_id);
  PERFORM public.event_request_review_check(cur);
  IF cur.status <> 'submitted' THEN RAISE EXCEPTION 'Request already under review'; END IF;
  UPDATE public.event_requests SET status = 'under_review', reviewer_id = _uid, notice = 'under_review', notice_seen_at = NULL WHERE id = p_id;
END $function$;

CREATE OR REPLACE FUNCTION public.submit_event_request(p jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _uid uuid := public.event_request_actor(); r public.event_requests; _scope text; _branch uuid; _region uuid; _id uuid;
  _type text := coalesce(nullif(p->>'request_type', ''), 'proposal');
BEGIN
  PERFORM public.require_privacy_accepted();
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
END $function$;

CREATE OR REPLACE FUNCTION public.update_event(_event uuid, _data jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _branch uuid := nullif(_data->>'branch_id', '')::uuid; _region uuid; _scope text := _data->>'scope'; _old_status text; _old_reg boolean;
BEGIN
  PERFORM public.require_privacy_accepted();
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
END $function$;

CREATE OR REPLACE FUNCTION public.update_event_request(p_id uuid, p jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _uid uuid := public.event_request_actor(); cur public.event_requests; r public.event_requests;
BEGIN
  PERFORM public.require_privacy_accepted();
  cur := public.event_request_locked(p_id);
  IF cur.requester_id IS DISTINCT FROM _uid THEN RAISE EXCEPTION 'Not allowed'; END IF;
  IF cur.status <> 'submitted' THEN RAISE EXCEPTION 'Request can no longer be changed'; END IF;
  IF coalesce(nullif(p->>'request_type', ''), cur.request_type) <> cur.request_type THEN RAISE EXCEPTION 'Request scope and type cannot be changed'; END IF;
  -- The requester keeps the manager-only category untouched.
  r := public.event_request_fields((p - 'category') || jsonb_build_object('category', cur.category), cur.request_type);
  PERFORM public.event_request_apply(p_id, r);
END $function$;

CREATE OR REPLACE FUNCTION public.update_series_event(_event uuid, _mode text, _data jsonb, _rule text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _e public.events; _s public.event_series; _old uuid; _t record; _new_rule text; _dt timestamp; _timing boolean; _rule_changed boolean;
  _status text := coalesce(nullif(_data->>'status', ''), 'published'); _target uuid; _remaining integer; _done integer; _first uuid; _prev text;
  _del_series uuid; _from timestamp; _protected uuid[] := '{}'; _p public.events; _cand timestamp; _kept jsonb := '[]'::jsonb;
BEGIN
  PERFORM public.require_privacy_accepted();
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
END $function$;

CREATE OR REPLACE FUNCTION public.withdraw_event_request(p_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _uid uuid := public.event_request_actor(); cur public.event_requests;
BEGIN
  PERFORM public.require_privacy_accepted();
  cur := public.event_request_locked(p_id);
  IF cur.requester_id IS DISTINCT FROM _uid THEN RAISE EXCEPTION 'Not allowed'; END IF;
  IF cur.status <> 'submitted' THEN RAISE EXCEPTION 'Request can no longer be changed'; END IF;
  UPDATE public.event_requests SET status = 'withdrawn', notice = NULL, notice_seen_at = NULL WHERE id = p_id;
END $function$;

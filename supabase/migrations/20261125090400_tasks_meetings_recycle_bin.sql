-- Tasks and meetings in the Recycle Bin (same pattern as events: 30 days, Restore, Delete permanently), and the
-- structure checks for the new tables.
-- * Deleted tasks and meetings are listed for the managers of their scope (can_manage_recycle_scope: the branch's
--   Branch Manager, the region's Regional Director, National Coordinators for national items).
-- * A meeting's files stay in the private bucket until the meeting is purged; while it is deleted nobody can read them
--   (Storage policies require a visible meeting). Purging lists the stored files first: the server removes them, then
--   purge_meeting(_id, true) deletes the row (service role), like event requests.
-- * Branches and regions with tasks, meetings or task/meeting requests stay archived (structure_in_use).

ALTER TABLE public.recycle_bin_audit_log DROP CONSTRAINT recycle_bin_audit_log_item_type_check;
ALTER TABLE public.recycle_bin_audit_log ADD CONSTRAINT recycle_bin_audit_log_item_type_check
  CHECK (item_type IN ('event', 'user', 'series', 'event_request', 'volunteer_application', 'branch', 'region', 'task', 'meeting'));

CREATE OR REPLACE FUNCTION public.structure_in_use(_type text, _id uuid) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF _type = 'branch' THEN
    RETURN EXISTS (SELECT 1 FROM public.profiles WHERE branch_id = _id) OR EXISTS (SELECT 1 FROM public.events WHERE branch_id = _id)
      OR EXISTS (SELECT 1 FROM public.event_series WHERE branch_id = _id) OR EXISTS (SELECT 1 FROM public.event_requests WHERE branch_id = _id)
      OR EXISTS (SELECT 1 FROM public.tasks WHERE branch_id = _id) OR EXISTS (SELECT 1 FROM public.meetings WHERE branch_id = _id)
      OR EXISTS (SELECT 1 FROM public.task_requests WHERE branch_id = _id) OR EXISTS (SELECT 1 FROM public.meeting_requests WHERE branch_id = _id);
  END IF;
  RETURN EXISTS (SELECT 1 FROM public.branches b WHERE b.region_id = _id AND (b.deleted_at IS NULL OR NOT b.deleted_with_region OR public.structure_in_use('branch', b.id)))
    OR EXISTS (SELECT 1 FROM public.events WHERE region_id = _id) OR EXISTS (SELECT 1 FROM public.event_series WHERE region_id = _id)
    OR EXISTS (SELECT 1 FROM public.event_requests WHERE region_id = _id) OR EXISTS (SELECT 1 FROM public.user_roles WHERE region_id = _id)
    OR EXISTS (SELECT 1 FROM public.tasks WHERE region_id = _id) OR EXISTS (SELECT 1 FROM public.meetings WHERE region_id = _id)
    OR EXISTS (SELECT 1 FROM public.task_requests WHERE region_id = _id) OR EXISTS (SELECT 1 FROM public.meeting_requests WHERE region_id = _id);
END $$;

-- Restore a task or meeting within 30 days (the scope's managers).
CREATE FUNCTION public.restore_work_item(_type text, _id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _branch uuid; _region uuid; _deleted timestamptz; _purging timestamptz;
BEGIN
  IF _type = 'task' THEN
    SELECT branch_id, region_id, deleted_at INTO _branch, _region, _deleted FROM public.tasks WHERE id = _id FOR UPDATE;
  ELSE
    SELECT branch_id, region_id, deleted_at, purge_requested_at INTO _branch, _region, _deleted, _purging FROM public.meetings WHERE id = _id FOR UPDATE;
  END IF;
  IF NOT FOUND OR _deleted IS NULL OR _deleted <= now() - interval '30 days' OR _purging IS NOT NULL
    OR NOT public.can_manage_recycle_scope(auth.uid(), _branch, _region) THEN
    RAISE EXCEPTION 'Item cannot be restored';
  END IF;
  IF _type = 'task' THEN UPDATE public.tasks SET deleted_at = NULL, deleted_by = NULL WHERE id = _id;
  ELSE UPDATE public.meetings SET deleted_at = NULL, deleted_by = NULL WHERE id = _id; END IF;
  INSERT INTO public.recycle_bin_audit_log (actor_id, item_type, item_id, action, branch_id, region_id) VALUES (auth.uid(), _type, _id, 'restore', _branch, _region);
  RETURN jsonb_build_object('paths', '[]'::jsonb, 'deleted', false);
END $$;

-- Delete permanently (the scope's managers). A meeting with stored files returns their paths first.
CREATE FUNCTION public.purge_work_item(_type text, _id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _branch uuid; _region uuid; _deleted timestamptz; _paths jsonb;
BEGIN
  IF _type = 'task' THEN
    SELECT branch_id, region_id, deleted_at INTO _branch, _region, _deleted FROM public.tasks WHERE id = _id FOR UPDATE;
  ELSE
    SELECT branch_id, region_id, deleted_at INTO _branch, _region, _deleted FROM public.meetings WHERE id = _id FOR UPDATE;
  END IF;
  IF NOT FOUND OR _deleted IS NULL OR NOT public.can_manage_recycle_scope(auth.uid(), _branch, _region) THEN RAISE EXCEPTION 'Not allowed'; END IF;
  INSERT INTO public.recycle_bin_audit_log (actor_id, item_type, item_id, action, branch_id, region_id) VALUES (auth.uid(), _type, _id, 'permanent_delete', _branch, _region);
  IF _type = 'task' THEN DELETE FROM public.tasks WHERE id = _id; RETURN jsonb_build_object('paths', '[]'::jsonb, 'deleted', true); END IF;
  SELECT coalesce(jsonb_agg(o.name ORDER BY o.name), '[]'::jsonb) INTO _paths FROM storage.objects o
    WHERE o.bucket_id = 'meeting-files' AND o.name LIKE _id::text || '/%';
  IF _paths <> '[]'::jsonb THEN
    UPDATE public.meetings SET purge_requested_at = now() WHERE id = _id;
    RETURN jsonb_build_object('paths', _paths, 'deleted', false, 'bucket', 'meeting-files');
  END IF;
  DELETE FROM public.meetings WHERE id = _id;
  RETURN jsonb_build_object('paths', '[]'::jsonb, 'deleted', true);
END $$;

-- Service role only. Without _finalize: the stored files of a deleted meeting that may be purged (purge requested, or
-- 30 days passed). With _finalize: deletes the row once no file is stored any more.
CREATE FUNCTION public.purge_meeting(_id uuid, _finalize boolean DEFAULT false) RETURNS jsonb
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
  IF _m.purge_requested_at IS NULL THEN
    INSERT INTO public.recycle_bin_audit_log (actor_id, item_type, item_id, action, branch_id, region_id)
      VALUES (NULL, 'meeting', _id, 'permanent_delete', _m.branch_id, _m.region_id);
  END IF;
  RETURN jsonb_build_object('paths', '[]'::jsonb, 'deleted', true);
END $$;

-- Nightly cleanup: tasks past their 30 days, and meetings without stored files (the server purges the others first).
CREATE FUNCTION public.purge_expired_work_items() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _n integer; _m integer;
BEGIN
  WITH gone AS (DELETE FROM public.tasks WHERE deleted_at < now() - interval '30 days' RETURNING id, branch_id, region_id)
  INSERT INTO public.recycle_bin_audit_log (actor_id, item_type, item_id, action, branch_id, region_id)
    SELECT NULL, 'task', id, 'permanent_delete', branch_id, region_id FROM gone;
  GET DIAGNOSTICS _n = ROW_COUNT;
  WITH gone AS (
    DELETE FROM public.meetings m WHERE m.deleted_at < now() - interval '30 days'
      AND NOT EXISTS (SELECT 1 FROM storage.objects o WHERE o.bucket_id = 'meeting-files' AND o.name LIKE m.id::text || '/%')
    RETURNING id, branch_id, region_id)
  INSERT INTO public.recycle_bin_audit_log (actor_id, item_type, item_id, action, branch_id, region_id)
    SELECT NULL, 'meeting', id, 'permanent_delete', branch_id, region_id FROM gone;
  GET DIAGNOSTICS _m = ROW_COUNT;
  RETURN _n + _m;
END $$;

-- Recycle Bin listing and dispatch (redefined): tasks and meetings.
CREATE OR REPLACE FUNCTION public.list_recycle_bin(_type text DEFAULT 'all', _search text DEFAULT '', _offset integer DEFAULT 0)
 RETURNS TABLE(id uuid, type text, title text, role text, branch text, region text, deleted_by_name text, deleted_at timestamptz,
   days_left integer, can_restore boolean, self_requested boolean, event_count integer, total_count bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT (public.is_nc() OR EXISTS (SELECT 1 FROM profiles p JOIN user_roles r ON r.user_id = p.id WHERE p.id = auth.uid() AND p.status = 'active'
      AND p.deleted_at IS NULL AND r.role IN ('branch_manager', 'regional_director'))) THEN RAISE EXCEPTION 'Not allowed'; END IF;
  IF _type NOT IN ('all', 'event', 'user', 'series', 'event_request', 'volunteer_application', 'branch', 'region', 'task', 'meeting') THEN RAISE EXCEPTION 'Not allowed'; END IF;
  RETURN QUERY WITH items AS (
    SELECT e.id, 'event'::text AS type, e.title, NULL::text AS role, b.name AS branch, r.name AS region, p.full_name AS deleted_by_name, e.deleted_at,
      greatest(0, ceil(extract(epoch FROM (e.deleted_at + interval '30 days' - now())) / 86400))::integer AS days_left,
      public.can_restore_event(e.id) AS can_restore, false AS self_requested, NULL::integer AS event_count
    FROM events e LEFT JOIN regions r ON r.id = e.region_id LEFT JOIN branches b ON b.id = e.branch_id LEFT JOIN profiles p ON p.id = e.deleted_by
    WHERE e.deleted_at IS NOT NULL AND NOT e.series_template AND NOT e.deleted_with_series AND public.can_manage_recycle_scope(auth.uid(), e.branch_id, e.region_id)
    UNION ALL
    SELECT s.id, 'series', s.title, NULL, b.name, r.name, p.full_name, s.deleted_at,
      greatest(0, ceil(extract(epoch FROM (s.deleted_at + interval '30 days' - now())) / 86400))::integer,
      s.deleted_at > now() - interval '30 days' AND NOT EXISTS (SELECT 1 FROM event_deletion_jobs j JOIN events x ON x.id = j.event_id
        WHERE (x.series_id = s.id OR x.id = s.media_event_id) AND j.operation NOT IN ('archive', 'restore')),
      false, (SELECT count(*) FROM events x WHERE x.series_id = s.id AND x.deleted_with_series)::integer
    FROM event_series s LEFT JOIN regions r ON r.id = s.region_id LEFT JOIN branches b ON b.id = s.branch_id LEFT JOIN profiles p ON p.id = s.deleted_by
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
    UNION ALL
    SELECT a.id, 'volunteer_application', coalesce(nullif(ap.full_name, ''), 'Former member'), NULL, b.name, r.name, p.full_name, a.deleted_at,
      greatest(0, ceil(extract(epoch FROM (a.deleted_at + interval '30 days' - now())) / 86400))::integer,
      a.deleted_at > now() - interval '30 days', false, NULL::integer
    FROM volunteer_applications a JOIN branches b ON b.id = a.branch_id JOIN regions r ON r.id = b.region_id
      LEFT JOIN profiles ap ON ap.id = a.user_id AND ap.deleted_at IS NULL LEFT JOIN profiles p ON p.id = a.deleted_by
    WHERE a.deleted_at IS NOT NULL AND public.can_review_volunteer_application(a.branch_id)
    UNION ALL
    SELECT b.id, 'branch', b.name, NULL, b.name, r.name, p.full_name, b.deleted_at,
      greatest(0, ceil(extract(epoch FROM (b.deleted_at + interval '30 days' - now())) / 86400))::integer,
      b.deleted_at > now() - interval '30 days' AND r.deleted_at IS NULL, false, NULL::integer
    FROM branches b JOIN regions r ON r.id = b.region_id LEFT JOIN profiles p ON p.id = b.deleted_by
    WHERE b.deleted_at IS NOT NULL AND NOT b.deleted_with_region AND public.is_nc()
    UNION ALL
    SELECT r.id, 'region', r.name, NULL, NULL, r.name, p.full_name, r.deleted_at,
      greatest(0, ceil(extract(epoch FROM (r.deleted_at + interval '30 days' - now())) / 86400))::integer,
      r.deleted_at > now() - interval '30 days', false, (SELECT count(*) FROM branches x WHERE x.region_id = r.id AND x.deleted_with_region)::integer
    FROM regions r LEFT JOIN profiles p ON p.id = r.deleted_by
    WHERE r.deleted_at IS NOT NULL AND public.is_nc()
    UNION ALL
    SELECT t.id, 'task', t.title, NULL, b.name, r.name, p.full_name, t.deleted_at,
      greatest(0, ceil(extract(epoch FROM (t.deleted_at + interval '30 days' - now())) / 86400))::integer,
      t.deleted_at > now() - interval '30 days', false, NULL::integer
    FROM tasks t LEFT JOIN regions r ON r.id = t.region_id LEFT JOIN branches b ON b.id = t.branch_id LEFT JOIN profiles p ON p.id = t.deleted_by
    WHERE t.deleted_at IS NOT NULL AND public.can_manage_recycle_scope(auth.uid(), t.branch_id, t.region_id)
    UNION ALL
    SELECT m.id, 'meeting', m.title, NULL, b.name, r.name, p.full_name, m.deleted_at,
      greatest(0, ceil(extract(epoch FROM (m.deleted_at + interval '30 days' - now())) / 86400))::integer,
      m.deleted_at > now() - interval '30 days' AND m.purge_requested_at IS NULL, false, NULL::integer
    FROM meetings m LEFT JOIN regions r ON r.id = m.region_id LEFT JOIN branches b ON b.id = m.branch_id LEFT JOIN profiles p ON p.id = m.deleted_by
    WHERE m.deleted_at IS NOT NULL AND public.can_manage_recycle_scope(auth.uid(), m.branch_id, m.region_id)
  ) SELECT i.id, i.type, i.title, i.role, i.branch, i.region, i.deleted_by_name, i.deleted_at, i.days_left, i.can_restore, i.self_requested, i.event_count, count(*) OVER ()
    FROM items i
    WHERE (_type = 'all' OR i.type = _type OR (_type = 'event' AND i.type = 'series'))
      AND (coalesce(_search, '') = '' OR position(lower(left(_search, 200)) IN lower(i.title)) > 0)
    ORDER BY i.deleted_at DESC, i.id LIMIT 50 OFFSET greatest(0, least(_offset, 1000000));
END $$;

CREATE OR REPLACE FUNCTION public.restore_item(_type text, _id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _p public.profiles; _s public.user_deletion_state;
BEGIN
  PERFORM public.require_privacy_accepted();
  IF _type = 'volunteer_application' THEN RETURN public.restore_volunteer_application(_id); END IF;
  IF _type IN ('task', 'meeting') THEN RETURN public.restore_work_item(_type, _id); END IF;
  IF _type IN ('branch', 'region') THEN RETURN public.restore_structure(_type, _id); END IF;
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
  IF _type = 'volunteer_application' THEN RETURN public.purge_volunteer_application_item(_id); END IF;
  IF _type IN ('task', 'meeting') THEN RETURN public.purge_work_item(_type, _id); END IF;
  IF _type IN ('branch', 'region') THEN PERFORM public.require_nc(); RETURN public.purge_structure_item(_type, _id); END IF;
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

REVOKE ALL ON FUNCTION public.structure_in_use(text, uuid), public.restore_work_item(text, uuid), public.purge_work_item(text, uuid),
  public.purge_meeting(uuid, boolean), public.purge_expired_work_items() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purge_meeting(uuid, boolean), public.purge_expired_work_items() TO service_role;

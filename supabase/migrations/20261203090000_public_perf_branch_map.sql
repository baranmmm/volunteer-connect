-- Public pages performance and the branch map: schema and functions.
--
-- 1. Image copies. Event images (covers and gallery photos) get two resized WebP copies next to the original in the
--    event's folder: <path without extension>.w640.webp and .w1280.webp (event_media_variant_paths). The uploader
--    stores them right after the original and then calls set_event_media_variants, which checks both objects exist
--    and sets has_variants. Storage read/write checks accept the copy paths of an image row; deleting an image needs
--    its copies removed first; archive and purge already take every object in the event's folder, and restore now
--    moves the copies back too. The import and the backfill script (service role) set has_variants directly.
-- 2. Branch locations for the map: optional postcode, latitude/longitude (town-centre seed for the existing
--    branches), geocoded server side with postcodes.io and cached in postcode_geocodes (service role only).
--    set_branch_postcode (NC, or the RD of the branch's region) stores the postcode; the server then geocodes and
--    calls set_branch_coordinates (service role).
-- 3. get_branch_map: one row per branch with coordinates, region, branch managers' names and counts (volunteers,
--    followers, upcoming events, open tasks). National Coordinators (aal2) see every branch, Regional Directors their
--    own region's; nobody else. Counts only: never volunteer or follower names.

-- ─── 1. Image copies ─────────────────────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.event_media ADD COLUMN has_variants boolean NOT NULL DEFAULT false;

CREATE FUNCTION public.event_media_variant_paths(_path text) RETURNS text[]
LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT ARRAY[regexp_replace(_path, '\.[A-Za-z0-9]+$', '') || '.w640.webp', regexp_replace(_path, '\.[A-Za-z0-9]+$', '') || '.w1280.webp']
$$;

CREATE OR REPLACE FUNCTION public.can_read_event_file(_path text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (SELECT 1 FROM public.event_media WHERE (storage_path = _path OR (kind = 'image' AND _path = ANY (public.event_media_variant_paths(storage_path)))) AND public.can_view_event_media(event_id))
$function$;

CREATE OR REPLACE FUNCTION public.can_write_event_file(_path text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
 SELECT EXISTS(SELECT 1 FROM public.event_media WHERE (storage_path=_path OR (kind='image' AND _path=ANY(public.event_media_variant_paths(storage_path)))) AND public.can_manage_event(event_id))
$function$;

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
 IF EXISTS(SELECT 1 FROM storage.objects o JOIN public.event_media m ON (o.name=m.storage_path OR o.name=ANY(public.event_media_variant_paths(m.storage_path))) WHERE m.id=_media AND o.bucket_id='event-media') THEN RAISE EXCEPTION 'Remove stored file first'; END IF;
 DELETE FROM public.event_media WHERE id=_media;
 WITH ordered AS (SELECT id,row_number() OVER(ORDER BY CASE WHEN kind='image' THEN 0 ELSE 1 END,position,id)-1 AS pos FROM public.event_media WHERE event_id=_event)
 UPDATE public.event_media m SET position=ordered.pos,updated_at=now() FROM ordered WHERE m.id=ordered.id;
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
 SELECT coalesce(jsonb_agg(p ORDER BY p),'[]'::jsonb) INTO _paths FROM (SELECT storage_path AS p FROM event_media WHERE event_id=_event UNION ALL SELECT unnest(public.event_media_variant_paths(m.storage_path)) FROM event_media m WHERE m.event_id=_event AND m.has_variants) x;
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
    SELECT coalesce(jsonb_agg(p ORDER BY p), '[]'::jsonb) INTO _paths FROM (SELECT storage_path AS p FROM public.event_media WHERE event_id = _s.media_event_id UNION ALL SELECT unnest(public.event_media_variant_paths(m.storage_path)) FROM public.event_media m WHERE m.event_id = _s.media_event_id AND m.has_variants) x;
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

-- The uploader's last step: both copies are stored (checked in Storage), so pages may use them.
CREATE FUNCTION public.set_event_media_variants(p_media uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _m public.event_media;
BEGIN
  PERFORM public.require_privacy_accepted();
  SELECT * INTO _m FROM public.event_media WHERE id = p_media;
  IF NOT FOUND OR _m.kind <> 'image' OR NOT public.can_manage_event(_m.event_id) THEN RAISE EXCEPTION 'Not allowed'; END IF;
  IF (SELECT count(*) FROM storage.objects WHERE bucket_id = 'event-media' AND name = ANY (public.event_media_variant_paths(_m.storage_path))) < 2 THEN
    RAISE EXCEPTION 'Image copies are missing';
  END IF;
  UPDATE public.event_media SET has_variants = true, updated_at = now() WHERE id = p_media;
END $$;

-- Server only (public pages): whether a public image path has its copies.
CREATE FUNCTION public.event_media_has_variants(_path text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce((SELECT has_variants FROM public.event_media WHERE storage_path = _path), false)
$$;

-- ─── 2. Branch locations ─────────────────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.branches
  ADD COLUMN postcode text,
  ADD COLUMN latitude double precision,
  ADD COLUMN longitude double precision,
  ADD COLUMN located_at timestamptz,
  ADD CONSTRAINT branches_postcode_check CHECK (postcode IS NULL OR postcode ~ '^[A-Z]{1,2}[0-9][A-Z0-9]? [0-9][A-Z]{2}$'),
  ADD CONSTRAINT branches_coordinates_check CHECK ((latitude IS NULL) = (longitude IS NULL)
    AND (latitude IS NULL OR (latitude BETWEEN 49 AND 61 AND longitude BETWEEN -9 AND 3)));

CREATE TABLE public.postcode_geocodes (
  postcode text PRIMARY KEY CHECK (postcode ~ '^[A-Z]{1,2}[0-9][A-Z0-9]? [0-9][A-Z]{2}$'),
  latitude double precision NOT NULL,
  longitude double precision NOT NULL,
  fetched_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.postcode_geocodes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.postcode_geocodes FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.postcode_geocodes TO service_role;
CREATE POLICY postcode_geocodes_service ON public.postcode_geocodes FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Town-centre coordinates for the existing branches (only where none are set yet).
UPDATE public.branches b SET latitude = c.lat, longitude = c.lng, located_at = now()
FROM (VALUES
  ('basingstoke', 51.2665, -1.0924), ('bexley', 51.4570, 0.1394), ('birmingham', 52.4797, -1.9026), ('brighton', 50.8225, -0.1372),
  ('bristol', 51.4545, -2.5879), ('cardiff', 51.4816, -3.1791), ('croydon', 51.3762, -0.0982), ('hull', 53.7457, -0.3367),
  ('kingston', 51.4123, -0.3007), ('leeds', 53.8008, -1.5491), ('leicester', 52.6369, -1.1398), ('liverpool', 53.4084, -2.9916),
  ('london', 51.5074, -0.1278), ('manchester', 53.4808, -2.2426), ('medway', 51.3781, 0.5280), ('north east', 54.9783, -1.6178),
  ('northampton', 52.2405, -0.9027), ('oxford', 51.7520, -1.2577), ('reading', 51.4543, -0.9781), ('sheffield', 53.3811, -1.4701),
  ('sutton', 51.3618, -0.1945), ('worksop', 53.3018, -1.1240), ('lincoln', 53.2307, -0.5406), ('nottingham', 52.9548, -1.1581),
  ('southampton', 50.9097, -1.4044)
) AS c(name, lat, lng)
WHERE lower(btrim(b.name)) = c.name AND b.latitude IS NULL;

-- The postcode (NC, or the RD of the branch's region). Coordinates are set by the server after geocoding.
CREATE FUNCTION public.set_branch_postcode(p_branch uuid, p_postcode text) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _b public.branches; _pc text := nullif(upper(regexp_replace(btrim(coalesce(p_postcode, '')), '\s+', '', 'g')), '');
BEGIN
  PERFORM public.require_privacy_accepted();
  SELECT * INTO _b FROM public.branches WHERE id = p_branch AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND OR NOT (public.is_nc() OR EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'regional_director' AND region_id = _b.region_id)) THEN
    RAISE EXCEPTION 'Not allowed';
  END IF;
  IF _pc IS NOT NULL THEN
    IF _pc !~ '^[A-Z]{1,2}[0-9][A-Z0-9]?[0-9][A-Z]{2}$' THEN RAISE EXCEPTION 'Enter a valid UK postcode'; END IF;
    _pc := left(_pc, length(_pc) - 3) || ' ' || right(_pc, 3);
  END IF;
  UPDATE public.branches SET postcode = _pc WHERE id = p_branch;
  RETURN _pc;
END $$;

-- Server only: coordinates from the geocoder (or its cache), for the branch whose postcode they belong to.
CREATE FUNCTION public.set_branch_coordinates(p_branch uuid, p_postcode text, p_lat double precision, p_lng double precision) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.branches SET latitude = p_lat, longitude = p_lng, located_at = now()
  WHERE id = p_branch AND postcode IS NOT DISTINCT FROM p_postcode;
END $$;

-- ─── 3. The branch map ───────────────────────────────────────────────────────────────────────────────────────────

CREATE FUNCTION public.get_branch_map() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _nc boolean := public.is_nc(); _regions uuid[];
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_accepted_privacy_notice() THEN RAISE EXCEPTION 'Not allowed'; END IF;
  IF NOT _nc THEN
    SELECT array_agg(region_id) INTO _regions FROM public.user_roles WHERE user_id = auth.uid() AND role = 'regional_director' AND region_id IS NOT NULL;
    IF _regions IS NULL OR NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND status = 'active' AND deleted_at IS NULL) THEN
      RAISE EXCEPTION 'Not allowed';
    END IF;
  END IF;
  RETURN (SELECT coalesce(jsonb_agg(jsonb_build_object(
      'id', b.id, 'name', b.name, 'region_id', b.region_id, 'region', r.name, 'postcode', b.postcode,
      'latitude', b.latitude, 'longitude', b.longitude,
      'managers', coalesce((SELECT jsonb_agg(p.full_name ORDER BY p.full_name) FROM public.profiles p JOIN public.user_roles ur ON ur.user_id = p.id
        WHERE p.branch_id = b.id AND ur.role = 'branch_manager' AND p.status = 'active' AND p.deleted_at IS NULL), '[]'::jsonb),
      'volunteers', (SELECT count(*) FROM public.profiles p JOIN public.user_roles ur ON ur.user_id = p.id
        WHERE p.branch_id = b.id AND ur.role = 'volunteer' AND p.status = 'active' AND p.deleted_at IS NULL),
      'followers', (SELECT count(*) FROM public.user_followed_branches f JOIN public.profiles p ON p.id = f.user_id JOIN public.user_roles ur ON ur.user_id = p.id
        WHERE f.branch_id = b.id AND ur.role = 'follower' AND p.status = 'active' AND p.deleted_at IS NULL),
      'upcoming_events', (SELECT count(*) FROM public.events e WHERE e.branch_id = b.id AND e.status = 'published' AND e.deleted_at IS NULL
        AND NOT e.series_template AND e.category <> 'meeting' AND NOT e.past_record AND coalesce(public.event_ends(e) > now(), false)),
      'open_tasks', (SELECT count(*) FROM public.tasks t WHERE t.branch_id = b.id AND t.deleted_at IS NULL AND t.archived_at IS NULL AND t.status <> 'done')
    ) ORDER BY r.name, b.name), '[]'::jsonb)
    FROM public.branches b JOIN public.regions r ON r.id = b.region_id
    WHERE b.deleted_at IS NULL AND r.deleted_at IS NULL AND (_nc OR b.region_id = ANY (_regions)));
END $$;

-- ─── Grants ──────────────────────────────────────────────────────────────────────────────────────────────────────

REVOKE ALL ON FUNCTION public.event_media_has_variants(text), public.set_branch_coordinates(uuid, text, double precision, double precision)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.event_media_has_variants(text), public.set_branch_coordinates(uuid, text, double precision, double precision)
  TO service_role;
REVOKE ALL ON FUNCTION public.set_event_media_variants(uuid), public.set_branch_postcode(uuid, text), public.get_branch_map() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_event_media_variants(uuid), public.set_branch_postcode(uuid, text), public.get_branch_map() TO authenticated;

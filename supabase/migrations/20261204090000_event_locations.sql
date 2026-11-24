-- Public events map: where an event is drawn.
-- * events.postcode (optional, in-person events), latitude/longitude (geocoded by the server with postcodes.io through
--   the postcode_geocodes cache) and located_at. Nullable, nothing existing changes.
-- * set_event_postcode: managers of the event (can_manage_event). The server then geocodes and calls the service-only
--   set_event_coordinates, which applies only while the event still has that postcode.
-- * public_event_json gains `map`: {latitude, longitude, precision} for in-person events — the venue ('venue') when
--   geocoded and not "To be announced", otherwise the branch's town-centre location ('branch'); null for online events
--   and for events without any location (national/region-wide without a branch). The venue text is already public for
--   in-person events, so its coordinates reveal nothing new; online events never get a point.

ALTER TABLE public.events
  ADD COLUMN postcode text,
  ADD COLUMN latitude double precision,
  ADD COLUMN longitude double precision,
  ADD COLUMN located_at timestamptz,
  ADD CONSTRAINT events_postcode_check CHECK (postcode IS NULL OR postcode ~ '^[A-Z]{1,2}[0-9][A-Z0-9]? [0-9][A-Z]{2}$'),
  ADD CONSTRAINT events_coordinates_check CHECK ((latitude IS NULL) = (longitude IS NULL)
    AND (latitude IS NULL OR (latitude BETWEEN 49 AND 61 AND longitude BETWEEN -9 AND 3)));

CREATE FUNCTION public.set_event_postcode(p_event uuid, p_postcode text) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _pc text := nullif(upper(regexp_replace(btrim(coalesce(p_postcode, '')), '\s+', '', 'g')), '');
BEGIN
  PERFORM public.require_privacy_accepted();
  PERFORM id FROM public.events WHERE id = p_event AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND OR NOT public.can_manage_event(p_event) THEN RAISE EXCEPTION 'Not allowed'; END IF;
  IF _pc IS NOT NULL THEN
    IF _pc !~ '^[A-Z]{1,2}[0-9][A-Z0-9]?[0-9][A-Z]{2}$' THEN RAISE EXCEPTION 'Enter a valid UK postcode'; END IF;
    _pc := left(_pc, length(_pc) - 3) || ' ' || right(_pc, 3);
  END IF;
  -- A new or removed postcode drops the old point (the branch location is used until the server geocodes the new one).
  UPDATE public.events SET postcode = _pc,
    latitude = CASE WHEN postcode IS NOT DISTINCT FROM _pc THEN latitude END,
    longitude = CASE WHEN postcode IS NOT DISTINCT FROM _pc THEN longitude END,
    located_at = CASE WHEN postcode IS NOT DISTINCT FROM _pc THEN located_at END
  WHERE id = p_event;
  RETURN _pc;
END $$;

CREATE FUNCTION public.set_event_coordinates(p_event uuid, p_postcode text, p_lat double precision, p_lng double precision) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.events SET latitude = p_lat, longitude = p_lng, located_at = now()
  WHERE id = p_event AND postcode IS NOT DISTINCT FROM p_postcode AND p_postcode IS NOT NULL;
END $$;

-- Where the public map draws an event (see the header).
CREATE FUNCTION public.event_map_point(_e public.events) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE
    WHEN _e.location_type <> 'in_person' THEN NULL
    WHEN NOT _e.location_tba AND _e.latitude IS NOT NULL THEN
      jsonb_build_object('latitude', _e.latitude, 'longitude', _e.longitude, 'precision', 'venue')
    ELSE (SELECT jsonb_build_object('latitude', b.latitude, 'longitude', b.longitude, 'precision', 'branch')
          FROM public.branches b WHERE b.id = _e.branch_id AND b.latitude IS NOT NULL) END
$$;

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
    'has_image', public.public_event_image_path(_e) IS NOT NULL,
    'map', public.event_map_point(_e))
  FROM (SELECT 1) one LEFT JOIN public.branches b ON b.id = _e.branch_id LEFT JOIN public.regions r ON r.id = _e.region_id
$$;

REVOKE ALL ON FUNCTION public.set_event_coordinates(uuid, text, double precision, double precision), public.event_map_point(public.events)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_event_coordinates(uuid, text, double precision, double precision) TO service_role;
REVOKE ALL ON FUNCTION public.set_event_postcode(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_event_postcode(uuid, text) TO authenticated;

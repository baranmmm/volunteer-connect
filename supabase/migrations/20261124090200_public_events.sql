-- Public events without signing in: /events, /events/:id and the ICS feed.
-- anon has no access to any table; these SECURITY DEFINER functions are the only way in. They are granted to anon on
-- purpose (the one exception to "SECURITY DEFINER → authenticated only") and return only these fields: title,
-- description, dates (London), all-day, branch, region, category, the physical location text, an online flag, the
-- organiser of an external event, whether there is an image, and the registration state as a word (never counts).
-- Never: online links, attendees, emails, creators, or files other than the first image (signed by the server).

-- 'open' | 'full' | 'closed' (no numbers).
CREATE FUNCTION public.public_registration_state(_e public.events) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE
    WHEN _e.status <> 'published' OR NOT _e.registration_enabled OR coalesce(public.event_ends(_e) <= now(), true)
      OR EXISTS (SELECT 1 FROM public.event_deletion_jobs WHERE event_id = _e.id) THEN 'closed'
    WHEN _e.capacity IS NOT NULL AND (SELECT seats FROM public.registration_counts(_e.id)) >= _e.capacity THEN 'full'
    ELSE 'open' END
$$;

-- The first image of the event, or of its series' media holder.
CREATE FUNCTION public.public_event_image_path(_e public.events) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(
    (SELECT m.storage_path FROM public.event_media m WHERE m.event_id = _e.id AND m.kind = 'image' ORDER BY m.position, m.created_at LIMIT 1),
    (SELECT m.storage_path FROM public.event_series s JOIN public.event_media m ON m.event_id = s.media_event_id
     WHERE s.id = _e.series_id AND s.deleted_at IS NULL AND m.kind = 'image' ORDER BY m.position, m.created_at LIMIT 1))
$$;

CREATE FUNCTION public.public_event_json(_e public.events) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object(
    'id', _e.id, 'title', _e.title, 'description', _e.description, 'status', _e.status, 'scope', _e.scope,
    'all_day', _e.all_day, 'start_at', _e.start_at, 'end_at', _e.end_at, 'start_date', _e.start_date, 'end_date', _e.end_date,
    'branch_id', _e.branch_id, 'branch', b.name, 'region_id', _e.region_id, 'region', r.name, 'category', _e.category,
    'location', CASE WHEN _e.location_type = 'in_person' THEN nullif(btrim(_e.location), '') END,
    'is_online', _e.location_type = 'online',
    'organizer', CASE WHEN _e.is_external THEN _e.organizer END,
    'registration', public.public_registration_state(_e),
    'has_image', public.public_event_image_path(_e) IS NOT NULL)
  FROM (SELECT 1) one LEFT JOIN public.branches b ON b.id = _e.branch_id LEFT JOIN public.regions r ON r.id = _e.region_id
$$;

-- A public, live event: public audience, published (or cancelled), not deleted, not a series template, and not in a
-- deleted branch or region.
CREATE FUNCTION public.is_public_event(_e public.events) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT _e.audience = 'public' AND _e.deleted_at IS NULL AND NOT _e.series_template AND _e.status IN ('published', 'cancelled')
    AND NOT EXISTS (SELECT 1 FROM public.branches WHERE id = _e.branch_id AND deleted_at IS NOT NULL)
    AND NOT EXISTS (SELECT 1 FROM public.regions WHERE id = _e.region_id AND deleted_at IS NOT NULL)
$$;

-- Upcoming public events. Branch filter: events of those branches, region-wide events of their regions, national
-- events. Region filter: events in those regions and national events. At most 12 months and 200 events.
CREATE FUNCTION public.get_public_events(p_branch_ids uuid[] DEFAULT NULL, p_from timestamptz DEFAULT NULL, p_to timestamptz DEFAULT NULL,
  p_region_ids uuid[] DEFAULT NULL, p_include_cancelled boolean DEFAULT false) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _from timestamptz := coalesce(p_from, now()); _to timestamptz;
BEGIN
  _to := coalesce(p_to, _from + interval '6 months');
  IF _to < _from OR _to > _from + interval '12 months' THEN RAISE EXCEPTION 'Date range must be at most 12 months'; END IF;
  IF coalesce(array_length(p_branch_ids, 1), 0) > 100 OR coalesce(array_length(p_region_ids, 1), 0) > 100 THEN RAISE EXCEPTION 'Too many filters'; END IF;
  RETURN (SELECT coalesce(jsonb_agg(public.public_event_json(x) ORDER BY public.event_starts(x), x.id), '[]'::jsonb) FROM (
    SELECT e.* FROM public.events e
    WHERE public.is_public_event(e) AND (e.status = 'published' OR p_include_cancelled)
      AND public.event_ends(e) >= _from AND public.event_starts(e) <= _to
      AND (p_branch_ids IS NULL OR e.scope = 'national' OR e.branch_id = ANY (p_branch_ids)
        OR (e.scope = 'region' AND e.region_id IN (SELECT region_id FROM public.branches WHERE id = ANY (p_branch_ids))))
      AND (p_region_ids IS NULL OR e.scope = 'national' OR e.region_id = ANY (p_region_ids))
    ORDER BY public.event_starts(e), e.id
    LIMIT 200) x);
END $$;

-- One public event (also when cancelled, so a shared or subscribed link explains it); NULL otherwise.
CREATE FUNCTION public.get_public_event(p_id uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.public_event_json(e) FROM public.events e WHERE e.id = p_id AND public.is_public_event(e)
$$;

-- Storage path of the public event's first image, for the server to sign (5 minutes). NULL when there is none.
CREATE FUNCTION public.get_public_event_image(p_id uuid) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.public_event_image_path(e) FROM public.events e WHERE e.id = p_id AND public.is_public_event(e)
$$;

REVOKE ALL ON FUNCTION public.public_registration_state(public.events), public.public_event_image_path(public.events),
  public.public_event_json(public.events), public.is_public_event(public.events) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_public_events(uuid[], timestamptz, timestamptz, uuid[], boolean), public.get_public_event(uuid),
  public.get_public_event_image(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_events(uuid[], timestamptz, timestamptz, uuid[], boolean), public.get_public_event(uuid),
  public.get_public_event_image(uuid) TO anon, authenticated;

-- 1. Online public events: the joining link reaches confirmed registrants only. The guest's "manage my registration"
--    page (guest_registration_view, server only) now carries online_url when the guest holds a place (registered,
--    attended, no-show) on a published online event. Public functions (get_public_*, the ICS feed, the landing data)
--    and announcements still never include it. The sender adds it to confirmation and reminder emails from
--    email_event_context (server only), again only for people with a place.
-- 2. Region-level past records (the import maps DS region pages, e.g. "Greater London", to region-scope records):
--    editing one keeps its region (update_past_event with no branch on a region record), and the landing gallery
--    names the region when there is no branch.

CREATE OR REPLACE FUNCTION public.guest_registration_view(p_registration uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object('registration_id', r.id, 'status', r.status, 'places', r.places, 'full_name', g.full_name,
    'waitlist_position', public.registration_position(r),
    'event', CASE WHEN public.is_public_event(e) THEN public.public_event_json(e) END,
    'online_url', CASE WHEN public.is_public_event(e) AND e.status = 'published' AND e.location_type = 'online'
      AND r.status IN ('registered', 'attended', 'no_show') AND g.confirmed_at IS NOT NULL THEN e.online_url END)
  FROM public.event_registrations r JOIN public.event_guests g ON g.registration_id = r.id JOIN public.events e ON e.id = r.event_id
  WHERE r.id = p_registration AND r.guest
$$;
REVOKE ALL ON FUNCTION public.guest_registration_view(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.guest_registration_view(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.update_past_event(p_id uuid, p_title text, p_date date, p_branch uuid, p_description text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _region uuid; _scope text := CASE WHEN p_branch IS NULL THEN 'national' ELSE 'branch' END; _old public.events;
BEGIN
  PERFORM public.require_privacy_accepted();
  PERFORM id FROM public.profiles WHERE id = auth.uid() FOR UPDATE;
  SELECT * INTO _old FROM public.events WHERE id = p_id AND past_record AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND OR NOT public.can_manage_event(p_id) THEN RAISE EXCEPTION 'Not allowed'; END IF;
  IF p_branch IS NOT NULL THEN SELECT region_id INTO _region FROM public.branches WHERE id = p_branch AND deleted_at IS NULL;
  ELSIF _old.scope = 'region' THEN _scope := 'region'; _region := _old.region_id;  -- a region record stays one
  END IF;
  IF NOT public.can_manage_event_scope(_scope, p_branch, _region) THEN RAISE EXCEPTION 'Not allowed'; END IF;
  IF char_length(coalesce(p_description, '')) > 5000 THEN RAISE EXCEPTION 'Invalid event values'; END IF;
  UPDATE public.events SET title = p_title, description = coalesce(p_description, ''), start_date = p_date, end_date = p_date,
    scope = _scope, branch_id = p_branch, region_id = _region
  WHERE id = p_id;
END $$;

CREATE OR REPLACE FUNCTION public.public_landing_data()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT jsonb_build_object(
    'upcoming', coalesce((SELECT jsonb_agg(public.public_event_json(x) || jsonb_build_object('image_path', public.public_event_image_path(x))
        ORDER BY public.event_starts(x), x.id)
      FROM (SELECT e.* FROM public.events e WHERE public.is_public_event(e) AND e.status = 'published' AND NOT e.past_record
        AND public.event_ends(e) >= now() AND public.event_starts(e) <= now() + interval '12 months'
        ORDER BY public.event_starts(e), e.id LIMIT 60) x), '[]'::jsonb),
    'gallery', coalesce((SELECT jsonb_agg(g ORDER BY g->>'date' DESC, g->>'event_id') FROM (
      SELECT jsonb_build_object('event_id', e.id, 'title', e.title, 'date', coalesce(e.start_date, (e.start_at AT TIME ZONE 'Europe/London')::date),
        'branch', b.name, 'region', rg.name, 'description', e.description, 'past_record', e.past_record,
        'photos', (SELECT jsonb_agg(jsonb_build_object('id', m.id, 'path', m.storage_path, 'width', m.width, 'height', m.height) ORDER BY m.position, m.created_at)
          FROM public.event_media m WHERE m.event_id = e.id AND m.in_gallery AND m.kind = 'image')) AS g
      FROM public.events e LEFT JOIN public.branches b ON b.id = e.branch_id LEFT JOIN public.regions rg ON rg.id = e.region_id
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
$function$

;
REVOKE ALL ON FUNCTION public.public_landing_data() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.public_landing_data() TO service_role;

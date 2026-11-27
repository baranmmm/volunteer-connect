-- Media for followers (on top of 20261216090000 / 20261217090000): followers see, read-only, the Media gallery of the
-- branches they follow, under the same rules as members: only events that have started, only event page photos added
-- after the start (past records in full), albums included; and, as everywhere for followers, only public events (a
-- members-only event's chapter stays hidden: can_view_event_media). They only ever get the 640/1280 copies (the
-- Storage read policy gives full-size originals to managers only).
-- * can_view_media(branch): also an active follower (no member role) who follows the branch. Every gallery RPC, the
--   viewed markers and the media-library read policy use it.
-- * get_media_home: a follower's branch list is the branches they follow; the default is the first one they followed.
-- * Followers change nothing: uploads and upload requests (volunteers / managers only), stars, moves, deletes and
--   covers (managers only) refused as before; request_media_download now refuses followers too. The post-event nudge
--   reaches volunteers only (unchanged). National Coordinators still see nothing.
-- * Privacy notice 1.7: the Media area is visible to signed-in members and followers of the branch (the text says so);
--   every member and follower confirms it once more.
-- Additive: functions replaced with the same signatures and grants; no table or data change.

CREATE OR REPLACE FUNCTION public.can_view_media(_branch uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  -- coalesce: is_branch_member is NULL (not false) for people without a branch; every helper here answers true/false.
  SELECT coalesce(_branch IS NOT NULL AND public.is_active_person(auth.uid()) AND public.session_ok() AND public.has_accepted_privacy_notice()
    AND EXISTS (SELECT 1 FROM public.branches b WHERE b.id = _branch AND b.deleted_at IS NULL)
    AND (public.is_branch_member(auth.uid(), _branch)
      OR EXISTS (SELECT 1 FROM public.user_roles r JOIN public.branches b ON b.region_id = r.region_id
                 WHERE r.user_id = auth.uid() AND r.role = 'regional_director' AND b.id = _branch)
      -- Followers (no member role): the branches they follow, read-only.
      OR (public.is_follower(auth.uid())
          AND EXISTS (SELECT 1 FROM public.user_followed_branches f WHERE f.user_id = auth.uid() AND f.branch_id = _branch))), false)
$$;

CREATE OR REPLACE FUNCTION public.get_media_home(p_branch uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _branches jsonb; _branch uuid; _manager boolean;
BEGIN
  SELECT coalesce(jsonb_agg(jsonb_build_object('id', b.id, 'name', b.name) ORDER BY b.name, b.id), '[]'::jsonb) INTO _branches
  FROM public.branches b WHERE b.deleted_at IS NULL AND public.can_view_media(b.id)
    AND (b.id = public.get_user_branch(auth.uid())
      OR EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = auth.uid() AND r.role = 'regional_director' AND r.region_id = b.region_id)
      OR (public.is_follower(auth.uid())
          AND EXISTS (SELECT 1 FROM public.user_followed_branches f WHERE f.user_id = auth.uid() AND f.branch_id = b.id)));
  IF _branches = '[]'::jsonb THEN RAISE EXCEPTION 'Not allowed'; END IF;
  -- Members: their branch; followers: the branch they followed first; then the first in the list.
  _branch := coalesce(p_branch, public.get_user_branch(auth.uid()),
    (SELECT f.branch_id FROM public.user_followed_branches f JOIN public.branches b ON b.id = f.branch_id AND b.deleted_at IS NULL
     WHERE f.user_id = auth.uid() AND public.is_follower(auth.uid()) ORDER BY f.created_at, f.branch_id LIMIT 1),
    (_branches->0->>'id')::uuid);
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(_branches) x WHERE (x->>'id')::uuid = _branch) THEN
    _branch := (_branches->0->>'id')::uuid;
  END IF;
  _manager := public.can_manage_media(_branch);
  RETURN jsonb_build_object(
    'branches', _branches,
    'branch', (SELECT jsonb_build_object('id', b.id, 'name', b.name) FROM public.branches b WHERE b.id = _branch),
    'can_manage', _manager,
    'can_request', public.can_request_media_upload(_branch),
    'is_trustee', public.is_trustee(auth.uid()),
    'photo_count', (SELECT count(*) FROM public.media_branch_photos(_branch)),
    'years', coalesce((SELECT jsonb_agg(jsonb_build_object('year', y, 'chapters', ch) ORDER BY y DESC) FROM (
        SELECT extract(year FROM c.chapter_date)::integer AS y,
          jsonb_agg(jsonb_build_object('kind', c.kind, 'id', c.id, 'title', c.title) ORDER BY c.sort_at DESC, c.id DESC) AS ch
        FROM public.media_branch_chapters(_branch) c WHERE c.photo_count > 0 OR _manager GROUP BY 1) yy), '[]'::jsonb),
    'albums', coalesce((SELECT jsonb_agg(jsonb_build_object('id', c.id, 'title', c.title, 'photo_count', c.photo_count)
        ORDER BY c.sort_at DESC, c.id DESC) FROM public.media_branch_chapters(_branch) c WHERE c.kind = 'album'), '[]'::jsonb));
END $$;

CREATE OR REPLACE FUNCTION public.request_media_download(p_items jsonb, p_reason text DEFAULT NULL) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid uuid := auth.uid(); _branch uuid; _item jsonb; _src text; _pid uuid; _id uuid;
  _reason text := nullif(btrim(coalesce(p_reason, '')), '');
BEGIN
  PERFORM public.require_privacy_accepted();
  PERFORM id FROM public.profiles WHERE id = _uid FOR UPDATE;  -- serialises the open-request limit
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 OR jsonb_array_length(p_items) > 50 THEN
    RAISE EXCEPTION 'Invalid media selection';
  END IF;
  IF length(_reason) > 500 THEN RAISE EXCEPTION 'Invalid request values'; END IF;
  BEGIN
    _branch := public.media_photo_branch(p_items->0->>'source', (p_items->0->>'id')::uuid);
  EXCEPTION WHEN invalid_text_representation THEN RAISE EXCEPTION 'Invalid media selection';
  END;
  -- Volunteers and trustees of the branch (and the region's RDs never: they manage); followers only view.
  IF _branch IS NULL OR NOT public.can_view_media(_branch) OR public.can_manage_media(_branch) OR public.is_follower(_uid) THEN
    RAISE EXCEPTION 'Not allowed';
  END IF;
  IF (SELECT count(*) FROM public.media_download_requests WHERE requester_id = _uid AND status = 'submitted') >= 5 THEN
    RAISE EXCEPTION 'Too many open requests';
  END IF;
  INSERT INTO public.media_download_requests (branch_id, requester_id, reason) VALUES (_branch, _uid, _reason) RETURNING id INTO _id;
  FOR _item IN SELECT DISTINCT x FROM jsonb_array_elements(p_items) x LOOP
    _src := _item->>'source';
    BEGIN
      _pid := (_item->>'id')::uuid;
    EXCEPTION WHEN invalid_text_representation THEN RAISE EXCEPTION 'Invalid media selection';
    END;
    IF NOT EXISTS (SELECT 1 FROM public.media_branch_photos(_branch) b WHERE b.source = _src AND b.id = _pid) THEN
      RAISE EXCEPTION 'Invalid media selection';
    END IF;
    INSERT INTO public.media_download_items (request_id, library_photo_id, event_media_id)
    VALUES (_id, CASE WHEN _src = 'library' THEN _pid END, CASE WHEN _src = 'event' THEN _pid END);
  END LOOP;
  RETURN _id;
END $$;

-- Privacy notice 1.7: who sees the Media area (members and followers of the branch).
CREATE OR REPLACE FUNCTION public.privacy_notice_version() RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public AS $$ SELECT '1.7' $$;

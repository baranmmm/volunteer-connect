-- Media tab, part 2 (on top of 20261216090000_media_library.sql):
-- * Only events that have happened. An event is a chapter only once it has started (start <= now; all-day events at
--   London midnight of their start date). Of a regular event's page images (event_media) only those added after the
--   start count as Media photos (posters, covers and promo images uploaded before stay on the event page only); a
--   past record (past_record: imported or recorded later) counts in full; Media-only photos of an event (approved
--   upload requests, moves, uploads into the chapter) count whatever their date. An event without qualifying photos
--   has no chapter. Upload requests, direct uploads, "Move to…" and approvals refuse events that have not started
--   ('Event has not started yet'); the upload targets list only started events. Albums are unaffected. Enforced in
--   media_branch_photos / media_event_ok, which every gallery, chapter, story, slideshow, photo-grid, highlight and
--   download RPC and the Storage read policy use.
-- * Five-photo preview per chapter (the collage's one large + four small tiles).
-- * Highlights: a Branch Manager / Regional Director stars photos (library or event page photos shown in Media);
--   get_media_highlights lists them newest first for the highlights strip, card and slideshow. A star follows the photo
--   through moves (same id; an event page photo moved to an album keeps it). Photo JSON carries 'starred'.
-- * Download requests (volunteers and trustees; managers download originals directly): one or several photos with an
--   optional reason, reviewed by the branch's BM / the region's RD in Requests (the grouped 'review' notice counts
--   them as 'downloads'). Approval opens a 24-hour window: the requester's notice (media_download_approved,
--   'request_decided') links to /media/download/<id>; the server signs the full-size files with the service role only
--   after media_download_files() confirms the requester, the approval and the window (expired links say so). Decline
--   with an optional reason (media_download_declined).
-- * Post-event nudge: at 09:30 London (pg_cron at 08:30 and 09:30 UTC; the function runs only in the London 09:00
--   hour) the day after a branch event ends, volunteers of the branch who attended it or are assigned a task linked to
--   it get one notice "Share your photos" (kind media_photo_nudge, new type 'media': in the app on, push on, email off
--   by default; changeable in Profile). Once per event and person (media_nudges_sent), never repeated.
-- Additive: new tables and functions; replaced functions keep their signatures and grants. No existing row changes.

-- ---------------------------------------------------------------------------------------------------------------
-- 1. Tables

CREATE TABLE public.media_highlights (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  library_photo_id uuid REFERENCES public.media_photos(id) ON DELETE CASCADE,
  event_media_id uuid REFERENCES public.event_media(id) ON DELETE CASCADE,
  starred_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT media_highlights_one CHECK ((library_photo_id IS NULL) <> (event_media_id IS NULL))
);
CREATE UNIQUE INDEX media_highlights_library_uq ON public.media_highlights (library_photo_id) WHERE library_photo_id IS NOT NULL;
CREATE UNIQUE INDEX media_highlights_event_uq ON public.media_highlights (event_media_id) WHERE event_media_id IS NOT NULL;
CREATE INDEX media_highlights_branch_idx ON public.media_highlights (branch_id, created_at DESC);
CREATE INDEX media_highlights_starred_by_idx ON public.media_highlights (starred_by) WHERE starred_by IS NOT NULL;

CREATE TABLE public.media_download_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  requester_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  reason text CHECK (reason IS NULL OR length(reason) <= 500),
  status text NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted', 'approved', 'declined', 'withdrawn')),
  decline_reason text CHECK (decline_reason IS NULL OR length(decline_reason) <= 500),
  reviewer_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  -- Approval opens the download window (24 hours).
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX media_download_requests_branch_idx ON public.media_download_requests (branch_id, status);
CREATE INDEX media_download_requests_requester_idx ON public.media_download_requests (requester_id) WHERE requester_id IS NOT NULL;
CREATE INDEX media_download_requests_reviewer_idx ON public.media_download_requests (reviewer_id) WHERE reviewer_id IS NOT NULL;

CREATE TABLE public.media_download_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES public.media_download_requests(id) ON DELETE CASCADE,
  library_photo_id uuid REFERENCES public.media_photos(id) ON DELETE CASCADE,
  event_media_id uuid REFERENCES public.event_media(id) ON DELETE CASCADE,
  CONSTRAINT media_download_items_one CHECK ((library_photo_id IS NULL) <> (event_media_id IS NULL))
);
CREATE INDEX media_download_items_request_idx ON public.media_download_items (request_id);
CREATE INDEX media_download_items_library_idx ON public.media_download_items (library_photo_id) WHERE library_photo_id IS NOT NULL;
CREATE INDEX media_download_items_event_idx ON public.media_download_items (event_media_id) WHERE event_media_id IS NOT NULL;

-- One nudge per event and person, never repeated. Personal: goes with the person or the event.
CREATE TABLE public.media_nudges_sent (
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  sent_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (event_id, user_id)
);
CREATE INDEX media_nudges_sent_user_idx ON public.media_nudges_sent (user_id);

ALTER TABLE public.media_highlights ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.media_download_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.media_download_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.media_nudges_sent ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.media_highlights, public.media_download_requests, public.media_download_items, public.media_nudges_sent
  FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.media_highlights, public.media_download_requests, public.media_download_items, public.media_nudges_sent
  TO service_role;

-- ---------------------------------------------------------------------------------------------------------------
-- 2. Helpers

-- Whether an event has started (an all-day event at London midnight of its start date); false for unscheduled ones.
CREATE FUNCTION public.media_event_started(_event uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce((SELECT coalesce(e.start_at, e.start_date::timestamp AT TIME ZONE 'Europe/London') <= now()
    FROM public.events e WHERE e.id = _event), false)
$$;

CREATE FUNCTION public.media_is_starred(_source text, _id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE WHEN _source = 'library' THEN EXISTS (SELECT 1 FROM public.media_highlights h WHERE h.library_photo_id = _id)
    ELSE EXISTS (SELECT 1 FROM public.media_highlights h WHERE h.event_media_id = _id) END
$$;

-- The branch of a photo ('library' | 'event'), or NULL.
CREATE FUNCTION public.media_photo_branch(_source text, _id uuid) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE WHEN _source = 'library' THEN (SELECT p.branch_id FROM public.media_photos p WHERE p.id = _id)
    WHEN _source = 'event' THEN (SELECT e.branch_id FROM public.event_media m JOIN public.events e ON e.id = m.event_id
      WHERE m.id = _id AND e.scope = 'branch') END
$$;

-- ---------------------------------------------------------------------------------------------------------------
-- 3. Replaced (same signatures): the started-events rule, five-photo preview, stars in photo JSON, started-only
--    targets, highlights through moves, download requests in the review count and on account deletion.

CREATE OR REPLACE FUNCTION public.media_event_ok(_event uuid, _branch uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(EXISTS (SELECT 1 FROM public.events e WHERE e.id = _event AND e.branch_id = _branch AND e.scope = 'branch'
      AND e.deleted_at IS NULL AND NOT e.series_template AND e.category <> 'meeting' AND e.status IN ('published', 'cancelled'))
    AND public.can_view_event_media(_event) AND public.media_event_started(_event), false)
$$;

CREATE OR REPLACE FUNCTION public.media_branch_photos(_branch uuid)
RETURNS TABLE (source text, id uuid, chapter_kind text, chapter_id uuid, storage_path text, has_variants boolean,
  width integer, height integer, pos integer, created_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH ev AS (
    SELECT e.id, e.past_record, coalesce(e.start_at, e.start_date::timestamp AT TIME ZONE 'Europe/London') AS started_at
    FROM public.events e
    WHERE e.branch_id = _branch AND e.scope = 'branch' AND e.deleted_at IS NULL AND NOT e.series_template
      AND e.category <> 'meeting' AND e.status IN ('published', 'cancelled') AND public.can_view_event_media(e.id)
      AND coalesce(e.start_at, e.start_date::timestamp AT TIME ZONE 'Europe/London') <= now())
  SELECT 'event', m.id, 'event', m.event_id, m.storage_path, m.has_variants, m.width, m.height, m.position, m.created_at
  FROM public.event_media m JOIN ev ON ev.id = m.event_id
  -- Event page images count once the event has started; a past record counts in full (imported and recorded later).
  WHERE m.kind = 'image' AND (ev.past_record OR m.created_at >= ev.started_at) AND EXISTS (SELECT 1 FROM storage.objects o WHERE o.bucket_id = 'event-media' AND o.name = m.storage_path)
  UNION ALL
  SELECT 'library', p.id, 'event', p.event_id, p.storage_path, true, p.width, p.height, 1000 + p.position, p.added_at
  FROM public.media_photos p JOIN ev ON ev.id = p.event_id
  WHERE p.branch_id = _branch AND p.ready AND p.deleting_at IS NULL
  UNION ALL
  SELECT 'library', p.id, 'album', p.album_id, p.storage_path, true, p.width, p.height, p.position, p.added_at
  FROM public.media_photos p JOIN public.media_albums a ON a.id = p.album_id AND a.deleted_at IS NULL
  WHERE p.branch_id = _branch AND a.branch_id = _branch AND p.ready AND p.deleting_at IS NULL
$$;

CREATE OR REPLACE FUNCTION public.media_chapter_json(_branch uuid, _kind text, _id uuid, _preview integer, _manager boolean) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH c AS (SELECT * FROM public.media_branch_chapters(_branch) c WHERE c.kind = _kind AND c.id = _id),
  ph AS (SELECT * FROM public.media_branch_photos(_branch) p WHERE p.chapter_kind = _kind AND p.chapter_id = _id),
  seen AS (SELECT v.viewed_at FROM public.media_chapter_views v WHERE v.user_id = auth.uid()
           AND ((_kind = 'album' AND v.album_id = _id) OR (_kind = 'event' AND v.event_id = _id)))
  SELECT jsonb_build_object('kind', c.kind, 'id', c.id, 'title', c.title, 'date', c.chapter_date, 'venue', c.venue,
    'description', c.description, 'photo_count', c.photo_count, 'last_added_at', c.last_added_at,
    'cover_photo_id', c.cover_photo_id,
    'is_new', c.last_added_at > now() - interval '7 days',
    'unseen', c.photo_count > 0 AND NOT EXISTS (SELECT 1 FROM seen WHERE seen.viewed_at >= c.last_added_at),
    'photos', coalesce((SELECT jsonb_agg(x.j ORDER BY x.o) FROM (
        SELECT public.media_photo_json(p.source, p.id, p.storage_path, p.has_variants, p.width, p.height, p.created_at, _manager)
          || jsonb_build_object('starred', public.media_is_starred(p.source, p.id)) AS j,
          row_number() OVER (ORDER BY coalesce(p.id = c.cover_photo_id, false) DESC, p.pos, p.created_at, p.id) AS o
        FROM ph p ORDER BY o LIMIT greatest(coalesce(_preview, 4), 0)) x), '[]'::jsonb))
  FROM c
$$;

CREATE OR REPLACE FUNCTION public.get_media_photos(p_branch uuid, p_source text DEFAULT 'all', p_year integer DEFAULT NULL,
  p_before_at timestamptz DEFAULT NULL, p_before_id uuid DEFAULT NULL, p_limit integer DEFAULT 60) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _manager boolean;
BEGIN
  IF NOT public.can_view_media(p_branch) THEN RAISE EXCEPTION 'Not allowed'; END IF;
  IF coalesce(p_source, 'all') NOT IN ('all', 'events', 'albums') THEN RAISE EXCEPTION 'Invalid media filter'; END IF;
  _manager := public.can_manage_media(p_branch);
  RETURN jsonb_build_object('photos', coalesce((SELECT jsonb_agg(public.media_photo_json(p.source, p.id, p.storage_path, p.has_variants,
        p.width, p.height, p.created_at, _manager) || jsonb_build_object('chapter_kind', p.chapter_kind, 'chapter_id', p.chapter_id,
        'chapter_title', c.title, 'chapter_date', c.chapter_date, 'starred', public.media_is_starred(p.source, p.id)) ORDER BY p.created_at DESC, p.id DESC)
      FROM (SELECT * FROM public.media_branch_photos(p_branch) p
        WHERE (coalesce(p_source, 'all') = 'all' OR (p_source = 'events' AND p.chapter_kind = 'event') OR (p_source = 'albums' AND p.chapter_kind = 'album'))
          AND (p_before_at IS NULL OR (p.created_at, p.id) < (p_before_at, coalesce(p_before_id, 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid)))
        ORDER BY p.created_at DESC, p.id DESC LIMIT least(greatest(coalesce(p_limit, 60), 1), 120)) p
      JOIN public.media_branch_chapters(p_branch) c ON c.kind = p.chapter_kind AND c.id = p.chapter_id
      WHERE p_year IS NULL OR extract(year FROM c.chapter_date) = p_year), '[]'::jsonb));
END $$;

CREATE OR REPLACE FUNCTION public.get_media_chapters(p_branch uuid, p_source text DEFAULT 'all', p_year integer DEFAULT NULL,
  p_search text DEFAULT NULL, p_before_at timestamptz DEFAULT NULL, p_before_id uuid DEFAULT NULL, p_limit integer DEFAULT 6)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _manager boolean; _search text := nullif(btrim(coalesce(p_search, '')), '');
BEGIN
  IF NOT public.can_view_media(p_branch) THEN RAISE EXCEPTION 'Not allowed'; END IF;
  IF coalesce(p_source, 'all') NOT IN ('all', 'events', 'albums') OR length(_search) > 100 THEN RAISE EXCEPTION 'Invalid media filter'; END IF;
  _manager := public.can_manage_media(p_branch);
  RETURN jsonb_build_object('chapters', coalesce((SELECT jsonb_agg(public.media_chapter_json(p_branch, c.kind, c.id, 5, _manager)
        || jsonb_build_object('sort_at', c.sort_at) ORDER BY c.sort_at DESC, c.id DESC)
      FROM (SELECT * FROM public.media_branch_chapters(p_branch) c
        WHERE (c.photo_count > 0 OR (_manager AND c.kind = 'album'))
          AND (coalesce(p_source, 'all') = 'all' OR (p_source = 'events' AND c.kind = 'event') OR (p_source = 'albums' AND c.kind = 'album'))
          AND (p_year IS NULL OR extract(year FROM c.chapter_date) = p_year)
          AND (_search IS NULL OR position(lower(_search) IN lower(c.title)) > 0)
          AND (p_before_at IS NULL OR (c.sort_at, c.id) < (p_before_at, coalesce(p_before_id, 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid)))
        ORDER BY c.sort_at DESC, c.id DESC LIMIT least(greatest(coalesce(p_limit, 6), 1), 30)) c), '[]'::jsonb));
END $$;

CREATE OR REPLACE FUNCTION public.list_media_targets(p_branch uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT (public.can_manage_media(p_branch) OR public.can_request_media_upload(p_branch)) THEN RAISE EXCEPTION 'Not allowed'; END IF;
  RETURN jsonb_build_object(
    'albums', coalesce((SELECT jsonb_agg(jsonb_build_object('id', a.id, 'title', a.title, 'date', a.album_date) ORDER BY a.created_at DESC, a.id)
      FROM public.media_albums a WHERE a.branch_id = p_branch AND a.deleted_at IS NULL), '[]'::jsonb),
    'events', coalesce((SELECT jsonb_agg(jsonb_build_object('id', x.id, 'title', x.title, 'date', x.d) ORDER BY x.s DESC, x.id) FROM (
        SELECT e.id, e.title, coalesce(e.start_date, (e.start_at AT TIME ZONE 'Europe/London')::date) AS d,
          coalesce(e.start_at, e.start_date::timestamp AT TIME ZONE 'Europe/London') AS s
        FROM public.events e WHERE e.branch_id = p_branch AND e.scope = 'branch' AND e.deleted_at IS NULL AND NOT e.series_template
          AND e.category <> 'meeting' AND e.status IN ('published', 'cancelled')
          AND coalesce(e.start_at, e.start_date::timestamp AT TIME ZONE 'Europe/London') <= now()
          AND public.can_view_event_media(e.id)
        ORDER BY 4 DESC, 1 LIMIT 50) x), '[]'::jsonb));
END $$;

CREATE OR REPLACE FUNCTION public.media_target(_branch uuid, p jsonb, OUT _album uuid, OUT _event uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  _album := nullif(p->>'album_id', '')::uuid;
  _event := nullif(p->>'event_id', '')::uuid;
  IF (_album IS NULL) = (_event IS NULL) THEN RAISE EXCEPTION 'Choose an album or an event'; END IF;
  IF _album IS NOT NULL THEN
    PERFORM 1 FROM public.media_albums WHERE id = _album AND branch_id = _branch AND deleted_at IS NULL FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Album not found'; END IF;
  ELSE
    PERFORM 1 FROM public.events WHERE id = _event FOR KEY SHARE;
    IF FOUND AND NOT public.media_event_started(_event) THEN RAISE EXCEPTION 'Event has not started yet'; END IF;
    IF NOT public.media_event_ok(_event, _branch) THEN RAISE EXCEPTION 'Event not found'; END IF;
  END IF;
EXCEPTION WHEN invalid_text_representation THEN RAISE EXCEPTION 'Choose an album or an event';
END $$;

CREATE OR REPLACE FUNCTION public.move_media_photos(p_items jsonb, p_target jsonb, p_commit boolean DEFAULT false) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _branch uuid; _album uuid; _event uuid; _t record; _item jsonb; _src text; _id uuid;
  _p public.media_photos; _m public.event_media; _e public.events; _ext text; _to text; _pos integer;
  _moved integer := 0; _skipped jsonb := '[]'::jsonb; _copies jsonb := '[]'::jsonb; _remove jsonb := '[]'::jsonb;
  _hashes text[] := '{}'; _events uuid[] := '{}'; _from text[]; _dest text[]; i integer;
BEGIN
  PERFORM public.require_privacy_accepted();
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 OR jsonb_array_length(p_items) > 200
     OR p_target IS NULL OR jsonb_typeof(p_target) <> 'object' THEN
    RAISE EXCEPTION 'Invalid media selection';
  END IF;
  BEGIN
    _album := nullif(p_target->>'album_id', '')::uuid;
    _event := nullif(p_target->>'event_id', '')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN RAISE EXCEPTION 'Choose an album or an event';
  END;
  _branch := CASE WHEN _album IS NOT NULL THEN (SELECT branch_id FROM public.media_albums WHERE id = _album)
                  ELSE (SELECT branch_id FROM public.events WHERE id = _event AND scope = 'branch') END;
  IF _branch IS NULL OR NOT public.can_manage_media(_branch) THEN RAISE EXCEPTION 'Not allowed'; END IF;
  _t := public.media_target(_branch, p_target);  -- validates and locks the target album
  SELECT coalesce(max(position) + 1, 0) INTO _pos FROM public.media_photos
  WHERE (album_id = _album OR event_id = _event) AND deleting_at IS NULL;

  FOR _item IN SELECT x FROM jsonb_array_elements(p_items) x LOOP
    _src := _item->>'source';
    BEGIN
      _id := (_item->>'id')::uuid;
    EXCEPTION WHEN invalid_text_representation THEN RAISE EXCEPTION 'Invalid media selection';
    END;
    IF _src = 'library' THEN
      SELECT * INTO _p FROM public.media_photos WHERE id = _id FOR UPDATE;
      IF NOT FOUND OR _p.branch_id IS DISTINCT FROM _branch OR NOT _p.ready OR _p.deleting_at IS NOT NULL
         OR NOT ((_p.album_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.media_albums a WHERE a.id = _p.album_id AND a.deleted_at IS NULL))
              OR (_p.event_id IS NOT NULL AND public.media_event_ok(_p.event_id, _branch))) THEN
        RAISE EXCEPTION 'Not allowed';
      END IF;
      IF _p.album_id IS NOT DISTINCT FROM _album AND _p.event_id IS NOT DISTINCT FROM _event THEN
        _skipped := _skipped || jsonb_build_object('id', _id, 'reason', 'unchanged');
        CONTINUE;
      END IF;
      IF (_p.content_hash IS NOT NULL AND (_p.content_hash = ANY (_hashes) OR EXISTS (SELECT 1 FROM public.media_photos x
            WHERE x.id <> _id AND x.content_hash = _p.content_hash AND x.deleting_at IS NULL
              AND ((_album IS NOT NULL AND x.album_id = _album) OR (_event IS NOT NULL AND x.event_id = _event)))
          OR (_event IS NOT NULL AND EXISTS (SELECT 1 FROM public.event_media m WHERE m.event_id = _event AND m.content_hash = _p.content_hash)))) THEN
        _skipped := _skipped || jsonb_build_object('id', _id, 'reason', 'duplicate');
        CONTINUE;
      END IF;
      IF _p.content_hash IS NOT NULL THEN _hashes := _hashes || _p.content_hash; END IF;
      IF p_commit THEN
        UPDATE public.media_albums SET cover_photo_id = NULL WHERE cover_photo_id = _id AND id IS DISTINCT FROM _album;
        UPDATE public.media_photos SET album_id = _album, event_id = _event, position = _pos, added_at = clock_timestamp() WHERE id = _id;
        _pos := _pos + 1;
      END IF;
      _moved := _moved + 1;
    ELSIF _src = 'event' THEN
      SELECT * INTO _m FROM public.event_media WHERE id = _id;
      IF NOT FOUND THEN RAISE EXCEPTION 'Not allowed'; END IF;
      SELECT * INTO _e FROM public.events WHERE id = _m.event_id FOR UPDATE;
      PERFORM 1 FROM public.event_media WHERE id = _id FOR UPDATE;
      IF _m.kind <> 'image' OR _e.branch_id IS DISTINCT FROM _branch OR NOT public.media_event_ok(_e.id, _branch)
         OR NOT public.can_manage_event(_e.id) THEN
        RAISE EXCEPTION 'Not allowed';
      END IF;
      IF _album IS NULL THEN RAISE EXCEPTION 'Event page photos can only be moved to an album'; END IF;
      IF _id = (SELECT x.id FROM public.event_media x WHERE x.event_id = _e.id AND x.kind = 'image' ORDER BY x.position, x.id LIMIT 1) THEN
        RAISE EXCEPTION 'Change the event cover first';
      END IF;
      IF NOT _m.has_variants THEN RAISE EXCEPTION 'Image copies are missing'; END IF;
      _ext := public.media_ext(split_part(_m.storage_path, '.', array_length(string_to_array(_m.storage_path, '.'), 1)));
      IF _ext IS NULL THEN RAISE EXCEPTION 'Invalid media file'; END IF;
      IF _m.content_hash IS NOT NULL AND (_m.content_hash = ANY (_hashes) OR public.media_is_duplicate(_album, NULL, _m.content_hash)) THEN
        _skipped := _skipped || jsonb_build_object('id', _id, 'reason', 'duplicate');
        CONTINUE;
      END IF;
      IF _m.content_hash IS NOT NULL THEN _hashes := _hashes || _m.content_hash; END IF;
      _events := _events || _e.id;
      -- A public event keeps at least one photo (the cover stays anyway; checked for every event moved from).
      IF _e.audience = 'public' AND (SELECT count(*) FROM public.event_media x WHERE x.event_id = _e.id AND x.kind = 'image')
           - (SELECT count(*) FROM unnest(_events) v WHERE v = _e.id) < 1 THEN
        RAISE EXCEPTION 'A public event must keep at least one photo';
      END IF;
      _to := _branch::text || '/' || _id::text || '.' || _ext;
      _from := _m.storage_path || public.event_media_variant_paths(_m.storage_path);
      _dest := _to || public.event_media_variant_paths(_to);
      IF NOT p_commit THEN
        FOR i IN 1..3 LOOP
          _copies := _copies || jsonb_build_object('from_bucket', 'event-media', 'from', _from[i], 'to_bucket', 'media-library', 'to', _dest[i]);
        END LOOP;
      ELSE
        IF (SELECT count(*) FROM storage.objects WHERE bucket_id = 'media-library' AND name = ANY (_dest)) < 3 THEN
          RAISE EXCEPTION 'Copied files are missing';
        END IF;
        INSERT INTO public.media_photos (id, branch_id, album_id, storage_path, original_name, content_hash, width, height,
          position, ready, uploaded_by, created_at)
        VALUES (_id, _branch, _album, _to, _m.original_name, _m.content_hash, _m.width, _m.height, _pos, true, _m.uploaded_by, _m.created_at);
        -- The highlight star follows the photo (same id), before the event row goes.
        UPDATE public.media_highlights SET library_photo_id = _id, event_media_id = NULL WHERE event_media_id = _id;
        DELETE FROM public.event_media WHERE id = _id;
        WITH ordered AS (SELECT x.id, row_number() OVER (ORDER BY CASE WHEN x.kind = 'image' THEN 0 ELSE 1 END, x.position, x.id) - 1 AS pos
                         FROM public.event_media x WHERE x.event_id = _e.id)
        UPDATE public.event_media x SET position = ordered.pos, updated_at = now() FROM ordered WHERE x.id = ordered.id AND x.position <> ordered.pos;
        FOR i IN 1..3 LOOP
          _remove := _remove || jsonb_build_object('bucket', 'event-media', 'path', _from[i]);
        END LOOP;
        _pos := _pos + 1;
      END IF;
      _moved := _moved + 1;
    ELSE
      RAISE EXCEPTION 'Invalid media selection';
    END IF;
  END LOOP;

  IF p_commit AND _moved > 0 THEN
    DELETE FROM public.media_chapter_views WHERE album_id = _album OR event_id = _event;
  END IF;
  RETURN jsonb_build_object('album_id', _album, 'event_id', _event, 'moved', _moved, 'skipped', _skipped,
    'copies', _copies, 'remove', _remove, 'committed', coalesce(p_commit, false));
END $$;

CREATE OR REPLACE FUNCTION public.review_waiting_for(_user uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH work AS (
    SELECT branch_id FROM public.task_requests WHERE target_id = _user AND status = 'submitted'
    UNION ALL SELECT branch_id FROM public.meeting_requests WHERE target_id = _user AND status = 'submitted'),
  ev AS (
    SELECT branch_id FROM public.event_requests
    WHERE deleted_at IS NULL AND status IN ('submitted', 'under_review') AND requester_id IS DISTINCT FROM _user
      AND public.user_manages_scope(_user, scope, branch_id, region_id)),
  apps AS (
    SELECT a.branch_id FROM public.volunteer_applications a JOIN public.branches b ON b.id = a.branch_id
    WHERE a.deleted_at IS NULL AND a.status = 'submitted' AND public.user_manages_scope(_user, 'branch', a.branch_id, b.region_id)),
  media AS (
    SELECT r.branch_id FROM public.media_upload_requests r JOIN public.branches b ON b.id = r.branch_id
    WHERE r.status = 'submitted' AND r.requester_id IS DISTINCT FROM _user
      AND public.user_manages_scope(_user, 'branch', r.branch_id, b.region_id)),
  downloads AS (
    SELECT r.branch_id FROM public.media_download_requests r JOIN public.branches b ON b.id = r.branch_id
    WHERE r.status = 'submitted' AND r.requester_id IS DISTINCT FROM _user
      AND public.user_manages_scope(_user, 'branch', r.branch_id, b.region_id)),
  allb AS (SELECT branch_id FROM work UNION ALL SELECT branch_id FROM ev UNION ALL SELECT branch_id FROM apps
    UNION ALL SELECT branch_id FROM media UNION ALL SELECT branch_id FROM downloads)
  SELECT jsonb_build_object(
    'work', (SELECT count(*) FROM work), 'event_requests', (SELECT count(*) FROM ev), 'applications', (SELECT count(*) FROM apps),
    'media', (SELECT count(*) FROM media), 'downloads', (SELECT count(*) FROM downloads),
    'total', (SELECT count(*) FROM allb),
    'branches', (SELECT coalesce(jsonb_agg(name ORDER BY n DESC, name), '[]'::jsonb) FROM (
      SELECT b.name, count(*) AS n FROM allb JOIN public.branches b ON b.id = allb.branch_id GROUP BY b.name ORDER BY count(*) DESC, b.name LIMIT 3) x))
$$;

CREATE OR REPLACE FUNCTION public.get_review_waiting() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE WHEN auth.uid() IS NOT NULL AND public.session_ok() AND public.has_accepted_privacy_notice()
    THEN public.review_waiting_for(auth.uid())
    ELSE jsonb_build_object('work', 0, 'event_requests', 0, 'applications', 0, 'media', 0, 'downloads', 0, 'total', 0, 'branches', '[]'::jsonb) END
$$;

CREATE OR REPLACE FUNCTION public.profiles_media_sync() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN
    UPDATE public.media_upload_files f SET discarded = true FROM public.media_upload_requests r
    WHERE r.id = f.request_id AND r.requester_id = NEW.id AND r.status IN ('uploading', 'submitted');
    UPDATE public.media_upload_requests SET status = 'withdrawn' WHERE requester_id = NEW.id AND status IN ('uploading', 'submitted');
    DELETE FROM public.media_chapter_views WHERE user_id = NEW.id;
    UPDATE public.media_download_requests SET status = 'withdrawn' WHERE requester_id = NEW.id AND status = 'submitted';
  END IF;
  RETURN NULL;
END $$;

-- ---------------------------------------------------------------------------------------------------------------
-- 4. Highlights (stars)

-- Star or unstar a photo shown in the branch's Media (managers only).
CREATE FUNCTION public.set_media_highlight(p_source text, p_id uuid, p_on boolean) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _branch uuid := public.media_photo_branch(p_source, p_id);
BEGIN
  PERFORM public.require_privacy_accepted();
  IF _branch IS NULL OR p_on IS NULL OR NOT public.can_manage_media(_branch)
     OR NOT EXISTS (SELECT 1 FROM public.media_branch_photos(_branch) b WHERE b.source = p_source AND b.id = p_id) THEN
    RAISE EXCEPTION 'Not allowed';
  END IF;
  IF p_on THEN
    INSERT INTO public.media_highlights (branch_id, library_photo_id, event_media_id, starred_by)
    VALUES (_branch, CASE WHEN p_source = 'library' THEN p_id END, CASE WHEN p_source = 'event' THEN p_id END, auth.uid())
    ON CONFLICT DO NOTHING;
  ELSE
    DELETE FROM public.media_highlights WHERE (p_source = 'library' AND library_photo_id = p_id) OR (p_source = 'event' AND event_media_id = p_id);
  END IF;
END $$;

-- The branch's starred photos still shown in Media, most recently starred first, with their chapter.
CREATE FUNCTION public.get_media_highlights(p_branch uuid, p_limit integer DEFAULT 30) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _manager boolean;
BEGIN
  IF NOT public.can_view_media(p_branch) THEN RAISE EXCEPTION 'Not allowed'; END IF;
  _manager := public.can_manage_media(p_branch);
  RETURN jsonb_build_object('photos', coalesce((SELECT jsonb_agg(x.j ORDER BY x.starred_at DESC, x.id) FROM (
      SELECT p.id, h.created_at AS starred_at,
        public.media_photo_json(p.source, p.id, p.storage_path, p.has_variants, p.width, p.height, p.created_at, _manager)
          || jsonb_build_object('chapter_kind', p.chapter_kind, 'chapter_id', p.chapter_id, 'chapter_title', c.title,
            'chapter_date', c.chapter_date, 'chapter_venue', c.venue, 'chapter_photo_count', c.photo_count,
            'starred', true, 'starred_at', h.created_at) AS j
      FROM public.media_highlights h
      JOIN public.media_branch_photos(p_branch) p
        ON (p.source = 'library' AND p.id = h.library_photo_id) OR (p.source = 'event' AND p.id = h.event_media_id)
      JOIN public.media_branch_chapters(p_branch) c ON c.kind = p.chapter_kind AND c.id = p.chapter_id
      WHERE h.branch_id = p_branch
      ORDER BY h.created_at DESC, p.id LIMIT least(greatest(coalesce(p_limit, 30), 1), 100)) x), '[]'::jsonb));
END $$;

-- ---------------------------------------------------------------------------------------------------------------
-- 5. Download requests (volunteers and trustees → the branch's BM / the region's RD)

CREATE FUNCTION public.media_download_request_json(_r public.media_download_requests) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object('id', _r.id, 'branch_id', _r.branch_id,
    'branch_name', (SELECT name FROM public.branches WHERE id = _r.branch_id),
    'status', _r.status, 'reason', _r.reason, 'decline_reason', _r.decline_reason,
    'expires_at', _r.expires_at,
    'expired', _r.status = 'approved' AND _r.expires_at <= now(),
    'requester_name', CASE WHEN o.own THEN NULL ELSE (SELECT full_name FROM public.profiles WHERE id = _r.requester_id) END,
    'reviewer_name', (SELECT full_name FROM public.profiles WHERE id = _r.reviewer_id),
    'reviewed_at', _r.reviewed_at, 'created_at', _r.created_at,
    'is_own', o.own,
    'can_withdraw', o.own AND _r.status = 'submitted',
    'can_review', NOT o.own AND _r.status = 'submitted' AND public.can_manage_media(_r.branch_id),
    -- Previews only (the 640 copies): the full-size files are signed by the server after media_download_files().
    'items', coalesce((SELECT jsonb_agg(jsonb_build_object('id', i.id,
        'source', CASE WHEN i.library_photo_id IS NOT NULL THEN 'library' ELSE 'event' END,
        'photo_id', coalesce(i.library_photo_id, i.event_media_id),
        'bucket', CASE WHEN i.library_photo_id IS NOT NULL THEN 'media-library' ELSE 'event-media' END,
        'w640', (public.event_media_variant_paths(coalesce(p.storage_path, m.storage_path)))[1],
        'has_variants', coalesce(p.id IS NOT NULL, m.has_variants)) ORDER BY i.id)
      FROM public.media_download_items i
      LEFT JOIN public.media_photos p ON p.id = i.library_photo_id
      LEFT JOIN public.event_media m ON m.id = i.event_media_id
      WHERE i.request_id = _r.id), '[]'::jsonb))
  FROM (SELECT _r.requester_id IS NOT NULL AND _r.requester_id = auth.uid() AS own) o
$$;

-- One or several photos shown in the branch's Media (at most 50); volunteers and trustees (managers download
-- directly). At most 5 open requests per person.
CREATE FUNCTION public.request_media_download(p_items jsonb, p_reason text DEFAULT NULL) RETURNS uuid
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
  IF _branch IS NULL OR NOT public.can_view_media(_branch) OR public.can_manage_media(_branch) THEN RAISE EXCEPTION 'Not allowed'; END IF;
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

CREATE FUNCTION public.withdraw_media_download_request(p_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _r public.media_download_requests;
BEGIN
  PERFORM public.require_privacy_accepted();
  SELECT * INTO _r FROM public.media_download_requests WHERE id = p_id FOR UPDATE;
  IF NOT FOUND OR _r.requester_id IS DISTINCT FROM auth.uid() THEN RAISE EXCEPTION 'Not allowed'; END IF;
  IF _r.status <> 'submitted' THEN RAISE EXCEPTION 'Request can no longer be changed'; END IF;
  UPDATE public.media_download_requests SET status = 'withdrawn' WHERE id = p_id;
END $$;

-- Approval opens a 24-hour download window; the requester is told with a link to it.
CREATE FUNCTION public.approve_media_download_request(p_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid uuid := auth.uid(); _r public.media_download_requests;
BEGIN
  PERFORM public.require_privacy_accepted();
  SELECT * INTO _r FROM public.media_download_requests WHERE id = p_id FOR UPDATE;
  IF NOT FOUND OR NOT public.can_manage_media(_r.branch_id) OR _r.requester_id IS NOT DISTINCT FROM _uid THEN RAISE EXCEPTION 'Not allowed'; END IF;
  IF _r.status <> 'submitted' THEN RAISE EXCEPTION 'Request is already decided'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.media_download_items WHERE request_id = p_id) THEN RAISE EXCEPTION 'Invalid media selection'; END IF;
  UPDATE public.media_download_requests SET status = 'approved', reviewer_id = _uid, reviewed_at = now(),
    expires_at = now() + interval '24 hours' WHERE id = p_id;
  PERFORM public.notify(_r.requester_id, 'media_download_approved', 'media_download_request', p_id, '',
    '/media/download/' || p_id::text,
    jsonb_build_object('count', (SELECT count(*) FROM public.media_download_items WHERE request_id = p_id)));
END $$;

CREATE FUNCTION public.decline_media_download_request(p_id uuid, p_reason text DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid uuid := auth.uid(); _r public.media_download_requests; _reason text := nullif(btrim(coalesce(p_reason, '')), '');
BEGIN
  PERFORM public.require_privacy_accepted();
  SELECT * INTO _r FROM public.media_download_requests WHERE id = p_id FOR UPDATE;
  IF NOT FOUND OR NOT public.can_manage_media(_r.branch_id) OR _r.requester_id IS NOT DISTINCT FROM _uid THEN RAISE EXCEPTION 'Not allowed'; END IF;
  IF _r.status <> 'submitted' THEN RAISE EXCEPTION 'Request is already decided'; END IF;
  IF length(_reason) > 500 THEN RAISE EXCEPTION 'Invalid request values'; END IF;
  UPDATE public.media_download_requests SET status = 'declined', reviewer_id = _uid, reviewed_at = now(), decline_reason = _reason
  WHERE id = p_id;
  PERFORM public.notify(_r.requester_id, 'media_download_declined', 'media_download_request', p_id, '',
    '/requests?tab=mine', jsonb_build_object('reason', _reason));
END $$;

-- 'mine': the caller's own (newest first, 50); 'review': submitted requests of the branches they manage, then the 20
-- most recently decided.
CREATE FUNCTION public.list_media_download_requests(p_box text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_active_person(auth.uid()) OR NOT public.session_ok() OR NOT public.has_accepted_privacy_notice() THEN RAISE EXCEPTION 'Not allowed'; END IF;
  IF p_box = 'mine' THEN
    RETURN coalesce((SELECT jsonb_agg(public.media_download_request_json(r) ORDER BY r.created_at DESC, r.id)
      FROM public.media_download_requests r WHERE r.id IN (SELECT x.id FROM public.media_download_requests x
        WHERE x.requester_id = auth.uid() ORDER BY x.created_at DESC, x.id LIMIT 50)), '[]'::jsonb);
  ELSIF p_box = 'review' THEN
    RETURN coalesce((SELECT jsonb_agg(public.media_download_request_json(r) ORDER BY (r.status = 'submitted') DESC,
        CASE WHEN r.status = 'submitted' THEN r.created_at END, r.reviewed_at DESC, r.id)
      FROM public.media_download_requests r WHERE r.id IN (
        SELECT x.id FROM public.media_download_requests x WHERE x.status = 'submitted' AND x.requester_id IS DISTINCT FROM auth.uid()
          AND public.can_manage_media(x.branch_id)
        UNION ALL
        (SELECT x.id FROM public.media_download_requests x WHERE x.status IN ('approved', 'declined') AND public.can_manage_media(x.branch_id)
         ORDER BY x.reviewed_at DESC, x.id LIMIT 20))), '[]'::jsonb);
  END IF;
  RAISE EXCEPTION 'Invalid request list';
END $$;

-- The download page (/media/download/<id>): the requester's own request with its state; previews only.
CREATE FUNCTION public.get_media_download(p_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _r public.media_download_requests;
BEGIN
  SELECT * INTO _r FROM public.media_download_requests WHERE id = p_id;
  IF NOT FOUND OR NOT ((_r.requester_id = auth.uid() AND public.can_view_media(_r.branch_id)) OR public.can_manage_media(_r.branch_id)) THEN
    RAISE EXCEPTION 'Request not found';
  END IF;
  RETURN public.media_download_request_json(_r);
END $$;

-- Server only (service role): the full-size files of an approved request, for its requester, inside the 24-hour
-- window, while they are still a member who sees the branch's Media; and only photos still shown there.
CREATE FUNCTION public.media_download_files(p_id uuid, p_user uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _r public.media_download_requests;
BEGIN
  SELECT * INTO _r FROM public.media_download_requests WHERE id = p_id;
  IF NOT FOUND OR _r.requester_id IS DISTINCT FROM p_user OR p_user IS NULL THEN RETURN jsonb_build_object('state', 'not_found'); END IF;
  IF _r.status <> 'approved' THEN RETURN jsonb_build_object('state', _r.status); END IF;
  IF _r.expires_at <= now() THEN RETURN jsonb_build_object('state', 'expired', 'expires_at', _r.expires_at); END IF;
  IF NOT public.is_active_person(p_user) OR NOT (public.is_branch_member(p_user, _r.branch_id)
     OR EXISTS (SELECT 1 FROM public.user_roles ur JOIN public.branches b ON b.region_id = ur.region_id
                WHERE ur.user_id = p_user AND ur.role = 'regional_director' AND b.id = _r.branch_id)) THEN
    RETURN jsonb_build_object('state', 'not_found');
  END IF;
  RETURN jsonb_build_object('state', 'ready', 'expires_at', _r.expires_at,
    'files', coalesce((SELECT jsonb_agg(jsonb_build_object('item_id', i.id,
        'bucket', CASE WHEN p.id IS NOT NULL THEN 'media-library' ELSE 'event-media' END,
        'path', coalesce(p.storage_path, m.storage_path),
        'name', coalesce(p.original_name, m.original_name)) ORDER BY i.id)
      FROM public.media_download_items i
      LEFT JOIN public.media_photos p ON p.id = i.library_photo_id AND p.ready AND p.deleting_at IS NULL
      LEFT JOIN public.event_media m ON m.id = i.event_media_id
      WHERE i.request_id = p_id AND (p.id IS NOT NULL OR m.id IS NOT NULL)), '[]'::jsonb));
END $$;

CREATE FUNCTION public.media_download_requests_review_refresh() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _u uuid;
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.status IS NOT DISTINCT FROM NEW.status THEN RETURN NULL; END IF;
  IF NOT (NEW.status = 'submitted' OR (TG_OP = 'UPDATE' AND OLD.status = 'submitted')) THEN RETURN NULL; END IF;
  FOR _u IN SELECT x FROM (SELECT public.scope_reviewers('branch', b.id, b.region_id) AS x FROM public.branches b
      WHERE b.id = NEW.branch_id) r ORDER BY x LOOP
    PERFORM public.review_notice_refresh(_u);
  END LOOP;
  RETURN NULL;
END $$;
CREATE TRIGGER media_download_requests_review_refresh AFTER INSERT OR UPDATE OF status ON public.media_download_requests
  FOR EACH ROW EXECUTE FUNCTION public.media_download_requests_review_refresh();

-- ---------------------------------------------------------------------------------------------------------------
-- 6. Notices: the 'media' type (post-event nudge) and the download decisions

ALTER TABLE public.notifications DROP CONSTRAINT notifications_entity_type_check;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_entity_type_check
  CHECK (entity_type IN ('task', 'meeting', 'task_request', 'meeting_request', 'review', 'digest', 'volunteer_application',
    'email_budget', 'media_upload_request', 'media_download_request', 'event'));

CREATE OR REPLACE FUNCTION public.notification_type(_kind text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE
    WHEN _kind IN ('task_assigned', 'task_group_created') THEN 'task_assigned'
    WHEN _kind = 'task_note_mention' THEN 'mention'
    WHEN _kind IN ('review_waiting', 'task_request_received', 'meeting_request_received') THEN 'review'
    WHEN _kind = 'task_status_changed' THEN 'task_status'
    WHEN _kind = 'task_note_added' THEN 'task_note'
    WHEN _kind = 'task_reminder' THEN 'task_reminder'
    WHEN _kind LIKE 'meeting\_%' ESCAPE '\' AND _kind NOT LIKE 'meeting\_request\_%' ESCAPE '\' THEN 'meeting'
    WHEN _kind IN ('task_request_accepted', 'task_request_declined', 'meeting_request_approved', 'meeting_request_declined',
      'volunteer_application_approved', 'volunteer_application_declined',
      'media_upload_approved', 'media_upload_declined', 'media_download_approved', 'media_download_declined') THEN 'request_decided'
    WHEN _kind = 'media_photo_nudge' THEN 'media'
    ELSE 'other' END
$$;

-- Defaults for 'media': in the app on, push on, email off.
CREATE OR REPLACE FUNCTION public.notification_push_default(_type text) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT _type IN ('task_assigned', 'mention', 'review', 'meeting', 'media')
$$;

CREATE OR REPLACE FUNCTION public.notification_email_on(_user uuid, _type text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE WHEN _type = 'task_reminder' THEN public.wants_task_reminder_emails(_user)
    ELSE coalesce((SELECT (p.types->_type->>'email')::boolean FROM public.notification_preferences p WHERE p.user_id = _user),
      _type <> 'media') END
$$;

CREATE OR REPLACE FUNCTION public.notification_push_on(_user uuid, _type text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT _type IN ('task_assigned', 'mention', 'review', 'task_status', 'task_note', 'task_reminder', 'meeting', 'request_decided', 'media')
    AND coalesce((SELECT (p.types->_type->>'push')::boolean FROM public.notification_preferences p WHERE p.user_id = _user),
      public.notification_push_default(_type))
$$;

CREATE OR REPLACE FUNCTION public.get_notification_settings() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_accepted_privacy_notice() THEN RETURN NULL; END IF;
  RETURN jsonb_build_object(
    'task_reminder_emails', public.wants_task_reminder_emails(auth.uid()),
    'types', (SELECT jsonb_agg(public.notification_setting(auth.uid(), t) || jsonb_build_object('type', t,
        'locked', public.notification_type_locked(t), 'email_timing', public.notification_email_timing(t)) ORDER BY o)
      FROM unnest(ARRAY['task_assigned', 'mention', 'review', 'task_status', 'task_note', 'task_reminder', 'meeting', 'request_decided', 'media'])
        WITH ORDINALITY AS x(t, o)));
END $$;

CREATE OR REPLACE FUNCTION public.set_notification_setting(p_type text, p_enabled boolean, p_delivery text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.require_privacy_accepted();
  IF auth.uid() IS NULL OR NOT public.session_ok() THEN RAISE EXCEPTION 'Not allowed'; END IF;
  IF p_type NOT IN ('task_status', 'task_note', 'task_reminder', 'meeting', 'request_decided', 'media') THEN
    RAISE EXCEPTION 'This notice cannot be changed';
  END IF;
  INSERT INTO public.notification_preferences (user_id, types)
  VALUES (auth.uid(), jsonb_build_object(p_type, jsonb_build_object('enabled', coalesce(p_enabled, true))))
  ON CONFLICT (user_id) DO UPDATE SET types = public.notification_preferences.types
    || jsonb_build_object(p_type, coalesce(public.notification_preferences.types->p_type, '{}'::jsonb)
      || jsonb_build_object('enabled', coalesce(p_enabled, true))), updated_at = now();
  RETURN public.notification_setting(auth.uid(), p_type) || jsonb_build_object('type', p_type);
END $$;

CREATE OR REPLACE FUNCTION public.notification_email_set(_user uuid, _type text, _on boolean) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF _type NOT IN ('task_assigned', 'mention', 'review', 'task_status', 'task_note', 'task_reminder', 'meeting', 'request_decided', 'media')
    OR _on IS NULL THEN
    RAISE EXCEPTION 'Not allowed';
  END IF;
  IF _type = 'task_reminder' THEN
    INSERT INTO public.notification_preferences (user_id, task_reminder_emails, updated_at) VALUES (_user, _on, now())
    ON CONFLICT (user_id) DO UPDATE SET task_reminder_emails = EXCLUDED.task_reminder_emails, updated_at = now();
  ELSE
    INSERT INTO public.notification_preferences (user_id, types)
    VALUES (_user, jsonb_build_object(_type, jsonb_build_object('email', _on)))
    ON CONFLICT (user_id) DO UPDATE SET types = public.notification_preferences.types
      || jsonb_build_object(_type, coalesce(public.notification_preferences.types->_type, '{}'::jsonb) || jsonb_build_object('email', _on)),
      updated_at = now();
  END IF;
  IF NOT _on THEN
    UPDATE public.email_outbox SET status = 'cancelled', last_error = 'email_off'
    WHERE user_id = _user AND status = 'pending'
      AND ((template = 'notice' AND payload->>'type' = _type) OR (_type = 'task_reminder' AND template = 'task_reminder'));
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.notice_email_unsubscribe(p_user uuid, p_type text) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF p_user IS NULL OR NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_user AND deleted_at IS NULL)
    OR p_type NOT IN ('task_assigned', 'mention', 'review', 'task_status', 'task_note', 'task_reminder', 'meeting', 'request_decided', 'media') THEN
    RETURN 'invalid';
  END IF;
  PERFORM public.notification_email_set(p_user, p_type, false);
  RETURN 'unsubscribed';
END $$;

CREATE OR REPLACE FUNCTION public.set_notification_push(p_type text, p_on boolean) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.require_privacy_accepted();
  IF auth.uid() IS NULL OR NOT public.session_ok()
    OR NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'Not allowed';
  END IF;
  IF p_type IS NULL OR p_on IS NULL
    OR p_type NOT IN ('task_assigned', 'mention', 'review', 'task_status', 'task_note', 'task_reminder', 'meeting', 'request_decided', 'media') THEN
    RAISE EXCEPTION 'Not allowed';
  END IF;
  INSERT INTO public.notification_preferences (user_id, types)
  VALUES (auth.uid(), jsonb_build_object(p_type, jsonb_build_object('push', p_on)))
  ON CONFLICT (user_id) DO UPDATE SET types = public.notification_preferences.types
    || jsonb_build_object(p_type, coalesce(public.notification_preferences.types->p_type, '{}'::jsonb) || jsonb_build_object('push', p_on)),
    updated_at = now();
  IF NOT p_on THEN
    UPDATE public.push_outbox SET status = 'skipped', last_error = 'push_off'
    WHERE user_id = auth.uid() AND status = 'pending' AND type = p_type;
  END IF;
  RETURN public.notification_setting(auth.uid(), p_type) || jsonb_build_object('type', p_type);
END $$;

-- ---------------------------------------------------------------------------------------------------------------
-- 7. Post-event nudge (pg_cron at 08:30 and 09:30 UTC; runs only in the London 09:00 hour, so once a day at 09:30
--    London in summer and winter). Events of a branch that ended yesterday (London): published, not meetings, series
--    templates or past records. Volunteers of the branch (not trustees: they do not upload) who attended (marked
--    attended) or are assigned a live task linked to the event. Idempotent: one row per event and person.
CREATE FUNCTION public.run_media_nudges(p_now timestamptz DEFAULT now()) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _local timestamp := p_now AT TIME ZONE 'Europe/London'; _yesterday date; _r record; _n integer := 0;
BEGIN
  IF extract(hour FROM _local) <> 9 THEN RETURN 0; END IF;
  _yesterday := _local::date - 1;
  FOR _r IN
    SELECT e.id AS event_id, e.title, u.id AS user_id
    FROM public.events e
    JOIN public.profiles u ON u.branch_id = e.branch_id AND u.status = 'active' AND u.deleted_at IS NULL
    WHERE e.scope = 'branch' AND e.status = 'published' AND e.deleted_at IS NULL AND NOT e.series_template
      AND e.category <> 'meeting' AND NOT e.past_record
      AND coalesce(e.end_date, e.start_date, (coalesce(e.end_at, e.start_at) AT TIME ZONE 'Europe/London')::date) = _yesterday
      AND public.has_role(u.id, 'volunteer') AND NOT public.is_trustee(u.id)
      AND (EXISTS (SELECT 1 FROM public.event_registrations g WHERE g.event_id = e.id AND g.user_id = u.id AND g.status = 'attended')
        OR EXISTS (SELECT 1 FROM public.tasks t JOIN public.task_assignees a ON a.task_id = t.id
                   WHERE t.event_id = e.id AND t.deleted_at IS NULL AND a.user_id = u.id))
    ORDER BY e.id, u.id
  LOOP
    INSERT INTO public.media_nudges_sent (event_id, user_id) VALUES (_r.event_id, _r.user_id) ON CONFLICT DO NOTHING;
    CONTINUE WHEN NOT FOUND;
    PERFORM public.notify(_r.user_id, 'media_photo_nudge', 'event', _r.event_id, _r.title,
      '/media?request=event:' || _r.event_id::text, '{}'::jsonb);
    _n := _n + 1;
  END LOOP;
  RETURN _n;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'pg_cron') THEN
    CREATE EXTENSION IF NOT EXISTS pg_cron;
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'media-nudges') THEN
      PERFORM cron.unschedule('media-nudges');
    END IF;
    PERFORM cron.schedule('media-nudges', '30 8,9 * * *', 'SELECT public.run_media_nudges()');
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pg_cron not available: the post-event photo nudge does not run here: %', SQLERRM;
END $$;

-- ---------------------------------------------------------------------------------------------------------------
-- 8. Grants

REVOKE ALL ON FUNCTION
  public.media_event_started(uuid), public.media_is_starred(text, uuid), public.media_photo_branch(text, uuid),
  public.set_media_highlight(text, uuid, boolean), public.get_media_highlights(uuid, integer),
  public.media_download_request_json(public.media_download_requests), public.request_media_download(jsonb, text),
  public.withdraw_media_download_request(uuid), public.approve_media_download_request(uuid),
  public.decline_media_download_request(uuid, text), public.list_media_download_requests(text),
  public.get_media_download(uuid), public.media_download_files(uuid, uuid),
  public.media_download_requests_review_refresh(), public.run_media_nudges(timestamptz)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION
  public.set_media_highlight(text, uuid, boolean), public.get_media_highlights(uuid, integer),
  public.request_media_download(jsonb, text), public.withdraw_media_download_request(uuid),
  public.approve_media_download_request(uuid), public.decline_media_download_request(uuid, text),
  public.list_media_download_requests(text), public.get_media_download(uuid)
TO authenticated;

GRANT EXECUTE ON FUNCTION public.media_download_files(uuid, uuid), public.run_media_nudges(timestamptz) TO service_role;

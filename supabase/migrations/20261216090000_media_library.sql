-- Media tab (part 1): one members-only photo gallery per branch, built from two sources shown together as "chapters":
--   * event photos: the image rows of event_media of the branch's own events (scope 'branch', not drafts, not meetings,
--     not series templates), read under can_view_event_media; they are still added through the event form;
--   * the media library: albums owned by the branch (title, optional date, short description, cover) and library
--     photos. A library photo belongs to one album OR to one event of the branch (photos volunteers send for an event
--     land here, members-only: the event's own files, their 5-file limit and their visibility on event pages are not
--     touched).
-- Never other branches: every read RPC takes the branch and checks can_view_media(branch) (the branch's members,
-- trustees included, and the region's Regional Directors); events and albums of other branches never appear, public
-- ones included. Followers and National Coordinators get nothing.
--
-- Files: private bucket 'media-library' (JPG/PNG/WebP, 10 MB, like event-media). Every file, pending or approved, lives
-- at <branch id>/<id>.<ext> with its two copies <id>.w640.webp and <id>.w1280.webp (made in the browser like event
-- photos: WebP re-encode, EXIF stripped). The row that owns the id decides who may read it:
--   * media_upload_files (pending, from a volunteer's upload request): the requester while uploading, the request's
--     reviewers (the branch's BM, the region's RD) while it waits. Nobody else, so nothing shows before approval.
--   * media_photos (approved / uploaded by a manager): the branch's viewers read only the two copies; the full-size
--     original is readable only by the branch's managers (downloads for volunteers and trustees come in part 2).
-- Approval turns the selected pending rows into media_photos rows with the same id and path (no Storage copy); the
-- deselected and declined files are marked discarded and their paths are returned so the server deletes them through
-- Storage at once (service-role cleanup RPCs remove the rows afterwards; a scheduled sweep catches leftovers).
-- Deletion of albums and photos is a hard delete (they do not go to the Recycle Bin): the RPC hides them at once and
-- returns the paths; the server removes the files through Storage first and then the rows (never SQL on Storage).
--
-- Upload requests: volunteers (not trustees, not managers, who upload directly) pick an album or an event of their
-- branch, or propose a new album title, attach up to 20 photos and an optional note. The request is 'uploading' until
-- they submit it; then the branch's reviewers see it in Requests (the grouped 'review' notice counts it), approve all,
-- approve some or decline with an optional reason; the requester gets a 'request_decided' notice
-- (media_upload_approved / media_upload_declined). At most 5 open requests per person.
-- Duplicates: every file carries a SHA-256 of its bytes (content_hash); a photo already in the same album or event (a
-- library photo, or an event file with a hash) is refused at reservation ({duplicate: true}) and skipped at approval.
-- "Viewed" markers per member and chapter feed the amber rings of the mobile stories row.
-- Moving photos (managers, within one branch): album → album, album ↔ an event's Media-only chapter (the parent
-- changes, the files stay), and an event page photo (event_media) → album (copied to media-library by the server, then
-- the event row and old files go; never the event's cover). Never album → event page. Two phases: a plan (what the
-- server must copy), then the commit, which refuses unless every copy is stored, so a failed copy changes nothing.
-- Photo ids are kept, so later per-photo marks (highlight stars) follow the photo. Album deletion needs the album's
-- title typed as confirmation.
--
-- Also: event_media.content_hash (nullable; set by the event upload from now on), notification kinds and entity type,
-- review_waiting_for counts 'media', a soft-deleted person's open upload requests are withdrawn, privacy notice 1.6
-- (photos at events: legitimate interests instead of the photo consent; the consent column stays, nothing reads it).
-- Additive: new tables, bucket, policies and functions; notification_type, review_waiting_for, get_review_waiting and
-- privacy_notice_version are replaced with the same signatures. No existing row is changed.

-- ---------------------------------------------------------------------------------------------------------------
-- 1. Tables

CREATE TABLE public.media_albums (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  title text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 120),
  album_date date,
  description text CHECK (description IS NULL OR length(description) <= 500),
  cover_photo_id uuid,  -- FK added after media_photos
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- Set when deletion starts: hidden at once, removed with its photos after the files are gone.
  deleted_at timestamptz
);
CREATE INDEX media_albums_branch_idx ON public.media_albums (branch_id) WHERE deleted_at IS NULL;
CREATE INDEX media_albums_creator_idx ON public.media_albums (created_by) WHERE created_by IS NOT NULL;

CREATE TABLE public.media_photos (
  id uuid PRIMARY KEY,
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  -- One of the two while the photo is live. Both NULL: the event was purged (ON DELETE SET NULL); the cleanup removes it.
  album_id uuid REFERENCES public.media_albums(id) ON DELETE CASCADE,
  event_id uuid REFERENCES public.events(id) ON DELETE SET NULL,
  storage_path text NOT NULL UNIQUE,
  original_name text CHECK (original_name IS NULL OR length(original_name) <= 255),
  content_hash text CHECK (content_hash IS NULL OR content_hash ~ '^[0-9a-f]{64}$'),
  width integer CHECK (width IS NULL OR width BETWEEN 1 AND 20000),
  height integer CHECK (height IS NULL OR height BETWEEN 1 AND 20000),
  position integer NOT NULL DEFAULT 0,
  -- false until the original and both copies are stored (finish_media_photo); only ready photos are shown.
  ready boolean NOT NULL DEFAULT false,
  uploaded_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  approved_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  request_id uuid,  -- the upload request it came from (no FK: requests are removed independently)
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  -- When it was placed in its current album or event (a move sets it again, so the chapter shows it as new).
  added_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  -- Set when deletion starts: hidden at once; the row goes after its files.
  deleting_at timestamptz,
  CONSTRAINT media_photos_one_target CHECK (album_id IS NULL OR event_id IS NULL),
  CONSTRAINT media_photos_path CHECK (storage_path = branch_id::text || '/' || id::text || '.' || split_part(storage_path, '.', 2)
    AND split_part(storage_path, '.', 2) IN ('jpg', 'png', 'webp'))
);
CREATE INDEX media_photos_album_idx ON public.media_photos (album_id, position) WHERE album_id IS NOT NULL;
CREATE INDEX media_photos_event_idx ON public.media_photos (event_id, position) WHERE event_id IS NOT NULL;
CREATE INDEX media_photos_branch_created_idx ON public.media_photos (branch_id, created_at DESC);
CREATE INDEX media_photos_hash_idx ON public.media_photos (content_hash) WHERE content_hash IS NOT NULL;
CREATE INDEX media_photos_uploader_idx ON public.media_photos (uploaded_by) WHERE uploaded_by IS NOT NULL;
CREATE INDEX media_photos_approver_idx ON public.media_photos (approved_by) WHERE approved_by IS NOT NULL;

ALTER TABLE public.media_albums ADD CONSTRAINT media_albums_cover_fk
  FOREIGN KEY (cover_photo_id) REFERENCES public.media_photos(id) ON DELETE SET NULL;
CREATE INDEX media_albums_cover_idx ON public.media_albums (cover_photo_id) WHERE cover_photo_id IS NOT NULL;

CREATE TABLE public.media_upload_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  requester_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  album_id uuid REFERENCES public.media_albums(id) ON DELETE SET NULL,
  event_id uuid REFERENCES public.events(id) ON DELETE SET NULL,
  proposed_title text CHECK (proposed_title IS NULL OR length(btrim(proposed_title)) BETWEEN 1 AND 120),
  note text CHECK (note IS NULL OR length(note) <= 500),
  status text NOT NULL DEFAULT 'uploading' CHECK (status IN ('uploading', 'submitted', 'approved', 'declined', 'withdrawn')),
  decline_reason text CHECK (decline_reason IS NULL OR length(decline_reason) <= 500),
  reviewer_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  -- Where the approved photos went (a proposed album is created on approval).
  result_album_id uuid REFERENCES public.media_albums(id) ON DELETE SET NULL,
  result_event_id uuid REFERENCES public.events(id) ON DELETE SET NULL,
  added_count integer,
  skipped_count integer,
  submitted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX media_upload_requests_branch_idx ON public.media_upload_requests (branch_id, status);
CREATE INDEX media_upload_requests_requester_idx ON public.media_upload_requests (requester_id) WHERE requester_id IS NOT NULL;
CREATE INDEX media_upload_requests_reviewer_idx ON public.media_upload_requests (reviewer_id) WHERE reviewer_id IS NOT NULL;
CREATE INDEX media_upload_requests_album_idx ON public.media_upload_requests (album_id) WHERE album_id IS NOT NULL;
CREATE INDEX media_upload_requests_event_idx ON public.media_upload_requests (event_id) WHERE event_id IS NOT NULL;
CREATE INDEX media_upload_requests_result_album_idx ON public.media_upload_requests (result_album_id) WHERE result_album_id IS NOT NULL;
CREATE INDEX media_upload_requests_result_event_idx ON public.media_upload_requests (result_event_id) WHERE result_event_id IS NOT NULL;

CREATE TABLE public.media_upload_files (
  id uuid PRIMARY KEY,
  request_id uuid NOT NULL REFERENCES public.media_upload_requests(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  storage_path text NOT NULL UNIQUE,
  original_name text CHECK (original_name IS NULL OR length(original_name) <= 255),
  content_hash text CHECK (content_hash IS NULL OR content_hash ~ '^[0-9a-f]{64}$'),
  width integer CHECK (width IS NULL OR width BETWEEN 1 AND 20000),
  height integer CHECK (height IS NULL OR height BETWEEN 1 AND 20000),
  ready boolean NOT NULL DEFAULT false,
  -- Deselected, declined, withdrawn or duplicate: the files are deleted through Storage, then the row.
  discarded boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT media_upload_files_path CHECK (storage_path = branch_id::text || '/' || id::text || '.' || split_part(storage_path, '.', 2)
    AND split_part(storage_path, '.', 2) IN ('jpg', 'png', 'webp'))
);
CREATE INDEX media_upload_files_request_idx ON public.media_upload_files (request_id, created_at);
CREATE INDEX media_upload_files_discarded_idx ON public.media_upload_files (request_id) WHERE discarded;

-- Per member and chapter: when they last opened it (amber ring = photos added since). Personal: goes with the person.
CREATE TABLE public.media_chapter_views (
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  album_id uuid REFERENCES public.media_albums(id) ON DELETE CASCADE,
  event_id uuid REFERENCES public.events(id) ON DELETE CASCADE,
  viewed_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT media_chapter_views_one CHECK ((album_id IS NULL) <> (event_id IS NULL))
);
CREATE UNIQUE INDEX media_chapter_views_album_uq ON public.media_chapter_views (user_id, album_id) WHERE album_id IS NOT NULL;
CREATE UNIQUE INDEX media_chapter_views_event_uq ON public.media_chapter_views (user_id, event_id) WHERE event_id IS NOT NULL;
CREATE INDEX media_chapter_views_album_idx ON public.media_chapter_views (album_id) WHERE album_id IS NOT NULL;
CREATE INDEX media_chapter_views_event_idx ON public.media_chapter_views (event_id) WHERE event_id IS NOT NULL;

-- Duplicate check for event files (set by the event upload; NULL for older files and imports).
ALTER TABLE public.event_media ADD COLUMN content_hash text
  CHECK (content_hash IS NULL OR content_hash ~ '^[0-9a-f]{64}$');
CREATE INDEX event_media_hash_idx ON public.event_media (event_id, content_hash) WHERE content_hash IS NOT NULL;

-- No client privileges on any of them: every read and write goes through the RPCs below.
ALTER TABLE public.media_albums ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.media_photos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.media_upload_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.media_upload_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.media_chapter_views ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.media_albums, public.media_photos, public.media_upload_requests, public.media_upload_files,
  public.media_chapter_views FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.media_albums, public.media_photos, public.media_upload_requests, public.media_upload_files,
  public.media_chapter_views TO service_role;

CREATE FUNCTION public.media_touch() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;
CREATE TRIGGER media_albums_touch BEFORE UPDATE ON public.media_albums FOR EACH ROW EXECUTE FUNCTION public.media_touch();
CREATE TRIGGER media_upload_requests_touch BEFORE UPDATE ON public.media_upload_requests FOR EACH ROW EXECUTE FUNCTION public.media_touch();

-- ---------------------------------------------------------------------------------------------------------------
-- 2. Who may do what

-- Sees the branch's gallery: an active member of the branch (volunteer, trustee, Branch Manager) or a Regional
-- Director of its region, with the current privacy notice confirmed. Never followers, never National Coordinators.
CREATE FUNCTION public.can_view_media(_branch uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  -- coalesce: is_branch_member is NULL (not false) for people without a branch; every helper here answers true/false.
  SELECT coalesce(_branch IS NOT NULL AND public.is_active_person(auth.uid()) AND public.session_ok() AND public.has_accepted_privacy_notice()
    AND EXISTS (SELECT 1 FROM public.branches b WHERE b.id = _branch AND b.deleted_at IS NULL)
    AND (public.is_branch_member(auth.uid(), _branch)
      OR EXISTS (SELECT 1 FROM public.user_roles r JOIN public.branches b ON b.region_id = r.region_id
                 WHERE r.user_id = auth.uid() AND r.role = 'regional_director' AND b.id = _branch)), false)
$$;

-- Manages it (albums, direct uploads, deletion, order, covers, request review): the branch's Branch Manager or a
-- Regional Director of its region (the event managers of the branch).
CREATE FUNCTION public.can_manage_media(_branch uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(public.can_view_media(_branch)
    AND public.can_manage_event_scope('branch', _branch, (SELECT region_id FROM public.branches WHERE id = _branch)), false)
$$;

-- Sends upload requests: a volunteer of the branch (trustees and managers do not).
CREATE FUNCTION public.can_request_media_upload(_branch uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(public.can_view_media(_branch) AND public.has_role(auth.uid(), 'volunteer') AND NOT public.is_trustee(auth.uid())
    AND public.get_user_branch(auth.uid()) = _branch AND NOT public.can_manage_media(_branch), false)
$$;

-- An event of the branch that may be a chapter for the caller: the branch's own event (not region or national), not a
-- draft, not a meeting or series template, not deleted, and readable under the event media rules.
CREATE FUNCTION public.media_event_ok(_event uuid, _branch uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(EXISTS (SELECT 1 FROM public.events e WHERE e.id = _event AND e.branch_id = _branch AND e.scope = 'branch'
      AND e.deleted_at IS NULL AND NOT e.series_template AND e.category <> 'meeting' AND e.status IN ('published', 'cancelled'))
    AND public.can_view_event_media(_event), false)
$$;

CREATE FUNCTION public.media_ext(_ext text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE WHEN lower(_ext) = 'jpeg' THEN 'jpg' WHEN lower(_ext) IN ('jpg', 'png', 'webp') THEN lower(_ext) END
$$;

-- The id inside a media-library object name (<branch>/<id>.<ext> or <branch>/<id>.w640.webp), or NULL.
CREATE FUNCTION public.media_file_id(_name text) RETURNS uuid
LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE WHEN _name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp|w640\.webp|w1280\.webp)$'
    THEN substring(_name FROM 38 FOR 36)::uuid END
$$;

-- Storage policies (they run as the caller, so authenticated executes these; each answers only for one path).
CREATE FUNCTION public.can_read_media_file(_name text) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _id uuid := public.media_file_id(_name); _p public.media_photos; _f public.media_upload_files; _r public.media_upload_requests;
BEGIN
  IF _id IS NULL THEN RETURN false; END IF;
  SELECT * INTO _p FROM public.media_photos WHERE id = _id;
  IF FOUND THEN
    IF _p.deleting_at IS NOT NULL THEN RETURN false; END IF;
    IF _name = _p.storage_path THEN RETURN public.can_manage_media(_p.branch_id); END IF;  -- full size: managers only
    RETURN _name = ANY (public.event_media_variant_paths(_p.storage_path)) AND public.can_view_media(_p.branch_id)
      AND (_p.album_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.media_albums a WHERE a.id = _p.album_id AND a.deleted_at IS NULL)
        OR (_p.event_id IS NOT NULL AND public.media_event_ok(_p.event_id, _p.branch_id)));
  END IF;
  SELECT * INTO _f FROM public.media_upload_files WHERE id = _id;
  IF NOT FOUND OR _f.discarded OR NOT (_name = _f.storage_path OR _name = ANY (public.event_media_variant_paths(_f.storage_path))) THEN
    RETURN false;
  END IF;
  SELECT * INTO _r FROM public.media_upload_requests WHERE id = _f.request_id;
  RETURN (_r.requester_id = auth.uid() AND _r.status IN ('uploading', 'submitted') AND public.can_view_media(_r.branch_id))
    OR (_r.status = 'submitted' AND _r.requester_id IS DISTINCT FROM auth.uid() AND public.can_manage_media(_r.branch_id));
END $$;

-- Upload: a manager into a reserved photo that is not ready yet; the requester into a reserved file of their request
-- while it is 'uploading'. The original keeps its extension; the copies are .w640.webp / .w1280.webp.
CREATE FUNCTION public.can_write_media_file(_name text) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _id uuid := public.media_file_id(_name); _p public.media_photos; _f public.media_upload_files; _r public.media_upload_requests;
BEGIN
  IF _id IS NULL THEN RETURN false; END IF;
  SELECT * INTO _p FROM public.media_photos WHERE id = _id;
  IF FOUND THEN
    RETURN NOT _p.ready AND _p.deleting_at IS NULL AND _p.request_id IS NULL
      AND (_name = _p.storage_path OR _name = ANY (public.event_media_variant_paths(_p.storage_path)))
      AND public.can_manage_media(_p.branch_id);
  END IF;
  SELECT * INTO _f FROM public.media_upload_files WHERE id = _id;
  IF NOT FOUND OR _f.discarded OR _f.ready OR NOT (_name = _f.storage_path OR _name = ANY (public.event_media_variant_paths(_f.storage_path))) THEN
    RETURN false;
  END IF;
  SELECT * INTO _r FROM public.media_upload_requests WHERE id = _f.request_id;
  RETURN _r.requester_id = auth.uid() AND _r.status = 'uploading' AND public.can_request_media_upload(_r.branch_id);
END $$;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('media-library', 'media-library', false, 10485760, ARRAY['image/jpeg', 'image/png', 'image/webp'])
ON CONFLICT (id) DO UPDATE SET public = false, file_size_limit = EXCLUDED.file_size_limit, allowed_mime_types = EXCLUDED.allowed_mime_types;

CREATE POLICY media_library_read ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'media-library' AND public.can_read_media_file(name));
CREATE POLICY media_library_upload ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'media-library' AND public.can_write_media_file(name)
    AND lower(storage.extension(name)) IN ('jpg', 'png', 'webp'));
-- A failed upload can be cleared by the uploader while the reservation is still open (same rule as writing).
-- Deleting stored photos is done by the server after the delete RPCs (service role).
CREATE POLICY media_library_delete ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'media-library' AND public.can_write_media_file(name));

-- ---------------------------------------------------------------------------------------------------------------
-- 3. Read helpers (internal: not granted; the RPCs authorise first)

-- One photo for the client. Library photos: the copies, and the original only for managers. Event photos: as on the
-- event page (the original is readable there already), with the copies when they exist.
CREATE FUNCTION public.media_photo_json(_source text, _id uuid, _path text, _has_variants boolean, _width integer,
  _height integer, _created_at timestamptz, _manager boolean) RETURNS jsonb
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT jsonb_build_object('id', _id, 'source', _source,
    'bucket', CASE WHEN _source = 'library' THEN 'media-library' ELSE 'event-media' END,
    'original', CASE WHEN _source = 'event' OR _manager THEN _path END,
    'w640', CASE WHEN _has_variants THEN (public.event_media_variant_paths(_path))[1] END,
    'w1280', CASE WHEN _has_variants THEN (public.event_media_variant_paths(_path))[2] END,
    'width', _width, 'height', _height, 'created_at', _created_at)
$$;

-- Every visible photo of a branch with its chapter (caller already authorised for the branch).
CREATE FUNCTION public.media_branch_photos(_branch uuid)
RETURNS TABLE (source text, id uuid, chapter_kind text, chapter_id uuid, storage_path text, has_variants boolean,
  width integer, height integer, pos integer, created_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH ev AS (
    SELECT e.id FROM public.events e
    WHERE e.branch_id = _branch AND e.scope = 'branch' AND e.deleted_at IS NULL AND NOT e.series_template
      AND e.category <> 'meeting' AND e.status IN ('published', 'cancelled') AND public.can_view_event_media(e.id))
  SELECT 'event', m.id, 'event', m.event_id, m.storage_path, m.has_variants, m.width, m.height, m.position, m.created_at
  FROM public.event_media m JOIN ev ON ev.id = m.event_id
  WHERE m.kind = 'image' AND EXISTS (SELECT 1 FROM storage.objects o WHERE o.bucket_id = 'event-media' AND o.name = m.storage_path)
  UNION ALL
  SELECT 'library', p.id, 'event', p.event_id, p.storage_path, true, p.width, p.height, 1000 + p.position, p.added_at
  FROM public.media_photos p JOIN ev ON ev.id = p.event_id
  WHERE p.branch_id = _branch AND p.ready AND p.deleting_at IS NULL
  UNION ALL
  SELECT 'library', p.id, 'album', p.album_id, p.storage_path, true, p.width, p.height, p.position, p.added_at
  FROM public.media_photos p JOIN public.media_albums a ON a.id = p.album_id AND a.deleted_at IS NULL
  WHERE p.branch_id = _branch AND a.branch_id = _branch AND p.ready AND p.deleting_at IS NULL
$$;

-- Every chapter of a branch (events with at least one photo, every album, empty albums included for managers to
-- fill): kind, id, title, date (London), venue, description, photo count, newest photo time, cover.
CREATE FUNCTION public.media_branch_chapters(_branch uuid)
RETURNS TABLE (kind text, id uuid, title text, chapter_date date, venue text, description text, photo_count bigint,
  last_added_at timestamptz, cover_photo_id uuid, sort_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH ph AS (SELECT * FROM public.media_branch_photos(_branch)),
  agg AS (SELECT chapter_kind, chapter_id, count(*) AS n, max(created_at) AS last_at FROM ph GROUP BY 1, 2)
  SELECT 'event', e.id, e.title,
    coalesce(e.start_date, (e.start_at AT TIME ZONE 'Europe/London')::date),
    CASE WHEN e.location_type = 'online' THEN NULL ELSE nullif(btrim(e.location), '') END,
    NULL::text, agg.n, agg.last_at, NULL::uuid,
    coalesce(e.start_at, e.start_date::timestamp AT TIME ZONE 'Europe/London')
  FROM agg JOIN public.events e ON e.id = agg.chapter_id
  WHERE agg.chapter_kind = 'event'
  UNION ALL
  SELECT 'album', a.id, a.title, coalesce(a.album_date, (a.created_at AT TIME ZONE 'Europe/London')::date), NULL::text,
    a.description, coalesce(agg.n, 0), agg.last_at, a.cover_photo_id,
    coalesce(a.album_date::timestamp AT TIME ZONE 'Europe/London', a.created_at)
  FROM public.media_albums a LEFT JOIN agg ON agg.chapter_kind = 'album' AND agg.chapter_id = a.id
  WHERE a.branch_id = _branch AND a.deleted_at IS NULL
$$;

-- ---------------------------------------------------------------------------------------------------------------
-- 4. Read RPCs

-- The caller's Media context: the branches whose gallery they may open (their own branch; a Regional Director: every
-- branch of the region), the chosen branch (p_branch or the first), what they may do there, the "Jump to" index
-- (years with their chapter titles) and the album list.
CREATE FUNCTION public.get_media_home(p_branch uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _branches jsonb; _branch uuid; _manager boolean;
BEGIN
  SELECT coalesce(jsonb_agg(jsonb_build_object('id', b.id, 'name', b.name) ORDER BY b.name, b.id), '[]'::jsonb) INTO _branches
  FROM public.branches b WHERE b.deleted_at IS NULL AND public.can_view_media(b.id)
    AND (b.id = public.get_user_branch(auth.uid())
      OR EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = auth.uid() AND r.role = 'regional_director' AND r.region_id = b.region_id));
  IF _branches = '[]'::jsonb THEN RAISE EXCEPTION 'Not allowed'; END IF;
  _branch := coalesce(p_branch, public.get_user_branch(auth.uid()), (_branches->0->>'id')::uuid);
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

-- One chapter object (heading, counts, markers) with up to _preview photos.
CREATE FUNCTION public.media_chapter_json(_branch uuid, _kind text, _id uuid, _preview integer, _manager boolean) RETURNS jsonb
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
        SELECT public.media_photo_json(p.source, p.id, p.storage_path, p.has_variants, p.width, p.height, p.created_at, _manager) AS j,
          row_number() OVER (ORDER BY coalesce(p.id = c.cover_photo_id, false) DESC, p.pos, p.created_at, p.id) AS o
        FROM ph p ORDER BY o LIMIT greatest(coalesce(_preview, 4), 0)) x), '[]'::jsonb))
  FROM c
$$;

-- The timeline: chapters newest first, filtered by source ('all' | 'events' | 'albums'), year and title search, in
-- pages of p_limit after the cursor (p_before_at, p_before_id: the sort_at and id of the last chapter shown). Each
-- chapter carries 4 photos for the collage. Empty albums only for managers.
CREATE FUNCTION public.get_media_chapters(p_branch uuid, p_source text DEFAULT 'all', p_year integer DEFAULT NULL,
  p_search text DEFAULT NULL, p_before_at timestamptz DEFAULT NULL, p_before_id uuid DEFAULT NULL, p_limit integer DEFAULT 6)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _manager boolean; _search text := nullif(btrim(coalesce(p_search, '')), '');
BEGIN
  IF NOT public.can_view_media(p_branch) THEN RAISE EXCEPTION 'Not allowed'; END IF;
  IF coalesce(p_source, 'all') NOT IN ('all', 'events', 'albums') OR length(_search) > 100 THEN RAISE EXCEPTION 'Invalid media filter'; END IF;
  _manager := public.can_manage_media(p_branch);
  RETURN jsonb_build_object('chapters', coalesce((SELECT jsonb_agg(public.media_chapter_json(p_branch, c.kind, c.id, 4, _manager)
        || jsonb_build_object('sort_at', c.sort_at) ORDER BY c.sort_at DESC, c.id DESC)
      FROM (SELECT * FROM public.media_branch_chapters(p_branch) c
        WHERE (c.photo_count > 0 OR (_manager AND c.kind = 'album'))
          AND (coalesce(p_source, 'all') = 'all' OR (p_source = 'events' AND c.kind = 'event') OR (p_source = 'albums' AND c.kind = 'album'))
          AND (p_year IS NULL OR extract(year FROM c.chapter_date) = p_year)
          AND (_search IS NULL OR position(lower(_search) IN lower(c.title)) > 0)
          AND (p_before_at IS NULL OR (c.sort_at, c.id) < (p_before_at, coalesce(p_before_id, 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid)))
        ORDER BY c.sort_at DESC, c.id DESC LIMIT least(greatest(coalesce(p_limit, 6), 1), 30)) c), '[]'::jsonb));
END $$;

-- The full chapter view (masonry grid, story viewer, slideshow): every photo in order.
CREATE FUNCTION public.get_media_chapter(p_kind text, p_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _branch uuid; _r jsonb;
BEGIN
  IF p_kind = 'album' THEN
    SELECT branch_id INTO _branch FROM public.media_albums WHERE id = p_id AND deleted_at IS NULL;
  ELSIF p_kind = 'event' THEN
    SELECT branch_id INTO _branch FROM public.events WHERE id = p_id AND scope = 'branch';
  END IF;
  IF _branch IS NULL OR NOT public.can_view_media(_branch) THEN RAISE EXCEPTION 'Chapter not found'; END IF;
  _r := public.media_chapter_json(_branch, p_kind, p_id, 10000, public.can_manage_media(_branch));
  IF _r IS NULL THEN RAISE EXCEPTION 'Chapter not found'; END IF;
  RETURN _r || jsonb_build_object('branch_id', _branch);
END $$;

-- The mobile grid: photos newest first (source and year filters as on the timeline), in pages of p_limit after the
-- cursor (created_at and id of the last photo shown).
CREATE FUNCTION public.get_media_photos(p_branch uuid, p_source text DEFAULT 'all', p_year integer DEFAULT NULL,
  p_before_at timestamptz DEFAULT NULL, p_before_id uuid DEFAULT NULL, p_limit integer DEFAULT 60) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _manager boolean;
BEGIN
  IF NOT public.can_view_media(p_branch) THEN RAISE EXCEPTION 'Not allowed'; END IF;
  IF coalesce(p_source, 'all') NOT IN ('all', 'events', 'albums') THEN RAISE EXCEPTION 'Invalid media filter'; END IF;
  _manager := public.can_manage_media(p_branch);
  RETURN jsonb_build_object('photos', coalesce((SELECT jsonb_agg(public.media_photo_json(p.source, p.id, p.storage_path, p.has_variants,
        p.width, p.height, p.created_at, _manager) || jsonb_build_object('chapter_kind', p.chapter_kind, 'chapter_id', p.chapter_id,
        'chapter_title', c.title, 'chapter_date', c.chapter_date) ORDER BY p.created_at DESC, p.id DESC)
      FROM (SELECT * FROM public.media_branch_photos(p_branch) p
        WHERE (coalesce(p_source, 'all') = 'all' OR (p_source = 'events' AND p.chapter_kind = 'event') OR (p_source = 'albums' AND p.chapter_kind = 'album'))
          AND (p_before_at IS NULL OR (p.created_at, p.id) < (p_before_at, coalesce(p_before_id, 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid)))
        ORDER BY p.created_at DESC, p.id DESC LIMIT least(greatest(coalesce(p_limit, 60), 1), 120)) p
      JOIN public.media_branch_chapters(p_branch) c ON c.kind = p.chapter_kind AND c.id = p.chapter_id
      WHERE p_year IS NULL OR extract(year FROM c.chapter_date) = p_year), '[]'::jsonb));
END $$;

-- Targets for an upload or an upload request: the branch's albums and its events (published or cancelled, newest
-- first, the last 50) that may hold photos.
CREATE FUNCTION public.list_media_targets(p_branch uuid) RETURNS jsonb
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
          AND coalesce(e.start_at, e.start_date::timestamp AT TIME ZONE 'Europe/London') <= now() + interval '1 day'
          AND public.can_view_event_media(e.id)
        ORDER BY 4 DESC, 1 LIMIT 50) x), '[]'::jsonb));
END $$;

-- ---------------------------------------------------------------------------------------------------------------
-- 5. Albums (managers)

CREATE FUNCTION public.media_album_fields(p jsonb, OUT _title text, OUT _date date, OUT _description text)
LANGUAGE plpgsql IMMUTABLE SET search_path = public AS $$
BEGIN
  IF p IS NULL OR jsonb_typeof(p) <> 'object' THEN RAISE EXCEPTION 'Invalid album values'; END IF;
  _title := btrim(coalesce(p->>'title', ''));
  _description := nullif(btrim(coalesce(p->>'description', '')), '');
  IF _title = '' THEN RAISE EXCEPTION 'Album title is required'; END IF;
  IF length(_title) > 120 OR length(_description) > 500 THEN RAISE EXCEPTION 'Invalid album values'; END IF;
  BEGIN
    _date := nullif(p->>'date', '')::date;
  EXCEPTION WHEN data_exception THEN RAISE EXCEPTION 'Invalid album values';
  END;
  IF _date IS NOT NULL AND (_date < '2000-01-01' OR _date > '2100-01-01') THEN RAISE EXCEPTION 'Invalid album values'; END IF;
END $$;

CREATE FUNCTION public.create_media_album(p_branch uuid, p jsonb) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _f record; _id uuid;
BEGIN
  PERFORM public.require_privacy_accepted();
  IF NOT public.can_manage_media(p_branch) THEN RAISE EXCEPTION 'Not allowed'; END IF;
  _f := public.media_album_fields(p);
  INSERT INTO public.media_albums (branch_id, title, album_date, description, created_by)
  VALUES (p_branch, _f._title, _f._date, _f._description, auth.uid()) RETURNING id INTO _id;
  RETURN _id;
END $$;

CREATE FUNCTION public.update_media_album(p_id uuid, p jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _a public.media_albums; _f record;
BEGIN
  PERFORM public.require_privacy_accepted();
  SELECT * INTO _a FROM public.media_albums WHERE id = p_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND OR NOT public.can_manage_media(_a.branch_id) THEN RAISE EXCEPTION 'Not allowed'; END IF;
  _f := public.media_album_fields(p);
  UPDATE public.media_albums SET title = _f._title, album_date = _f._date, description = _f._description WHERE id = p_id;
END $$;

-- The cover: one of the album's ready photos, or NULL for the default (the first photo).
CREATE FUNCTION public.set_media_album_cover(p_album uuid, p_photo uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _a public.media_albums;
BEGIN
  PERFORM public.require_privacy_accepted();
  SELECT * INTO _a FROM public.media_albums WHERE id = p_album AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND OR NOT public.can_manage_media(_a.branch_id) THEN RAISE EXCEPTION 'Not allowed'; END IF;
  IF p_photo IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.media_photos WHERE id = p_photo AND album_id = p_album AND ready AND deleting_at IS NULL) THEN
    RAISE EXCEPTION 'Invalid album cover';
  END IF;
  UPDATE public.media_albums SET cover_photo_id = p_photo WHERE id = p_album;
END $$;

-- Hard delete: hidden at once; returns every stored path (originals and copies) for the server to delete through
-- Storage, after which clear_deleted_media() removes the rows.
CREATE FUNCTION public.delete_media_album(p_id uuid, p_title text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _a public.media_albums; _paths jsonb;
BEGIN
  PERFORM public.require_privacy_accepted();
  SELECT * INTO _a FROM public.media_albums WHERE id = p_id FOR UPDATE;
  IF NOT FOUND OR NOT public.can_manage_media(_a.branch_id) THEN RAISE EXCEPTION 'Not allowed'; END IF;
  IF _a.deleted_at IS NULL AND btrim(coalesce(p_title, '')) IS DISTINCT FROM btrim(_a.title) THEN
    RAISE EXCEPTION 'Album title confirmation required';
  END IF;
  UPDATE public.media_albums SET deleted_at = coalesce(deleted_at, now()) WHERE id = p_id;
  UPDATE public.media_photos SET deleting_at = coalesce(deleting_at, now()) WHERE album_id = p_id;
  SELECT coalesce(jsonb_agg(x ORDER BY x), '[]'::jsonb) INTO _paths FROM (
    SELECT p.storage_path AS x FROM public.media_photos p WHERE p.album_id = p_id
    UNION ALL SELECT unnest(public.event_media_variant_paths(p.storage_path)) FROM public.media_photos p WHERE p.album_id = p_id) f;
  RETURN jsonb_build_object('bucket', 'media-library', 'paths', _paths);
END $$;

-- ---------------------------------------------------------------------------------------------------------------
-- 6. Photos (managers upload directly)

-- The album or event of a target object {album_id} | {event_id} in the branch, checked; locks the album row.
CREATE FUNCTION public.media_target(_branch uuid, p jsonb, OUT _album uuid, OUT _event uuid)
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
    IF NOT public.media_event_ok(_event, _branch) THEN RAISE EXCEPTION 'Event not found'; END IF;
  END IF;
EXCEPTION WHEN invalid_text_representation THEN RAISE EXCEPTION 'Choose an album or an event';
END $$;

-- Whether a photo with this hash is already in the album or event (library photos and the event's own files).
CREATE FUNCTION public.media_is_duplicate(_album uuid, _event uuid, _hash text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT _hash IS NOT NULL AND (
    EXISTS (SELECT 1 FROM public.media_photos p WHERE p.content_hash = _hash AND p.deleting_at IS NULL
            AND ((_album IS NOT NULL AND p.album_id = _album) OR (_event IS NOT NULL AND p.event_id = _event)))
    OR (_event IS NOT NULL AND EXISTS (SELECT 1 FROM public.event_media m WHERE m.event_id = _event AND m.content_hash = _hash)))
$$;

CREATE FUNCTION public.media_hash(_hash text) RETURNS text
LANGUAGE plpgsql IMMUTABLE SET search_path = public AS $$
BEGIN
  IF _hash IS NULL OR lower(_hash) !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'Invalid media file'; END IF;
  RETURN lower(_hash);
END $$;

-- Reserves one direct upload (Branch Manager / Regional Director) into an album or event of the branch. Returns
-- {id, path} for the original (copies: <id>.w640.webp, <id>.w1280.webp), or {duplicate: true} when the same photo is
-- already there. The photo stays hidden until finish_media_photo.
CREATE FUNCTION public.add_media_photo(p_branch uuid, p_target jsonb, p_extension text, p_original_name text, p_hash text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _t record; _id uuid := gen_random_uuid(); _ext text := public.media_ext(p_extension); _hash text; _path text; _pos integer;
BEGIN
  PERFORM public.require_privacy_accepted();
  IF NOT public.can_manage_media(p_branch) THEN RAISE EXCEPTION 'Not allowed'; END IF;
  IF _ext IS NULL THEN RAISE EXCEPTION 'Invalid media file'; END IF;
  _hash := public.media_hash(p_hash);
  _t := public.media_target(p_branch, p_target);
  IF public.media_is_duplicate(_t._album, _t._event, _hash) THEN RETURN jsonb_build_object('duplicate', true); END IF;
  SELECT coalesce(max(position) + 1, 0) INTO _pos FROM public.media_photos
  WHERE (album_id = _t._album OR event_id = _t._event) AND deleting_at IS NULL;
  _path := p_branch::text || '/' || _id::text || '.' || _ext;
  INSERT INTO public.media_photos (id, branch_id, album_id, event_id, storage_path, original_name, content_hash, position, uploaded_by)
  VALUES (_id, p_branch, _t._album, _t._event, _path, nullif(left(btrim(coalesce(p_original_name, '')), 255), ''), _hash, _pos, auth.uid());
  RETURN jsonb_build_object('id', _id, 'path', _path, 'duplicate', false);
END $$;

-- The uploader's last step: the original and both copies are stored; the photo becomes visible.
CREATE FUNCTION public.finish_media_photo(p_id uuid, p_width integer, p_height integer) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _p public.media_photos;
BEGIN
  PERFORM public.require_privacy_accepted();
  SELECT * INTO _p FROM public.media_photos WHERE id = p_id AND deleting_at IS NULL FOR UPDATE;
  IF NOT FOUND OR _p.request_id IS NOT NULL OR NOT public.can_manage_media(_p.branch_id) THEN RAISE EXCEPTION 'Not allowed'; END IF;
  IF p_width NOT BETWEEN 1 AND 20000 OR p_height NOT BETWEEN 1 AND 20000 THEN RAISE EXCEPTION 'Invalid media file'; END IF;
  IF (SELECT count(*) FROM storage.objects WHERE bucket_id = 'media-library'
      AND name = ANY (_p.storage_path || public.event_media_variant_paths(_p.storage_path))) < 3 THEN
    RAISE EXCEPTION 'Image copies are missing';
  END IF;
  UPDATE public.media_photos SET ready = true, width = p_width, height = p_height WHERE id = p_id;
END $$;

-- Hard delete of library photos (managers): hidden at once; returns the stored paths for the server to delete.
CREATE FUNCTION public.delete_media_photos(p_ids uuid[]) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _paths jsonb;
BEGIN
  PERFORM public.require_privacy_accepted();
  IF p_ids IS NULL OR cardinality(p_ids) = 0 OR cardinality(p_ids) > 200 THEN RAISE EXCEPTION 'Invalid media selection'; END IF;
  PERFORM 1 FROM public.media_photos WHERE id = ANY (p_ids) ORDER BY id FOR UPDATE;
  IF (SELECT count(*) FROM public.media_photos WHERE id = ANY (p_ids)) <> (SELECT count(DISTINCT x) FROM unnest(p_ids) x)
     OR EXISTS (SELECT 1 FROM public.media_photos WHERE id = ANY (p_ids) AND NOT public.can_manage_media(branch_id)) THEN
    RAISE EXCEPTION 'Not allowed';
  END IF;
  UPDATE public.media_albums a SET cover_photo_id = NULL WHERE a.cover_photo_id = ANY (p_ids);
  UPDATE public.media_photos SET deleting_at = coalesce(deleting_at, now()) WHERE id = ANY (p_ids);
  SELECT coalesce(jsonb_agg(x ORDER BY x), '[]'::jsonb) INTO _paths FROM (
    SELECT p.storage_path AS x FROM public.media_photos p WHERE p.id = ANY (p_ids)
    UNION ALL SELECT unnest(public.event_media_variant_paths(p.storage_path)) FROM public.media_photos p WHERE p.id = ANY (p_ids)) f;
  RETURN jsonb_build_object('bucket', 'media-library', 'paths', _paths);
END $$;

-- New order of an album's photos (every live photo of the album exactly once).
CREATE FUNCTION public.reorder_media_photos(p_album uuid, p_ids uuid[]) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _a public.media_albums; _n integer;
BEGIN
  PERFORM public.require_privacy_accepted();
  SELECT * INTO _a FROM public.media_albums WHERE id = p_album AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND OR NOT public.can_manage_media(_a.branch_id) THEN RAISE EXCEPTION 'Not allowed'; END IF;
  SELECT count(*) INTO _n FROM public.media_photos WHERE album_id = p_album AND deleting_at IS NULL;
  IF p_ids IS NULL OR cardinality(p_ids) <> _n OR (SELECT count(DISTINCT x) FROM unnest(p_ids) x) <> _n
     OR EXISTS (SELECT 1 FROM unnest(p_ids) x WHERE x IS NULL OR NOT EXISTS (
       SELECT 1 FROM public.media_photos p WHERE p.id = x AND p.album_id = p_album AND p.deleting_at IS NULL)) THEN
    RAISE EXCEPTION 'Invalid photo order';
  END IF;
  UPDATE public.media_photos p SET position = a.ord - 1 FROM unnest(p_ids) WITH ORDINALITY a(id, ord) WHERE p.id = a.id;
END $$;

-- Moves photos to another album or event chapter of the same branch (Branch Manager / Regional Director only).
-- p_items: [{"source": "library" | "event", "id": uuid}, ...] (at most 200); p_target: {album_id} | {event_id}.
--   * library photo (album or an event's Media-only chapter) → any album or event chapter: the parent changes, the
--     files stay where they are.
--   * event page photo (event_media image) → album only (it leaves the event page and becomes members-only): its
--     original and both copies are copied by the server from event-media/<event>/<id>.<ext> to
--     media-library/<branch>/<id>.<ext>; the event's cover cannot be moved, a public event keeps at least one photo,
--     the event must be one the caller manages and the photo must have its copies.
--   * never album → event page, never across branches, never by volunteers or trustees.
-- Same content hash already in the target: skipped and reported ('duplicate'); already there: 'unchanged'.
-- p_commit = false: checks everything and returns the plan ({copies: [{from_bucket, from, to_bucket, to}]}); nothing
-- changes. The server makes the copies (removing them again if any copy fails), then calls with p_commit = true: the
-- same checks run again, every copy must be stored, the rows change in one transaction and the old event-media paths
-- are returned ({remove: [{bucket, path}]}) for the server to delete. A source album whose cover moved falls back to
-- its first photo; the target chapter's "viewed" markers are cleared so the move shows as new. Ids are kept.
CREATE FUNCTION public.move_media_photos(p_items jsonb, p_target jsonb, p_commit boolean DEFAULT false) RETURNS jsonb
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

-- "Viewed" marker for the stories ring.
CREATE FUNCTION public.mark_media_chapter_viewed(p_kind text, p_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _branch uuid;
BEGIN
  PERFORM public.require_privacy_accepted();
  IF p_kind = 'album' THEN
    SELECT branch_id INTO _branch FROM public.media_albums WHERE id = p_id AND deleted_at IS NULL;
  ELSIF p_kind = 'event' THEN
    SELECT branch_id INTO _branch FROM public.events WHERE id = p_id AND scope = 'branch';
    IF NOT public.media_event_ok(p_id, _branch) THEN _branch := NULL; END IF;
  END IF;
  IF _branch IS NULL OR NOT public.can_view_media(_branch) THEN RAISE EXCEPTION 'Chapter not found'; END IF;
  IF p_kind = 'album' THEN
    INSERT INTO public.media_chapter_views (user_id, album_id) VALUES (auth.uid(), p_id)
    ON CONFLICT (user_id, album_id) WHERE album_id IS NOT NULL DO UPDATE SET viewed_at = now();
  ELSE
    INSERT INTO public.media_chapter_views (user_id, event_id) VALUES (auth.uid(), p_id)
    ON CONFLICT (user_id, event_id) WHERE event_id IS NOT NULL DO UPDATE SET viewed_at = now();
  END IF;
END $$;

-- ---------------------------------------------------------------------------------------------------------------
-- 7. Upload requests (volunteers → the branch's Branch Manager / the region's Regional Director)

CREATE FUNCTION public.media_upload_request_json(_r public.media_upload_requests, _with_files boolean) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object('id', _r.id, 'branch_id', _r.branch_id,
    'branch_name', (SELECT name FROM public.branches WHERE id = _r.branch_id),
    'status', _r.status, 'note', _r.note, 'decline_reason', _r.decline_reason,
    'album_id', _r.album_id, 'event_id', _r.event_id, 'proposed_title', _r.proposed_title,
    'target_title', coalesce((SELECT title FROM public.media_albums WHERE id = coalesce(_r.result_album_id, _r.album_id)),
      (SELECT title FROM public.events WHERE id = coalesce(_r.result_event_id, _r.event_id)), _r.proposed_title),
    'target_kind', CASE WHEN coalesce(_r.result_event_id, _r.event_id) IS NOT NULL THEN 'event' ELSE 'album' END,
    'result_album_id', _r.result_album_id, 'result_event_id', _r.result_event_id,
    'added_count', _r.added_count, 'skipped_count', _r.skipped_count,
    'requester_name', CASE WHEN o.own THEN NULL ELSE (SELECT full_name FROM public.profiles WHERE id = _r.requester_id) END,
    'reviewer_name', (SELECT full_name FROM public.profiles WHERE id = _r.reviewer_id),
    'reviewed_at', _r.reviewed_at, 'submitted_at', _r.submitted_at, 'created_at', _r.created_at,
    'file_count', (SELECT count(*) FROM public.media_upload_files f WHERE f.request_id = _r.id AND f.ready AND NOT f.discarded),
    'is_own', o.own,
    'can_edit', o.own AND _r.status = 'uploading',
    'can_withdraw', o.own AND _r.status IN ('uploading', 'submitted'),
    'can_review', NOT o.own AND _r.status = 'submitted' AND public.can_manage_media(_r.branch_id),
    'files', coalesce((SELECT jsonb_agg(jsonb_build_object('id', f.id, 'path', f.storage_path,
        'w640', (public.event_media_variant_paths(f.storage_path))[1], 'w1280', (public.event_media_variant_paths(f.storage_path))[2],
        'original_name', f.original_name, 'width', f.width, 'height', f.height, 'ready', f.ready,
        'duplicate', public.media_is_duplicate(_r.album_id, _r.event_id, f.content_hash)) ORDER BY f.created_at, f.id)
      FROM (SELECT * FROM public.media_upload_files f WHERE f.request_id = _r.id AND NOT f.discarded
              AND (_with_files OR f.ready) ORDER BY f.created_at, f.id LIMIT CASE WHEN _with_files THEN 20 ELSE 4 END) f), '[]'::jsonb))
  FROM (SELECT _r.requester_id IS NOT NULL AND _r.requester_id = auth.uid() AS own) o
$$;

-- Starts a request (status 'uploading'): target {album_id} | {event_id} | {proposed_title}, optional note.
CREATE FUNCTION public.create_media_upload_request(p jsonb) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid uuid := auth.uid(); _branch uuid; _t record; _album uuid; _event uuid; _title text; _note text; _id uuid;
BEGIN
  PERFORM public.require_privacy_accepted();
  PERFORM id FROM public.profiles WHERE id = _uid FOR UPDATE;  -- serialises the open-request limit
  _branch := public.get_user_branch(_uid);
  IF NOT public.can_request_media_upload(_branch) THEN RAISE EXCEPTION 'Not allowed'; END IF;
  IF p IS NULL OR jsonb_typeof(p) <> 'object' THEN RAISE EXCEPTION 'Invalid request values'; END IF;
  _title := nullif(btrim(coalesce(p->>'proposed_title', '')), '');
  _note := nullif(btrim(coalesce(p->>'note', '')), '');
  IF length(_title) > 120 OR length(_note) > 500 THEN RAISE EXCEPTION 'Invalid request values'; END IF;
  IF _title IS NOT NULL THEN
    IF nullif(p->>'album_id', '') IS NOT NULL OR nullif(p->>'event_id', '') IS NOT NULL THEN RAISE EXCEPTION 'Choose an album or an event'; END IF;
  ELSE
    _t := public.media_target(_branch, p);
    _album := _t._album;
    _event := _t._event;
  END IF;
  IF (SELECT count(*) FROM public.media_upload_requests WHERE requester_id = _uid AND status IN ('uploading', 'submitted')) >= 5 THEN
    RAISE EXCEPTION 'Too many open requests';
  END IF;
  INSERT INTO public.media_upload_requests (branch_id, requester_id, album_id, event_id, proposed_title, note)
  VALUES (_branch, _uid, _album, _event, _title, _note) RETURNING id INTO _id;
  RETURN _id;
END $$;

-- Reserves one file of the requester's request (at most 20). {duplicate: true} when the photo is already in the
-- chosen album or event, or already attached to this request.
CREATE FUNCTION public.add_media_upload_file(p_request uuid, p_extension text, p_original_name text, p_hash text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _r public.media_upload_requests; _id uuid := gen_random_uuid(); _ext text := public.media_ext(p_extension); _hash text; _path text;
BEGIN
  PERFORM public.require_privacy_accepted();
  SELECT * INTO _r FROM public.media_upload_requests WHERE id = p_request FOR UPDATE;
  IF NOT FOUND OR _r.requester_id IS DISTINCT FROM auth.uid() OR NOT public.can_request_media_upload(_r.branch_id) THEN RAISE EXCEPTION 'Not allowed'; END IF;
  IF _r.status <> 'uploading' THEN RAISE EXCEPTION 'Request can no longer be changed'; END IF;
  IF _ext IS NULL THEN RAISE EXCEPTION 'Invalid media file'; END IF;
  _hash := public.media_hash(p_hash);
  IF public.media_is_duplicate(_r.album_id, _r.event_id, _hash)
     OR EXISTS (SELECT 1 FROM public.media_upload_files WHERE request_id = p_request AND content_hash = _hash AND NOT discarded) THEN
    RETURN jsonb_build_object('duplicate', true);
  END IF;
  IF (SELECT count(*) FROM public.media_upload_files WHERE request_id = p_request AND NOT discarded) >= 20 THEN
    RAISE EXCEPTION 'Maximum 20 photos per request';
  END IF;
  _path := _r.branch_id::text || '/' || _id::text || '.' || _ext;
  INSERT INTO public.media_upload_files (id, request_id, branch_id, storage_path, original_name, content_hash)
  VALUES (_id, p_request, _r.branch_id, _path, nullif(left(btrim(coalesce(p_original_name, '')), 255), ''), _hash);
  RETURN jsonb_build_object('id', _id, 'path', _path, 'duplicate', false);
END $$;

CREATE FUNCTION public.finish_media_upload_file(p_id uuid, p_width integer, p_height integer) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _f public.media_upload_files; _r public.media_upload_requests;
BEGIN
  PERFORM public.require_privacy_accepted();
  SELECT * INTO _f FROM public.media_upload_files WHERE id = p_id AND NOT discarded;
  IF NOT FOUND THEN RAISE EXCEPTION 'Not allowed'; END IF;
  SELECT * INTO _r FROM public.media_upload_requests WHERE id = _f.request_id FOR UPDATE;
  IF _r.requester_id IS DISTINCT FROM auth.uid() OR _r.status <> 'uploading' THEN RAISE EXCEPTION 'Not allowed'; END IF;
  IF p_width NOT BETWEEN 1 AND 20000 OR p_height NOT BETWEEN 1 AND 20000 THEN RAISE EXCEPTION 'Invalid media file'; END IF;
  IF (SELECT count(*) FROM storage.objects WHERE bucket_id = 'media-library'
      AND name = ANY (_f.storage_path || public.event_media_variant_paths(_f.storage_path))) < 3 THEN
    RAISE EXCEPTION 'Image copies are missing';
  END IF;
  UPDATE public.media_upload_files SET ready = true, width = p_width, height = p_height WHERE id = p_id;
END $$;

-- Removes one file from a request that is still being prepared; returns its paths for the server to delete.
CREATE FUNCTION public.remove_media_upload_file(p_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _f public.media_upload_files; _r public.media_upload_requests;
BEGIN
  PERFORM public.require_privacy_accepted();
  SELECT * INTO _f FROM public.media_upload_files WHERE id = p_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Not allowed'; END IF;
  SELECT * INTO _r FROM public.media_upload_requests WHERE id = _f.request_id FOR UPDATE;
  IF _r.requester_id IS DISTINCT FROM auth.uid() OR _r.status <> 'uploading' THEN RAISE EXCEPTION 'Request can no longer be changed'; END IF;
  UPDATE public.media_upload_files SET discarded = true WHERE id = p_id;
  RETURN jsonb_build_object('bucket', 'media-library', 'paths', to_jsonb(_f.storage_path || public.event_media_variant_paths(_f.storage_path)));
END $$;

-- Sends the request to the reviewers: at least one stored photo; files still unfinished are dropped.
CREATE FUNCTION public.submit_media_upload_request(p_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _r public.media_upload_requests; _paths jsonb;
BEGIN
  PERFORM public.require_privacy_accepted();
  SELECT * INTO _r FROM public.media_upload_requests WHERE id = p_id FOR UPDATE;
  IF NOT FOUND OR _r.requester_id IS DISTINCT FROM auth.uid() OR NOT public.can_request_media_upload(_r.branch_id) THEN RAISE EXCEPTION 'Not allowed'; END IF;
  IF _r.status <> 'uploading' THEN RAISE EXCEPTION 'Request can no longer be changed'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.media_upload_files WHERE request_id = p_id AND ready AND NOT discarded) THEN
    RAISE EXCEPTION 'Add at least one photo';
  END IF;
  SELECT coalesce(jsonb_agg(x ORDER BY x), '[]'::jsonb) INTO _paths FROM (
    SELECT unnest(f.storage_path || public.event_media_variant_paths(f.storage_path)) AS x
    FROM public.media_upload_files f WHERE f.request_id = p_id AND NOT f.ready AND NOT f.discarded) y;
  UPDATE public.media_upload_files SET discarded = true WHERE request_id = p_id AND NOT ready;
  UPDATE public.media_upload_requests SET status = 'submitted', submitted_at = now() WHERE id = p_id;
  RETURN jsonb_build_object('bucket', 'media-library', 'paths', _paths);
END $$;

CREATE FUNCTION public.withdraw_media_upload_request(p_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _r public.media_upload_requests; _paths jsonb;
BEGIN
  PERFORM public.require_privacy_accepted();
  SELECT * INTO _r FROM public.media_upload_requests WHERE id = p_id FOR UPDATE;
  IF NOT FOUND OR _r.requester_id IS DISTINCT FROM auth.uid() THEN RAISE EXCEPTION 'Not allowed'; END IF;
  IF _r.status NOT IN ('uploading', 'submitted') THEN RAISE EXCEPTION 'Request can no longer be changed'; END IF;
  SELECT coalesce(jsonb_agg(x ORDER BY x), '[]'::jsonb) INTO _paths FROM (
    SELECT unnest(f.storage_path || public.event_media_variant_paths(f.storage_path)) AS x
    FROM public.media_upload_files f WHERE f.request_id = p_id AND NOT f.discarded) y;
  UPDATE public.media_upload_files SET discarded = true WHERE request_id = p_id;
  UPDATE public.media_upload_requests SET status = 'withdrawn' WHERE id = p_id;
  RETURN jsonb_build_object('bucket', 'media-library', 'paths', _paths);
END $$;

-- 'mine': the caller's own requests (newest first, the last 50); 'review': submitted requests of the branches they
-- manage (oldest first), then the 20 most recently decided.
CREATE FUNCTION public.list_media_upload_requests(p_box text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_active_person(auth.uid()) OR NOT public.session_ok() OR NOT public.has_accepted_privacy_notice() THEN RAISE EXCEPTION 'Not allowed'; END IF;
  IF p_box = 'mine' THEN
    RETURN coalesce((SELECT jsonb_agg(public.media_upload_request_json(r, false) ORDER BY r.created_at DESC, r.id)
      FROM public.media_upload_requests r WHERE r.id IN (SELECT x.id FROM public.media_upload_requests x WHERE x.requester_id = auth.uid()
        ORDER BY x.created_at DESC, x.id LIMIT 50)), '[]'::jsonb);
  ELSIF p_box = 'review' THEN
    RETURN coalesce((SELECT jsonb_agg(public.media_upload_request_json(r, false) ORDER BY (r.status = 'submitted') DESC,
        CASE WHEN r.status = 'submitted' THEN r.submitted_at END, r.reviewed_at DESC, r.id)
      FROM public.media_upload_requests r WHERE r.id IN (
        SELECT x.id FROM public.media_upload_requests x WHERE x.status = 'submitted' AND x.requester_id IS DISTINCT FROM auth.uid()
          AND public.can_manage_media(x.branch_id)
        UNION ALL
        (SELECT x.id FROM public.media_upload_requests x WHERE x.status IN ('approved', 'declined') AND public.can_manage_media(x.branch_id)
         ORDER BY x.reviewed_at DESC, x.id LIMIT 20))), '[]'::jsonb);
  END IF;
  RAISE EXCEPTION 'Invalid request list';
END $$;

CREATE FUNCTION public.get_media_upload_request(p_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _r public.media_upload_requests;
BEGIN
  SELECT * INTO _r FROM public.media_upload_requests WHERE id = p_id;
  IF NOT FOUND OR NOT ((_r.requester_id = auth.uid() AND public.can_view_media(_r.branch_id)) OR public.can_manage_media(_r.branch_id)) THEN
    RAISE EXCEPTION 'Request not found';
  END IF;
  RETURN public.media_upload_request_json(_r, true);
END $$;

-- Approval: the selected files (p_file_ids; at least one) go into the chosen album or event, or into a new album with
-- the proposed title (p_album_title may change it). Files already there (same hash) are skipped. The other files are
-- discarded; their paths are returned for the server to delete through Storage at once.
CREATE FUNCTION public.approve_media_upload_request(p_id uuid, p_file_ids uuid[], p_album_title text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid uuid := auth.uid(); _r public.media_upload_requests; _album uuid; _event uuid; _title text; _pos integer;
  _f public.media_upload_files; _added integer := 0; _skipped integer := 0; _paths jsonb; _seen text[] := '{}';
BEGIN
  PERFORM public.require_privacy_accepted();
  SELECT * INTO _r FROM public.media_upload_requests WHERE id = p_id FOR UPDATE;
  IF NOT FOUND OR NOT public.can_manage_media(_r.branch_id) OR _r.requester_id IS NOT DISTINCT FROM _uid THEN RAISE EXCEPTION 'Not allowed'; END IF;
  IF _r.status <> 'submitted' THEN RAISE EXCEPTION 'Request is already decided'; END IF;
  IF p_file_ids IS NULL OR cardinality(p_file_ids) = 0 THEN RAISE EXCEPTION 'Select at least one photo'; END IF;
  IF EXISTS (SELECT 1 FROM unnest(p_file_ids) x WHERE NOT EXISTS (
      SELECT 1 FROM public.media_upload_files f WHERE f.id = x AND f.request_id = p_id AND f.ready AND NOT f.discarded)) THEN
    RAISE EXCEPTION 'Invalid media selection';
  END IF;
  _album := _r.album_id;
  _event := _r.event_id;
  IF _album IS NOT NULL THEN
    PERFORM 1 FROM public.media_albums WHERE id = _album AND branch_id = _r.branch_id AND deleted_at IS NULL FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Album not found'; END IF;
  ELSIF _event IS NOT NULL THEN
    IF NOT public.media_event_ok(_event, _r.branch_id) THEN RAISE EXCEPTION 'Event not found'; END IF;
  ELSE
    _title := btrim(coalesce(nullif(btrim(coalesce(p_album_title, '')), ''), _r.proposed_title, ''));
    IF _title = '' OR length(_title) > 120 THEN RAISE EXCEPTION 'Album title is required'; END IF;
    INSERT INTO public.media_albums (branch_id, title, created_by) VALUES (_r.branch_id, _title, _uid) RETURNING id INTO _album;
  END IF;
  SELECT coalesce(max(position) + 1, 0) INTO _pos FROM public.media_photos
  WHERE (album_id = _album OR event_id = _event) AND deleting_at IS NULL;
  FOR _f IN SELECT * FROM public.media_upload_files WHERE request_id = p_id AND id = ANY (p_file_ids) ORDER BY created_at, id LOOP
    IF public.media_is_duplicate(_album, _event, _f.content_hash) OR _f.content_hash = ANY (_seen) THEN
      _skipped := _skipped + 1;
      CONTINUE;
    END IF;
    _seen := _seen || _f.content_hash;
    INSERT INTO public.media_photos (id, branch_id, album_id, event_id, storage_path, original_name, content_hash, width, height,
      position, ready, uploaded_by, approved_by, request_id)
    VALUES (_f.id, _f.branch_id, _album, _event, _f.storage_path, _f.original_name, _f.content_hash, _f.width, _f.height,
      _pos, true, _r.requester_id, _uid, p_id);
    DELETE FROM public.media_upload_files WHERE id = _f.id;
    _pos := _pos + 1;
    _added := _added + 1;
  END LOOP;
  SELECT coalesce(jsonb_agg(x ORDER BY x), '[]'::jsonb) INTO _paths FROM (
    SELECT unnest(f.storage_path || public.event_media_variant_paths(f.storage_path)) AS x
    FROM public.media_upload_files f WHERE f.request_id = p_id AND NOT f.discarded) y;
  UPDATE public.media_upload_files SET discarded = true WHERE request_id = p_id;
  UPDATE public.media_upload_requests SET status = 'approved', reviewer_id = _uid, reviewed_at = now(),
    result_album_id = _album, result_event_id = _event, added_count = _added, skipped_count = _skipped
  WHERE id = p_id;
  PERFORM public.notify(_r.requester_id, 'media_upload_approved', 'media_upload_request', p_id,
    coalesce((SELECT title FROM public.media_albums WHERE id = _album), (SELECT title FROM public.events WHERE id = _event)),
    CASE WHEN _album IS NOT NULL THEN '/media?album=' || _album::text ELSE '/media?event=' || _event::text END,
    jsonb_build_object('added', _added, 'skipped', _skipped));
  RETURN jsonb_build_object('album_id', _album, 'event_id', _event, 'added', _added, 'skipped', _skipped,
    'bucket', 'media-library', 'paths', _paths);
END $$;

CREATE FUNCTION public.decline_media_upload_request(p_id uuid, p_reason text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid uuid := auth.uid(); _r public.media_upload_requests; _reason text := nullif(btrim(coalesce(p_reason, '')), ''); _paths jsonb;
BEGIN
  PERFORM public.require_privacy_accepted();
  SELECT * INTO _r FROM public.media_upload_requests WHERE id = p_id FOR UPDATE;
  IF NOT FOUND OR NOT public.can_manage_media(_r.branch_id) OR _r.requester_id IS NOT DISTINCT FROM _uid THEN RAISE EXCEPTION 'Not allowed'; END IF;
  IF _r.status <> 'submitted' THEN RAISE EXCEPTION 'Request is already decided'; END IF;
  IF length(_reason) > 500 THEN RAISE EXCEPTION 'Invalid request values'; END IF;
  SELECT coalesce(jsonb_agg(x ORDER BY x), '[]'::jsonb) INTO _paths FROM (
    SELECT unnest(f.storage_path || public.event_media_variant_paths(f.storage_path)) AS x
    FROM public.media_upload_files f WHERE f.request_id = p_id AND NOT f.discarded) y;
  UPDATE public.media_upload_files SET discarded = true WHERE request_id = p_id;
  UPDATE public.media_upload_requests SET status = 'declined', reviewer_id = _uid, reviewed_at = now(), decline_reason = _reason
  WHERE id = p_id;
  PERFORM public.notify(_r.requester_id, 'media_upload_declined', 'media_upload_request', p_id,
    coalesce((SELECT title FROM public.media_albums WHERE id = _r.album_id), (SELECT title FROM public.events WHERE id = _r.event_id),
      _r.proposed_title), '/requests?tab=mine', jsonb_build_object('reason', _reason));
  RETURN jsonb_build_object('bucket', 'media-library', 'paths', _paths);
END $$;

-- ---------------------------------------------------------------------------------------------------------------
-- 8. Cleanup (service role: the server after a delete/decision, and the scheduled Recycle Bin cleanup)

-- Everything that must leave Storage: discarded request files, photos being deleted, photos whose event was purged,
-- photos never finished (reserved more than a day ago) and requests abandoned while uploading for more than 2 days
-- (withdrawn here). Paths include the copies; the caller deletes them through Storage, then calls
-- clear_deleted_media().
CREATE FUNCTION public.media_cleanup_paths() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _paths jsonb;
BEGIN
  UPDATE public.media_upload_files f SET discarded = true FROM public.media_upload_requests r
  WHERE r.id = f.request_id AND NOT f.discarded
    AND (r.status IN ('declined', 'withdrawn') OR (r.status = 'uploading' AND r.created_at < now() - interval '2 days'));
  UPDATE public.media_upload_requests SET status = 'withdrawn' WHERE status = 'uploading' AND created_at < now() - interval '2 days';
  UPDATE public.media_photos SET deleting_at = now() WHERE deleting_at IS NULL
    AND ((album_id IS NULL AND event_id IS NULL) OR (NOT ready AND request_id IS NULL AND created_at < now() - interval '1 day'));
  SELECT coalesce(jsonb_agg(x ORDER BY x), '[]'::jsonb) INTO _paths FROM (
    SELECT unnest(f.storage_path || public.event_media_variant_paths(f.storage_path)) AS x FROM public.media_upload_files f WHERE f.discarded
    UNION ALL
    SELECT unnest(p.storage_path || public.event_media_variant_paths(p.storage_path)) FROM public.media_photos p WHERE p.deleting_at IS NOT NULL) y
  WHERE EXISTS (SELECT 1 FROM storage.objects o WHERE o.bucket_id = 'media-library' AND o.name = y.x);
  RETURN jsonb_build_object('bucket', 'media-library', 'paths', _paths);
END $$;

-- Removes the rows whose files are gone: discarded request files, photos being deleted, deleted albums without photos.
CREATE FUNCTION public.clear_deleted_media() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _files integer; _photos integer; _albums integer;
BEGIN
  DELETE FROM public.media_upload_files f WHERE f.discarded AND NOT EXISTS (SELECT 1 FROM storage.objects o
    WHERE o.bucket_id = 'media-library' AND o.name = ANY (f.storage_path || public.event_media_variant_paths(f.storage_path)));
  GET DIAGNOSTICS _files = ROW_COUNT;
  DELETE FROM public.media_photos p WHERE p.deleting_at IS NOT NULL AND NOT EXISTS (SELECT 1 FROM storage.objects o
    WHERE o.bucket_id = 'media-library' AND o.name = ANY (p.storage_path || public.event_media_variant_paths(p.storage_path)));
  GET DIAGNOSTICS _photos = ROW_COUNT;
  DELETE FROM public.media_albums a WHERE a.deleted_at IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.media_photos p WHERE p.album_id = a.id);
  GET DIAGNOSTICS _albums = ROW_COUNT;
  RETURN jsonb_build_object('files', _files, 'photos', _photos, 'albums', _albums);
END $$;

-- ---------------------------------------------------------------------------------------------------------------
-- 9. Notices, review counts, deleted people

ALTER TABLE public.notifications DROP CONSTRAINT notifications_entity_type_check;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_entity_type_check
  CHECK (entity_type IN ('task', 'meeting', 'task_request', 'meeting_request', 'review', 'digest', 'volunteer_application',
    'email_budget', 'media_upload_request'));

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
      'media_upload_approved', 'media_upload_declined') THEN 'request_decided'
    ELSE 'other' END
$$;

-- As in 20261128090000, plus 'media': submitted upload requests of the branches _user manages.
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
  allb AS (SELECT branch_id FROM work UNION ALL SELECT branch_id FROM ev UNION ALL SELECT branch_id FROM apps
    UNION ALL SELECT branch_id FROM media)
  SELECT jsonb_build_object(
    'work', (SELECT count(*) FROM work), 'event_requests', (SELECT count(*) FROM ev), 'applications', (SELECT count(*) FROM apps),
    'media', (SELECT count(*) FROM media),
    'total', (SELECT count(*) FROM allb),
    'branches', (SELECT coalesce(jsonb_agg(name ORDER BY n DESC, name), '[]'::jsonb) FROM (
      SELECT b.name, count(*) AS n FROM allb JOIN public.branches b ON b.id = allb.branch_id GROUP BY b.name ORDER BY count(*) DESC, b.name LIMIT 3) x))
$$;

CREATE OR REPLACE FUNCTION public.get_review_waiting() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE WHEN auth.uid() IS NOT NULL AND public.session_ok() AND public.has_accepted_privacy_notice()
    THEN public.review_waiting_for(auth.uid())
    ELSE jsonb_build_object('work', 0, 'event_requests', 0, 'applications', 0, 'media', 0, 'total', 0, 'branches', '[]'::jsonb) END
$$;

-- The grouped review notice follows submitted / decided upload requests (as for volunteer applications).
CREATE FUNCTION public.media_upload_requests_review_refresh() RETURNS trigger
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
CREATE TRIGGER media_upload_requests_review_refresh AFTER INSERT OR UPDATE OF status ON public.media_upload_requests
  FOR EACH ROW EXECUTE FUNCTION public.media_upload_requests_review_refresh();

-- A soft-deleted person's open upload requests are withdrawn (their files are then removed by the cleanup);
-- restoring the person does not reopen them. Their viewed markers go with them.
CREATE FUNCTION public.profiles_media_sync() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN
    UPDATE public.media_upload_files f SET discarded = true FROM public.media_upload_requests r
    WHERE r.id = f.request_id AND r.requester_id = NEW.id AND r.status IN ('uploading', 'submitted');
    UPDATE public.media_upload_requests SET status = 'withdrawn' WHERE requester_id = NEW.id AND status IN ('uploading', 'submitted');
    DELETE FROM public.media_chapter_views WHERE user_id = NEW.id;
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER profiles_media_sync AFTER UPDATE OF deleted_at ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.profiles_media_sync();

-- ---------------------------------------------------------------------------------------------------------------
-- 10. Privacy notice 1.6: photos at events and in the members' Media area (legitimate interests, the right to object
-- and to have a photo removed) instead of the optional photo consent. Every member confirms it once more.
CREATE OR REPLACE FUNCTION public.privacy_notice_version() RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public AS $$ SELECT '1.6' $$;

-- ---------------------------------------------------------------------------------------------------------------
-- 11. Grants

REVOKE ALL ON FUNCTION
  public.media_touch(), public.can_view_media(uuid), public.can_manage_media(uuid), public.can_request_media_upload(uuid),
  public.media_event_ok(uuid, uuid), public.media_ext(text), public.media_file_id(text), public.can_read_media_file(text),
  public.can_write_media_file(text), public.media_photo_json(text, uuid, text, boolean, integer, integer, timestamptz, boolean),
  public.media_branch_photos(uuid), public.media_branch_chapters(uuid), public.get_media_home(uuid),
  public.media_chapter_json(uuid, text, uuid, integer, boolean),
  public.get_media_chapters(uuid, text, integer, text, timestamptz, uuid, integer), public.get_media_chapter(text, uuid),
  public.get_media_photos(uuid, text, integer, timestamptz, uuid, integer), public.list_media_targets(uuid),
  public.media_album_fields(jsonb), public.create_media_album(uuid, jsonb), public.update_media_album(uuid, jsonb),
  public.set_media_album_cover(uuid, uuid), public.delete_media_album(uuid, text), public.media_target(uuid, jsonb),
  public.media_is_duplicate(uuid, uuid, text), public.media_hash(text), public.add_media_photo(uuid, jsonb, text, text, text),
  public.finish_media_photo(uuid, integer, integer), public.delete_media_photos(uuid[]), public.reorder_media_photos(uuid, uuid[]),
  public.mark_media_chapter_viewed(text, uuid), public.media_upload_request_json(public.media_upload_requests, boolean),
  public.create_media_upload_request(jsonb), public.add_media_upload_file(uuid, text, text, text),
  public.finish_media_upload_file(uuid, integer, integer), public.remove_media_upload_file(uuid),
  public.submit_media_upload_request(uuid), public.withdraw_media_upload_request(uuid), public.list_media_upload_requests(text),
  public.get_media_upload_request(uuid), public.approve_media_upload_request(uuid, uuid[], text),
  public.decline_media_upload_request(uuid, text), public.media_cleanup_paths(), public.clear_deleted_media(),
  public.move_media_photos(jsonb, jsonb, boolean),
  public.media_upload_requests_review_refresh(), public.profiles_media_sync()
FROM PUBLIC, anon, authenticated;

-- Storage policy helpers and the client RPCs (each authorises the caller itself).
GRANT EXECUTE ON FUNCTION
  public.can_view_media(uuid), public.can_manage_media(uuid), public.can_request_media_upload(uuid),
  public.can_read_media_file(text), public.can_write_media_file(text),
  public.get_media_home(uuid), public.get_media_chapters(uuid, text, integer, text, timestamptz, uuid, integer),
  public.get_media_chapter(text, uuid), public.get_media_photos(uuid, text, integer, timestamptz, uuid, integer),
  public.list_media_targets(uuid), public.create_media_album(uuid, jsonb), public.update_media_album(uuid, jsonb),
  public.set_media_album_cover(uuid, uuid), public.delete_media_album(uuid, text), public.add_media_photo(uuid, jsonb, text, text, text),
  public.finish_media_photo(uuid, integer, integer), public.delete_media_photos(uuid[]), public.reorder_media_photos(uuid, uuid[]),
  public.mark_media_chapter_viewed(text, uuid), public.create_media_upload_request(jsonb),
  public.add_media_upload_file(uuid, text, text, text), public.finish_media_upload_file(uuid, integer, integer),
  public.remove_media_upload_file(uuid), public.submit_media_upload_request(uuid), public.withdraw_media_upload_request(uuid),
  public.list_media_upload_requests(text), public.get_media_upload_request(uuid),
  public.approve_media_upload_request(uuid, uuid[], text), public.decline_media_upload_request(uuid, text),
  public.move_media_photos(jsonb, jsonb, boolean)
TO authenticated;

GRANT EXECUTE ON FUNCTION public.media_cleanup_paths(), public.clear_deleted_media() TO service_role;

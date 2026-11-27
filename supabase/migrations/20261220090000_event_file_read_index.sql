-- Event file reads (Storage policy event_files_read → can_read_event_file) as an index lookup instead of a scan.
--
-- Why: the check matched `storage_path = _path OR (kind = 'image' AND _path = ANY (event_media_variant_paths(storage_path)))`.
-- The second arm cannot use an index, so every Storage object a member signs (each photo and each w640/w1280 copy)
-- scanned the whole event_media table, calling can_view_event_media and event_media_variant_paths for every row. The
-- cost grows with all photos in the database (×objects signed): Calendar, Media and the dashboard took 5–19 s on
-- production after the past-events imports (measured 8 ms per object with 182 rows locally, 100–200 ms in production).
--
-- Same rule, same signature, owner and grants: a row matches when _path is its file or one of its two copies. A copy is
-- the original's path without its extension plus '.w640.webp' / '.w1280.webp' (event_media_variant_paths), so the row's
-- path stem equals _path without that suffix. The stem is indexed (images only); the exact ANY check stays, so the
-- extra condition only narrows the rows the planner reads, never what matches. Additive: one index, one function body.

CREATE INDEX IF NOT EXISTS event_media_image_stem_idx
  ON public.event_media (regexp_replace(storage_path, '\.[A-Za-z0-9]+$', ''))
  WHERE kind = 'image';

CREATE OR REPLACE FUNCTION public.can_read_event_file(_path text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.event_media
    WHERE (storage_path = _path
        OR (kind = 'image'
            AND regexp_replace(storage_path, '\.[A-Za-z0-9]+$', '') = regexp_replace(_path, '\.w(640|1280)\.webp$', '')
            AND _path = ANY (public.event_media_variant_paths(storage_path))))
      AND public.can_view_event_media(event_id))
$function$;

REVOKE EXECUTE ON FUNCTION public.can_read_event_file(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_read_event_file(text) TO authenticated;

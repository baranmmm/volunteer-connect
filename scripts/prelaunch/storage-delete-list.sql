-- Pre-launch reset: READ-ONLY list of the Storage objects to delete (SELECT only, nothing is changed). Run it in the
-- Supabase SQL editor on production after the backup and BEFORE the reset (files first, rows second), then delete the
-- listed objects in the dashboard (Storage → bucket → select → Delete). SQL must never delete storage.objects.
--
-- Keep rules (the same as scripts/prelaunch/report.sql and reset.sql)
--   * event-media objects in the folder of a kept event (<event id>/...): the imported photos and their image
--     copies (<name>.w640.webp, <name>.w1280.webp) live in the same folder;
--   * event-media posters of the kept videos (event_videos.thumb_path, videos/<video id>.jpg).
--   Nothing else in Storage is kept: the app's static and brand assets are bundled with the app (public/), not stored
--   in a bucket. Every object of meeting-files and event-request-files is deleted, and so is everything under
--   event-media/deleted/ (Recycle Bin copies).
--
-- Output: one table (bucket_id, name). The first rows, whose name starts with "#", are the per-bucket summary (not
-- objects); then every object to delete, ordered by bucket and name. Run it again after the reset: it must list no
-- objects (summary "delete 0") unless test files were uploaded in between; delete those too.

WITH
keep_events AS (
  SELECT e.id FROM public.events e
  WHERE e.past_record AND e.deleted_at IS NULL
    AND EXISTS (SELECT 1 FROM public.event_media m WHERE m.event_id = e.id AND m.source_url LIKE 'https://www.dialoguesociety.org/%')
),
keep_videos AS (
  SELECT v.id, v.thumb_path FROM public.event_videos v
  WHERE (v.event_id IS NULL AND v.created_by IS NULL) OR v.event_id IN (SELECT id FROM keep_events)
),
objects AS (
  SELECT o.bucket_id, o.name,
    (o.bucket_id = 'event-media'
      AND (split_part(o.name, '/', 1) IN (SELECT id::text FROM keep_events)
        OR o.name IN (SELECT thumb_path FROM keep_videos WHERE thumb_path IS NOT NULL))) AS keep
  FROM storage.objects o
),
buckets AS (
  SELECT id AS bucket_id FROM storage.buckets
  UNION
  SELECT DISTINCT bucket_id FROM storage.objects
),
listing(ord, bucket_id, name) AS (
  SELECT 0, b.bucket_id,
    '# summary: delete ' || (SELECT count(*) FROM objects o WHERE o.bucket_id = b.bucket_id AND NOT o.keep)
      || ' / keep ' || (SELECT count(*) FROM objects o WHERE o.bucket_id = b.bucket_id AND o.keep)
      || ' / total ' || (SELECT count(*) FROM objects o WHERE o.bucket_id = b.bucket_id)
  FROM buckets b
  UNION ALL
  SELECT 0, '(all buckets)',
    '# summary: delete ' || (SELECT count(*) FROM objects WHERE NOT keep) || ' / keep ' || (SELECT count(*) FROM objects WHERE keep)
      || ' / total ' || (SELECT count(*) FROM objects)
  UNION ALL
  SELECT 1, o.bucket_id, o.name FROM objects o WHERE NOT o.keep
)
SELECT bucket_id, name FROM listing ORDER BY ord, bucket_id, name;

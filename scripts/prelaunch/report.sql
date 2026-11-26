-- Pre-launch reset: READ-ONLY report (SELECT only, nothing is changed). Run it in the Supabase SQL editor on
-- production and check the numbers before and after the reset (scripts/prelaunch/reset.sql uses exactly these keep
-- rules; after the reset every "DELETE rows" and "DELETE storage" line must be 0 and section 8 must be empty).
--
-- Keep rules
--   * the National Coordinator account with the DOTTED email (a "." before the @): auth user, profile, role,
--     MFA factors, its own preferences/consents and push devices. Every other account is deleted (incl. the undotted NC).
--   * the 15 imported dialoguesociety.org past events (past_record, photos with a dialoguesociety.org source_url),
--     their photos (event_media + Storage objects in their folder) and the imported channel highlight videos
--     (event_videos without an event, created_by NULL) with their poster files.
--   * reference data: regions, branches (with postcodes/coordinates), the postcode geocode cache.
-- Everything else user-generated is in the delete set.
--
-- Output: one table (section, name, detail, n). Sections:
--   1 KEEP account          every National Coordinator account; detail says KEEP or DELETE (exactly one KEEP expected)
--   2 KEEP imported event   the past events to keep (expect 15); n = Storage objects kept for it
--   3 KEEP highlight video  the channel videos to keep (expect 6)
--   4 KEEP reference        row counts of the reference tables that stay
--   5 DELETE rows           per table: rows the reset would delete (detail: total / kept)
--   6 DELETE storage        per bucket: objects the reset would delete (detail: total / kept)
--   7 FK CHECK              keep-rule rows that point at something being deleted, and how the reset avoids it
--   8 NOT COVERED           public tables this report (and the reset) does not know; must be empty, otherwise update
--                           both scripts first (the reset aborts while such a table holds rows)

WITH
keep_nc AS (
  SELECT u.id, u.email
  FROM auth.users u JOIN public.user_roles r ON r.user_id = u.id AND r.role = 'national_coordinator'
  WHERE split_part(u.email, '@', 1) LIKE '%.%'
),
keep_events AS (
  SELECT e.id FROM public.events e
  WHERE e.past_record AND e.deleted_at IS NULL
    AND EXISTS (SELECT 1 FROM public.event_media m WHERE m.event_id = e.id AND m.source_url LIKE 'https://www.dialoguesociety.org/%')
),
keep_videos AS (
  SELECT v.id, v.thumb_path FROM public.event_videos v
  WHERE (v.event_id IS NULL AND v.created_by IS NULL) OR v.event_id IN (SELECT id FROM keep_events)
),
keep_objects AS (
  SELECT o.id, o.bucket_id FROM storage.objects o
  WHERE o.bucket_id = 'event-media'
    AND (split_part(o.name, '/', 1) IN (SELECT id::text FROM keep_events)
      OR o.name IN (SELECT thumb_path FROM keep_videos WHERE thumb_path IS NOT NULL))
),
counts(tbl, total, kept) AS (
  SELECT 'auth.users', (SELECT count(*) FROM auth.users), (SELECT count(*) FROM auth.users WHERE id IN (SELECT id FROM keep_nc))
  UNION ALL SELECT 'auth.identities', (SELECT count(*) FROM auth.identities), (SELECT count(*) FROM auth.identities WHERE user_id IN (SELECT id FROM keep_nc))
  UNION ALL SELECT 'auth.sessions', (SELECT count(*) FROM auth.sessions), (SELECT count(*) FROM auth.sessions WHERE user_id IN (SELECT id FROM keep_nc))
  UNION ALL SELECT 'auth.mfa_factors', (SELECT count(*) FROM auth.mfa_factors), (SELECT count(*) FROM auth.mfa_factors WHERE user_id IN (SELECT id FROM keep_nc))
  UNION ALL SELECT 'auth.one_time_tokens', (SELECT count(*) FROM auth.one_time_tokens), (SELECT count(*) FROM auth.one_time_tokens WHERE user_id IN (SELECT id FROM keep_nc))
  UNION ALL SELECT 'auth.refresh_tokens', (SELECT count(*) FROM auth.refresh_tokens), (SELECT count(*) FROM auth.refresh_tokens WHERE user_id IN (SELECT id::text FROM keep_nc))
  UNION ALL SELECT 'auth.flow_state', (SELECT count(*) FROM auth.flow_state), (SELECT count(*) FROM auth.flow_state WHERE user_id IN (SELECT id FROM keep_nc))
  UNION ALL SELECT 'auth.audit_log_entries', (SELECT count(*) FROM auth.audit_log_entries), (SELECT count(*) FROM auth.audit_log_entries WHERE (payload ->> 'actor_id') IN (SELECT id::text FROM keep_nc))
  UNION ALL SELECT 'profiles', (SELECT count(*) FROM public.profiles), (SELECT count(*) FROM public.profiles WHERE id IN (SELECT id FROM keep_nc))
  UNION ALL SELECT 'user_roles', (SELECT count(*) FROM public.user_roles), (SELECT count(*) FROM public.user_roles WHERE user_id IN (SELECT id FROM keep_nc))
  UNION ALL SELECT 'user_followed_branches', (SELECT count(*) FROM public.user_followed_branches), (SELECT count(*) FROM public.user_followed_branches WHERE user_id IN (SELECT id FROM keep_nc))
  UNION ALL SELECT 'consent_preferences', (SELECT count(*) FROM public.consent_preferences), (SELECT count(*) FROM public.consent_preferences WHERE user_id IN (SELECT id FROM keep_nc))
  UNION ALL SELECT 'notification_preferences', (SELECT count(*) FROM public.notification_preferences), (SELECT count(*) FROM public.notification_preferences WHERE user_id IN (SELECT id FROM keep_nc))
  UNION ALL SELECT 'push_subscriptions', (SELECT count(*) FROM public.push_subscriptions), (SELECT count(*) FROM public.push_subscriptions WHERE user_id IN (SELECT id FROM keep_nc))
  UNION ALL SELECT 'privacy_notice_acceptances', (SELECT count(*) FROM public.privacy_notice_acceptances), (SELECT count(*) FROM public.privacy_notice_acceptances WHERE user_id IN (SELECT id FROM keep_nc))
  UNION ALL SELECT 'events', (SELECT count(*) FROM public.events), (SELECT count(*) FROM keep_events)
  UNION ALL SELECT 'event_media', (SELECT count(*) FROM public.event_media), (SELECT count(*) FROM public.event_media WHERE event_id IN (SELECT id FROM keep_events))
  UNION ALL SELECT 'event_videos', (SELECT count(*) FROM public.event_videos), (SELECT count(*) FROM keep_videos)
  UNION ALL SELECT 'account_deletion_requests', (SELECT count(*) FROM public.account_deletion_requests), 0
  UNION ALL SELECT 'email_outbox', (SELECT count(*) FROM public.email_outbox), 0
  UNION ALL SELECT 'event_announcements', (SELECT count(*) FROM public.event_announcements), 0
  UNION ALL SELECT 'event_audit_log', (SELECT count(*) FROM public.event_audit_log), 0
  UNION ALL SELECT 'event_cleanup_audit', (SELECT count(*) FROM public.event_cleanup_audit), 0
  UNION ALL SELECT 'event_deletion_jobs', (SELECT count(*) FROM public.event_deletion_jobs), 0
  UNION ALL SELECT 'event_guests', (SELECT count(*) FROM public.event_guests), 0
  UNION ALL SELECT 'event_registrations', (SELECT count(*) FROM public.event_registrations), 0
  UNION ALL SELECT 'event_request_media', (SELECT count(*) FROM public.event_request_media), 0
  UNION ALL SELECT 'event_requests', (SELECT count(*) FROM public.event_requests), 0
  UNION ALL SELECT 'event_series', (SELECT count(*) FROM public.event_series), 0
  UNION ALL SELECT 'media_albums', (SELECT count(*) FROM public.media_albums), 0
  UNION ALL SELECT 'media_download_items', (SELECT count(*) FROM public.media_download_items), 0
  UNION ALL SELECT 'media_download_requests', (SELECT count(*) FROM public.media_download_requests), 0
  UNION ALL SELECT 'media_highlights', (SELECT count(*) FROM public.media_highlights), 0
  UNION ALL SELECT 'media_nudges_sent', (SELECT count(*) FROM public.media_nudges_sent), 0
  UNION ALL SELECT 'media_chapter_views', (SELECT count(*) FROM public.media_chapter_views), 0
  UNION ALL SELECT 'media_photos', (SELECT count(*) FROM public.media_photos), 0
  UNION ALL SELECT 'media_upload_files', (SELECT count(*) FROM public.media_upload_files), 0
  UNION ALL SELECT 'media_upload_requests', (SELECT count(*) FROM public.media_upload_requests), 0
  UNION ALL SELECT 'meeting_agenda_items', (SELECT count(*) FROM public.meeting_agenda_items), 0
  UNION ALL SELECT 'meeting_decisions', (SELECT count(*) FROM public.meeting_decisions), 0
  UNION ALL SELECT 'meeting_files', (SELECT count(*) FROM public.meeting_files), 0
  UNION ALL SELECT 'meeting_invitees', (SELECT count(*) FROM public.meeting_invitees), 0
  UNION ALL SELECT 'meeting_requests', (SELECT count(*) FROM public.meeting_requests), 0
  UNION ALL SELECT 'meeting_series', (SELECT count(*) FROM public.meeting_series), 0
  UNION ALL SELECT 'meetings', (SELECT count(*) FROM public.meetings), 0
  UNION ALL SELECT 'push_outbox', (SELECT count(*) FROM public.push_outbox), 0
  UNION ALL SELECT 'notification_digest_log', (SELECT count(*) FROM public.notification_digest_log), 0
  UNION ALL SELECT 'notifications', (SELECT count(*) FROM public.notifications), 0
  UNION ALL SELECT 'public_rate_limits', (SELECT count(*) FROM public.public_rate_limits), 0
  UNION ALL SELECT 'recycle_bin_audit_log', (SELECT count(*) FROM public.recycle_bin_audit_log), 0
  UNION ALL SELECT 'subscribers', (SELECT count(*) FROM public.subscribers), 0
  UNION ALL SELECT 'task_groups', (SELECT count(*) FROM public.task_groups), 0
  UNION ALL SELECT 'task_assignees', (SELECT count(*) FROM public.task_assignees), 0
  UNION ALL SELECT 'task_notes', (SELECT count(*) FROM public.task_notes), 0
  UNION ALL SELECT 'task_reminder_log', (SELECT count(*) FROM public.task_reminder_log), 0
  UNION ALL SELECT 'task_requests', (SELECT count(*) FROM public.task_requests), 0
  UNION ALL SELECT 'tasks', (SELECT count(*) FROM public.tasks), 0
  UNION ALL SELECT 'user_audit_log', (SELECT count(*) FROM public.user_audit_log), 0
  UNION ALL SELECT 'user_deletion_state', (SELECT count(*) FROM public.user_deletion_state), 0
  UNION ALL SELECT 'volunteer_applications', (SELECT count(*) FROM public.volunteer_applications), 0
),
report(ord, section, name, detail, n) AS (
  -- 1. Every National Coordinator account, with the decision.
  SELECT 1, 'KEEP account', u.email,
    CASE WHEN u.id IN (SELECT id FROM keep_nc) THEN 'KEEP' ELSE 'DELETE' END
      || ' | profile: ' || coalesce(p.full_name, '(none)') || ' | status: ' || coalesce(p.status::text, '-')
      || ' | id: ' || u.id::text,
    (SELECT count(*) FROM auth.mfa_factors f WHERE f.user_id = u.id)
  FROM auth.users u JOIN public.user_roles r ON r.user_id = u.id AND r.role = 'national_coordinator'
  LEFT JOIN public.profiles p ON p.id = u.id
  UNION ALL
  SELECT 1, 'KEEP account', '(count of KEEP accounts — must be 1)', 'auth.users with the NC role and a dotted email', (SELECT count(*) FROM keep_nc)
  -- 2. The imported past events.
  UNION ALL
  SELECT 2, 'KEEP imported event', e.title,
    coalesce(e.start_date::text, '-') || ' | ' || e.scope || ' ' || coalesce(b.name, rg.name, '') || ' | id: ' || e.id::text
      || ' | photos: ' || (SELECT count(*) FROM public.event_media m WHERE m.event_id = e.id)
      || ' (gallery ' || (SELECT count(*) FROM public.event_media m WHERE m.event_id = e.id AND m.in_gallery) || ')'
      || ' | created_by: ' || coalesce((SELECT email FROM public.profiles WHERE id = e.created_by), 'NULL'),
    (SELECT count(*) FROM storage.objects o WHERE o.bucket_id = 'event-media' AND split_part(o.name, '/', 1) = e.id::text)
  FROM public.events e LEFT JOIN public.branches b ON b.id = e.branch_id LEFT JOIN public.regions rg ON rg.id = e.region_id
  WHERE e.id IN (SELECT id FROM keep_events)
  UNION ALL
  SELECT 2, 'KEEP imported event', '(count — expect 15)', 'past_record with a dialoguesociety.org photo', (SELECT count(*) FROM keep_events)
  -- 3. The channel highlight videos.
  UNION ALL
  SELECT 3, 'KEEP highlight video', v.title, 'youtube: ' || v.youtube_id || ' | poster: ' || coalesce(v.thumb_path, 'none') || ' | id: ' || v.id::text, 1
  FROM public.event_videos v WHERE v.id IN (SELECT id FROM keep_videos)
  -- 4. Reference data that stays.
  UNION ALL SELECT 4, 'KEEP reference', 'regions', 'all rows', (SELECT count(*) FROM public.regions)
  UNION ALL SELECT 4, 'KEEP reference', 'branches', 'all rows (located: ' || (SELECT count(*) FROM public.branches WHERE latitude IS NOT NULL) || ')', (SELECT count(*) FROM public.branches)
  UNION ALL SELECT 4, 'KEEP reference', 'postcode_geocodes', 'geocode cache', (SELECT count(*) FROM public.postcode_geocodes)
  UNION ALL SELECT 4, 'KEEP reference', 'storage objects kept', 'event-media: imported photos + copies + video posters', (SELECT count(*) FROM keep_objects)
  -- 5. Rows the reset would delete, per table.
  UNION ALL
  SELECT 5, 'DELETE rows', tbl, 'total ' || total || ' / kept ' || kept, total - kept FROM counts
  -- 6. Storage objects the reset would delete, per bucket.
  UNION ALL
  SELECT 6, 'DELETE storage', b.id,
    'total ' || (SELECT count(*) FROM storage.objects o WHERE o.bucket_id = b.id)
      || ' / kept ' || (SELECT count(*) FROM keep_objects k WHERE k.bucket_id = b.id),
    (SELECT count(*) FROM storage.objects o WHERE o.bucket_id = b.id) - (SELECT count(*) FROM keep_objects k WHERE k.bucket_id = b.id)
  FROM storage.buckets b
  -- 7. Keep-rule rows that point at something being deleted.
  UNION ALL
  SELECT 7, 'FK CHECK', 'events.created_by (kept events)',
    'points at an account being deleted; FK is SET NULL. Reset: reassign to the kept NC before deleting accounts',
    (SELECT count(*) FROM public.events e WHERE e.id IN (SELECT id FROM keep_events) AND e.created_by IS NOT NULL AND e.created_by NOT IN (SELECT id FROM keep_nc))
  UNION ALL
  SELECT 7, 'FK CHECK', 'events.created_by IS NULL (kept events)',
    'imported without an owner; reset: set to the kept NC (your rule: reassign ownership to the NC)',
    (SELECT count(*) FROM public.events e WHERE e.id IN (SELECT id FROM keep_events) AND e.created_by IS NULL)
  UNION ALL
  SELECT 7, 'FK CHECK', 'event_media.uploaded_by (kept photos)',
    'SET NULL on account delete (no cascade); reset: reassign to the kept NC',
    (SELECT count(*) FROM public.event_media m WHERE m.event_id IN (SELECT id FROM keep_events) AND m.uploaded_by IS NOT NULL AND m.uploaded_by NOT IN (SELECT id FROM keep_nc))
  UNION ALL
  SELECT 7, 'FK CHECK', 'event_videos.created_by (kept videos)',
    'SET NULL on account delete (no cascade)',
    (SELECT count(*) FROM keep_videos k JOIN public.event_videos v ON v.id = k.id WHERE v.created_by IS NOT NULL AND v.created_by NOT IN (SELECT id FROM keep_nc))
  UNION ALL
  SELECT 7, 'FK CHECK', 'event_videos.event_id (kept videos on deleted events)',
    'would CASCADE with the event; must be 0',
    (SELECT count(*) FROM keep_videos k JOIN public.event_videos v ON v.id = k.id WHERE v.event_id IS NOT NULL AND v.event_id NOT IN (SELECT id FROM keep_events))
  UNION ALL
  SELECT 7, 'FK CHECK', 'events.series_id (kept events in a series)',
    'kept events must not belong to a series being deleted; must be 0',
    (SELECT count(*) FROM public.events e WHERE e.id IN (SELECT id FROM keep_events) AND e.series_id IS NOT NULL)
  UNION ALL
  SELECT 7, 'FK CHECK', 'event_series.media_event_id = a kept event',
    'a series using a kept event as its media holder; must be 0',
    (SELECT count(*) FROM public.event_series s WHERE s.media_event_id IN (SELECT id FROM keep_events))
  UNION ALL
  SELECT 7, 'FK CHECK', 'kept events in the Recycle Bin / deletion jobs',
    'must be 0 (a deletion job would purge kept files)',
    (SELECT count(*) FROM public.event_deletion_jobs j WHERE j.event_id IN (SELECT id FROM keep_events))
  UNION ALL
  SELECT 7, 'FK CHECK', 'kept NC rows that reference deleted accounts',
    'profiles.deleted_by / user_roles of the NC pointing elsewhere; SET NULL, harmless',
    (SELECT count(*) FROM public.profiles p WHERE p.id IN (SELECT id FROM keep_nc) AND p.deleted_by IS NOT NULL)
  UNION ALL
  SELECT 7, 'FK CHECK', 'kept NC MFA factors',
    'the reset aborts without one and verifies the count is unchanged; must be >= 1',
    (SELECT count(*) FROM auth.mfa_factors f WHERE f.user_id IN (SELECT id FROM keep_nc))
  UNION ALL
  SELECT 7, 'FK CHECK', 'kept events that are series templates or meetings',
    'must be 0 (the reset aborts otherwise)',
    (SELECT count(*) FROM public.events e WHERE e.id IN (SELECT id FROM keep_events) AND (e.series_template OR e.category = 'meeting'))
  UNION ALL
  SELECT 7, 'FK CHECK', 'last-active-NC protection',
    'triggers protect the last active NC; the kept NC must be active so deleting the others is allowed',
    (SELECT count(*) FROM public.profiles p WHERE p.id IN (SELECT id FROM keep_nc) AND p.status = 'active' AND p.deleted_at IS NULL)
  -- 8. Public tables neither kept nor counted above (a table added after this report was written).
  UNION ALL
  SELECT 8, 'NOT COVERED', c.relname, 'public table unknown to the report and the reset: update both before resetting', NULL::bigint
  FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace s ON s.oid = c.relnamespace
  WHERE s.nspname = 'public' AND c.relkind IN ('r', 'p') AND NOT c.relispartition
    AND c.relname NOT IN ('regions', 'branches', 'postcode_geocodes')
    AND 'public.' || c.relname NOT IN (SELECT CASE WHEN tbl LIKE 'auth.%' THEN tbl ELSE 'public.' || tbl END FROM counts)
)
SELECT section, name, detail, n FROM report ORDER BY ord, section, name;

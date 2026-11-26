-- Pre-launch reset: deletes every test account and all user-generated data, keeping only
--   * the National Coordinator account with the DOTTED email (a "." before the @): auth user, identities, sessions,
--     MFA factors, profile, role, followed branches, consents, notification settings, privacy notice acceptances;
--   * the 15 imported dialoguesociety.org past events (past_record, not deleted, with a photo whose source_url is on
--     https://www.dialoguesociety.org/), every event_media row of those events, and the highlight videos (channel
--     videos: event_id NULL and created_by NULL, plus videos attached to a kept event);
--   * reference data: regions, branches, postcode_geocodes.
-- The keep rules are exactly those of scripts/prelaunch/report.sql (rule-based, never fixed ids).
--
-- Written to run unchanged as a migration (plain SQL, one DO block, no BEGIN/COMMIT, no psql meta-commands): on reset
-- day it is copied to supabase/migrations/<timestamp>_prelaunch_reset.sql. Any error rolls the whole migration back.
--
-- Guard
--   * keep NC = 0 AND keep events = 0 AND keep videos = 0: not the production database (fresh local stacks, CI, QA,
--     the PGlite test fixture): RAISE NOTICE and change nothing. This path reads only auth.users and public tables.
--   * otherwise the counts must be exactly 1 NC, 15 events, 6 videos, the NC active (not deleted) with at least one
--     MFA factor, and no kept event in a series / used as a series' media holder / in a deletion job; else RAISE
--     EXCEPTION (nothing changed).
--
-- Storage is NOT touched here (SQL must never delete storage.objects; protect_objects_delete blocks it): delete the
-- objects listed by scripts/prelaunch/storage-delete-list.sql in the Supabase dashboard BEFORE running this.
--
-- Deletion order (children before parents; every statement is explicit so no ON DELETE SET NULL action has to update
-- a row that is about to be deleted anyway, which would fire that table's UPDATE triggers):
--   1  email_outbox                  references notifications (SET NULL), registrations, subscribers, events, profiles
--   2  notification_digest_log       references notifications (SET NULL)
--   3  notifications                 self-reference digest_id (SET NULL) is resolved in the same statement
--   4  task_reminder_log, task_notes, task_assignees   children of tasks (CASCADE anyway)
--   5  task_requests                 task_id SET NULL: deleted before tasks so no UPDATE runs on them
--   6  tasks                         references task_groups, meeting_decisions, meetings, events (all SET NULL)
--   7  task_groups                   references meeting_decisions, meetings, events (SET NULL)
--   8  meeting_requests              meeting_id SET NULL
--   9  meeting_decisions, meeting_agenda_items (carried_to self SET NULL), meeting_files, meeting_invitees
--  10  meetings                      meetings.event_id is NO ACTION: must go before events
--  11  meeting_series                meetings.series_id SET NULL: after meetings
--  12  event_request_media, event_requests   event_requests.event_id SET NULL: before events
--  13  event_announcements, event_guests, event_registrations, event_audit_log, event_cleanup_audit,
--      event_deletion_jobs           children / logs of events
--  14  event_videos (not kept)       BEFORE accounts: a test channel video with created_by = a deleted account would
--                                    otherwise become created_by NULL and newly match the keep rule
--  15  event_media (not kept)        then events (not kept). Kept events have no series (guard), so deleting the
--      events (not kept)             other events only sets event_series.media_event_id NULL (no trigger there)
--  16  event_series                  after events: deleting a series first would SET NULL events.series_id, an
--                                    UPDATE that events_series_guard rejects ("Not allowed")
--  17  subscribers, public_rate_limits
--  18  volunteer_applications, account_deletion_requests (deletion_audit_id SET NULL),
--      user_deletion_state (deletion_audit_id RESTRICT: must go before user_audit_log), user_audit_log,
--      recycle_bin_audit_log
--  19  privacy_notice_acceptances, consent_preferences, notification_preferences, user_followed_branches: rows of
--      other accounts (and orphans with user_id NULL); the NC's own rows stay
--  20  reassign kept rows that reference a deleted account to the NC (see below)
--  21  auth.refresh_tokens, auth.flow_state (user_id has no FK), auth.audit_log_entries of other accounts
--  22  auth.users other than the NC; CASCADE removes profiles, user_roles, auth.identities, auth.sessions (and their
--      refresh tokens / MFA claims), auth.mfa_factors, auth.one_time_tokens and the other auth.* children
--
-- Kept rows that reference people (reassigned to the NC before the accounts go)
--   events.created_by (kept events)      -> the NC, also when NULL (imported events: the agreed ownership rule)
--   events.deleted_by (kept events)      -> NULL when it points at another account (kept events are not deleted)
--   event_media.uploaded_by (kept)       -> the NC when it points at another account (NULL = imported: left NULL)
--   event_videos.created_by (kept)       -> the NC when it points at another account; NULL stays NULL (it is the
--                                           channel-video keep rule, so the second run must still find them)
--   profiles.deleted_by (the NC)         -> NULL when it points at another account
--   branches.deleted_by, regions.deleted_by (no FK) -> the NC when they point at another account
--
-- Triggers that fire on these statements (none is disabled; session_replication_role is not used)
--   guard_last_nc_profile / guard_last_nc_role (BEFORE DELETE on profiles / user_roles, through the auth.users
--     CASCADE): they only block removing the LAST active NC. The kept NC is checked to be active and not deleted
--     before anything is deleted, so other_active_nc_exists() is true for every other NC that goes.
--   events UPDATE triggers (reassigning created_by/deleted_by of the 15 kept past records): validate_event (keeps
--     past_record, re-normalises the record, sets updated_at), events_series_guard (series columns unchanged: no
--     error), zz_events_ics_sequence (no time/place change: sequence unchanged), events_public_emails /
--     events_registration_sync / events_to_meeting / events_meeting_guard (no status, time, deletion or category
--     change, no meeting: they do nothing). No email is queued.
--   profiles UPDATE triggers (NC's deleted_by -> NULL, normally never runs): guard_last_nc_profile (status unchanged:
--     passes), profiles_*_sync (deleted_at unchanged: nothing).
--   No other table that is deleted from has a DELETE trigger; deletes never fire the UPDATE triggers of other tables
--   because their referencing rows are deleted first (order above).
--
-- Final verification (same transaction; RAISE EXCEPTION rolls everything back): 1 auth user = 1 profile = the NC,
-- active, one role row national_coordinator, MFA factor count unchanged, every remaining auth row is the NC's; 15 kept
-- events, kept media count unchanged, 6 videos (all re-found by the keep rules); every other public table is empty
-- except the reference tables. The "every other public table" check is dynamic: a table added later that holds data
-- aborts the reset until this script is updated.
--
-- Idempotent: on the reset database the keep rules find the same 1/15/6, nothing is deleted or reassigned, and the
-- verification passes.

DO $$
DECLARE
  _nc uuid;
  _n_nc int;
  _keep_events uuid[];
  _keep_videos uuid[];
  _n_media int;
  _n_mfa int;
  _n int;
  _t text;
  _log text := '';
BEGIN
  -- Keep sets (the report's rules).
  SELECT count(*), min(u.id::text)::uuid INTO _n_nc, _nc
  FROM auth.users u JOIN public.user_roles r ON r.user_id = u.id AND r.role = 'national_coordinator'
  WHERE split_part(u.email, '@', 1) LIKE '%.%';

  SELECT coalesce(array_agg(e.id ORDER BY e.id), '{}') INTO _keep_events
  FROM public.events e
  WHERE e.past_record AND e.deleted_at IS NULL
    AND EXISTS (SELECT 1 FROM public.event_media m WHERE m.event_id = e.id AND m.source_url LIKE 'https://www.dialoguesociety.org/%');

  SELECT coalesce(array_agg(v.id ORDER BY v.id), '{}') INTO _keep_videos
  FROM public.event_videos v
  WHERE (v.event_id IS NULL AND v.created_by IS NULL) OR v.event_id = ANY (_keep_events);

  -- Guard 1: nothing to keep = not the production database. Change nothing.
  IF _n_nc = 0 AND cardinality(_keep_events) = 0 AND cardinality(_keep_videos) = 0 THEN
    RAISE NOTICE 'prelaunch reset: no keep data (no dotted National Coordinator, no imported events, no highlight videos): not the production database, nothing changed';
    RETURN;
  END IF;

  -- Guard 2: exactly the expected keep set, or abort.
  IF _n_nc <> 1 OR cardinality(_keep_events) <> 15 OR cardinality(_keep_videos) <> 6 THEN
    RAISE EXCEPTION 'prelaunch reset aborted: expected 1 dotted National Coordinator, 15 imported events, 6 highlight videos; found %, %, %',
      _n_nc, cardinality(_keep_events), cardinality(_keep_videos);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = _nc AND p.status = 'active' AND p.deleted_at IS NULL) THEN
    RAISE EXCEPTION 'prelaunch reset aborted: the kept National Coordinator is not active (or is deleted)';
  END IF;
  SELECT count(*) INTO _n_mfa FROM auth.mfa_factors f WHERE f.user_id = _nc;
  IF _n_mfa < 1 THEN
    RAISE EXCEPTION 'prelaunch reset aborted: the kept National Coordinator has no MFA factor';
  END IF;
  IF EXISTS (SELECT 1 FROM public.events e WHERE e.id = ANY (_keep_events) AND (e.series_id IS NOT NULL OR e.series_template OR e.category = 'meeting'))
     OR EXISTS (SELECT 1 FROM public.event_series s WHERE s.media_event_id = ANY (_keep_events))
     OR EXISTS (SELECT 1 FROM public.event_deletion_jobs j WHERE j.event_id = ANY (_keep_events)) THEN
    RAISE EXCEPTION 'prelaunch reset aborted: a kept event is in a series, holds a series'' media, is a meeting or has a deletion job';
  END IF;
  SELECT count(*) INTO _n_media FROM public.event_media m WHERE m.event_id = ANY (_keep_events);

  -- 1-3 Email and notifications.
  DELETE FROM public.email_outbox; GET DIAGNOSTICS _n = ROW_COUNT; _log := _log || ' email_outbox=' || _n;
  DELETE FROM public.notification_digest_log; GET DIAGNOSTICS _n = ROW_COUNT; _log := _log || ' notification_digest_log=' || _n;
  DELETE FROM public.notifications; GET DIAGNOSTICS _n = ROW_COUNT; _log := _log || ' notifications=' || _n;
  -- 4-7 Tasks.
  DELETE FROM public.task_reminder_log; GET DIAGNOSTICS _n = ROW_COUNT; _log := _log || ' task_reminder_log=' || _n;
  DELETE FROM public.task_notes; GET DIAGNOSTICS _n = ROW_COUNT; _log := _log || ' task_notes=' || _n;
  DELETE FROM public.task_assignees; GET DIAGNOSTICS _n = ROW_COUNT; _log := _log || ' task_assignees=' || _n;
  DELETE FROM public.task_requests; GET DIAGNOSTICS _n = ROW_COUNT; _log := _log || ' task_requests=' || _n;
  DELETE FROM public.tasks; GET DIAGNOSTICS _n = ROW_COUNT; _log := _log || ' tasks=' || _n;
  DELETE FROM public.task_groups; GET DIAGNOSTICS _n = ROW_COUNT; _log := _log || ' task_groups=' || _n;
  -- 8-11 Meetings.
  DELETE FROM public.meeting_requests; GET DIAGNOSTICS _n = ROW_COUNT; _log := _log || ' meeting_requests=' || _n;
  DELETE FROM public.meeting_decisions; GET DIAGNOSTICS _n = ROW_COUNT; _log := _log || ' meeting_decisions=' || _n;
  DELETE FROM public.meeting_agenda_items; GET DIAGNOSTICS _n = ROW_COUNT; _log := _log || ' meeting_agenda_items=' || _n;
  DELETE FROM public.meeting_files; GET DIAGNOSTICS _n = ROW_COUNT; _log := _log || ' meeting_files=' || _n;
  DELETE FROM public.meeting_invitees; GET DIAGNOSTICS _n = ROW_COUNT; _log := _log || ' meeting_invitees=' || _n;
  DELETE FROM public.meetings; GET DIAGNOSTICS _n = ROW_COUNT; _log := _log || ' meetings=' || _n;
  DELETE FROM public.meeting_series; GET DIAGNOSTICS _n = ROW_COUNT; _log := _log || ' meeting_series=' || _n;
  -- 12 Event requests.
  DELETE FROM public.event_request_media; GET DIAGNOSTICS _n = ROW_COUNT; _log := _log || ' event_request_media=' || _n;
  DELETE FROM public.event_requests; GET DIAGNOSTICS _n = ROW_COUNT; _log := _log || ' event_requests=' || _n;
  -- 13 Event children and logs (also those of kept events: registrations, guests, audit rows are test data).
  DELETE FROM public.event_announcements; GET DIAGNOSTICS _n = ROW_COUNT; _log := _log || ' event_announcements=' || _n;
  DELETE FROM public.event_guests; GET DIAGNOSTICS _n = ROW_COUNT; _log := _log || ' event_guests=' || _n;
  DELETE FROM public.event_registrations; GET DIAGNOSTICS _n = ROW_COUNT; _log := _log || ' event_registrations=' || _n;
  DELETE FROM public.event_audit_log; GET DIAGNOSTICS _n = ROW_COUNT; _log := _log || ' event_audit_log=' || _n;
  DELETE FROM public.event_cleanup_audit; GET DIAGNOSTICS _n = ROW_COUNT; _log := _log || ' event_cleanup_audit=' || _n;
  DELETE FROM public.event_deletion_jobs; GET DIAGNOSTICS _n = ROW_COUNT; _log := _log || ' event_deletion_jobs=' || _n;
  -- 14-16 Videos, media, events, series (kept rows stay).
  DELETE FROM public.event_videos WHERE NOT (id = ANY (_keep_videos)); GET DIAGNOSTICS _n = ROW_COUNT; _log := _log || ' event_videos=' || _n;
  DELETE FROM public.event_media WHERE NOT (event_id = ANY (_keep_events)); GET DIAGNOSTICS _n = ROW_COUNT; _log := _log || ' event_media=' || _n;
  DELETE FROM public.events WHERE NOT (id = ANY (_keep_events)); GET DIAGNOSTICS _n = ROW_COUNT; _log := _log || ' events=' || _n;
  DELETE FROM public.event_series; GET DIAGNOSTICS _n = ROW_COUNT; _log := _log || ' event_series=' || _n;
  -- 17 Public-side records.
  DELETE FROM public.subscribers; GET DIAGNOSTICS _n = ROW_COUNT; _log := _log || ' subscribers=' || _n;
  DELETE FROM public.public_rate_limits; GET DIAGNOSTICS _n = ROW_COUNT; _log := _log || ' public_rate_limits=' || _n;
  -- 18 Applications, account requests and audit history.
  DELETE FROM public.volunteer_applications; GET DIAGNOSTICS _n = ROW_COUNT; _log := _log || ' volunteer_applications=' || _n;
  DELETE FROM public.account_deletion_requests; GET DIAGNOSTICS _n = ROW_COUNT; _log := _log || ' account_deletion_requests=' || _n;
  DELETE FROM public.user_deletion_state; GET DIAGNOSTICS _n = ROW_COUNT; _log := _log || ' user_deletion_state=' || _n;
  DELETE FROM public.user_audit_log; GET DIAGNOSTICS _n = ROW_COUNT; _log := _log || ' user_audit_log=' || _n;
  DELETE FROM public.recycle_bin_audit_log; GET DIAGNOSTICS _n = ROW_COUNT; _log := _log || ' recycle_bin_audit_log=' || _n;
  -- 19 Per-account settings of other accounts (the NC's own stay).
  DELETE FROM public.privacy_notice_acceptances WHERE user_id IS DISTINCT FROM _nc; GET DIAGNOSTICS _n = ROW_COUNT; _log := _log || ' privacy_notice_acceptances=' || _n;
  DELETE FROM public.consent_preferences WHERE user_id <> _nc; GET DIAGNOSTICS _n = ROW_COUNT; _log := _log || ' consent_preferences=' || _n;
  DELETE FROM public.notification_preferences WHERE user_id <> _nc; GET DIAGNOSTICS _n = ROW_COUNT; _log := _log || ' notification_preferences=' || _n;
  DELETE FROM public.user_followed_branches WHERE user_id <> _nc; GET DIAGNOSTICS _n = ROW_COUNT; _log := _log || ' user_followed_branches=' || _n;

  -- 20 Kept rows that reference another account -> the NC (only rows that differ, so a second run updates nothing).
  UPDATE public.events SET created_by = _nc,
      deleted_by = CASE WHEN deleted_by IS DISTINCT FROM _nc THEN NULL ELSE deleted_by END
    WHERE id = ANY (_keep_events) AND (created_by IS DISTINCT FROM _nc OR (deleted_by IS NOT NULL AND deleted_by <> _nc));
  GET DIAGNOSTICS _n = ROW_COUNT; _log := _log || ' | reassigned events=' || _n;
  UPDATE public.event_media SET uploaded_by = _nc WHERE event_id = ANY (_keep_events) AND uploaded_by <> _nc;
  GET DIAGNOSTICS _n = ROW_COUNT; _log := _log || ' event_media=' || _n;
  UPDATE public.event_videos SET created_by = _nc WHERE id = ANY (_keep_videos) AND created_by <> _nc;
  GET DIAGNOSTICS _n = ROW_COUNT; _log := _log || ' event_videos=' || _n;
  UPDATE public.profiles SET deleted_by = NULL WHERE id = _nc AND deleted_by <> _nc;
  UPDATE public.branches SET deleted_by = _nc WHERE deleted_by <> _nc;
  UPDATE public.regions SET deleted_by = _nc WHERE deleted_by <> _nc;

  -- 21-22 Accounts. auth.refresh_tokens.user_id is text; flow_state and audit_log_entries have no FK to auth.users.
  DELETE FROM auth.refresh_tokens WHERE user_id IS DISTINCT FROM _nc::text; GET DIAGNOSTICS _n = ROW_COUNT; _log := _log || ' | auth.refresh_tokens=' || _n;
  DELETE FROM auth.flow_state WHERE user_id IS DISTINCT FROM _nc; GET DIAGNOSTICS _n = ROW_COUNT; _log := _log || ' auth.flow_state=' || _n;
  DELETE FROM auth.audit_log_entries WHERE (payload ->> 'actor_id') IS DISTINCT FROM _nc::text; GET DIAGNOSTICS _n = ROW_COUNT; _log := _log || ' auth.audit_log_entries=' || _n;
  DELETE FROM auth.users WHERE id <> _nc; GET DIAGNOSTICS _n = ROW_COUNT; _log := _log || ' auth.users=' || _n;

  RAISE NOTICE 'prelaunch reset: deleted%', _log;

  -- Verification (any mismatch rolls the whole reset back).
  IF (SELECT count(*) FROM auth.users) <> 1 OR NOT EXISTS (SELECT 1 FROM auth.users WHERE id = _nc) THEN
    RAISE EXCEPTION 'prelaunch reset verification: auth.users is not exactly the kept NC';
  END IF;
  IF (SELECT count(*) FROM public.profiles) <> 1
     OR NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = _nc AND status = 'active' AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'prelaunch reset verification: profiles is not exactly the active kept NC';
  END IF;
  IF (SELECT count(*) FROM public.user_roles) <> 1
     OR NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _nc AND role = 'national_coordinator') THEN
    RAISE EXCEPTION 'prelaunch reset verification: user_roles is not exactly the NC role';
  END IF;
  IF (SELECT count(*) FROM auth.mfa_factors) <> _n_mfa OR (SELECT count(*) FROM auth.mfa_factors WHERE user_id = _nc) <> _n_mfa THEN
    RAISE EXCEPTION 'prelaunch reset verification: MFA factors changed';
  END IF;
  IF EXISTS (SELECT 1 FROM auth.identities WHERE user_id <> _nc) OR EXISTS (SELECT 1 FROM auth.sessions WHERE user_id <> _nc)
     OR EXISTS (SELECT 1 FROM auth.one_time_tokens WHERE user_id <> _nc)
     OR EXISTS (SELECT 1 FROM auth.refresh_tokens WHERE user_id IS DISTINCT FROM _nc::text)
     OR EXISTS (SELECT 1 FROM auth.flow_state WHERE user_id IS DISTINCT FROM _nc) THEN
    RAISE EXCEPTION 'prelaunch reset verification: auth rows of other accounts remain';
  END IF;
  IF (SELECT count(*) FROM public.events) <> 15
     OR (SELECT count(*) FROM public.events e WHERE e.id = ANY (_keep_events) AND e.past_record AND e.deleted_at IS NULL AND e.created_by = _nc
           AND EXISTS (SELECT 1 FROM public.event_media m WHERE m.event_id = e.id AND m.source_url LIKE 'https://www.dialoguesociety.org/%')) <> 15 THEN
    RAISE EXCEPTION 'prelaunch reset verification: kept events are not the 15 imported events owned by the NC';
  END IF;
  IF (SELECT count(*) FROM public.event_media) <> _n_media
     OR (SELECT count(*) FROM public.event_media WHERE event_id = ANY (_keep_events)) <> _n_media THEN
    RAISE EXCEPTION 'prelaunch reset verification: kept media rows changed';
  END IF;
  IF (SELECT count(*) FROM public.event_videos) <> 6
     OR (SELECT count(*) FROM public.event_videos v WHERE v.id = ANY (_keep_videos)
           AND ((v.event_id IS NULL AND v.created_by IS NULL) OR v.event_id = ANY (_keep_events))) <> 6 THEN
    RAISE EXCEPTION 'prelaunch reset verification: kept videos are not the 6 highlight videos';
  END IF;
  IF EXISTS (SELECT 1 FROM public.user_followed_branches WHERE user_id <> _nc)
     OR EXISTS (SELECT 1 FROM public.consent_preferences WHERE user_id <> _nc)
     OR EXISTS (SELECT 1 FROM public.notification_preferences WHERE user_id <> _nc)
     OR EXISTS (SELECT 1 FROM public.privacy_notice_acceptances WHERE user_id IS DISTINCT FROM _nc) THEN
    RAISE EXCEPTION 'prelaunch reset verification: settings rows of other accounts remain';
  END IF;
  -- Every other public table must be empty (reference tables and the kept tables checked above excepted).
  FOR _t IN
    SELECT c.relname FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace s ON s.oid = c.relnamespace
    WHERE s.nspname = 'public' AND c.relkind IN ('r', 'p') AND NOT c.relispartition
      AND c.relname NOT IN ('regions', 'branches', 'postcode_geocodes',
        'profiles', 'user_roles', 'user_followed_branches', 'consent_preferences', 'notification_preferences',
        'privacy_notice_acceptances', 'events', 'event_media', 'event_videos')
    ORDER BY c.relname
  LOOP
    EXECUTE format('SELECT count(*) FROM public.%I', _t) INTO _n;
    IF _n <> 0 THEN
      RAISE EXCEPTION 'prelaunch reset verification: public.% still has % rows', _t, _n;
    END IF;
  END LOOP;

  RAISE NOTICE 'prelaunch reset: verified (1 NC with % MFA factor(s), 15 events, % media rows, 6 videos)', _n_mfa, _n_media;
END $$;

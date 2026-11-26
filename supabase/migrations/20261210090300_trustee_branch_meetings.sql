-- Trustees see every meeting of their own branch (approved by the user, 2026-11-26), read only.
--
-- * Before: a trustee saw a meeting like a volunteer: only when they created it or were invited.
-- * After: a trustee also sees every branch-scope meeting of their own branch: the meeting and its calendar entry,
--   agenda items, decisions, files (rows and the meeting-files Storage objects) and invitees, in lists, the dashboard
--   card, series tasks and task sources. Every one of these reads goes through can_view_meeting (RLS policies of
--   meetings, meeting_agenda_items, meeting_decisions, meeting_files, meeting_invitees; can_read_meeting_file;
--   can_view_event for the calendar entry; get_meeting, list_meetings, get_meeting_series_tasks, get_task,
--   list_task_sources), so only that function changes.
-- * Region and national meetings: unchanged (as for volunteers: created or invited only).
-- * Volunteers: unchanged (created or invited only).
-- * Writes: unchanged. can_edit_meeting / meeting_editable refuse trustees (20261210090100), so they cannot edit,
--   cancel, delete, change invitees, agenda, decisions or files, or carry items over (list_meeting_carry_over and
--   carry_over_agenda need an editable meeting).
-- Additive: can_view_meeting is replaced with the same signature and grants; no table, policy or data change.
CREATE OR REPLACE FUNCTION public.can_view_meeting(_meeting uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.is_active_person(auth.uid()) AND public.session_ok() AND NOT public.is_follower(auth.uid())
    AND EXISTS (SELECT 1 FROM public.meetings m WHERE m.id = _meeting AND m.deleted_at IS NULL AND (
      m.created_by = auth.uid()
      OR EXISTS (SELECT 1 FROM public.meeting_invitees i WHERE i.meeting_id = m.id AND i.user_id = auth.uid())
      OR public.can_manage_event_scope(m.scope, m.branch_id, m.region_id)
      -- A trustee: every meeting of their own branch, read only.
      OR (m.scope = 'branch' AND public.is_trustee(auth.uid()) AND public.is_branch_member(auth.uid(), m.branch_id))))
$$;

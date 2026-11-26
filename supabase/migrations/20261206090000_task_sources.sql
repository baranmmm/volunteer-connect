-- The Tasks page groups tasks by where they come from: a meeting agenda item (through the task's decision), a meeting,
-- or an event. list_tasks returns only the ids; this read returns the labels for the caller's visible tasks and task
-- groups, each only when the caller may see that meeting or event (otherwise the task shows under "Other tasks").
-- Additive: one new read function, no table, policy or data change.
CREATE FUNCTION public.list_task_sources() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH visible AS (
    SELECT t.decision_id, t.meeting_id, t.event_id FROM public.tasks t
    WHERE t.deleted_at IS NULL AND public.has_accepted_privacy_notice() AND public.can_view_task(t.id)
  ), ids AS (
    SELECT DISTINCT decision_id, meeting_id, event_id FROM visible
  )
  SELECT jsonb_build_object(
    'decisions', coalesce((
      SELECT jsonb_agg(jsonb_build_object('id', d.id, 'agenda_item_id', a.id, 'agenda_item', a.title,
               'meeting_id', m.id, 'meeting', m.title, 'starts_at', m.starts_at) ORDER BY m.starts_at, a.position, d.id)
      FROM public.meeting_decisions d
      JOIN public.meeting_agenda_items a ON a.id = d.agenda_item_id
      JOIN public.meetings m ON m.id = d.meeting_id
      WHERE d.id IN (SELECT decision_id FROM ids WHERE decision_id IS NOT NULL) AND public.can_view_meeting(m.id)), '[]'::jsonb),
    'meetings', coalesce((
      SELECT jsonb_agg(jsonb_build_object('id', m.id, 'title', m.title, 'starts_at', m.starts_at) ORDER BY m.starts_at, m.id)
      FROM public.meetings m
      WHERE m.id IN (SELECT meeting_id FROM ids WHERE meeting_id IS NOT NULL) AND public.can_view_meeting(m.id)), '[]'::jsonb),
    'events', coalesce((
      SELECT jsonb_agg(jsonb_build_object('id', e.id, 'title', e.title,
               'start', CASE WHEN e.all_day THEN e.start_date::text ELSE e.start_at::text END) ORDER BY e.id)
      FROM public.events e
      WHERE e.id IN (SELECT event_id FROM ids WHERE event_id IS NOT NULL) AND public.can_view_event(e.id)), '[]'::jsonb))
$$;

REVOKE EXECUTE ON FUNCTION public.list_task_sources() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_task_sources() TO authenticated;

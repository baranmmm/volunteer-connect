-- A2b fix: attendee names are opt-out. New registrations show the name unless the volunteer hides it.
-- Erased rows (user_id NULL) keep show_name = false (event_registrations_anonymised CHECK).
ALTER TABLE public.event_registrations ALTER COLUMN show_name SET DEFAULT true;
UPDATE public.event_registrations SET show_name = true WHERE user_id IS NOT NULL AND NOT show_name;

-- Same signature (only the parameter default changes), so no new overload is created.
-- Registering again after a cancellation keeps a name that was hidden before; p_show_name = false hides it.
CREATE OR REPLACE FUNCTION public.register_for_event(p_event_id uuid, p_show_name boolean DEFAULT true) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid uuid := auth.uid(); _e public.events; _r public.event_registrations; _existing boolean; _status text;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not signed in'; END IF;
  PERFORM id FROM public.profiles WHERE id = _uid FOR UPDATE;
  SELECT * INTO _e FROM public.events WHERE id = p_event_id FOR UPDATE;
  IF NOT FOUND OR _e.series_template OR NOT public.can_view_event(p_event_id) THEN RAISE EXCEPTION 'Not allowed'; END IF;
  SELECT * INTO _r FROM public.event_registrations WHERE event_id = p_event_id AND user_id = _uid FOR UPDATE;
  _existing := FOUND;
  IF _existing AND _r.status <> 'cancelled' THEN RETURN public.registration_result(_r); END IF;  -- idempotent
  IF _e.status <> 'published' OR NOT _e.registration_enabled
     OR EXISTS (SELECT 1 FROM public.event_deletion_jobs WHERE event_id = p_event_id) THEN RAISE EXCEPTION 'Registration is closed'; END IF;
  IF coalesce(public.event_ends(_e) <= now(), true) THEN RAISE EXCEPTION 'Event has ended'; END IF;
  _status := CASE WHEN _e.capacity IS NULL OR (SELECT seats FROM public.registration_counts(p_event_id)) < _e.capacity
             THEN 'registered' ELSE 'waitlisted' END;
  IF _existing THEN
    UPDATE public.event_registrations SET status = _status, registered_at = clock_timestamp(), cancelled_at = NULL,
      show_name = _r.show_name AND coalesce(p_show_name, true), notice = NULL, notice_seen_at = NULL,
      attendance_marked_by = NULL, attendance_marked_at = NULL
    WHERE id = _r.id RETURNING * INTO _r;
  ELSE
    INSERT INTO public.event_registrations (event_id, user_id, status, show_name)
    VALUES (p_event_id, _uid, _status, coalesce(p_show_name, true)) RETURNING * INTO _r;
  END IF;
  RETURN public.registration_result(_r);
END $$;

REVOKE ALL ON FUNCTION public.register_for_event(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.register_for_event(uuid, boolean) TO authenticated;

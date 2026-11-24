-- Calendar SEQUENCE per attendee: SEQUENCE = events.ics_sequence + event_registrations.ics_offset.
-- The offset goes up when the person cancels and again when they register again, so the cancellation and a later
-- new invitation (same UID) always come after everything the person received before; event changes keep raising
-- events.ics_sequence for everyone. email_event_context returns the offset.
ALTER TABLE public.event_registrations ADD COLUMN ics_offset integer NOT NULL DEFAULT 0 CHECK (ics_offset >= 0);

CREATE FUNCTION public.event_registrations_ics_offset() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.ics_offset := OLD.ics_offset;
  IF (OLD.status IN ('registered', 'waitlisted') AND NEW.status = 'cancelled')
     OR (OLD.status = 'cancelled' AND NEW.status IN ('pending', 'registered', 'waitlisted')) THEN
    NEW.ics_offset := OLD.ics_offset + 1;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER event_registrations_ics_offset BEFORE UPDATE OF status ON public.event_registrations
  FOR EACH ROW EXECUTE FUNCTION public.event_registrations_ics_offset();
REVOKE ALL ON FUNCTION public.event_registrations_ics_offset() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.email_event_context(p_registration uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object('registration', jsonb_build_object('id', r.id, 'status', r.status, 'places', r.places, 'guest', r.guest,
      'waitlist_position', public.registration_position(r), 'ics_offset', r.ics_offset),
    'event', to_jsonb(e) - 'created_by' - 'deleted_by', 'branch', b.name, 'region', rg.name)
  FROM public.event_registrations r JOIN public.events e ON e.id = r.event_id
  LEFT JOIN public.branches b ON b.id = e.branch_id LEFT JOIN public.regions rg ON rg.id = e.region_id
  WHERE r.id = p_registration
$$;

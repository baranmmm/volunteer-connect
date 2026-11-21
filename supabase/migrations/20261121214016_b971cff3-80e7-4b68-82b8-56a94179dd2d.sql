CREATE INDEX event_deletion_jobs_requested_by ON public.event_deletion_jobs(requested_by);
CREATE INDEX event_audit_log_actor_id ON public.event_audit_log(actor_id);
CREATE OR REPLACE FUNCTION public.delete_event(_event uuid, _finalize boolean DEFAULT false) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE _e public.events; _state jsonb; _paths jsonb;
BEGIN
 PERFORM id FROM public.profiles WHERE id=auth.uid() FOR UPDATE;
 SELECT * INTO _e FROM public.events WHERE id=_event FOR UPDATE;
 IF NOT FOUND OR NOT public.can_manage_event_scope(_e.scope,_e.branch_id,_e.region_id) THEN RAISE EXCEPTION 'Not allowed'; END IF;
 _state:=public.get_event_deletion_state(_event);
 IF NOT (_state->>'canDelete')::boolean THEN RAISE EXCEPTION 'Event cannot be deleted'; END IF;
 IF _finalize AND NOT EXISTS(SELECT 1 FROM public.event_deletion_jobs WHERE event_id=_event) THEN RAISE EXCEPTION 'Event deletion not prepared'; END IF;
 INSERT INTO public.event_deletion_jobs(event_id,requested_by) VALUES(_event,auth.uid()) ON CONFLICT(event_id) DO NOTHING;
 SELECT coalesce(jsonb_agg(path ORDER BY path),'[]'::jsonb) INTO _paths FROM (SELECT storage_path AS path FROM public.event_media WHERE event_id=_event UNION SELECT name FROM storage.objects WHERE bucket_id='event-media' AND name LIKE _event::text||'/%') files;
 IF NOT _finalize THEN RETURN jsonb_build_object('paths',_paths,'deleted',false); END IF;
 IF EXISTS(SELECT 1 FROM storage.objects WHERE bucket_id='event-media' AND name LIKE _event::text||'/%') THEN RAISE EXCEPTION 'Event files still exist'; END IF;
 INSERT INTO public.event_audit_log(actor_id,event_id,scope,branch_id,region_id) VALUES(auth.uid(),_event,_e.scope,_e.branch_id,_e.region_id);
 DELETE FROM public.event_media WHERE event_id=_event;
 DELETE FROM public.events WHERE id=_event;
 RETURN jsonb_build_object('paths','[]'::jsonb,'deleted',true);
END $$;
COMMENT ON FUNCTION public.delete_event(uuid,boolean) IS 'Authenticated execution is intentional: active scope management and eligibility are checked inside this SECURITY DEFINER function. Preparation freezes changes; finalization requires Storage API cleanup.';
COMMENT ON FUNCTION public.get_event_deletion_state(uuid) IS 'Authenticated execution is intentional: returns deletion eligibility only after active scope-management authorization.';
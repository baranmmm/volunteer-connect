CREATE TABLE public.event_deletion_jobs (event_id uuid PRIMARY KEY REFERENCES public.events(id) ON DELETE CASCADE, requested_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL, created_at timestamptz NOT NULL DEFAULT now());
GRANT SELECT ON public.event_deletion_jobs TO authenticated;
GRANT ALL ON public.event_deletion_jobs TO service_role;
ALTER TABLE public.event_deletion_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY event_deletion_jobs_read ON public.event_deletion_jobs FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.events e WHERE e.id=event_id AND public.can_manage_event_scope(e.scope,e.branch_id,e.region_id)));
CREATE TABLE public.event_audit_log (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), actor_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL, event_id uuid NOT NULL, action text NOT NULL DEFAULT 'event_deleted', scope text NOT NULL, branch_id uuid, region_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
GRANT SELECT ON public.event_audit_log TO authenticated;
GRANT ALL ON public.event_audit_log TO service_role;
ALTER TABLE public.event_audit_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY event_audit_log_read ON public.event_audit_log FOR SELECT TO authenticated USING (public.can_manage_event_scope(scope,branch_id,region_id));
CREATE INDEX event_audit_log_event_time ON public.event_audit_log(event_id,created_at);
-- A2b integration seam: count all registrations conservatively, regardless of status.
CREATE FUNCTION public.event_has_registrations(_event uuid) RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE _exists boolean;
BEGIN
 IF to_regclass('public.event_registrations') IS NULL THEN RETURN false; END IF;
 EXECUTE 'SELECT EXISTS(SELECT 1 FROM public.event_registrations WHERE event_id=$1)' INTO _exists USING _event;
 RETURN _exists;
END $$;
REVOKE ALL ON FUNCTION public.event_has_registrations(uuid) FROM PUBLIC,anon,authenticated;
CREATE FUNCTION public.get_event_deletion_state(_event uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE _e public.events; _reason text; _pending boolean;
BEGIN
 SELECT * INTO _e FROM public.events WHERE id=_event;
 IF NOT FOUND OR NOT public.can_manage_event_scope(_e.scope,_e.branch_id,_e.region_id) THEN RETURN jsonb_build_object('canManage',false,'canDelete',false,'pending',false,'reason',NULL); END IF;
 SELECT EXISTS(SELECT 1 FROM public.event_deletion_jobs WHERE event_id=_event) INTO _pending;
 IF _e.status='draft' THEN _reason:=NULL;
 ELSIF _e.status<>'published' THEN _reason:='status';
 ELSIF _e.start_at<=now() THEN _reason:='started';
 ELSIF public.event_has_registrations(_event) THEN _reason:='registrations';
 END IF;
 RETURN jsonb_build_object('canManage',true,'canDelete',_reason IS NULL,'pending',_pending,'reason',_reason);
END $$;
REVOKE ALL ON FUNCTION public.get_event_deletion_state(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_event_deletion_state(uuid) TO authenticated;
-- Pending jobs freeze all existing management RPCs and reserved-path uploads.
CREATE OR REPLACE FUNCTION public.can_manage_event(_event uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT NOT EXISTS(SELECT 1 FROM public.event_deletion_jobs WHERE event_id=_event) AND EXISTS(SELECT 1 FROM public.events e WHERE e.id=_event AND public.can_manage_event_scope(e.scope,e.branch_id,e.region_id))
$$;
CREATE FUNCTION public.delete_event(_event uuid, _finalize boolean DEFAULT false) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE _e public.events; _state jsonb; _paths jsonb;
BEGIN
 PERFORM id FROM public.profiles WHERE id=auth.uid() FOR UPDATE;
 SELECT * INTO _e FROM public.events WHERE id=_event FOR UPDATE;
 IF NOT FOUND OR NOT public.can_manage_event_scope(_e.scope,_e.branch_id,_e.region_id) THEN RAISE EXCEPTION 'Not allowed'; END IF;
 _state:=public.get_event_deletion_state(_event);
 IF NOT (_state->>'canDelete')::boolean THEN RAISE EXCEPTION 'Event cannot be deleted'; END IF;
 IF _finalize AND NOT EXISTS(SELECT 1 FROM public.event_deletion_jobs WHERE event_id=_event) THEN RAISE EXCEPTION 'Event deletion not prepared'; END IF;
 INSERT INTO public.event_deletion_jobs(event_id,requested_by) VALUES(_event,auth.uid()) ON CONFLICT(event_id) DO NOTHING;
 SELECT coalesce(jsonb_agg(storage_path ORDER BY position,id),'[]'::jsonb) INTO _paths FROM public.event_media WHERE event_id=_event;
 IF NOT _finalize THEN RETURN jsonb_build_object('paths',_paths,'deleted',false); END IF;
 IF EXISTS(SELECT 1 FROM storage.objects WHERE bucket_id='event-media' AND name LIKE _event::text||'/%') THEN RAISE EXCEPTION 'Event files still exist'; END IF;
 INSERT INTO public.event_audit_log(actor_id,event_id,scope,branch_id,region_id) VALUES(auth.uid(),_event,_e.scope,_e.branch_id,_e.region_id);
 DELETE FROM public.event_media WHERE event_id=_event;
 DELETE FROM public.events WHERE id=_event;
 RETURN jsonb_build_object('paths','[]'::jsonb,'deleted',true);
END $$;
REVOKE ALL ON FUNCTION public.delete_event(uuid,boolean) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.delete_event(uuid,boolean) TO authenticated;
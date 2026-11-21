CREATE TABLE public.event_cleanup_audit(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),started_at timestamptz NOT NULL DEFAULT now(),finished_at timestamptz,events_purged integer NOT NULL DEFAULT 0,files_purged integer NOT NULL DEFAULT 0,outcome text NOT NULL DEFAULT 'running');
GRANT ALL ON public.event_cleanup_audit TO service_role;
ALTER TABLE public.event_cleanup_audit ENABLE ROW LEVEL SECURITY;
CREATE OR REPLACE FUNCTION public.purge_event(_event uuid,_finalize boolean DEFAULT false) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$ DECLARE _e public.events; _paths jsonb; BEGIN
 SELECT * INTO _e FROM events WHERE id=_event FOR UPDATE;
 IF NOT FOUND OR _e.deleted_at IS NULL OR _e.deleted_at>=now()-interval '30 days' OR EXISTS(SELECT 1 FROM event_deletion_jobs WHERE event_id=_event AND operation NOT IN ('purge','archive')) THEN RAISE EXCEPTION 'Event cannot be purged'; END IF;
 INSERT INTO event_deletion_jobs(event_id,operation) VALUES(_event,'purge') ON CONFLICT(event_id) DO UPDATE SET operation='purge';
 SELECT coalesce(jsonb_agg(name ORDER BY name),'[]'::jsonb) INTO _paths FROM storage.objects WHERE bucket_id='event-media' AND (name LIKE _event::text||'/%' OR name LIKE 'deleted/'||_event::text||'/%');
 IF NOT _finalize THEN RETURN jsonb_build_object('paths',_paths,'deleted',false); END IF;
 IF jsonb_array_length(_paths)>0 THEN RAISE EXCEPTION 'Event files still exist'; END IF;
 INSERT INTO event_audit_log(actor_id,event_id,action,scope,branch_id,region_id) VALUES(NULL,_event,'event_purged',_e.scope,_e.branch_id,_e.region_id);
 DELETE FROM event_media WHERE event_id=_event;
 DELETE FROM events WHERE id=_event;
 RETURN jsonb_build_object('paths','[]'::jsonb,'deleted',true);
END $$;
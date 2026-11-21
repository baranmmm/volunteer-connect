ALTER TABLE public.events ADD COLUMN deleted_at timestamptz, ADD COLUMN deleted_by uuid;
ALTER TABLE public.event_deletion_jobs ADD COLUMN operation text NOT NULL DEFAULT 'legacy';
CREATE INDEX events_deleted_at_idx ON public.events(deleted_at) WHERE deleted_at IS NOT NULL;
CREATE OR REPLACE FUNCTION public.can_manage_event(_event uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$ SELECT NOT EXISTS(SELECT 1 FROM public.event_deletion_jobs WHERE event_id=_event) AND EXISTS(SELECT 1 FROM public.events e WHERE e.id=_event AND e.deleted_at IS NULL AND public.can_manage_event_scope(e.scope,e.branch_id,e.region_id)) $$;
CREATE OR REPLACE FUNCTION public.can_view_event(_event uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$ SELECT EXISTS(SELECT 1 FROM public.profiles WHERE id=auth.uid() AND status='active') AND EXISTS(SELECT 1 FROM public.events e WHERE e.id=_event AND e.deleted_at IS NULL AND (EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=auth.uid() AND role='regional_director' AND region_id=e.region_id) OR (e.scope='branch' AND e.branch_id=public.get_user_branch(auth.uid()) AND (e.status IN ('published','cancelled') OR public.has_role(auth.uid(),'branch_manager'))) OR (e.scope='region' AND e.status IN ('published','cancelled') AND EXISTS(SELECT 1 FROM public.profiles p JOIN public.branches b ON b.id=p.branch_id WHERE p.id=auth.uid() AND b.region_id=e.region_id)))) $$;
DROP POLICY events_read ON public.events;
CREATE POLICY events_read ON public.events FOR SELECT TO authenticated USING(deleted_at IS NULL AND public.can_view_event(id));
DROP POLICY event_media_read ON public.event_media;
CREATE POLICY event_media_read ON public.event_media FOR SELECT TO authenticated USING(public.can_view_event(event_id));
CREATE OR REPLACE FUNCTION public.get_event_deletion_state(_event uuid) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$ SELECT jsonb_build_object('canManage',public.can_manage_event(_event),'canDelete',public.can_manage_event(_event),'pending',false,'reason',NULL) $$;
DROP FUNCTION public.delete_event(uuid,boolean);
CREATE FUNCTION public.delete_event(_event uuid,_title text DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$ DECLARE _e public.events; _paths jsonb; BEGIN
 PERFORM id FROM profiles WHERE id=auth.uid() FOR UPDATE;
 SELECT * INTO _e FROM events WHERE id=_event FOR UPDATE;
 IF NOT FOUND OR NOT public.can_manage_event_scope(_e.scope,_e.branch_id,_e.region_id) OR EXISTS(SELECT 1 FROM event_deletion_jobs WHERE event_id=_event AND operation IN ('restore','purge')) THEN RAISE EXCEPTION 'Not allowed'; END IF;
 IF _e.deleted_at IS NULL THEN
  IF NOT public.can_manage_event(_event) THEN RAISE EXCEPTION 'Not allowed'; END IF;
  IF (_e.status<>'draft' OR _e.start_at<=now()) AND _title IS DISTINCT FROM _e.title THEN RAISE EXCEPTION 'Event title confirmation required'; END IF;
  UPDATE events SET deleted_at=now(),deleted_by=auth.uid() WHERE id=_event;
  INSERT INTO event_audit_log(actor_id,event_id,action,scope,branch_id,region_id) VALUES(auth.uid(),_event,'event_deleted',_e.scope,_e.branch_id,_e.region_id);
 END IF;
 SELECT coalesce(jsonb_agg(path ORDER BY path),'[]'::jsonb) INTO _paths FROM (SELECT storage_path AS path FROM event_media WHERE event_id=_event UNION SELECT name FROM storage.objects WHERE bucket_id='event-media' AND name LIKE _event::text||'/%') files;
 RETURN jsonb_build_object('paths',_paths,'deleted',true);
END $$;
CREATE FUNCTION public.can_restore_event(_event uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$ SELECT EXISTS(SELECT 1 FROM profiles WHERE id=auth.uid() AND status='active') AND EXISTS(SELECT 1 FROM events e JOIN user_roles r ON r.user_id=auth.uid() AND r.role='regional_director' AND r.region_id=e.region_id WHERE e.id=_event AND e.deleted_at IS NOT NULL AND e.deleted_at>now()-interval '30 days') AND NOT EXISTS(SELECT 1 FROM event_deletion_jobs WHERE event_id=_event AND operation IN ('purge','legacy')) $$;
CREATE FUNCTION public.list_deleted_events(_offset integer DEFAULT 0) RETURNS TABLE(id uuid,title text,status text,start_at timestamptz,deleted_at timestamptz,deleted_by uuid) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM profiles p JOIN user_roles r ON r.user_id=p.id WHERE p.id=auth.uid() AND p.status='active' AND r.role='regional_director') THEN RAISE EXCEPTION 'Not allowed'; END IF;
 RETURN QUERY SELECT e.id,e.title,e.status,e.start_at,e.deleted_at,e.deleted_by FROM events e WHERE public.can_restore_event(e.id) ORDER BY e.deleted_at DESC,e.id LIMIT 100 OFFSET greatest(_offset,0);
END $$;
CREATE FUNCTION public.restore_event(_event uuid,_finalize boolean DEFAULT false) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$ DECLARE _e public.events; _paths jsonb; BEGIN
 PERFORM id FROM profiles WHERE id=auth.uid() FOR UPDATE;
 SELECT * INTO _e FROM events WHERE id=_event FOR UPDATE;
 IF NOT FOUND OR NOT public.can_restore_event(_event) THEN RAISE EXCEPTION 'Event cannot be restored'; END IF;
 INSERT INTO event_deletion_jobs(event_id,requested_by,operation) VALUES(_event,auth.uid(),'restore') ON CONFLICT(event_id) DO NOTHING;
 IF NOT EXISTS(SELECT 1 FROM event_deletion_jobs WHERE event_id=_event AND operation='restore') THEN RAISE EXCEPTION 'Not allowed'; END IF;
 SELECT coalesce(jsonb_agg(storage_path ORDER BY storage_path),'[]'::jsonb) INTO _paths FROM event_media WHERE event_id=_event;
 IF NOT _finalize THEN RETURN jsonb_build_object('paths',_paths,'deleted',false); END IF;
 IF EXISTS(SELECT 1 FROM event_media m WHERE m.event_id=_event AND NOT EXISTS(SELECT 1 FROM storage.objects o WHERE o.bucket_id='event-media' AND o.name=m.storage_path)) THEN RAISE EXCEPTION 'Event restoration files missing'; END IF;
 UPDATE events SET deleted_at=NULL,deleted_by=NULL WHERE events.id=_event;
 INSERT INTO event_audit_log(actor_id,event_id,action,scope,branch_id,region_id) VALUES(auth.uid(),_event,'event_restored',_e.scope,_e.branch_id,_e.region_id);
 DELETE FROM event_deletion_jobs WHERE event_id=_event;
 RETURN jsonb_build_object('paths','[]'::jsonb,'deleted',false);
END $$;
CREATE FUNCTION public.purge_event(_event uuid,_finalize boolean DEFAULT false) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$ DECLARE _e public.events; _paths jsonb; BEGIN
 SELECT * INTO _e FROM events WHERE id=_event FOR UPDATE;
 IF NOT FOUND OR _e.deleted_at IS NULL OR _e.deleted_at>now()-interval '30 days' OR EXISTS(SELECT 1 FROM event_deletion_jobs WHERE event_id=_event AND operation<>'purge') THEN RAISE EXCEPTION 'Event cannot be purged'; END IF;
 INSERT INTO event_deletion_jobs(event_id,operation) VALUES(_event,'purge') ON CONFLICT(event_id) DO NOTHING;
 SELECT coalesce(jsonb_agg(name ORDER BY name),'[]'::jsonb) INTO _paths FROM storage.objects WHERE bucket_id='event-media' AND (name LIKE _event::text||'/%' OR name LIKE 'deleted/'||_event::text||'/%');
 IF NOT _finalize THEN RETURN jsonb_build_object('paths',_paths,'deleted',false); END IF;
 IF jsonb_array_length(_paths)>0 THEN RAISE EXCEPTION 'Event files still exist'; END IF;
 INSERT INTO event_audit_log(actor_id,event_id,action,scope,branch_id,region_id) VALUES(NULL,_event,'event_purged',_e.scope,_e.branch_id,_e.region_id);
 IF to_regclass('public.event_registrations') IS NOT NULL THEN EXECUTE 'DELETE FROM public.event_registrations WHERE event_id=$1' USING _event; END IF;
 DELETE FROM event_media WHERE event_id=_event;
 DELETE FROM events WHERE id=_event;
 RETURN jsonb_build_object('paths','[]'::jsonb,'deleted',true);
END $$;
REVOKE ALL ON FUNCTION public.delete_event(uuid,text),public.restore_event(uuid,boolean),public.can_restore_event(uuid),public.list_deleted_events(integer),public.purge_event(uuid,boolean) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.delete_event(uuid,text),public.restore_event(uuid,boolean),public.can_restore_event(uuid),public.list_deleted_events(integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.purge_event(uuid,boolean) TO service_role;
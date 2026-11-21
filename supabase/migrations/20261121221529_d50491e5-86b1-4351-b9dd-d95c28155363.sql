ALTER TABLE public.profiles ADD COLUMN deleted_at timestamptz, ADD COLUMN deleted_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL;
CREATE INDEX profiles_deleted_at_idx ON public.profiles(deleted_at) WHERE deleted_at IS NOT NULL;
CREATE INDEX profiles_deleted_by_idx ON public.profiles(deleted_by);
CREATE TABLE public.user_deletion_state (
 target_id uuid PRIMARY KEY, deletion_audit_id uuid NOT NULL REFERENCES public.user_audit_log(id) ON DELETE RESTRICT,
 previous_status public.profile_status NOT NULL, self_requested boolean NOT NULL,
 operation text NOT NULL CHECK(operation IN ('deleting','deleted','restore','purge')),
 operation_actor uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.user_deletion_state TO service_role;
ALTER TABLE public.user_deletion_state ENABLE ROW LEVEL SECURITY;
CREATE POLICY user_deletion_state_service_only ON public.user_deletion_state FOR ALL TO service_role USING(true) WITH CHECK(true);
CREATE INDEX user_deletion_state_actor_idx ON public.user_deletion_state(operation_actor);
CREATE TABLE public.recycle_bin_audit_log (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), actor_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
 item_type text NOT NULL CHECK(item_type IN ('event','user')), item_id uuid NOT NULL,
 action text NOT NULL CHECK(action IN ('delete','restore','permanent_delete','deletion_failed')),
 branch_id uuid, region_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.recycle_bin_audit_log TO authenticated;
GRANT ALL ON public.recycle_bin_audit_log TO service_role;
ALTER TABLE public.recycle_bin_audit_log ENABLE ROW LEVEL SECURITY;
CREATE INDEX recycle_bin_audit_actor_idx ON public.recycle_bin_audit_log(actor_id);
ALTER TABLE public.event_cleanup_audit ADD COLUMN users_purged integer NOT NULL DEFAULT 0;

CREATE FUNCTION public.can_manage_recycle_scope(_actor uuid,_branch uuid,_region uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT EXISTS(SELECT 1 FROM profiles WHERE id=_actor AND status='active' AND deleted_at IS NULL)
 AND (EXISTS(SELECT 1 FROM user_roles WHERE user_id=_actor AND role='regional_director' AND region_id=_region)
 OR (_branch IS NOT NULL AND public.has_role(_actor,'branch_manager') AND public.get_user_branch(_actor)=_branch));
$$;
CREATE POLICY recycle_bin_audit_read ON public.recycle_bin_audit_log FOR SELECT TO authenticated USING(public.can_manage_recycle_scope(auth.uid(),branch_id,region_id));

CREATE OR REPLACE FUNCTION public.can_manage_user(_actor uuid,_target uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT _actor IS NOT NULL AND _target IS NOT NULL AND _actor<>_target
 AND EXISTS(SELECT 1 FROM profiles WHERE id=_actor AND status='active' AND deleted_at IS NULL)
 AND EXISTS(SELECT 1 FROM profiles WHERE id=_target AND deleted_at IS NULL)
 AND NOT public.has_role(_target,'regional_director')
 AND (EXISTS(SELECT 1 FROM user_roles r JOIN profiles p ON p.id=_target JOIN branches b ON b.id=p.branch_id WHERE r.user_id=_actor AND r.role='regional_director' AND r.region_id=b.region_id)
 OR (public.has_role(_actor,'branch_manager') AND NOT public.has_role(_target,'branch_manager') AND public.get_user_branch(_actor) IS NOT NULL AND public.get_user_branch(_actor)=public.get_user_branch(_target)));
$$;
ALTER POLICY "Users read own profile" ON public.profiles USING(id=auth.uid() AND deleted_at IS NULL);
ALTER POLICY "Users update own profile" ON public.profiles USING(id=auth.uid() AND deleted_at IS NULL) WITH CHECK(id=auth.uid() AND deleted_at IS NULL);
-- Manager profile/role policies already use can_manage_user; no unrelated policy is widened.

CREATE FUNCTION public.can_manage_deleted_user(_actor uuid,_target uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT _actor<>_target AND NOT public.has_role(_target,'regional_director')
 AND EXISTS(SELECT 1 FROM profiles p JOIN branches b ON b.id=p.branch_id WHERE p.id=_target AND p.deleted_at IS NOT NULL
 AND public.can_manage_recycle_scope(_actor,p.branch_id,b.region_id)
 AND (NOT public.has_role(_target,'branch_manager') OR EXISTS(SELECT 1 FROM user_roles WHERE user_id=_actor AND role='regional_director' AND region_id=b.region_id)));
$$;

CREATE OR REPLACE FUNCTION public.authorize_user_deletion(_actor uuid,_target uuid,_request uuid DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE _p public.profiles; _audit uuid; _region uuid; _self boolean;
BEGIN
 PERFORM id FROM profiles WHERE id=_actor FOR UPDATE;
 SELECT * INTO _p FROM profiles WHERE id=_target FOR UPDATE;
 IF _actor IS NULL OR _target IS NULL OR _actor=_target THEN RAISE EXCEPTION 'You cannot delete your own account here'; END IF;
 IF public.has_role(_target,'regional_director') THEN RAISE EXCEPTION 'Regional Directors cannot be deleted'; END IF;
 IF NOT FOUND OR NOT public.can_manage_user(_actor,_target) THEN RAISE EXCEPTION 'You cannot manage this user'; END IF;
 IF _request IS NULL THEN
  IF _p.status<>'inactive' THEN RAISE EXCEPTION 'Deactivate the user first'; END IF;
 ELSE
  PERFORM id FROM account_deletion_requests WHERE id=_request AND user_id=_target AND status='pending' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'This deletion request is no longer pending'; END IF;
 END IF;
 -- A pending right-to-erasure request remains non-restorable even if the admin uses ordinary deletion.
 SELECT EXISTS(SELECT 1 FROM account_deletion_requests WHERE user_id=_target AND status='pending') INTO _self;
 SELECT region_id INTO _region FROM branches WHERE id=_p.branch_id;
 IF _region IS NULL THEN RAISE EXCEPTION 'Not allowed'; END IF;
 INSERT INTO user_audit_log(actor_id,target_id,action) VALUES(_actor,_target,'user_deleted') RETURNING id INTO _audit;
 INSERT INTO user_deletion_state(target_id,deletion_audit_id,previous_status,self_requested,operation,operation_actor) VALUES(_target,_audit,_p.status,_self,'deleting',_actor);
 UPDATE profiles SET deleted_at=now(),deleted_by=_actor,status='inactive' WHERE id=_target;
 UPDATE account_deletion_requests SET deletion_audit_id=_audit WHERE user_id=_target AND status='pending';
 INSERT INTO recycle_bin_audit_log(actor_id,item_type,item_id,action,branch_id,region_id) VALUES(_actor,'user',_target,'delete',_p.branch_id,_region);
 RETURN _audit;
END $$;
CREATE OR REPLACE FUNCTION public.record_user_deletion(_actor uuid,_target uuid,_audit uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 UPDATE user_deletion_state SET operation='deleted',updated_at=now() WHERE target_id=_target AND deletion_audit_id=_audit AND operation='deleting' AND operation_actor=_actor;
 IF NOT FOUND THEN RAISE EXCEPTION 'Invalid deletion audit entry'; END IF;
 UPDATE account_deletion_requests SET status='completed',handled_by=_actor,handled_at=now() WHERE deletion_audit_id=_audit AND status='pending';
END $$;
CREATE OR REPLACE FUNCTION public.record_user_deletion_failure(_actor uuid,_target uuid,_audit uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE _s public.user_deletion_state; _p public.profiles; _region uuid;
BEGIN
 SELECT * INTO _p FROM profiles WHERE id=_target FOR UPDATE;
 SELECT * INTO _s FROM user_deletion_state WHERE target_id=_target AND deletion_audit_id=_audit AND operation='deleting' AND operation_actor=_actor FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Invalid deletion audit entry'; END IF;
 UPDATE profiles SET deleted_at=NULL,deleted_by=NULL,status=_s.previous_status WHERE id=_target;
 INSERT INTO user_audit_log(actor_id,target_id,action) VALUES(_actor,_target,'user_deletion_failed');
 UPDATE account_deletion_requests SET status='pending',handled_by=NULL,handled_at=NULL,deletion_audit_id=NULL WHERE deletion_audit_id=_audit;
 SELECT region_id INTO _region FROM branches WHERE id=_p.branch_id;
 INSERT INTO recycle_bin_audit_log(actor_id,item_type,item_id,action,branch_id,region_id) VALUES(_actor,'user',_target,'deletion_failed',_p.branch_id,_region);
 DELETE FROM user_deletion_state WHERE target_id=_target;
END $$;

CREATE OR REPLACE FUNCTION public.can_restore_event(_event uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT EXISTS(SELECT 1 FROM events e WHERE e.id=_event AND e.deleted_at>now()-interval '30 days'
 AND public.can_manage_recycle_scope(auth.uid(),e.branch_id,e.region_id))
 AND NOT EXISTS(SELECT 1 FROM event_deletion_jobs WHERE event_id=_event AND operation NOT IN ('restore','archive'));
$$;
CREATE OR REPLACE FUNCTION public.delete_event(_event uuid,_title text DEFAULT NULL,_complete boolean DEFAULT false) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE _e public.events; _paths jsonb;
BEGIN
 PERFORM id FROM profiles WHERE id=auth.uid() FOR UPDATE;
 SELECT * INTO _e FROM events WHERE id=_event FOR UPDATE;
 IF NOT FOUND OR NOT public.can_manage_event_scope(_e.scope,_e.branch_id,_e.region_id) OR EXISTS(SELECT 1 FROM event_deletion_jobs WHERE event_id=_event AND operation NOT IN ('archive')) THEN RAISE EXCEPTION 'Not allowed'; END IF;
 IF _e.deleted_at IS NULL THEN
  IF NOT public.can_manage_event(_event) THEN RAISE EXCEPTION 'Not allowed'; END IF;
  UPDATE events SET deleted_at=now(),deleted_by=auth.uid() WHERE id=_event;
  INSERT INTO event_audit_log(actor_id,event_id,action,scope,branch_id,region_id) VALUES(auth.uid(),_event,'event_deleted',_e.scope,_e.branch_id,_e.region_id);
  INSERT INTO recycle_bin_audit_log(actor_id,item_type,item_id,action,branch_id,region_id) VALUES(auth.uid(),'event',_event,'delete',_e.branch_id,_e.region_id);
 END IF;
 IF _complete THEN
  IF EXISTS(SELECT 1 FROM storage.objects WHERE bucket_id='event-media' AND name LIKE _event::text||'/%') THEN RAISE EXCEPTION 'Event files still exist'; END IF;
  DELETE FROM event_deletion_jobs WHERE event_id=_event AND operation='archive';
  RETURN jsonb_build_object('paths','[]'::jsonb,'deleted',true);
 END IF;
 INSERT INTO event_deletion_jobs(event_id,requested_by,operation) VALUES(_event,auth.uid(),'archive') ON CONFLICT(event_id) DO NOTHING;
 SELECT coalesce(jsonb_agg(path ORDER BY path),'[]'::jsonb) INTO _paths FROM (SELECT storage_path AS path FROM event_media WHERE event_id=_event UNION SELECT name FROM storage.objects WHERE bucket_id='event-media' AND name LIKE _event::text||'/%') files;
 RETURN jsonb_build_object('paths',_paths,'deleted',true);
END $$;
CREATE OR REPLACE FUNCTION public.restore_event(_event uuid,_finalize boolean DEFAULT false) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE _e public.events; _paths jsonb;
BEGIN
 PERFORM id FROM profiles WHERE id=auth.uid() FOR UPDATE;
 SELECT * INTO _e FROM events WHERE id=_event FOR UPDATE;
 IF NOT FOUND OR NOT public.can_restore_event(_event) THEN RAISE EXCEPTION 'Event cannot be restored'; END IF;
 INSERT INTO event_deletion_jobs(event_id,requested_by,operation) VALUES(_event,auth.uid(),'restore') ON CONFLICT(event_id) DO UPDATE SET operation='restore',requested_by=auth.uid() WHERE event_deletion_jobs.operation IN ('archive','restore');
 SELECT coalesce(jsonb_agg(storage_path ORDER BY storage_path),'[]'::jsonb) INTO _paths FROM event_media WHERE event_id=_event;
 IF NOT _finalize THEN RETURN jsonb_build_object('paths',_paths,'deleted',false); END IF;
 -- Failed reservations are discarded; real archived files must have been restored through Storage.
 DELETE FROM event_media m WHERE event_id=_event AND NOT EXISTS(SELECT 1 FROM storage.objects o WHERE o.bucket_id='event-media' AND (o.name=m.storage_path OR o.name='deleted/'||m.storage_path));
 IF EXISTS(SELECT 1 FROM event_media m WHERE m.event_id=_event AND NOT EXISTS(SELECT 1 FROM storage.objects o WHERE o.bucket_id='event-media' AND o.name=m.storage_path)) THEN RAISE EXCEPTION 'Event restoration files missing'; END IF;
 UPDATE events SET deleted_at=NULL,deleted_by=NULL WHERE id=_event;
 INSERT INTO event_audit_log(actor_id,event_id,action,scope,branch_id,region_id) VALUES(auth.uid(),_event,'event_restored',_e.scope,_e.branch_id,_e.region_id);
 INSERT INTO recycle_bin_audit_log(actor_id,item_type,item_id,action,branch_id,region_id) VALUES(auth.uid(),'event',_event,'restore',_e.branch_id,_e.region_id);
 DELETE FROM event_deletion_jobs WHERE event_id=_event;
 RETURN jsonb_build_object('paths','[]'::jsonb,'deleted',false);
END $$;

CREATE FUNCTION public.list_recycle_bin(_type text DEFAULT 'all',_search text DEFAULT '',_offset integer DEFAULT 0)
RETURNS TABLE(id uuid,type text,title text,role text,branch text,region text,deleted_by_name text,deleted_at timestamptz,days_left integer,can_restore boolean,total_count bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM profiles p JOIN user_roles r ON r.user_id=p.id WHERE p.id=auth.uid() AND p.status='active' AND p.deleted_at IS NULL AND r.role IN ('branch_manager','regional_director')) THEN RAISE EXCEPTION 'Not allowed'; END IF;
 IF _type NOT IN ('all','event','user') THEN RAISE EXCEPTION 'Not allowed'; END IF;
 RETURN QUERY WITH items AS (
 SELECT e.id,'event'::text AS type,e.title,NULL::text AS role,b.name AS branch,r.name AS region,p.full_name AS deleted_by_name,e.deleted_at,
 greatest(0,ceil(extract(epoch FROM(e.deleted_at+interval '30 days'-now()))/86400))::integer AS days_left,public.can_restore_event(e.id) AS can_restore
 FROM events e JOIN regions r ON r.id=e.region_id LEFT JOIN branches b ON b.id=e.branch_id LEFT JOIN profiles p ON p.id=e.deleted_by
 WHERE e.deleted_at IS NOT NULL AND public.can_manage_recycle_scope(auth.uid(),e.branch_id,e.region_id)
 UNION ALL
 SELECT u.id,'user',u.full_name,(SELECT ur.role::text FROM user_roles ur WHERE ur.user_id=u.id ORDER BY CASE ur.role WHEN 'branch_manager' THEN 0 ELSE 1 END LIMIT 1),b.name,r.name,p.full_name,u.deleted_at,
 greatest(0,ceil(extract(epoch FROM(u.deleted_at+interval '30 days'-now()))/86400))::integer,
 NOT s.self_requested AND s.operation IN ('deleted','restore') AND u.deleted_at>now()-interval '30 days'
 FROM profiles u JOIN user_deletion_state s ON s.target_id=u.id JOIN branches b ON b.id=u.branch_id JOIN regions r ON r.id=b.region_id LEFT JOIN profiles p ON p.id=u.deleted_by
 WHERE u.deleted_at IS NOT NULL AND public.can_manage_deleted_user(auth.uid(),u.id)
 ) SELECT i.id,i.type,i.title,i.role,i.branch,i.region,i.deleted_by_name,i.deleted_at,i.days_left,i.can_restore,count(*) OVER()
 FROM items i WHERE (_type='all' OR i.type=_type) AND (coalesce(_search,'')='' OR position(lower(left(_search,200)) IN lower(i.title))>0)
 ORDER BY i.deleted_at DESC,i.id LIMIT 50 OFFSET greatest(0,least(_offset,1000000));
END $$;

CREATE FUNCTION public.restore_item(_type text,_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE _p public.profiles; _s public.user_deletion_state;
BEGIN
 IF _type='event' THEN RETURN public.restore_event(_id,false); END IF;
 IF _type<>'user' THEN RAISE EXCEPTION 'Not allowed'; END IF;
 PERFORM id FROM profiles WHERE id=auth.uid() FOR UPDATE;
 SELECT * INTO _p FROM profiles WHERE id=_id FOR UPDATE;
 SELECT * INTO _s FROM user_deletion_state WHERE target_id=_id FOR UPDATE;
 IF NOT FOUND OR NOT public.can_manage_deleted_user(auth.uid(),_id) OR _s.self_requested OR _p.deleted_at<=now()-interval '30 days' OR _s.operation NOT IN ('deleted','restore') THEN RAISE EXCEPTION 'Item cannot be restored'; END IF;
 UPDATE user_deletion_state SET operation='restore',operation_actor=auth.uid(),updated_at=now() WHERE target_id=_id;
 RETURN jsonb_build_object('paths','[]'::jsonb,'deleted',false);
END $$;
CREATE FUNCTION public.finish_user_recycle_operation(_id uuid,_operation text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE _s public.user_deletion_state; _p public.profiles; _region uuid;
BEGIN
 SELECT * INTO _p FROM profiles WHERE id=_id FOR UPDATE;
 SELECT * INTO _s FROM user_deletion_state WHERE target_id=_id AND operation=_operation FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Not allowed'; END IF;
 IF _operation='restore' THEN
  IF _s.self_requested OR _p.deleted_at<=now()-interval '30 days' OR NOT public.can_manage_deleted_user(_s.operation_actor,_id) THEN RAISE EXCEPTION 'Item cannot be restored'; END IF;
  SELECT region_id INTO _region FROM branches WHERE id=_p.branch_id;
  UPDATE profiles SET deleted_at=NULL,deleted_by=NULL,status=_s.previous_status WHERE id=_id;
  INSERT INTO recycle_bin_audit_log(actor_id,item_type,item_id,action,branch_id,region_id) VALUES(_s.operation_actor,'user',_id,'restore',_p.branch_id,_region);
 ELSIF _operation='purge' THEN
  IF EXISTS(SELECT 1 FROM auth.users WHERE id=_id) THEN RAISE EXCEPTION 'Auth account still exists'; END IF;
 ELSE RAISE EXCEPTION 'Not allowed'; END IF;
 DELETE FROM user_deletion_state WHERE target_id=_id;
END $$;

CREATE FUNCTION public.prepare_user_purge(_id uuid,_actor uuid DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE _p public.profiles; _s public.user_deletion_state; _region uuid;
BEGIN
 SELECT * INTO _p FROM profiles WHERE id=_id FOR UPDATE;
 SELECT * INTO _s FROM user_deletion_state WHERE target_id=_id FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('paths','[]'::jsonb,'deleted',true); END IF;
 IF _s.operation='restore' THEN RAISE EXCEPTION 'Item cannot be purged'; END IF;
 IF _s.operation<>'purge' THEN
  IF _p.deleted_at IS NULL OR (_actor IS NULL AND _p.deleted_at>=now()-interval '30 days') OR (_actor IS NOT NULL AND NOT public.can_manage_deleted_user(_actor,_id)) THEN RAISE EXCEPTION 'Item cannot be purged'; END IF;
  SELECT region_id INTO _region FROM branches WHERE id=_p.branch_id;
  UPDATE user_deletion_state SET operation='purge',operation_actor=_actor,updated_at=now() WHERE target_id=_id;
  INSERT INTO recycle_bin_audit_log(actor_id,item_type,item_id,action,branch_id,region_id) VALUES(_actor,'user',_id,'permanent_delete',_p.branch_id,_region);
 END IF;
 RETURN jsonb_build_object('paths','[]'::jsonb,'deleted',false);
END $$;

CREATE FUNCTION public.permanent_delete_item(_type text,_id uuid,_confirmation text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE _e public.events; _paths jsonb;
BEGIN
 IF _confirmation IS DISTINCT FROM 'DELETE' THEN RAISE EXCEPTION 'Permanent deletion confirmation required'; END IF;
 PERFORM id FROM profiles WHERE id=auth.uid() FOR UPDATE;
 IF _type='user' THEN
  IF NOT public.can_manage_deleted_user(auth.uid(),_id) THEN RAISE EXCEPTION 'Not allowed'; END IF;
  RETURN public.prepare_user_purge(_id,auth.uid());
 ELSIF _type<>'event' THEN RAISE EXCEPTION 'Not allowed'; END IF;
 SELECT * INTO _e FROM events WHERE id=_id FOR UPDATE;
 IF NOT FOUND OR _e.deleted_at IS NULL OR NOT public.can_manage_recycle_scope(auth.uid(),_e.branch_id,_e.region_id) OR EXISTS(SELECT 1 FROM event_deletion_jobs WHERE event_id=_id AND operation NOT IN ('archive','manual_purge')) THEN RAISE EXCEPTION 'Not allowed'; END IF;
 INSERT INTO event_deletion_jobs(event_id,operation,requested_by) VALUES(_id,'manual_purge',auth.uid()) ON CONFLICT(event_id) DO UPDATE SET operation='manual_purge',requested_by=auth.uid();
 SELECT coalesce(jsonb_agg(name ORDER BY name),'[]'::jsonb) INTO _paths FROM storage.objects WHERE bucket_id='event-media' AND (name LIKE _id::text||'/%' OR name LIKE 'deleted/'||_id::text||'/%');
 RETURN jsonb_build_object('paths',_paths,'deleted',false);
END $$;
CREATE OR REPLACE FUNCTION public.purge_event(_event uuid,_finalize boolean DEFAULT false) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE _e public.events; _paths jsonb; _job public.event_deletion_jobs;
BEGIN
 SELECT * INTO _e FROM events WHERE id=_event FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('paths','[]'::jsonb,'deleted',true); END IF;
 SELECT * INTO _job FROM event_deletion_jobs WHERE event_id=_event;
 IF _e.deleted_at IS NULL OR (_e.deleted_at>=now()-interval '30 days' AND _job.operation IS DISTINCT FROM 'manual_purge') OR (_job.operation IS NOT NULL AND _job.operation NOT IN ('purge','archive','manual_purge')) THEN RAISE EXCEPTION 'Event cannot be purged'; END IF;
 INSERT INTO event_deletion_jobs(event_id,operation) VALUES(_event,'purge') ON CONFLICT(event_id) DO UPDATE SET operation=CASE WHEN event_deletion_jobs.operation='manual_purge' THEN 'manual_purge' ELSE 'purge' END;
 SELECT coalesce(jsonb_agg(name ORDER BY name),'[]'::jsonb) INTO _paths FROM storage.objects WHERE bucket_id='event-media' AND (name LIKE _event::text||'/%' OR name LIKE 'deleted/'||_event::text||'/%');
 IF NOT _finalize THEN RETURN jsonb_build_object('paths',_paths,'deleted',false); END IF;
 IF jsonb_array_length(_paths)>0 THEN RAISE EXCEPTION 'Event files still exist'; END IF;
 INSERT INTO event_audit_log(actor_id,event_id,action,scope,branch_id,region_id) VALUES(CASE WHEN _job.operation='manual_purge' THEN _job.requested_by ELSE NULL END,_event,'event_purged',_e.scope,_e.branch_id,_e.region_id);
 INSERT INTO recycle_bin_audit_log(actor_id,item_type,item_id,action,branch_id,region_id) VALUES(CASE WHEN _job.operation='manual_purge' THEN _job.requested_by ELSE NULL END,'event',_event,'permanent_delete',_e.branch_id,_e.region_id);
 DELETE FROM event_media WHERE event_id=_event;
 DELETE FROM events WHERE id=_event;
 RETURN jsonb_build_object('paths','[]'::jsonb,'deleted',true);
END $$;
REVOKE ALL ON FUNCTION public.can_manage_recycle_scope(uuid,uuid,uuid),public.can_manage_deleted_user(uuid,uuid),public.list_recycle_bin(text,text,integer),public.restore_item(text,uuid),public.permanent_delete_item(text,uuid,text),public.finish_user_recycle_operation(uuid,text),public.prepare_user_purge(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.can_manage_recycle_scope(uuid,uuid,uuid),public.can_manage_deleted_user(uuid,uuid),public.list_recycle_bin(text,text,integer),public.restore_item(text,uuid),public.permanent_delete_item(text,uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.finish_user_recycle_operation(uuid,text),public.prepare_user_purge(uuid,uuid) TO service_role;
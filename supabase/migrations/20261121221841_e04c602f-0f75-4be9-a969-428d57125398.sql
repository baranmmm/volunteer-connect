DROP FUNCTION public.list_recycle_bin(text,text,integer);
CREATE FUNCTION public.list_recycle_bin(_type text DEFAULT 'all',_search text DEFAULT '',_offset integer DEFAULT 0)
RETURNS TABLE(id uuid,type text,title text,role text,branch text,region text,deleted_by_name text,deleted_at timestamptz,days_left integer,can_restore boolean,self_requested boolean,total_count bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM profiles p JOIN user_roles r ON r.user_id=p.id WHERE p.id=auth.uid() AND p.status='active' AND p.deleted_at IS NULL AND r.role IN ('branch_manager','regional_director')) THEN RAISE EXCEPTION 'Not allowed'; END IF;
 IF _type NOT IN ('all','event','user') THEN RAISE EXCEPTION 'Not allowed'; END IF;
 RETURN QUERY WITH items AS (
 SELECT e.id,'event'::text AS type,e.title,NULL::text AS role,b.name AS branch,r.name AS region,p.full_name AS deleted_by_name,e.deleted_at,
 greatest(0,ceil(extract(epoch FROM(e.deleted_at+interval '30 days'-now()))/86400))::integer AS days_left,public.can_restore_event(e.id) AS can_restore,false AS self_requested
 FROM events e JOIN regions r ON r.id=e.region_id LEFT JOIN branches b ON b.id=e.branch_id LEFT JOIN profiles p ON p.id=e.deleted_by
 WHERE e.deleted_at IS NOT NULL AND public.can_manage_recycle_scope(auth.uid(),e.branch_id,e.region_id)
 UNION ALL
 SELECT u.id,'user',u.full_name,(SELECT ur.role::text FROM user_roles ur WHERE ur.user_id=u.id ORDER BY CASE ur.role WHEN 'branch_manager' THEN 0 ELSE 1 END LIMIT 1),b.name,r.name,p.full_name,u.deleted_at,
 greatest(0,ceil(extract(epoch FROM(u.deleted_at+interval '30 days'-now()))/86400))::integer,
 NOT s.self_requested AND s.operation IN ('deleted','restore') AND u.deleted_at>now()-interval '30 days',s.self_requested
 FROM profiles u JOIN user_deletion_state s ON s.target_id=u.id JOIN branches b ON b.id=u.branch_id JOIN regions r ON r.id=b.region_id LEFT JOIN profiles p ON p.id=u.deleted_by
 WHERE u.deleted_at IS NOT NULL AND public.can_manage_deleted_user(auth.uid(),u.id)
 ) SELECT i.id,i.type,i.title,i.role,i.branch,i.region,i.deleted_by_name,i.deleted_at,i.days_left,i.can_restore,i.self_requested,count(*) OVER()
 FROM items i WHERE (_type='all' OR i.type=_type) AND (coalesce(_search,'')='' OR position(lower(left(_search,200)) IN lower(i.title))>0)
 ORDER BY i.deleted_at DESC,i.id LIMIT 50 OFFSET greatest(0,least(_offset,1000000));
END $$;
REVOKE ALL ON FUNCTION public.list_recycle_bin(text,text,integer) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.list_recycle_bin(text,text,integer) TO authenticated;
CREATE OR REPLACE FUNCTION public.get_user_audit_history(_target uuid,_offset integer DEFAULT 0)
RETURNS TABLE(id uuid,action public.user_audit_action,old_value text,new_value text,created_at timestamptz,actor_name text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF auth.uid() IS NULL OR NOT EXISTS(SELECT 1 FROM profiles WHERE profiles.id=auth.uid() AND deleted_at IS NULL) OR NOT (auth.uid()=_target OR public.can_manage_user(auth.uid(),_target)) THEN RAISE EXCEPTION 'Not allowed'; END IF;
 RETURN QUERY SELECT a.id,a.action,a.old_value,a.new_value,a.created_at,coalesce(nullif(p.full_name,''),'Former member') FROM user_audit_log a LEFT JOIN profiles p ON p.id=a.actor_id AND p.deleted_at IS NULL WHERE a.target_id=_target ORDER BY a.created_at DESC,a.id DESC LIMIT 100 OFFSET greatest(_offset,0);
END $$;
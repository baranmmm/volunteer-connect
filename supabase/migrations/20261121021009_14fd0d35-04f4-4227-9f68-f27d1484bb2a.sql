CREATE TABLE public.events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), title text NOT NULL, description text NOT NULL DEFAULT '', location text NOT NULL DEFAULT '',
 start_at timestamptz NOT NULL, end_at timestamptz, organizer text NOT NULL, category text NOT NULL,
 capacity integer, scope text NOT NULL, branch_id uuid REFERENCES public.branches(id), region_id uuid NOT NULL REFERENCES public.regions(id),
 status text NOT NULL DEFAULT 'draft', created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON public.events FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.events TO authenticated;
GRANT ALL ON public.events TO service_role;
ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;
CREATE TABLE public.event_media (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
 storage_path text NOT NULL UNIQUE, kind text NOT NULL, position integer NOT NULL,
 uploaded_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON public.event_media FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.event_media TO authenticated;
GRANT ALL ON public.event_media TO service_role;
ALTER TABLE public.event_media ENABLE ROW LEVEL SECURITY;
CREATE INDEX events_region_start ON public.events(region_id,start_at,id);
CREATE INDEX events_branch_start ON public.events(branch_id,start_at,id);
CREATE INDEX event_media_event_position ON public.event_media(event_id,position);

CREATE FUNCTION public.can_manage_event_scope(_scope text, _branch uuid, _region uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
 SELECT EXISTS (SELECT 1 FROM public.profiles WHERE id=auth.uid() AND status='active') AND (
  (_scope IN ('branch','region') AND public.has_role(auth.uid(),'regional_director') AND EXISTS (SELECT 1 FROM public.user_roles WHERE user_id=auth.uid() AND role='regional_director' AND region_id=_region)
    AND ((_scope='region' AND _branch IS NULL) OR (_scope='branch' AND EXISTS(SELECT 1 FROM public.branches WHERE id=_branch AND region_id=_region))))
  OR (_scope='branch' AND public.has_role(auth.uid(),'branch_manager') AND _branch=public.get_user_branch(auth.uid()) AND EXISTS(SELECT 1 FROM public.branches WHERE id=_branch AND region_id=_region))
 )
$$;
CREATE FUNCTION public.can_manage_event(_event uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
 SELECT EXISTS(SELECT 1 FROM public.events e WHERE e.id=_event AND public.can_manage_event_scope(e.scope,e.branch_id,e.region_id))
$$;
CREATE FUNCTION public.can_view_event(_event uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
 SELECT EXISTS(SELECT 1 FROM public.profiles WHERE id=auth.uid() AND status='active') AND EXISTS(
 SELECT 1 FROM public.events e WHERE e.id=_event AND (
   EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=auth.uid() AND role='regional_director' AND region_id=e.region_id)
   OR (e.scope='branch' AND e.branch_id=public.get_user_branch(auth.uid()) AND (e.status IN ('published','cancelled') OR public.has_role(auth.uid(),'branch_manager')))
   OR (e.scope='region' AND e.status IN ('published','cancelled') AND EXISTS(SELECT 1 FROM public.profiles p JOIN public.branches b ON b.id=p.branch_id WHERE p.id=auth.uid() AND b.region_id=e.region_id))
 ))
$$;
CREATE POLICY events_read ON public.events FOR SELECT TO authenticated USING(public.can_view_event(id));
CREATE POLICY event_media_read ON public.event_media FOR SELECT TO authenticated USING(public.can_view_event(event_id));

CREATE FUNCTION public.validate_event() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
 IF NEW.title IS NULL OR length(trim(NEW.title))=0 OR length(NEW.title)>200 OR NEW.organizer IS NULL OR length(trim(NEW.organizer))=0 OR length(NEW.organizer)>200 THEN RAISE EXCEPTION 'Event title and organizer are required'; END IF;
 IF NEW.category IS NULL OR NEW.category NOT IN ('dialogue','dinner','interfaith','community','education','other') OR NEW.scope IS NULL OR NEW.scope NOT IN ('branch','region') OR NEW.status IS NULL OR NEW.status NOT IN ('draft','published','cancelled') THEN RAISE EXCEPTION 'Invalid event values'; END IF;
 IF NEW.start_at IS NULL OR NOT isfinite(NEW.start_at) OR (NEW.end_at IS NOT NULL AND (NOT isfinite(NEW.end_at) OR NEW.end_at<NEW.start_at)) OR (NEW.capacity IS NOT NULL AND NEW.capacity<1) THEN RAISE EXCEPTION 'Invalid event dates or capacity'; END IF;
 IF (NEW.scope='branch' AND NOT EXISTS(SELECT 1 FROM public.branches WHERE id=NEW.branch_id AND region_id=NEW.region_id)) OR (NEW.scope='region' AND NEW.branch_id IS NOT NULL) THEN RAISE EXCEPTION 'Invalid event scope'; END IF;
 NEW.title:=trim(NEW.title); NEW.organizer:=trim(NEW.organizer); NEW.updated_at:=now(); RETURN NEW;
END $$;
CREATE TRIGGER validate_event BEFORE INSERT OR UPDATE ON public.events FOR EACH ROW EXECUTE FUNCTION public.validate_event();
CREATE FUNCTION public.create_event(_data jsonb) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE _id uuid; _branch uuid:=nullif(_data->>'branch_id','')::uuid; _region uuid; _scope text:=_data->>'scope';
BEGIN
 PERFORM id FROM public.profiles WHERE id=auth.uid() FOR UPDATE;
 IF _scope='branch' THEN SELECT region_id INTO _region FROM public.branches WHERE id=_branch; ELSE SELECT region_id INTO _region FROM public.user_roles WHERE user_id=auth.uid() AND role='regional_director' LIMIT 1; END IF;
 IF NOT public.can_manage_event_scope(_scope,_branch,_region) THEN RAISE EXCEPTION 'Not allowed'; END IF;
 IF _data->>'status' IS NULL OR _data->>'status' NOT IN ('draft','published') THEN RAISE EXCEPTION 'Invalid event values'; END IF;
 INSERT INTO public.events(title,description,location,start_at,end_at,organizer,category,capacity,scope,branch_id,region_id,status,created_by)
 VALUES(_data->>'title',coalesce(_data->>'description',''),coalesce(_data->>'location',''),(_data->>'start_at')::timestamptz,nullif(_data->>'end_at','')::timestamptz,_data->>'organizer',_data->>'category',nullif(_data->>'capacity','')::integer,_scope,_branch,_region,_data->>'status',auth.uid()) RETURNING id INTO _id;
 RETURN _id;
END $$;
CREATE FUNCTION public.update_event(_event uuid,_data jsonb) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE _branch uuid:=nullif(_data->>'branch_id','')::uuid; _region uuid; _scope text:=_data->>'scope'; _old_status text;
BEGIN
 PERFORM id FROM public.profiles WHERE id=auth.uid() FOR UPDATE;
 SELECT status INTO _old_status FROM public.events WHERE id=_event FOR UPDATE;
 IF NOT FOUND OR NOT public.can_manage_event(_event) THEN RAISE EXCEPTION 'Not allowed'; END IF;
 IF _scope='branch' THEN SELECT region_id INTO _region FROM public.branches WHERE id=_branch; ELSE SELECT region_id INTO _region FROM public.user_roles WHERE user_id=auth.uid() AND role='regional_director' LIMIT 1; END IF;
 IF NOT public.can_manage_event_scope(_scope,_branch,_region) THEN RAISE EXCEPTION 'Not allowed'; END IF;
 IF _data->>'status' IS NULL OR _data->>'status' NOT IN ('draft','published','cancelled') OR (_old_status='cancelled' AND _data->>'status'<>'cancelled') OR (_old_status<>'cancelled' AND _data->>'status'='cancelled') THEN RAISE EXCEPTION 'Invalid event values'; END IF;
 UPDATE public.events SET title=_data->>'title',description=coalesce(_data->>'description',''),location=coalesce(_data->>'location',''),start_at=(_data->>'start_at')::timestamptz,end_at=nullif(_data->>'end_at','')::timestamptz,organizer=_data->>'organizer',category=_data->>'category',capacity=nullif(_data->>'capacity','')::integer,scope=_scope,branch_id=_branch,region_id=_region,status=_data->>'status' WHERE id=_event;
END $$;
CREATE FUNCTION public.cancel_event(_event uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 PERFORM id FROM public.profiles WHERE id=auth.uid() FOR UPDATE;
 PERFORM id FROM public.events WHERE id=_event FOR UPDATE;
 IF NOT FOUND OR NOT public.can_manage_event(_event) THEN RAISE EXCEPTION 'Not allowed'; END IF;
 UPDATE public.events SET status='cancelled' WHERE id=_event;
END $$;
CREATE FUNCTION public.add_event_media(_event uuid,_kind text,_extension text) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE _id uuid:=gen_random_uuid(); _position integer;
BEGIN
 PERFORM id FROM public.profiles WHERE id=auth.uid() FOR UPDATE;
 PERFORM id FROM public.events WHERE id=_event FOR UPDATE;
 IF NOT FOUND OR NOT public.can_manage_event(_event) THEN RAISE EXCEPTION 'Not allowed'; END IF;
 IF NOT ((_kind='image' AND _extension IN ('jpg','png','webp')) OR (_kind='pdf' AND _extension='pdf')) OR _kind IS NULL OR _extension IS NULL THEN RAISE EXCEPTION 'Invalid event file'; END IF;
 SELECT count(*) INTO _position FROM public.event_media WHERE event_id=_event;
 IF _position>=5 THEN RAISE EXCEPTION 'Maximum 5 files per event'; END IF;
 INSERT INTO public.event_media(id,event_id,storage_path,kind,position,uploaded_by) VALUES(_id,_event,_event::text||'/'||_id::text||'.'||_extension,_kind,_position,auth.uid());
 RETURN _id;
END $$;
CREATE FUNCTION public.reorder_event_media(_event uuid,_ids uuid[]) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE _count integer;
BEGIN
 PERFORM id FROM public.profiles WHERE id=auth.uid() FOR UPDATE;
 PERFORM id FROM public.events WHERE id=_event FOR UPDATE;
 IF NOT FOUND OR NOT public.can_manage_event(_event) THEN RAISE EXCEPTION 'Not allowed'; END IF;
 SELECT count(*) INTO _count FROM public.event_media WHERE event_id=_event;
 IF _ids IS NULL OR cardinality(_ids)<>_count OR (SELECT count(DISTINCT i) FROM unnest(_ids) i)<>_count OR EXISTS(SELECT 1 FROM unnest(_ids) i WHERE i IS NULL OR NOT EXISTS(SELECT 1 FROM public.event_media WHERE id=i AND event_id=_event)) THEN RAISE EXCEPTION 'Invalid event file order'; END IF;
 IF _count>0 AND (SELECT kind FROM public.event_media WHERE id=_ids[1])<>'image' AND EXISTS(SELECT 1 FROM public.event_media WHERE event_id=_event AND kind='image') THEN RAISE EXCEPTION 'Cover must be an image'; END IF;
 UPDATE public.event_media m SET position=a.ord-1,updated_at=now() FROM unnest(_ids) WITH ORDINALITY a(id,ord) WHERE m.id=a.id AND m.event_id=_event;
END $$;
CREATE FUNCTION public.delete_event_media(_media uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE _event uuid;
BEGIN
 PERFORM id FROM public.profiles WHERE id=auth.uid() FOR UPDATE;
 SELECT event_id INTO _event FROM public.event_media WHERE id=_media;
 PERFORM id FROM public.events WHERE id=_event FOR UPDATE;
 IF NOT FOUND OR NOT public.can_manage_event(_event) THEN RAISE EXCEPTION 'Not allowed'; END IF;
 IF EXISTS(SELECT 1 FROM storage.objects o JOIN public.event_media m ON m.storage_path=o.name WHERE m.id=_media AND o.bucket_id='event-media') THEN RAISE EXCEPTION 'Remove stored file first'; END IF;
 DELETE FROM public.event_media WHERE id=_media;
 WITH ordered AS (SELECT id,row_number() OVER(ORDER BY CASE WHEN kind='image' THEN 0 ELSE 1 END,position,id)-1 AS pos FROM public.event_media WHERE event_id=_event)
 UPDATE public.event_media m SET position=ordered.pos,updated_at=now() FROM ordered WHERE m.id=ordered.id;
END $$;

CREATE FUNCTION public.can_read_event_file(_path text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT EXISTS(SELECT 1 FROM public.event_media WHERE storage_path=_path AND public.can_view_event(event_id))
$$;
CREATE FUNCTION public.can_write_event_file(_path text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT EXISTS(SELECT 1 FROM public.event_media WHERE storage_path=_path AND public.can_manage_event(event_id))
$$;
CREATE POLICY event_files_read ON storage.objects FOR SELECT TO authenticated USING(bucket_id='event-media' AND public.can_read_event_file(name));
CREATE POLICY event_files_upload ON storage.objects FOR INSERT TO authenticated WITH CHECK(bucket_id='event-media' AND public.can_write_event_file(name) AND lower(storage.extension(name)) IN ('jpg','png','webp','pdf') AND metadata->>'mimetype' = CASE lower(storage.extension(name)) WHEN 'jpg' THEN 'image/jpeg' WHEN 'png' THEN 'image/png' WHEN 'webp' THEN 'image/webp' WHEN 'pdf' THEN 'application/pdf' END AND (metadata->>'size')::bigint<=10485760);
CREATE POLICY event_files_delete ON storage.objects FOR DELETE TO authenticated USING(bucket_id='event-media' AND public.can_write_event_file(name));

REVOKE ALL ON FUNCTION public.can_manage_event_scope(text,uuid,uuid),public.can_manage_event(uuid),public.can_view_event(uuid),public.create_event(jsonb),public.update_event(uuid,jsonb),public.cancel_event(uuid),public.add_event_media(uuid,text,text),public.reorder_event_media(uuid,uuid[]),public.delete_event_media(uuid),public.can_read_event_file(text),public.can_write_event_file(text),public.validate_event() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.can_manage_event_scope(text,uuid,uuid),public.can_manage_event(uuid),public.can_view_event(uuid),public.create_event(jsonb),public.update_event(uuid,jsonb),public.cancel_event(uuid),public.add_event_media(uuid,text,text),public.reorder_event_media(uuid,uuid[]),public.delete_event_media(uuid),public.can_read_event_file(text),public.can_write_event_file(text) TO authenticated;
COMMENT ON TABLE public.event_media IS 'Reserve via add_event_media before Storage upload; delete Storage object before delete_event_media. Event row locks serialize the five-file limit.';
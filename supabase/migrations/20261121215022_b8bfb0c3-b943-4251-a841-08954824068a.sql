ALTER TABLE public.events ALTER COLUMN start_at DROP NOT NULL;
CREATE OR REPLACE FUNCTION public.validate_event() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$ BEGIN
 IF NEW.title IS NULL OR length(trim(NEW.title))=0 OR length(NEW.title)>200 OR NEW.organizer IS NULL OR length(NEW.organizer)>200 THEN RAISE EXCEPTION 'Event title and organizer are required'; END IF;
 IF NEW.category IS NULL OR NEW.category NOT IN ('dialogue','dinner','interfaith','community','education','other') OR NEW.scope IS NULL OR NEW.scope NOT IN ('branch','region') OR NEW.status IS NULL OR NEW.status NOT IN ('draft','published','cancelled') THEN RAISE EXCEPTION 'Invalid event values'; END IF;
 IF (NEW.start_at IS NOT NULL AND NOT isfinite(NEW.start_at)) OR (NEW.end_at IS NOT NULL AND (NOT isfinite(NEW.end_at) OR NEW.end_at<NEW.start_at)) OR (NEW.capacity IS NOT NULL AND NEW.capacity<1) THEN RAISE EXCEPTION 'Invalid event dates or capacity'; END IF;
 IF NEW.status='published' THEN
  IF TG_OP='INSERT' OR ROW(NEW.title,NEW.start_at,NEW.end_at,NEW.location,NEW.category,NEW.scope,NEW.branch_id,NEW.region_id,NEW.status) IS DISTINCT FROM ROW(OLD.title,OLD.start_at,OLD.end_at,OLD.location,OLD.category,OLD.scope,OLD.branch_id,OLD.region_id,OLD.status) THEN
   IF NEW.start_at IS NULL OR NEW.end_at IS NULL OR length(trim(NEW.location))=0 THEN RAISE EXCEPTION 'Required publish fields missing'; END IF;
  END IF;
 END IF;
 IF (NEW.scope='branch' AND NOT EXISTS(SELECT 1 FROM branches WHERE id=NEW.branch_id AND region_id=NEW.region_id)) OR (NEW.scope='region' AND NEW.branch_id IS NOT NULL) THEN RAISE EXCEPTION 'Invalid event scope'; END IF;
 NEW.title:=trim(NEW.title); NEW.organizer:=trim(NEW.organizer); NEW.updated_at:=now(); RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION public.create_event(_data jsonb) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$ DECLARE _id uuid; _branch uuid:=nullif(_data->>'branch_id','')::uuid; _region uuid; _scope text:=_data->>'scope'; BEGIN
 PERFORM id FROM profiles WHERE id=auth.uid() FOR UPDATE;
 IF _data->>'status'='draft' AND _branch IS NULL AND _scope IS DISTINCT FROM 'region' THEN
  IF public.has_role(auth.uid(),'regional_director') THEN _scope:='region'; ELSE _branch:=public.get_user_branch(auth.uid()); _scope:='branch'; END IF;
 END IF;
 IF _scope='branch' THEN SELECT region_id INTO _region FROM branches WHERE id=_branch; ELSE SELECT region_id INTO _region FROM user_roles WHERE user_id=auth.uid() AND role='regional_director' LIMIT 1; END IF;
 IF NOT public.can_manage_event_scope(_scope,_branch,_region) THEN RAISE EXCEPTION 'Not allowed'; END IF;
 IF _data->>'status' IS NULL OR _data->>'status' NOT IN ('draft','published') THEN RAISE EXCEPTION 'Invalid event values'; END IF;
 INSERT INTO events(title,description,location,start_at,end_at,organizer,category,capacity,scope,branch_id,region_id,status,created_by) VALUES(_data->>'title',coalesce(_data->>'description',''),coalesce(_data->>'location',''),nullif(_data->>'start_at','')::timestamptz,nullif(_data->>'end_at','')::timestamptz,coalesce(_data->>'organizer',''),coalesce(_data->>'category','dialogue'),nullif(_data->>'capacity','')::integer,_scope,_branch,_region,_data->>'status',auth.uid()) RETURNING id INTO _id; RETURN _id;
END $$;
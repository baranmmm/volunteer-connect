ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS all_day boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS start_date date,
  ADD COLUMN IF NOT EXISTS end_date date,
  ADD COLUMN IF NOT EXISTS location_type text NOT NULL DEFAULT 'in_person',
  ADD COLUMN IF NOT EXISTS online_url text;

CREATE OR REPLACE FUNCTION public.validate_event()
 RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public'
AS $function$
DECLARE _today date := (now() AT TIME ZONE 'Europe/London')::date; _times_changed boolean;
BEGIN
 IF NEW.title IS NULL OR length(trim(NEW.title))=0 OR length(NEW.title)>200 OR NEW.organizer IS NULL OR length(NEW.organizer)>200 THEN RAISE EXCEPTION 'Event title and organizer are required'; END IF;
 IF NEW.category IS NULL OR NEW.category NOT IN ('dialogue','dinner','interfaith','community','education','other') OR NEW.scope IS NULL OR NEW.scope NOT IN ('branch','region') OR NEW.status IS NULL OR NEW.status NOT IN ('draft','published','cancelled') OR NEW.all_day IS NULL OR NEW.location_type IS NULL OR NEW.location_type NOT IN ('in_person','online') THEN RAISE EXCEPTION 'Invalid event values'; END IF;
 -- All-day events are London calendar dates; timed events are instants. Never keep both.
 IF NEW.all_day THEN NEW.start_at:=NULL; NEW.end_at:=NULL; ELSE NEW.start_date:=NULL; NEW.end_date:=NULL; END IF;
 IF NEW.location_type='in_person' THEN NEW.online_url:=NULL; END IF;
 NEW.online_url := nullif(btrim(coalesce(NEW.online_url,'')),'');
 IF NEW.online_url IS NOT NULL AND (length(NEW.online_url)>2000 OR NEW.online_url !~ '^https://[^\s/?#]+\.[^\s]*$') THEN RAISE EXCEPTION 'Online meeting link must use https'; END IF;
 IF (NEW.start_at IS NOT NULL AND NOT isfinite(NEW.start_at)) OR (NEW.end_at IS NOT NULL AND (NOT isfinite(NEW.end_at) OR NEW.end_at<NEW.start_at)) OR (NEW.end_date IS NOT NULL AND NEW.start_date IS NOT NULL AND NEW.end_date<NEW.start_date) OR (NEW.end_date IS NOT NULL AND NEW.start_date IS NULL) OR (NEW.capacity IS NOT NULL AND NEW.capacity<1) THEN RAISE EXCEPTION 'Invalid event dates or capacity'; END IF;
 _times_changed := TG_OP='INSERT' OR ROW(NEW.all_day,NEW.start_at,NEW.end_at,NEW.start_date,NEW.end_date,NEW.status) IS DISTINCT FROM ROW(OLD.all_day,OLD.start_at,OLD.end_at,OLD.start_date,OLD.end_date,OLD.status);
 IF _times_changed AND NEW.start_at IS NOT NULL AND NEW.end_at IS NOT NULL AND NEW.end_at<=NEW.start_at THEN RAISE EXCEPTION 'Event end must be after start'; END IF;
 IF NEW.status='published' THEN
  IF NEW.all_day AND NEW.start_date IS NOT NULL THEN NEW.end_date:=coalesce(NEW.end_date,NEW.start_date); END IF;
  IF TG_OP='INSERT' OR ROW(NEW.title,NEW.all_day,NEW.start_at,NEW.end_at,NEW.start_date,NEW.end_date,NEW.location,NEW.location_type,NEW.online_url,NEW.category,NEW.scope,NEW.branch_id,NEW.region_id,NEW.status) IS DISTINCT FROM ROW(OLD.title,OLD.all_day,OLD.start_at,OLD.end_at,OLD.start_date,OLD.end_date,OLD.location,OLD.location_type,OLD.online_url,OLD.category,OLD.scope,OLD.branch_id,OLD.region_id,OLD.status) THEN
   IF (NEW.all_day AND NEW.start_date IS NULL) OR (NOT NEW.all_day AND (NEW.start_at IS NULL OR NEW.end_at IS NULL))
      OR (NEW.location_type='in_person' AND length(trim(NEW.location))=0) OR (NEW.location_type='online' AND NEW.online_url IS NULL) THEN RAISE EXCEPTION 'Required publish fields missing'; END IF;
  END IF;
  IF _times_changed AND ((NEW.all_day AND NEW.end_date<_today) OR (NOT NEW.all_day AND NEW.end_at<now())) THEN RAISE EXCEPTION 'Published event cannot end in the past'; END IF;
 END IF;
 IF (NEW.scope='branch' AND NOT EXISTS(SELECT 1 FROM branches WHERE id=NEW.branch_id AND region_id=NEW.region_id)) OR (NEW.scope='region' AND NEW.branch_id IS NOT NULL) THEN RAISE EXCEPTION 'Invalid event scope'; END IF;
 NEW.title:=trim(NEW.title); NEW.organizer:=trim(NEW.organizer); NEW.updated_at:=now(); RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.create_event(_data jsonb)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$ DECLARE _id uuid; _branch uuid:=nullif(_data->>'branch_id','')::uuid; _region uuid; _scope text:=_data->>'scope'; BEGIN
 PERFORM id FROM profiles WHERE id=auth.uid() FOR UPDATE;
 IF _data->>'status'='draft' AND _branch IS NULL AND _scope IS DISTINCT FROM 'region' THEN
  IF public.has_role(auth.uid(),'regional_director') THEN _scope:='region'; ELSE _branch:=public.get_user_branch(auth.uid()); _scope:='branch'; END IF;
 END IF;
 IF _scope='branch' THEN SELECT region_id INTO _region FROM branches WHERE id=_branch; ELSE SELECT region_id INTO _region FROM user_roles WHERE user_id=auth.uid() AND role='regional_director' LIMIT 1; END IF;
 IF NOT public.can_manage_event_scope(_scope,_branch,_region) THEN RAISE EXCEPTION 'Not allowed'; END IF;
 IF _data->>'status' IS NULL OR _data->>'status' NOT IN ('draft','published') THEN RAISE EXCEPTION 'Invalid event values'; END IF;
 INSERT INTO events(title,description,location,start_at,end_at,all_day,start_date,end_date,location_type,online_url,organizer,category,capacity,scope,branch_id,region_id,status,created_by)
 VALUES(_data->>'title',coalesce(_data->>'description',''),coalesce(_data->>'location',''),nullif(_data->>'start_at','')::timestamptz,nullif(_data->>'end_at','')::timestamptz,coalesce((_data->>'all_day')::boolean,false),nullif(_data->>'start_date','')::date,nullif(_data->>'end_date','')::date,coalesce(nullif(_data->>'location_type',''),'in_person'),nullif(_data->>'online_url',''),coalesce(nullif(trim(_data->>'organizer'),''),'Dialogue Society'),coalesce(_data->>'category','dialogue'),nullif(_data->>'capacity','')::integer,_scope,_branch,_region,_data->>'status',auth.uid()) RETURNING id INTO _id; RETURN _id;
END $function$;

CREATE OR REPLACE FUNCTION public.update_event(_event uuid, _data jsonb)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE _branch uuid:=nullif(_data->>'branch_id','')::uuid; _region uuid; _scope text:=_data->>'scope'; _old_status text;
BEGIN
 PERFORM id FROM public.profiles WHERE id=auth.uid() FOR UPDATE;
 SELECT status INTO _old_status FROM public.events WHERE id=_event FOR UPDATE;
 IF NOT FOUND OR NOT public.can_manage_event(_event) THEN RAISE EXCEPTION 'Not allowed'; END IF;
 IF _scope='branch' THEN SELECT region_id INTO _region FROM public.branches WHERE id=_branch; ELSE SELECT region_id INTO _region FROM public.user_roles WHERE user_id=auth.uid() AND role='regional_director' LIMIT 1; END IF;
 IF NOT public.can_manage_event_scope(_scope,_branch,_region) THEN RAISE EXCEPTION 'Not allowed'; END IF;
 IF _data->>'status' IS NULL OR _data->>'status' NOT IN ('draft','published','cancelled') OR (_old_status='cancelled' AND _data->>'status'<>'cancelled') OR (_old_status<>'cancelled' AND _data->>'status'='cancelled') THEN RAISE EXCEPTION 'Invalid event values'; END IF;
 UPDATE public.events SET title=_data->>'title',description=coalesce(_data->>'description',''),location=coalesce(_data->>'location',''),start_at=nullif(_data->>'start_at','')::timestamptz,end_at=nullif(_data->>'end_at','')::timestamptz,all_day=coalesce((_data->>'all_day')::boolean,false),start_date=nullif(_data->>'start_date','')::date,end_date=nullif(_data->>'end_date','')::date,location_type=coalesce(nullif(_data->>'location_type',''),'in_person'),online_url=nullif(_data->>'online_url',''),organizer=coalesce(nullif(trim(_data->>'organizer'),''),'Dialogue Society'),category=_data->>'category',capacity=nullif(_data->>'capacity','')::integer,scope=_scope,branch_id=_branch,region_id=_region,status=_data->>'status' WHERE id=_event;
END $function$;

CREATE OR REPLACE FUNCTION public.add_event_media(_event uuid, _kind text, _extension text, _original_name text)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE _id uuid:=gen_random_uuid(); _position integer; _name text := nullif(left(btrim(coalesce(_original_name,'')),255),'');
BEGIN
 _extension := CASE WHEN lower(_extension) = 'jpeg' THEN 'jpg' ELSE lower(_extension) END;
 PERFORM id FROM public.profiles WHERE id=auth.uid() FOR UPDATE;
 PERFORM id FROM public.events WHERE id=_event FOR UPDATE;
 IF NOT FOUND OR NOT public.can_manage_event(_event) THEN RAISE EXCEPTION 'Not allowed'; END IF;
 IF _kind IS NULL OR _extension IS NULL OR NOT ((_kind='image' AND _extension IN ('jpg','png','webp')) OR (_kind='pdf' AND _extension='pdf') OR (_kind='document' AND _extension IN ('docx','pptx'))) THEN RAISE EXCEPTION 'Invalid event file'; END IF;
 SELECT count(*) INTO _position FROM public.event_media WHERE event_id=_event;
 IF _position>=5 THEN RAISE EXCEPTION 'Maximum 5 files per event'; END IF;
 INSERT INTO public.event_media(id,event_id,storage_path,kind,position,uploaded_by,original_name) VALUES(_id,_event,_event::text||'/'||_id::text||'.'||_extension,_kind,_position,auth.uid(),_name);
 RETURN _id;
END $function$;

ALTER POLICY event_files_upload ON storage.objects
 WITH CHECK (bucket_id='event-media' AND public.can_write_event_file(name) AND lower(storage.extension(name)) IN ('jpg','png','webp','pdf','docx','pptx'));
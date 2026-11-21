CREATE OR REPLACE FUNCTION public.add_event_media(_event uuid, _kind text, _extension text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _id uuid:=gen_random_uuid(); _position integer;
BEGIN
 _extension := CASE WHEN lower(_extension) = 'jpeg' THEN 'jpg' ELSE lower(_extension) END;
 PERFORM id FROM public.profiles WHERE id=auth.uid() FOR UPDATE;
 PERFORM id FROM public.events WHERE id=_event FOR UPDATE;
 IF NOT FOUND OR NOT public.can_manage_event(_event) THEN RAISE EXCEPTION 'Not allowed'; END IF;
 IF NOT ((_kind='image' AND _extension IN ('jpg','png','webp')) OR (_kind='pdf' AND _extension='pdf')) OR _kind IS NULL OR _extension IS NULL THEN RAISE EXCEPTION 'Invalid event file'; END IF;
 SELECT count(*) INTO _position FROM public.event_media WHERE event_id=_event;
 IF _position>=5 THEN RAISE EXCEPTION 'Maximum 5 files per event'; END IF;
 INSERT INTO public.event_media(id,event_id,storage_path,kind,position,uploaded_by) VALUES(_id,_event,_event::text||'/'||_id::text||'.'||_extension,_kind,_position,auth.uid());
 RETURN _id;
END $function$;

ALTER POLICY event_files_upload ON storage.objects
 WITH CHECK (bucket_id='event-media' AND public.can_write_event_file(name) AND lower(storage.extension(name)) IN ('jpg','png','webp','pdf'));
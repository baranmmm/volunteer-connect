ALTER TABLE public.event_media ADD COLUMN IF NOT EXISTS original_name text CHECK (original_name IS NULL OR char_length(original_name) <= 255);

CREATE OR REPLACE FUNCTION public.add_event_media(_event uuid, _kind text, _extension text, _original_name text)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE _id uuid:=gen_random_uuid(); _position integer; _name text := nullif(left(btrim(coalesce(_original_name,'')),255),'');
BEGIN
 _extension := CASE WHEN lower(_extension) = 'jpeg' THEN 'jpg' ELSE lower(_extension) END;
 PERFORM id FROM public.profiles WHERE id=auth.uid() FOR UPDATE;
 PERFORM id FROM public.events WHERE id=_event FOR UPDATE;
 IF NOT FOUND OR NOT public.can_manage_event(_event) THEN RAISE EXCEPTION 'Not allowed'; END IF;
 IF NOT ((_kind='image' AND _extension IN ('jpg','png','webp')) OR (_kind='pdf' AND _extension='pdf')) OR _kind IS NULL OR _extension IS NULL THEN RAISE EXCEPTION 'Invalid event file'; END IF;
 SELECT count(*) INTO _position FROM public.event_media WHERE event_id=_event;
 IF _position>=5 THEN RAISE EXCEPTION 'Maximum 5 files per event'; END IF;
 INSERT INTO public.event_media(id,event_id,storage_path,kind,position,uploaded_by,original_name) VALUES(_id,_event,_event::text||'/'||_id::text||'.'||_extension,_kind,_position,auth.uid(),_name);
 RETURN _id;
END $function$;

REVOKE ALL ON FUNCTION public.add_event_media(uuid,text,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.add_event_media(uuid,text,text,text) TO authenticated;
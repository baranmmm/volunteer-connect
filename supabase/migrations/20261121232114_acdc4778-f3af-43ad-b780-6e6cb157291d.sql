DROP FUNCTION IF EXISTS public.add_event_media(uuid, text, text);
REVOKE ALL ON FUNCTION public.add_event_media(uuid, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.add_event_media(uuid, text, text, text) TO authenticated;
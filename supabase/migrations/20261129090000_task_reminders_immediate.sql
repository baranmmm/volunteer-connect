-- Task reminders always arrive immediately (like assignments, mentions and requests waiting for review): never in the
-- daily summary. They can still be turned off. get_notification_settings marks such types with delivery_locked, so
-- Profile > Notifications shows only the on/off switch for them. Reminders already held for a summary are released.

CREATE OR REPLACE FUNCTION public.notification_delivery_locked(_type text) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = public AS $$ SELECT public.notification_type_locked(_type) OR _type = 'task_reminder' $$;

CREATE OR REPLACE FUNCTION public.notification_setting(_user uuid, _type text) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE WHEN public.notification_type_locked(_type) THEN jsonb_build_object('enabled', true, 'delivery', 'immediate')
    ELSE jsonb_build_object(
      'enabled', coalesce((SELECT (p.types->_type->>'enabled')::boolean FROM public.notification_preferences p WHERE p.user_id = _user), true),
      'delivery', CASE WHEN public.notification_delivery_locked(_type) THEN 'immediate'
        ELSE coalesce((SELECT p.types->_type->>'delivery' FROM public.notification_preferences p WHERE p.user_id = _user),
          public.notification_default_delivery(_user)) END) END
$$;

CREATE OR REPLACE FUNCTION public.get_notification_settings() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_accepted_privacy_notice() THEN RETURN NULL; END IF;
  RETURN jsonb_build_object(
    'default_delivery', public.notification_default_delivery(auth.uid()),
    'task_reminder_emails', public.wants_task_reminder_emails(auth.uid()),
    'types', (SELECT jsonb_agg(public.notification_setting(auth.uid(), t) || jsonb_build_object('type', t,
        'locked', public.notification_type_locked(t), 'delivery_locked', public.notification_delivery_locked(t)) ORDER BY o)
      FROM unnest(ARRAY['task_assigned', 'mention', 'review', 'task_status', 'task_note', 'task_reminder', 'meeting', 'request_decided'])
        WITH ORDINALITY AS x(t, o)));
END $$;

CREATE OR REPLACE FUNCTION public.set_notification_setting(p_type text, p_enabled boolean, p_delivery text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _delivery text := CASE WHEN public.notification_delivery_locked(p_type) THEN 'immediate' ELSE p_delivery END;
BEGIN
  PERFORM public.require_privacy_accepted();
  IF auth.uid() IS NULL OR NOT public.session_ok() THEN RAISE EXCEPTION 'Not allowed'; END IF;
  IF p_type NOT IN ('task_status', 'task_note', 'task_reminder', 'meeting', 'request_decided') THEN
    RAISE EXCEPTION 'This notice cannot be changed';
  END IF;
  IF _delivery NOT IN ('immediate', 'digest') THEN RAISE EXCEPTION 'Not allowed'; END IF;
  INSERT INTO public.notification_preferences (user_id, types)
  VALUES (auth.uid(), jsonb_build_object(p_type, jsonb_build_object('enabled', coalesce(p_enabled, true), 'delivery', _delivery)))
  ON CONFLICT (user_id) DO UPDATE SET types = public.notification_preferences.types
    || jsonb_build_object(p_type, jsonb_build_object('enabled', coalesce(p_enabled, true), 'delivery', _delivery)), updated_at = now();
  RETURN public.notification_setting(auth.uid(), p_type);
END $$;

REVOKE ALL ON FUNCTION public.notification_delivery_locked(text) FROM PUBLIC, anon, authenticated;

-- Reminders held for a daily summary go out now.
UPDATE public.notifications SET held = false WHERE held AND kind = 'task_reminder';

-- Privacy notice confirmation (legitimate interests: confirming the member has read the notice, not consent) and two
-- optional, separate consents (photos/videos, occasional email updates), both off by default.
-- The current notice version is defined once, here (privacy_notice_version); the server validates against it.
-- Enforcement: sign-up (handle_new_user) refuses accounts without the current version; server functions require it
-- (requireMember); and RESTRICTIVE RLS policies hide event and request data from members who have not confirmed it.

CREATE FUNCTION public.privacy_notice_version() RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public AS $$ SELECT '1.0' $$;

CREATE TABLE public.privacy_notice_acceptances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  notice_version text NOT NULL CHECK (length(notice_version) BETWEEN 1 AND 20),
  accepted_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, notice_version)
);
CREATE INDEX privacy_notice_acceptances_user_idx ON public.privacy_notice_acceptances (user_id, accepted_at DESC);
ALTER TABLE public.privacy_notice_acceptances ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.privacy_notice_acceptances FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.privacy_notice_acceptances TO authenticated;
GRANT ALL ON public.privacy_notice_acceptances TO service_role;
CREATE POLICY privacy_notice_acceptances_read_own ON public.privacy_notice_acceptances FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- Optional consents; erased with the profile (CASCADE), unlike the anonymous acceptance records above.
CREATE TABLE public.consent_preferences (
  user_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  photo_consent boolean NOT NULL DEFAULT false,
  photo_consent_changed_at timestamptz,
  updates_email_consent boolean NOT NULL DEFAULT false,
  updates_email_consent_changed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.consent_preferences ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.consent_preferences FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.consent_preferences TO authenticated;
GRANT ALL ON public.consent_preferences TO service_role;
CREATE POLICY consent_preferences_read_own ON public.consent_preferences FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- Policy helper (authenticated must execute it: RLS runs as the caller). Answers only for the caller.
CREATE FUNCTION public.has_accepted_privacy_notice() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.privacy_notice_acceptances
    WHERE user_id = auth.uid() AND notice_version = public.privacy_notice_version())
$$;

-- Internal: records the current confirmation and optional consents for a user (sign-up trigger).
CREATE FUNCTION public.record_privacy_choices(_user uuid, _photo boolean, _updates boolean) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  INSERT INTO public.privacy_notice_acceptances (user_id, notice_version) VALUES (_user, public.privacy_notice_version())
    ON CONFLICT (user_id, notice_version) DO NOTHING;
  INSERT INTO public.consent_preferences (user_id, photo_consent, photo_consent_changed_at, updates_email_consent, updates_email_consent_changed_at)
    VALUES (_user, coalesce(_photo, false), CASE WHEN _photo THEN now() END, coalesce(_updates, false), CASE WHEN _updates THEN now() END)
    ON CONFLICT (user_id) DO NOTHING;
$$;

-- Sign-up: the account is refused unless the current notice version was confirmed.
CREATE OR REPLACE FUNCTION public.handle_new_user() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _branch uuid;
  _lang text := NEW.raw_user_meta_data->>'preferred_language';
BEGIN
  IF NEW.raw_user_meta_data->>'privacy_notice_version' IS DISTINCT FROM public.privacy_notice_version() THEN
    RAISE EXCEPTION 'Privacy notice must be accepted';
  END IF;
  BEGIN _branch := NULLIF(NEW.raw_user_meta_data->>'branch_id','')::uuid; EXCEPTION WHEN others THEN _branch := NULL; END;
  IF _branch IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.branches WHERE id = _branch) THEN _branch := NULL; END IF;
  IF _lang IS NULL OR _lang NOT IN ('en','tr') THEN _lang := 'en'; END IF;
  INSERT INTO public.profiles (id, full_name, email, phone, branch_id, status, preferred_language)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'full_name',''), NEW.email, NEW.raw_user_meta_data->>'phone', _branch, 'pending', _lang);
  INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'volunteer');
  PERFORM public.record_privacy_choices(NEW.id,
    (NEW.raw_user_meta_data->>'photo_consent') = 'true', (NEW.raw_user_meta_data->>'updates_email_consent') = 'true');
  RETURN NEW;
END $$;

CREATE FUNCTION public.get_privacy_status() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _a public.privacy_notice_acceptances; _c public.consent_preferences;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not signed in'; END IF;
  SELECT * INTO _a FROM public.privacy_notice_acceptances WHERE user_id = auth.uid() ORDER BY (notice_version = public.privacy_notice_version()) DESC, accepted_at DESC LIMIT 1;
  SELECT * INTO _c FROM public.consent_preferences WHERE user_id = auth.uid();
  RETURN jsonb_build_object('current_version', public.privacy_notice_version(),
    'accepted_version', _a.notice_version, 'accepted_at', _a.accepted_at,
    'current_accepted', coalesce(_a.notice_version = public.privacy_notice_version(), false),
    'photo_consent', coalesce(_c.photo_consent, false), 'photo_consent_changed_at', _c.photo_consent_changed_at,
    'updates_email_consent', coalesce(_c.updates_email_consent, false), 'updates_email_consent_changed_at', _c.updates_email_consent_changed_at);
END $$;

-- Confirms the CURRENT version only; an outdated version (an old screen) is refused.
CREATE FUNCTION public.accept_privacy_notice(p_version text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not signed in'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND deleted_at IS NULL) THEN RAISE EXCEPTION 'Not allowed'; END IF;
  IF p_version IS DISTINCT FROM public.privacy_notice_version() THEN RAISE EXCEPTION 'Privacy notice version is out of date'; END IF;
  INSERT INTO public.privacy_notice_acceptances (user_id, notice_version) VALUES (auth.uid(), p_version)
    ON CONFLICT (user_id, notice_version) DO NOTHING;
  RETURN public.get_privacy_status();
END $$;

CREATE FUNCTION public.set_consent_preferences(p_photo_consent boolean, p_updates_email_consent boolean) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not signed in'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND deleted_at IS NULL) THEN RAISE EXCEPTION 'Not allowed'; END IF;
  IF p_photo_consent IS NULL OR p_updates_email_consent IS NULL THEN RAISE EXCEPTION 'Invalid consent values'; END IF;
  INSERT INTO public.consent_preferences AS c (user_id, photo_consent, photo_consent_changed_at, updates_email_consent, updates_email_consent_changed_at)
  VALUES (auth.uid(), p_photo_consent, now(), p_updates_email_consent, now())
  ON CONFLICT (user_id) DO UPDATE SET
    photo_consent = EXCLUDED.photo_consent,
    photo_consent_changed_at = CASE WHEN c.photo_consent IS DISTINCT FROM EXCLUDED.photo_consent THEN now() ELSE c.photo_consent_changed_at END,
    updates_email_consent = EXCLUDED.updates_email_consent,
    updates_email_consent_changed_at = CASE WHEN c.updates_email_consent IS DISTINCT FROM EXCLUDED.updates_email_consent THEN now() ELSE c.updates_email_consent_changed_at END,
    updated_at = now();
  RETURN public.get_privacy_status();
END $$;

-- Members who have not confirmed the current notice read no event or request data (AND-ed with every other policy).
CREATE POLICY privacy_notice_required ON public.events AS RESTRICTIVE FOR SELECT TO authenticated USING (public.has_accepted_privacy_notice());
CREATE POLICY privacy_notice_required ON public.event_series AS RESTRICTIVE FOR SELECT TO authenticated USING (public.has_accepted_privacy_notice());
CREATE POLICY privacy_notice_required ON public.event_media AS RESTRICTIVE FOR SELECT TO authenticated USING (public.has_accepted_privacy_notice());
CREATE POLICY privacy_notice_required ON public.event_registrations AS RESTRICTIVE FOR SELECT TO authenticated USING (public.has_accepted_privacy_notice());
CREATE POLICY privacy_notice_required ON public.event_requests AS RESTRICTIVE FOR SELECT TO authenticated USING (public.has_accepted_privacy_notice());

REVOKE ALL ON FUNCTION public.privacy_notice_version() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.privacy_notice_version() TO anon, authenticated, service_role; -- a constant; the sign-up page needs it
REVOKE ALL ON FUNCTION public.record_privacy_choices(uuid, boolean, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.has_accepted_privacy_notice() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_accepted_privacy_notice() TO authenticated;
REVOKE ALL ON FUNCTION public.get_privacy_status(), public.accept_privacy_notice(text), public.set_consent_preferences(boolean, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_privacy_status(), public.accept_privacy_notice(text), public.set_consent_preferences(boolean, boolean) TO authenticated;

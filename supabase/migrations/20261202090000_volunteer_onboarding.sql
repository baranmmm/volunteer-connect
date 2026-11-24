-- Sign-up and volunteer applications: follower vs volunteer.
-- * A volunteer application now always answers "How would you like to help?" (motivation, 30–500 characters),
--   "How much time can you give?" (time_commitment) and confirms the commitment (commitment_accepted_at). The same
--   rules apply to the sign-up form (handle_new_user) and to "Become a Dialogue Society volunteer" later
--   (submit_volunteer_application). One open application at a time, as before. Older applications keep their values.
-- * Sign-up with the volunteer choice: the account starts as a follower of the chosen branch AND the application is
--   created in the same step (also when the email still has to be confirmed). The answers come in the sign-up
--   metadata (volunteer_application: {help, time, commitment}).
-- * profiles.welcome_seen_at: the welcome screen after sign-up / first sign-in is shown until mark_welcome_seen().
-- * Applicants hear about the decision: volunteer_application_approved / _declined notices (type request_decided);
--   the decline notice carries the manager's note.

ALTER TABLE public.volunteer_applications
  ADD COLUMN time_commitment text,
  ADD COLUMN commitment_accepted_at timestamptz,
  ADD CONSTRAINT volunteer_applications_time_commitment_check
    CHECK (time_commitment IS NULL OR time_commitment IN ('few_hours_month', 'few_hours_week', 'more'));

ALTER TABLE public.profiles ADD COLUMN welcome_seen_at timestamptz;

-- The shared rules for a new application's answers (raises the error the form maps to a message).
CREATE FUNCTION public.check_volunteer_answers(_help text, _time text, _commitment boolean) RETURNS void
LANGUAGE plpgsql IMMUTABLE SET search_path = public AS $$
BEGIN
  IF char_length(btrim(coalesce(_help, ''))) NOT BETWEEN 30 AND 500 THEN
    RAISE EXCEPTION 'Tell us how you would like to help (30 to 500 characters)';
  END IF;
  IF _time IS NULL OR _time NOT IN ('few_hours_month', 'few_hours_week', 'more') THEN
    RAISE EXCEPTION 'Choose how much time you can give';
  END IF;
  IF NOT coalesce(_commitment, false) THEN RAISE EXCEPTION 'Please confirm the volunteering commitment'; END IF;
END $$;

CREATE OR REPLACE FUNCTION public.submit_volunteer_application(p jsonb) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid uuid := auth.uid(); _branch uuid; _id uuid;
BEGIN
  PERFORM public.require_privacy_accepted();
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not signed in'; END IF;
  PERFORM id FROM public.profiles WHERE id = _uid AND status = 'active' AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND OR NOT public.is_follower(_uid) THEN RAISE EXCEPTION 'Only followers can apply to volunteer'; END IF;
  BEGIN _branch := nullif(p->>'branch_id', '')::uuid; EXCEPTION WHEN others THEN _branch := NULL; END;
  IF _branch IS NULL OR NOT EXISTS (SELECT 1 FROM public.branches WHERE id = _branch AND deleted_at IS NULL) THEN RAISE EXCEPTION 'Branch not found'; END IF;
  IF EXISTS (SELECT 1 FROM public.volunteer_applications WHERE user_id = _uid AND status = 'submitted' AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'You already have an open application';
  END IF;
  PERFORM public.check_volunteer_answers(p->>'motivation', p->>'time_commitment', (p->>'commitment')::boolean);
  INSERT INTO public.volunteer_applications (user_id, branch_id, motivation, availability, skills, phone, time_commitment, commitment_accepted_at)
  VALUES (_uid, _branch, btrim(p->>'motivation'), nullif(btrim(coalesce(p->>'availability', '')), ''),
    nullif(btrim(coalesce(p->>'skills', '')), ''), nullif(btrim(coalesce(p->>'phone', '')), ''), p->>'time_commitment', now())
  RETURNING id INTO _id;
  RETURN _id;
END $$;

-- Sign-up: a follower of the chosen branch; with the volunteer choice also an application to that branch.
CREATE OR REPLACE FUNCTION public.handle_new_user() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _branch uuid;
  _lang text := NEW.raw_user_meta_data->>'preferred_language';
  _app jsonb := NEW.raw_user_meta_data->'volunteer_application';
BEGIN
  IF NEW.raw_user_meta_data->>'privacy_notice_version' IS DISTINCT FROM public.privacy_notice_version() THEN
    RAISE EXCEPTION 'Privacy notice must be accepted';
  END IF;
  BEGIN _branch := NULLIF(NEW.raw_user_meta_data->>'branch_id','')::uuid; EXCEPTION WHEN others THEN _branch := NULL; END;
  IF _branch IS NULL OR NOT EXISTS (SELECT 1 FROM public.branches WHERE id = _branch AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'Choose a branch to follow';
  END IF;
  IF _lang IS NULL OR _lang NOT IN ('en','tr') THEN _lang := 'en'; END IF;
  IF _app IS NOT NULL AND jsonb_typeof(_app) = 'object' THEN
    PERFORM public.check_volunteer_answers(_app->>'help', _app->>'time', (_app->>'commitment')::boolean);
  ELSIF _app IS NOT NULL AND jsonb_typeof(_app) <> 'null' THEN
    RAISE EXCEPTION 'Invalid volunteer application';
  END IF;
  INSERT INTO public.profiles (id, full_name, email, phone, branch_id, status, preferred_language)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'full_name',''), NEW.email, NEW.raw_user_meta_data->>'phone', NULL, 'active', _lang);
  INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'follower');
  INSERT INTO public.user_followed_branches (user_id, branch_id) VALUES (NEW.id, _branch);
  PERFORM public.record_privacy_choices(NEW.id,
    (NEW.raw_user_meta_data->>'photo_consent') = 'true', (NEW.raw_user_meta_data->>'updates_email_consent') = 'true');
  IF _app IS NOT NULL AND jsonb_typeof(_app) = 'object' THEN
    INSERT INTO public.volunteer_applications (user_id, branch_id, motivation, phone, time_commitment, commitment_accepted_at)
    VALUES (NEW.id, _branch, btrim(_app->>'help'), nullif(btrim(coalesce(NEW.raw_user_meta_data->>'phone', '')), ''), _app->>'time', now());
  END IF;
  RETURN NEW;
END $$;

-- The new answers in both lists.
CREATE OR REPLACE FUNCTION public.list_volunteer_applications(p_filter text DEFAULT 'open') RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_accepted_privacy_notice() OR NOT public.has_any_role(auth.uid(), ARRAY['branch_manager', 'regional_director']::public.app_role[]) THEN
    RAISE EXCEPTION 'Not allowed';
  END IF;
  RETURN (SELECT coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'branch_id', a.branch_id, 'branch', b.name, 'status', a.status,
      'motivation', a.motivation, 'availability', a.availability, 'skills', a.skills, 'phone', a.phone,
      'time_commitment', a.time_commitment, 'commitment_accepted_at', a.commitment_accepted_at,
      'decline_reason', a.decline_reason, 'reviewed_at', a.reviewed_at, 'created_at', a.created_at,
      'applicant_id', a.user_id, 'applicant_name', coalesce(nullif(p.full_name, ''), 'Former member'), 'applicant_email', p.email,
      'reviewer_name', rv.full_name) ORDER BY a.created_at), '[]'::jsonb)
    FROM public.volunteer_applications a JOIN public.branches b ON b.id = a.branch_id
    LEFT JOIN public.profiles p ON p.id = a.user_id AND p.deleted_at IS NULL
    LEFT JOIN public.profiles rv ON rv.id = a.reviewer_id
    WHERE a.deleted_at IS NULL AND public.can_review_volunteer_application(a.branch_id)
      AND (CASE WHEN p_filter = 'decided' THEN a.status <> 'submitted' ELSE a.status = 'submitted' END));
END $$;

CREATE OR REPLACE FUNCTION public.list_my_volunteer_applications() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'branch_id', a.branch_id, 'branch', b.name, 'status', a.status,
    'motivation', a.motivation, 'availability', a.availability, 'skills', a.skills, 'phone', a.phone,
    'time_commitment', a.time_commitment, 'commitment_accepted_at', a.commitment_accepted_at,
    'decline_reason', a.decline_reason, 'reviewed_at', a.reviewed_at, 'created_at', a.created_at) ORDER BY a.created_at DESC), '[]'::jsonb)
  FROM public.volunteer_applications a JOIN public.branches b ON b.id = a.branch_id
  WHERE a.user_id = auth.uid() AND a.deleted_at IS NULL AND public.has_accepted_privacy_notice()
$$;

-- Decision notices for the applicant.
CREATE OR REPLACE FUNCTION public.notification_type(_kind text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE
    WHEN _kind = 'task_assigned' THEN 'task_assigned'
    WHEN _kind = 'task_note_mention' THEN 'mention'
    WHEN _kind IN ('review_waiting', 'task_request_received', 'meeting_request_received') THEN 'review'
    WHEN _kind = 'task_status_changed' THEN 'task_status'
    WHEN _kind = 'task_note_added' THEN 'task_note'
    WHEN _kind = 'task_reminder' THEN 'task_reminder'
    WHEN _kind LIKE 'meeting\_%' ESCAPE '\' AND _kind NOT LIKE 'meeting\_request\_%' ESCAPE '\' THEN 'meeting'
    WHEN _kind IN ('task_request_accepted', 'task_request_declined', 'meeting_request_approved', 'meeting_request_declined',
      'volunteer_application_approved', 'volunteer_application_declined') THEN 'request_decided'
    ELSE 'other' END
$$;

CREATE OR REPLACE FUNCTION public.approve_volunteer_application(p_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid uuid := auth.uid(); _a public.volunteer_applications; _branch text;
BEGIN
  PERFORM public.require_privacy_accepted();
  PERFORM id FROM public.profiles WHERE id = _uid FOR UPDATE;
  SELECT * INTO _a FROM public.volunteer_applications WHERE id = p_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND OR NOT public.can_review_volunteer_application(_a.branch_id) OR _a.user_id IS NOT DISTINCT FROM _uid THEN RAISE EXCEPTION 'Not allowed'; END IF;
  IF _a.status <> 'submitted' THEN RAISE EXCEPTION 'This application is no longer open'; END IF;
  PERFORM id FROM public.profiles WHERE id = _a.user_id AND status = 'active' AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND OR NOT public.is_follower(_a.user_id) THEN RAISE EXCEPTION 'The applicant is no longer a follower'; END IF;
  SELECT name INTO _branch FROM public.branches WHERE id = _a.branch_id AND deleted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Branch not found'; END IF;
  DELETE FROM public.user_roles WHERE user_id = _a.user_id AND role = 'follower';
  INSERT INTO public.user_roles (user_id, role) VALUES (_a.user_id, 'volunteer');
  UPDATE public.profiles SET branch_id = _a.branch_id WHERE id = _a.user_id;
  INSERT INTO public.user_followed_branches (user_id, branch_id) VALUES (_a.user_id, _a.branch_id) ON CONFLICT DO NOTHING;
  UPDATE public.volunteer_applications SET status = 'approved', reviewer_id = _uid, reviewed_at = now() WHERE id = p_id;
  INSERT INTO public.user_audit_log (actor_id, target_id, action, old_value, new_value) VALUES
    (_uid, _a.user_id, 'role_change', 'follower', 'volunteer'),
    (_uid, _a.user_id, 'branch_change', NULL, _a.branch_id::text);
  PERFORM public.notify(_a.user_id, 'volunteer_application_approved', 'volunteer_application', _a.id, _branch, '/dashboard',
    jsonb_build_object('branch', _branch));
END $$;

CREATE OR REPLACE FUNCTION public.decline_volunteer_application(p_id uuid, p_reason text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _a public.volunteer_applications; _branch text;
BEGIN
  PERFORM public.require_privacy_accepted();
  SELECT * INTO _a FROM public.volunteer_applications WHERE id = p_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND OR NOT public.can_review_volunteer_application(_a.branch_id) OR _a.user_id IS NOT DISTINCT FROM auth.uid() THEN RAISE EXCEPTION 'Not allowed'; END IF;
  IF _a.status <> 'submitted' THEN RAISE EXCEPTION 'This application is no longer open'; END IF;
  IF length(btrim(coalesce(p_reason, ''))) < 10 THEN RAISE EXCEPTION 'Decline reason must be at least 10 characters'; END IF;
  UPDATE public.volunteer_applications SET status = 'declined', decline_reason = btrim(p_reason), reviewer_id = auth.uid(), reviewed_at = now() WHERE id = p_id;
  SELECT name INTO _branch FROM public.branches WHERE id = _a.branch_id;
  PERFORM public.notify(_a.user_id, 'volunteer_application_declined', 'volunteer_application', _a.id, coalesce(_branch, ''), '/dashboard',
    jsonb_build_object('branch', _branch, 'reason', btrim(p_reason)));
END $$;

-- The welcome screen was seen (idempotent).
CREATE FUNCTION public.mark_welcome_seen() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.require_privacy_accepted();
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not signed in'; END IF;
  UPDATE public.profiles SET welcome_seen_at = coalesce(welcome_seen_at, now()) WHERE id = auth.uid();
END $$;

REVOKE ALL ON FUNCTION public.check_volunteer_answers(text, text, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mark_welcome_seen() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_welcome_seen() TO authenticated;

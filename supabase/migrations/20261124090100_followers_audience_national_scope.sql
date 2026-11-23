-- Followers, event audience, national scope, volunteer applications.
--
-- * Everyone who signs up from now on is an active follower with at least one followed branch; existing users keep
--   their roles. Followers see only public published events (and cancelled public events they registered for), their
--   own registrations, applications and profile.
-- * events/event_series.audience: 'members' (default) or 'public'. Public events are visible to every signed-in member
--   and follower, and through the public RPCs (next migration) without signing in.
-- * scope 'national' (no branch, no region): created and managed only by an aal2 National Coordinator.
-- * National Coordinators act only with an aal2 (MFA) session: at aal1 they get nothing beyond their own profile.
-- * volunteer_applications: followers apply to a branch; its Branch Manager and the region's Regional Director review.
-- * Internal tables lose the INSERT/UPDATE/DELETE/TRUNCATE grants Supabase gave anon/authenticated by default
--   (RLS already blocked them; only SECURITY DEFINER functions and the service role write there).

-- ---------------------------------------------------------------------------------------------------------------
-- Grants
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.event_audit_log, public.event_cleanup_audit, public.event_deletion_jobs,
  public.recycle_bin_audit_log, public.user_deletion_state FROM anon, authenticated;
REVOKE ALL ON public.event_cleanup_audit, public.user_deletion_state FROM anon;
REVOKE SELECT ON public.event_audit_log, public.event_deletion_jobs, public.recycle_bin_audit_log FROM anon;

-- ---------------------------------------------------------------------------------------------------------------
-- Columns and constraints
ALTER TABLE public.events ADD COLUMN audience text NOT NULL DEFAULT 'members' CONSTRAINT events_audience_check CHECK (audience IN ('public', 'members'));
ALTER TABLE public.event_series ADD COLUMN audience text NOT NULL DEFAULT 'members' CONSTRAINT event_series_audience_check CHECK (audience IN ('public', 'members'));
-- National events and series have no region.
ALTER TABLE public.events ALTER COLUMN region_id DROP NOT NULL;
ALTER TABLE public.event_series ALTER COLUMN region_id DROP NOT NULL;
ALTER TABLE public.event_series DROP CONSTRAINT event_series_scope_check;
ALTER TABLE public.event_series ADD CONSTRAINT event_series_scope_check CHECK (
  (scope = 'branch' AND branch_id IS NOT NULL AND region_id IS NOT NULL) OR (scope = 'region' AND branch_id IS NULL AND region_id IS NOT NULL)
  OR (scope = 'national' AND branch_id IS NULL AND region_id IS NULL));
-- Audit rows of national items and of followers (no branch, no region).
ALTER TABLE public.recycle_bin_audit_log ALTER COLUMN region_id DROP NOT NULL;
ALTER TABLE public.recycle_bin_audit_log DROP CONSTRAINT recycle_bin_audit_log_item_type_check;
ALTER TABLE public.recycle_bin_audit_log ADD CONSTRAINT recycle_bin_audit_log_item_type_check
  CHECK (item_type IN ('event', 'user', 'series', 'event_request', 'volunteer_application', 'branch', 'region'));
CREATE INDEX events_public_upcoming_idx ON public.events (audience, status) WHERE deleted_at IS NULL AND NOT series_template;

-- ---------------------------------------------------------------------------------------------------------------
-- Role helpers
CREATE FUNCTION public.has_any_role(_uid uuid, _roles public.app_role[]) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _uid AND role = ANY (_roles))
$$;
-- Volunteer, Branch Manager or Regional Director (a member of a branch or region).
CREATE FUNCTION public.is_member(_uid uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.has_any_role(_uid, ARRAY['volunteer', 'branch_manager', 'regional_director']::public.app_role[])
$$;
-- A follower has no member or coordinator role.
CREATE FUNCTION public.is_follower(_uid uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.has_role(_uid, 'follower') AND NOT public.has_any_role(_uid, ARRAY['volunteer', 'branch_manager', 'regional_director', 'national_coordinator']::public.app_role[])
$$;
-- National Coordinator privileges: active, not deleted, and an aal2 (MFA) session.
CREATE FUNCTION public.is_nc() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(auth.jwt() ->> 'aal', '') = 'aal2' AND public.has_role(auth.uid(), 'national_coordinator')
    AND EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND status = 'active' AND deleted_at IS NULL)
$$;
-- False only for a National Coordinator without MFA: such a session gets nothing beyond its own profile.
CREATE FUNCTION public.session_ok() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT NOT public.has_role(auth.uid(), 'national_coordinator') OR coalesce(auth.jwt() ->> 'aal', '') = 'aal2'
$$;
REVOKE ALL ON FUNCTION public.has_any_role(uuid, public.app_role[]), public.is_member(uuid), public.is_follower(uuid), public.is_nc(), public.session_ok() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_any_role(uuid, public.app_role[]), public.is_member(uuid), public.is_follower(uuid), public.is_nc(), public.session_ok() TO authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- Followed branches (members follow their own branch implicitly)
CREATE TABLE public.user_followed_branches (
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, branch_id)
);
ALTER TABLE public.user_followed_branches ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.user_followed_branches FROM anon, authenticated;
GRANT SELECT ON public.user_followed_branches TO authenticated;
CREATE POLICY user_followed_branches_read_own ON public.user_followed_branches FOR SELECT TO authenticated
  USING (user_id = auth.uid() AND (SELECT public.has_accepted_privacy_notice()));
CREATE INDEX user_followed_branches_branch_idx ON public.user_followed_branches (branch_id);

-- ---------------------------------------------------------------------------------------------------------------
-- Volunteer applications
CREATE TABLE public.volunteer_applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  branch_id uuid NOT NULL REFERENCES public.branches(id),
  motivation text NOT NULL CONSTRAINT volunteer_applications_motivation_check CHECK (length(btrim(motivation)) BETWEEN 1 AND 1000),
  availability text CONSTRAINT volunteer_applications_availability_check CHECK (availability IS NULL OR length(availability) <= 500),
  skills text CONSTRAINT volunteer_applications_skills_check CHECK (skills IS NULL OR length(skills) <= 500),
  phone text CONSTRAINT volunteer_applications_phone_check CHECK (phone IS NULL OR length(phone) <= 40),
  status text NOT NULL DEFAULT 'submitted' CONSTRAINT volunteer_applications_status_check CHECK (status IN ('submitted', 'approved', 'declined', 'withdrawn')),
  decline_reason text CONSTRAINT volunteer_applications_decline_reason_check CHECK (decline_reason IS NULL OR length(decline_reason) <= 1000),
  reviewer_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  deleted_at timestamptz,
  deleted_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT volunteer_applications_decline_check CHECK (status <> 'declined' OR length(btrim(coalesce(decline_reason, ''))) >= 10)
);
-- One open application per user.
CREATE UNIQUE INDEX volunteer_applications_one_open ON public.volunteer_applications (user_id) WHERE status = 'submitted' AND deleted_at IS NULL;
CREATE INDEX volunteer_applications_branch_idx ON public.volunteer_applications (branch_id, status) WHERE deleted_at IS NULL;
ALTER TABLE public.volunteer_applications ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.volunteer_applications FROM anon, authenticated;
GRANT SELECT ON public.volunteer_applications TO authenticated;

CREATE FUNCTION public.volunteer_applications_touch() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END $$;
CREATE TRIGGER volunteer_applications_touch BEFORE UPDATE ON public.volunteer_applications FOR EACH ROW EXECUTE FUNCTION public.volunteer_applications_touch();

-- The branch's Branch Manager or the region's Regional Director (never National Coordinators: counts only).
CREATE FUNCTION public.can_review_volunteer_application(_branch uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND status = 'active' AND deleted_at IS NULL)
    AND EXISTS (SELECT 1 FROM public.branches b WHERE b.id = _branch AND (
      EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'regional_director' AND region_id = b.region_id)
      OR (public.has_role(auth.uid(), 'branch_manager') AND public.get_user_branch(auth.uid()) = b.id)))
$$;
REVOKE ALL ON FUNCTION public.can_review_volunteer_application(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_review_volunteer_application(uuid) TO authenticated;

CREATE POLICY volunteer_applications_read_own ON public.volunteer_applications FOR SELECT TO authenticated
  USING (user_id = auth.uid() AND deleted_at IS NULL);
CREATE POLICY volunteer_applications_read_review ON public.volunteer_applications FOR SELECT TO authenticated
  USING (deleted_at IS NULL AND public.can_review_volunteer_application(branch_id));
CREATE POLICY privacy_notice_required ON public.volunteer_applications AS RESTRICTIVE FOR SELECT TO authenticated
  USING ((SELECT public.has_accepted_privacy_notice()));

-- Open applications are withdrawn when their user is soft-deleted (like event requests).
CREATE FUNCTION public.profiles_volunteer_application_sync() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN
    UPDATE public.volunteer_applications SET status = 'withdrawn' WHERE user_id = NEW.id AND status = 'submitted';
  END IF;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.profiles_volunteer_application_sync() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER profiles_volunteer_application_sync AFTER UPDATE OF deleted_at ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.profiles_volunteer_application_sync();

-- ---------------------------------------------------------------------------------------------------------------
-- Visibility and management helpers (redefined)
CREATE OR REPLACE FUNCTION public.can_view_event(_event uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND status = 'active' AND deleted_at IS NULL)
    AND public.session_ok()
    AND EXISTS (SELECT 1 FROM public.events e WHERE e.id = _event AND e.deleted_at IS NULL AND (
      -- Public events: every signed-in member and follower; a cancelled one only for people registered to it.
      (e.audience = 'public' AND (e.status = 'published' OR (e.status = 'cancelled'
        AND EXISTS (SELECT 1 FROM public.event_registrations r WHERE r.event_id = e.id AND r.user_id = auth.uid()))))
      OR (public.is_member(auth.uid()) AND (
        EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'regional_director' AND region_id = e.region_id)
        OR (e.scope = 'branch' AND e.branch_id = public.get_user_branch(auth.uid()) AND (e.status IN ('published', 'cancelled') OR public.has_role(auth.uid(), 'branch_manager')))
        OR (e.scope = 'region' AND e.status IN ('published', 'cancelled') AND EXISTS (SELECT 1 FROM public.profiles p JOIN public.branches b ON b.id = p.branch_id WHERE p.id = auth.uid() AND b.region_id = e.region_id))
        OR (e.scope = 'national' AND e.status IN ('published', 'cancelled'))))
      -- National Coordinators: every published or cancelled event, and national drafts.
      OR (public.is_nc() AND (e.status IN ('published', 'cancelled') OR e.scope = 'national'))))
$$;

CREATE OR REPLACE FUNCTION public.can_manage_event_scope(_scope text, _branch uuid, _region uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
 SELECT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND status = 'active' AND deleted_at IS NULL) AND (
  (_scope IN ('branch', 'region') AND public.has_role(auth.uid(), 'regional_director') AND EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'regional_director' AND region_id = _region)
    AND ((_scope = 'region' AND _branch IS NULL) OR (_scope = 'branch' AND EXISTS (SELECT 1 FROM public.branches WHERE id = _branch AND region_id = _region))))
  OR (_scope = 'branch' AND public.has_role(auth.uid(), 'branch_manager') AND _branch = public.get_user_branch(auth.uid()) AND EXISTS (SELECT 1 FROM public.branches WHERE id = _branch AND region_id = _region))
  OR (_scope = 'national' AND _branch IS NULL AND _region IS NULL AND public.is_nc())
 )
$$;

CREATE OR REPLACE FUNCTION public.can_manage_recycle_scope(_actor uuid, _branch uuid, _region uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
 SELECT EXISTS (SELECT 1 FROM profiles WHERE id = _actor AND status = 'active' AND deleted_at IS NULL)
 AND (EXISTS (SELECT 1 FROM user_roles WHERE user_id = _actor AND role = 'regional_director' AND region_id = _region)
   OR (_branch IS NOT NULL AND public.has_role(_actor, 'branch_manager') AND public.get_user_branch(_actor) = _branch)
   OR (_branch IS NULL AND _region IS NULL AND _actor = auth.uid() AND public.is_nc()));
$$;

-- Who may manage whom. National Coordinators (aal2) manage Regional Directors and Branch Managers only; nobody manages
-- a National Coordinator in the app. Followers have no branch, so no Branch Manager or Regional Director manages them.
CREATE OR REPLACE FUNCTION public.can_manage_user(_actor uuid, _target uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
 SELECT _actor IS NOT NULL AND _target IS NOT NULL AND _actor <> _target
 AND EXISTS (SELECT 1 FROM profiles WHERE id = _actor AND status = 'active' AND deleted_at IS NULL)
 AND EXISTS (SELECT 1 FROM profiles WHERE id = _target AND deleted_at IS NULL)
 AND NOT public.has_role(_target, 'national_coordinator')
 AND (
   (_actor = auth.uid() AND public.is_nc() AND public.has_any_role(_target, ARRAY['branch_manager', 'regional_director']::public.app_role[]))
   OR (NOT public.has_role(_target, 'regional_director') AND (
     EXISTS (SELECT 1 FROM user_roles r JOIN profiles p ON p.id = _target JOIN branches b ON b.id = p.branch_id WHERE r.user_id = _actor AND r.role = 'regional_director' AND r.region_id = b.region_id)
     OR (public.has_role(_actor, 'branch_manager') AND NOT public.has_role(_target, 'branch_manager') AND public.get_user_branch(_actor) IS NOT NULL AND public.get_user_branch(_actor) = public.get_user_branch(_target))))
 );
$$;

CREATE OR REPLACE FUNCTION public.can_manage_deleted_user(_actor uuid, _target uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
 SELECT _actor <> _target AND NOT public.has_any_role(_target, ARRAY['regional_director', 'national_coordinator']::public.app_role[])
 AND EXISTS (SELECT 1 FROM profiles p JOIN branches b ON b.id = p.branch_id WHERE p.id = _target AND p.deleted_at IS NOT NULL
 AND public.can_manage_recycle_scope(_actor, p.branch_id, b.region_id)
 AND (NOT public.has_role(_target, 'branch_manager') OR EXISTS (SELECT 1 FROM user_roles WHERE user_id = _actor AND role = 'regional_director' AND region_id = b.region_id)));
$$;

-- Registrant names are for members only: never for followers or National Coordinators (counts only).
CREATE OR REPLACE FUNCTION public.registrant_names_visible(_event uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT _event IS NOT NULL AND public.is_member(auth.uid()) AND NOT public.has_role(auth.uid(), 'national_coordinator')
$$;

-- Managers read registration rows of their own branch/region events; national registrations are counts only.
DROP POLICY event_registrations_read_managed ON public.event_registrations;
CREATE POLICY event_registrations_read_managed ON public.event_registrations FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.events e WHERE e.id = event_registrations.event_id AND e.deleted_at IS NULL AND e.scope <> 'national'
    AND public.can_manage_event_scope(e.scope, e.branch_id, e.region_id)));

-- Branches and regions: deleted ones (Recycle Bin) are hidden everywhere, also from the sign-up page.
ALTER TABLE public.regions ADD COLUMN deleted_at timestamptz, ADD COLUMN deleted_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL;
ALTER TABLE public.branches ADD COLUMN deleted_at timestamptz, ADD COLUMN deleted_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN deleted_with_region boolean NOT NULL DEFAULT false;
DROP POLICY "Anyone can read branches" ON public.branches;
CREATE POLICY "Anyone can read branches" ON public.branches FOR SELECT TO anon, authenticated USING (deleted_at IS NULL);
DROP POLICY "Anyone can read regions" ON public.regions;
CREATE POLICY "Anyone can read regions" ON public.regions FOR SELECT TO anon, authenticated USING (deleted_at IS NULL);

-- ---------------------------------------------------------------------------------------------------------------
-- Sign-up: every new account is an active follower of the branch chosen on the sign-up page.
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
  IF _branch IS NULL OR NOT EXISTS (SELECT 1 FROM public.branches WHERE id = _branch AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'Choose a branch to follow';
  END IF;
  IF _lang IS NULL OR _lang NOT IN ('en','tr') THEN _lang := 'en'; END IF;
  INSERT INTO public.profiles (id, full_name, email, phone, branch_id, status, preferred_language)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'full_name',''), NEW.email, NEW.raw_user_meta_data->>'phone', NULL, 'active', _lang);
  INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'follower');
  INSERT INTO public.user_followed_branches (user_id, branch_id) VALUES (NEW.id, _branch);
  PERFORM public.record_privacy_choices(NEW.id,
    (NEW.raw_user_meta_data->>'photo_consent') = 'true', (NEW.raw_user_meta_data->>'updates_email_consent') = 'true');
  RETURN NEW;
END $$;

-- ---------------------------------------------------------------------------------------------------------------
-- Followed branches RPCs
CREATE FUNCTION public.follow_branch(p_branch_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.require_privacy_accepted();
  IF auth.uid() IS NULL OR NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND status = 'active' AND deleted_at IS NULL) THEN RAISE EXCEPTION 'Not allowed'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.branches WHERE id = p_branch_id AND deleted_at IS NULL) THEN RAISE EXCEPTION 'Branch not found'; END IF;
  INSERT INTO public.user_followed_branches (user_id, branch_id) VALUES (auth.uid(), p_branch_id) ON CONFLICT DO NOTHING;
END $$;

-- A follower keeps at least one followed branch; members always follow their own branch.
CREATE FUNCTION public.unfollow_branch(p_branch_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.require_privacy_accepted();
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not allowed'; END IF;
  PERFORM id FROM public.profiles WHERE id = auth.uid() FOR UPDATE;
  IF public.get_user_branch(auth.uid()) IS NULL AND NOT EXISTS (
       SELECT 1 FROM public.user_followed_branches f JOIN public.branches b ON b.id = f.branch_id
       WHERE f.user_id = auth.uid() AND f.branch_id <> p_branch_id AND b.deleted_at IS NULL) THEN
    RAISE EXCEPTION 'Follow at least one branch';
  END IF;
  DELETE FROM public.user_followed_branches WHERE user_id = auth.uid() AND branch_id = p_branch_id;
END $$;

-- Own followed branches (the member's own branch included, marked as such).
CREATE FUNCTION public.get_followed_branches() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object('branch_id', b.id, 'name', b.name, 'region_id', b.region_id, 'own', b.id = p.branch_id) ORDER BY b.name), '[]'::jsonb)
  FROM public.profiles p JOIN public.branches b ON b.deleted_at IS NULL AND (b.id = p.branch_id
    OR EXISTS (SELECT 1 FROM public.user_followed_branches f WHERE f.user_id = p.id AND f.branch_id = b.id))
  WHERE p.id = auth.uid() AND public.has_accepted_privacy_notice() AND public.session_ok()
$$;

REVOKE ALL ON FUNCTION public.follow_branch(uuid), public.unfollow_branch(uuid), public.get_followed_branches() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.follow_branch(uuid), public.unfollow_branch(uuid), public.get_followed_branches() TO authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- Volunteer application RPCs (all writes; every one checks the privacy notice)
CREATE FUNCTION public.submit_volunteer_application(p jsonb) RETURNS uuid
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
  INSERT INTO public.volunteer_applications (user_id, branch_id, motivation, availability, skills, phone)
  VALUES (_uid, _branch, btrim(coalesce(p->>'motivation', '')), nullif(btrim(coalesce(p->>'availability', '')), ''),
    nullif(btrim(coalesce(p->>'skills', '')), ''), nullif(btrim(coalesce(p->>'phone', '')), ''))
  RETURNING id INTO _id;
  RETURN _id;
END $$;

CREATE FUNCTION public.withdraw_volunteer_application(p_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.require_privacy_accepted();
  UPDATE public.volunteer_applications SET status = 'withdrawn'
  WHERE id = p_id AND user_id = auth.uid() AND status = 'submitted' AND deleted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Not allowed'; END IF;
END $$;

-- Approval makes the follower a volunteer of the branch (role, branch, audit log), atomically.
CREATE FUNCTION public.approve_volunteer_application(p_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid uuid := auth.uid(); _a public.volunteer_applications;
BEGIN
  PERFORM public.require_privacy_accepted();
  PERFORM id FROM public.profiles WHERE id = _uid FOR UPDATE;
  SELECT * INTO _a FROM public.volunteer_applications WHERE id = p_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND OR NOT public.can_review_volunteer_application(_a.branch_id) OR _a.user_id IS NOT DISTINCT FROM _uid THEN RAISE EXCEPTION 'Not allowed'; END IF;
  IF _a.status <> 'submitted' THEN RAISE EXCEPTION 'This application is no longer open'; END IF;
  PERFORM id FROM public.profiles WHERE id = _a.user_id AND status = 'active' AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND OR NOT public.is_follower(_a.user_id) THEN RAISE EXCEPTION 'The applicant is no longer a follower'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.branches WHERE id = _a.branch_id AND deleted_at IS NULL) THEN RAISE EXCEPTION 'Branch not found'; END IF;
  DELETE FROM public.user_roles WHERE user_id = _a.user_id AND role = 'follower';
  INSERT INTO public.user_roles (user_id, role) VALUES (_a.user_id, 'volunteer');
  UPDATE public.profiles SET branch_id = _a.branch_id WHERE id = _a.user_id;
  INSERT INTO public.user_followed_branches (user_id, branch_id) VALUES (_a.user_id, _a.branch_id) ON CONFLICT DO NOTHING;
  UPDATE public.volunteer_applications SET status = 'approved', reviewer_id = _uid, reviewed_at = now() WHERE id = p_id;
  INSERT INTO public.user_audit_log (actor_id, target_id, action, old_value, new_value) VALUES
    (_uid, _a.user_id, 'role_change', 'follower', 'volunteer'),
    (_uid, _a.user_id, 'branch_change', NULL, _a.branch_id::text);
END $$;

CREATE FUNCTION public.decline_volunteer_application(p_id uuid, p_reason text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _a public.volunteer_applications;
BEGIN
  PERFORM public.require_privacy_accepted();
  SELECT * INTO _a FROM public.volunteer_applications WHERE id = p_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND OR NOT public.can_review_volunteer_application(_a.branch_id) OR _a.user_id IS NOT DISTINCT FROM auth.uid() THEN RAISE EXCEPTION 'Not allowed'; END IF;
  IF _a.status <> 'submitted' THEN RAISE EXCEPTION 'This application is no longer open'; END IF;
  IF length(btrim(coalesce(p_reason, ''))) < 10 THEN RAISE EXCEPTION 'Decline reason must be at least 10 characters'; END IF;
  UPDATE public.volunteer_applications SET status = 'declined', decline_reason = btrim(p_reason), reviewer_id = auth.uid(), reviewed_at = now() WHERE id = p_id;
END $$;

-- Recycle Bin: the applicant deletes their own (an open one is withdrawn first), reviewers delete any in their scope.
CREATE FUNCTION public.delete_volunteer_application(p_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _a public.volunteer_applications; _region uuid;
BEGIN
  PERFORM public.require_privacy_accepted();
  SELECT * INTO _a FROM public.volunteer_applications WHERE id = p_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND OR NOT (_a.user_id = auth.uid() OR public.can_review_volunteer_application(_a.branch_id)) THEN RAISE EXCEPTION 'Not allowed'; END IF;
  SELECT region_id INTO _region FROM public.branches WHERE id = _a.branch_id;
  UPDATE public.volunteer_applications SET status = CASE WHEN status = 'submitted' THEN 'withdrawn' ELSE status END,
    deleted_at = now(), deleted_by = auth.uid() WHERE id = p_id;
  INSERT INTO public.recycle_bin_audit_log (actor_id, item_type, item_id, action, branch_id, region_id)
  VALUES (auth.uid(), 'volunteer_application', p_id, 'delete', _a.branch_id, _region);
END $$;

-- Own applications (newest first).
CREATE FUNCTION public.list_my_volunteer_applications() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'branch_id', a.branch_id, 'branch', b.name, 'status', a.status,
    'motivation', a.motivation, 'availability', a.availability, 'skills', a.skills, 'phone', a.phone,
    'decline_reason', a.decline_reason, 'reviewed_at', a.reviewed_at, 'created_at', a.created_at) ORDER BY a.created_at DESC), '[]'::jsonb)
  FROM public.volunteer_applications a JOIN public.branches b ON b.id = a.branch_id
  WHERE a.user_id = auth.uid() AND a.deleted_at IS NULL AND public.has_accepted_privacy_notice()
$$;

-- Reviewers: applications of their branch/region, with the applicant's name and email. 'open' or 'decided'.
CREATE FUNCTION public.list_volunteer_applications(p_filter text DEFAULT 'open') RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_accepted_privacy_notice() OR NOT public.has_any_role(auth.uid(), ARRAY['branch_manager', 'regional_director']::public.app_role[]) THEN
    RAISE EXCEPTION 'Not allowed';
  END IF;
  RETURN (SELECT coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'branch_id', a.branch_id, 'branch', b.name, 'status', a.status,
      'motivation', a.motivation, 'availability', a.availability, 'skills', a.skills, 'phone', a.phone,
      'decline_reason', a.decline_reason, 'reviewed_at', a.reviewed_at, 'created_at', a.created_at,
      'applicant_id', a.user_id, 'applicant_name', coalesce(nullif(p.full_name, ''), 'Former member'), 'applicant_email', p.email,
      'reviewer_name', rv.full_name) ORDER BY a.created_at), '[]'::jsonb)
    FROM public.volunteer_applications a JOIN public.branches b ON b.id = a.branch_id
    LEFT JOIN public.profiles p ON p.id = a.user_id AND p.deleted_at IS NULL
    LEFT JOIN public.profiles rv ON rv.id = a.reviewer_id
    WHERE a.deleted_at IS NULL AND public.can_review_volunteer_application(a.branch_id)
      AND (CASE WHEN p_filter = 'decided' THEN a.status <> 'submitted' ELSE a.status = 'submitted' END));
END $$;

-- Open applications: reviewers count their scope, National Coordinators the whole country (numbers only).
CREATE FUNCTION public.get_volunteer_application_count() RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT count(*)::integer FROM public.volunteer_applications a
  WHERE a.deleted_at IS NULL AND a.status = 'submitted' AND public.has_accepted_privacy_notice()
    AND (public.is_nc() OR public.can_review_volunteer_application(a.branch_id))
$$;

REVOKE ALL ON FUNCTION public.submit_volunteer_application(jsonb), public.withdraw_volunteer_application(uuid), public.approve_volunteer_application(uuid),
  public.decline_volunteer_application(uuid, text), public.delete_volunteer_application(uuid), public.list_my_volunteer_applications(),
  public.list_volunteer_applications(text), public.get_volunteer_application_count() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_volunteer_application(jsonb), public.withdraw_volunteer_application(uuid), public.approve_volunteer_application(uuid),
  public.decline_volunteer_application(uuid, text), public.delete_volunteer_application(uuid), public.list_my_volunteer_applications(),
  public.list_volunteer_applications(text), public.get_volunteer_application_count() TO authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- Role and branch management (redefined): National Coordinators (aal2) manage Regional Directors and Branch Managers.
DROP FUNCTION public.set_user_role(uuid, public.app_role);
CREATE FUNCTION public.set_user_role(_target uuid, _role public.app_role, _region uuid DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _actor uuid := auth.uid(); _old public.app_role; _old_region uuid; _nc boolean;
BEGIN
  PERFORM public.require_privacy_accepted();
  IF _role IS NULL OR _role IN ('follower', 'national_coordinator') THEN RAISE EXCEPTION 'This role cannot be assigned in the app'; END IF;
  IF _actor IS NULL OR _actor = _target THEN RAISE EXCEPTION 'You cannot change your own role'; END IF;
  PERFORM id FROM public.profiles WHERE id = _actor FOR UPDATE;
  _nc := public.is_nc();
  IF NOT _nc THEN
    IF _role NOT IN ('volunteer', 'branch_manager') THEN RAISE EXCEPTION 'Role must be Volunteer or Branch Manager; Regional Director cannot be assigned'; END IF;
    IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = _actor AND status = 'active') OR NOT public.has_role(_actor, 'regional_director') THEN RAISE EXCEPTION 'Only active Regional Directors can change roles'; END IF;
  END IF;
  PERFORM id FROM public.profiles WHERE id = _target FOR UPDATE;
  IF NOT public.can_manage_user(_actor, _target) THEN RAISE EXCEPTION 'You cannot manage this user'; END IF;
  SELECT role, region_id INTO _old, _old_region FROM public.user_roles WHERE user_id = _target AND role IN ('volunteer', 'branch_manager', 'regional_director')
    ORDER BY CASE role WHEN 'regional_director' THEN 0 WHEN 'branch_manager' THEN 1 ELSE 2 END LIMIT 1;
  IF _role = 'regional_director' THEN
    _region := coalesce(_region, _old_region);
    IF _region IS NULL OR NOT EXISTS (SELECT 1 FROM public.regions WHERE id = _region AND deleted_at IS NULL) THEN RAISE EXCEPTION 'Choose a region'; END IF;
  ELSE
    _region := NULL;
    IF public.get_user_branch(_target) IS NULL THEN RAISE EXCEPTION 'Assign a branch first'; END IF;
  END IF;
  IF _old = _role AND _old_region IS NOT DISTINCT FROM _region
     AND (SELECT count(*) FROM public.user_roles WHERE user_id = _target) = 1 THEN RETURN; END IF;
  DELETE FROM public.user_roles WHERE user_id = _target AND role IN ('follower', 'volunteer', 'branch_manager', 'regional_director');
  INSERT INTO public.user_roles (user_id, role, region_id) VALUES (_target, _role, _region);
  INSERT INTO public.user_audit_log (actor_id, target_id, action, old_value, new_value)
  VALUES (_actor, _target, 'role_change', _old::text, _role::text);
END $$;
REVOKE ALL ON FUNCTION public.set_user_role(uuid, public.app_role, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_user_role(uuid, public.app_role, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.set_user_branch(_target uuid, _branch uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _actor uuid := auth.uid(); _old uuid; _region uuid; _nc boolean;
BEGIN
  PERFORM public.require_privacy_accepted();
  IF _actor IS NULL OR _actor = _target THEN RAISE EXCEPTION 'You cannot move your own branch'; END IF;
  PERFORM id FROM public.profiles WHERE id = _actor FOR UPDATE;
  _nc := public.is_nc();
  IF NOT _nc AND (NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = _actor AND status = 'active') OR NOT public.has_role(_actor, 'regional_director')) THEN
    RAISE EXCEPTION 'Only active Regional Directors can move users';
  END IF;
  SELECT region_id INTO _region FROM public.user_roles WHERE user_id = _actor AND role = 'regional_director' LIMIT 1;
  SELECT branch_id INTO _old FROM public.profiles WHERE id = _target FOR UPDATE;
  IF NOT public.can_manage_user(_actor, _target) THEN RAISE EXCEPTION 'You cannot manage this user'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.branches WHERE id = _branch AND deleted_at IS NULL AND (_nc OR region_id = _region)) THEN
    RAISE EXCEPTION 'The new branch must belong to your region';
  END IF;
  IF _old IS NOT DISTINCT FROM _branch THEN RETURN; END IF;
  UPDATE public.profiles SET branch_id = _branch WHERE id = _target;
  INSERT INTO public.user_audit_log (actor_id, target_id, action, old_value, new_value) VALUES (_actor, _target, 'branch_change', _old::text, _branch::text);
END $$;

-- ---------------------------------------------------------------------------------------------------------------
-- Follower self-deletion (service role only; the deleteMyAccount server function checks the typed name first).
-- Followers have no manager, so their erasure is self-service and, like every self-requested erasure, non-restorable.
CREATE FUNCTION public.authorize_follower_self_deletion(_target uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _p public.profiles; _audit uuid;
BEGIN
  SELECT * INTO _p FROM public.profiles WHERE id = _target FOR UPDATE;
  IF NOT FOUND OR _p.deleted_at IS NOT NULL OR NOT public.is_follower(_target) THEN RAISE EXCEPTION 'Not allowed'; END IF;
  IF EXISTS (SELECT 1 FROM public.user_deletion_state WHERE target_id = _target) THEN RAISE EXCEPTION 'Not allowed'; END IF;
  INSERT INTO public.user_audit_log (actor_id, target_id, action) VALUES (_target, _target, 'deletion_requested');
  INSERT INTO public.user_audit_log (actor_id, target_id, action) VALUES (_target, _target, 'user_deleted') RETURNING id INTO _audit;
  INSERT INTO public.user_deletion_state (target_id, deletion_audit_id, previous_status, self_requested, operation, operation_actor)
  VALUES (_target, _audit, _p.status, true, 'deleting', _target);
  UPDATE public.profiles SET deleted_at = now(), deleted_by = _target, status = 'inactive' WHERE id = _target;
  INSERT INTO public.recycle_bin_audit_log (actor_id, item_type, item_id, action, branch_id, region_id) VALUES (_target, 'user', _target, 'delete', NULL, NULL);
  RETURN _audit;
END $$;
REVOKE ALL ON FUNCTION public.authorize_follower_self_deletion(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.authorize_follower_self_deletion(uuid) TO service_role;


-- ---------------------------------------------------------------------------------------------------------------
-- Existing functions, patched (audience, national scope, followers, National Coordinators)

CREATE OR REPLACE FUNCTION public.validate_event()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE _today date := (now() AT TIME ZONE 'Europe/London')::date; _times_changed boolean;
BEGIN
 IF NEW.title IS NULL OR length(trim(NEW.title))=0 OR length(NEW.title)>200 OR NEW.organizer IS NULL OR length(NEW.organizer)>200 THEN RAISE EXCEPTION 'Event title and organizer are required'; END IF;
 IF NEW.category IS NULL OR NEW.category NOT IN ('dialogue','dinner','interfaith','community','education','other') OR NEW.scope IS NULL OR NEW.scope NOT IN ('branch','region','national') OR NEW.audience IS NULL OR NEW.audience NOT IN ('public','members') OR NEW.status IS NULL OR NEW.status NOT IN ('draft','published','cancelled') OR NEW.all_day IS NULL OR NEW.location_type IS NULL OR NEW.location_type NOT IN ('in_person','online') THEN RAISE EXCEPTION 'Invalid event values'; END IF;
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
 IF (NEW.scope='branch' AND NOT EXISTS(SELECT 1 FROM branches WHERE id=NEW.branch_id AND region_id=NEW.region_id)) OR (NEW.scope='region' AND (NEW.branch_id IS NOT NULL OR NEW.region_id IS NULL))
    OR (NEW.scope='national' AND (NEW.branch_id IS NOT NULL OR NEW.region_id IS NOT NULL)) THEN RAISE EXCEPTION 'Invalid event scope'; END IF;
 IF TG_OP='INSERT' AND NEW.branch_id IS NOT NULL AND EXISTS(SELECT 1 FROM branches WHERE id=NEW.branch_id AND deleted_at IS NOT NULL) THEN RAISE EXCEPTION 'Branch not found'; END IF;
 NEW.title:=trim(NEW.title); NEW.organizer:=trim(NEW.organizer); NEW.updated_at:=now(); RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.create_event(_data jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _id uuid; _branch uuid := nullif(_data->>'branch_id', '')::uuid; _region uuid; _scope text := _data->>'scope';
BEGIN
  PERFORM public.require_privacy_accepted();
  PERFORM id FROM profiles WHERE id = auth.uid() FOR UPDATE;
  IF _data->>'status' = 'draft' AND _branch IS NULL AND _scope IS DISTINCT FROM 'region' AND _scope IS DISTINCT FROM 'national' THEN
    IF public.is_nc() THEN _scope := 'national'; ELSIF public.has_role(auth.uid(), 'regional_director') THEN _scope := 'region'; ELSE _branch := public.get_user_branch(auth.uid()); _scope := 'branch'; END IF;
  END IF;
  IF _scope = 'national' THEN _branch := NULL; _region := NULL; ELSIF _scope = 'branch' THEN SELECT region_id INTO _region FROM branches WHERE id = _branch; ELSE SELECT region_id INTO _region FROM user_roles WHERE user_id = auth.uid() AND role = 'regional_director' LIMIT 1; END IF;
  IF NOT public.can_manage_event_scope(_scope, _branch, _region) THEN RAISE EXCEPTION 'Not allowed'; END IF;
  IF _data->>'status' IS NULL OR _data->>'status' NOT IN ('draft', 'published') THEN RAISE EXCEPTION 'Invalid event values'; END IF;
  INSERT INTO events (title, description, location, start_at, end_at, all_day, start_date, end_date, location_type, online_url, organizer, category, capacity,
    registration_enabled, audience, scope, branch_id, region_id, status, created_by)
  VALUES (_data->>'title', coalesce(_data->>'description', ''), coalesce(_data->>'location', ''), nullif(_data->>'start_at', '')::timestamptz,
    nullif(_data->>'end_at', '')::timestamptz, coalesce((_data->>'all_day')::boolean, false), nullif(_data->>'start_date', '')::date,
    nullif(_data->>'end_date', '')::date, coalesce(nullif(_data->>'location_type', ''), 'in_person'), nullif(_data->>'online_url', ''),
    coalesce(nullif(trim(_data->>'organizer'), ''), 'Dialogue Society'), coalesce(_data->>'category', 'dialogue'), nullif(_data->>'capacity', '')::integer,
    coalesce((_data->>'registration_enabled')::boolean, true), coalesce(nullif(_data->>'audience', ''), 'members'), _scope, _branch, _region, _data->>'status', auth.uid())
  RETURNING id INTO _id;
  RETURN _id;
END $function$;

CREATE OR REPLACE FUNCTION public.update_event(_event uuid, _data jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _branch uuid := nullif(_data->>'branch_id', '')::uuid; _region uuid; _scope text := _data->>'scope'; _old_status text; _old_reg boolean;
BEGIN
  PERFORM public.require_privacy_accepted();
  PERFORM id FROM public.profiles WHERE id = auth.uid() FOR UPDATE;
  SELECT status, registration_enabled INTO _old_status, _old_reg FROM public.events WHERE id = _event FOR UPDATE;
  IF NOT FOUND OR NOT public.can_manage_event(_event) THEN RAISE EXCEPTION 'Not allowed'; END IF;
  IF _scope = 'national' THEN _branch := NULL; _region := NULL; ELSIF _scope = 'branch' THEN SELECT region_id INTO _region FROM public.branches WHERE id = _branch; ELSE SELECT region_id INTO _region FROM public.user_roles WHERE user_id = auth.uid() AND role = 'regional_director' LIMIT 1; END IF;
  IF NOT public.can_manage_event_scope(_scope, _branch, _region) THEN RAISE EXCEPTION 'Not allowed'; END IF;
  IF _data->>'status' IS NULL OR _data->>'status' NOT IN ('draft', 'published', 'cancelled') OR (_old_status = 'cancelled' AND _data->>'status' <> 'cancelled') OR (_old_status <> 'cancelled' AND _data->>'status' = 'cancelled') THEN RAISE EXCEPTION 'Invalid event values'; END IF;
  UPDATE public.events SET title = _data->>'title', description = coalesce(_data->>'description', ''), location = coalesce(_data->>'location', ''),
    start_at = nullif(_data->>'start_at', '')::timestamptz, end_at = nullif(_data->>'end_at', '')::timestamptz, all_day = coalesce((_data->>'all_day')::boolean, false),
    start_date = nullif(_data->>'start_date', '')::date, end_date = nullif(_data->>'end_date', '')::date, location_type = coalesce(nullif(_data->>'location_type', ''), 'in_person'),
    online_url = nullif(_data->>'online_url', ''), organizer = coalesce(nullif(trim(_data->>'organizer'), ''), 'Dialogue Society'), category = _data->>'category',
    capacity = nullif(_data->>'capacity', '')::integer, registration_enabled = coalesce((_data->>'registration_enabled')::boolean, _old_reg), audience = coalesce(nullif(_data->>'audience', ''), audience),
    scope = _scope, branch_id = _branch, region_id = _region, status = _data->>'status'
  WHERE id = _event;
END $function$;

CREATE OR REPLACE FUNCTION public.create_series(_data jsonb, _rule text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _branch uuid := nullif(_data->>'branch_id', '')::uuid; _scope text := _data->>'scope'; _region uuid;
  _status text := coalesce(nullif(_data->>'status', ''), 'published'); _t record; _sid uuid; _mid uuid; _first uuid; _n integer; _prev text;
BEGIN
  PERFORM public.require_privacy_accepted();
  PERFORM id FROM public.profiles WHERE id = auth.uid() FOR UPDATE;
  IF _status NOT IN ('draft', 'published') THEN RAISE EXCEPTION 'Invalid event values'; END IF;
  IF _status = 'draft' AND _branch IS NULL AND _scope IS DISTINCT FROM 'region' AND _scope IS DISTINCT FROM 'national' THEN
    IF public.is_nc() THEN _scope := 'national'; ELSIF public.has_role(auth.uid(), 'regional_director') THEN _scope := 'region'; ELSE _branch := public.get_user_branch(auth.uid()); _scope := 'branch'; END IF;
  END IF;
  IF _scope = 'national' THEN _branch := NULL; _region := NULL; ELSIF _scope = 'branch' THEN SELECT region_id INTO _region FROM public.branches WHERE id = _branch;
  ELSE SELECT region_id INTO _region FROM public.user_roles WHERE user_id = auth.uid() AND role = 'regional_director' LIMIT 1; END IF;
  IF NOT public.can_manage_event_scope(_scope, _branch, _region) THEN RAISE EXCEPTION 'Not allowed'; END IF;
  SELECT * INTO _t FROM public.series_timing(_data);
  PERFORM 1 FROM public.series_expand(upper(_rule), _t.dtstart_local, _t.dtstart_local, _t.dtstart_local, 1);  -- validates the rule
  _prev := public.series_op_begin();
  INSERT INTO public.events (title, description, location, location_type, online_url, organizer, category, capacity, registration_enabled, audience,
    scope, branch_id, region_id, status, created_by, all_day, series_template)
  VALUES (_data->>'title', coalesce(_data->>'description', ''), coalesce(_data->>'location', ''), coalesce(nullif(_data->>'location_type', ''), 'in_person'),
    nullif(_data->>'online_url', ''), coalesce(nullif(trim(_data->>'organizer'), ''), 'Dialogue Society'), coalesce(_data->>'category', 'dialogue'),
    nullif(_data->>'capacity', '')::integer, coalesce((_data->>'registration_enabled')::boolean, true), coalesce(nullif(_data->>'audience', ''), 'members'), _scope, _branch, _region, 'draft', auth.uid(), _t.all_day, true)
  RETURNING id INTO _mid;
  INSERT INTO public.event_series (rule, all_day, dtstart_local, duration_minutes, span_days, status, title, description, location,
    location_type, online_url, organizer, category, capacity, registration_enabled, audience, scope, branch_id, region_id, media_event_id, created_by)
  SELECT upper(_rule), _t.all_day, _t.dtstart_local, _t.duration_minutes, _t.span_days, _status, e.title, e.description, e.location,
    e.location_type, e.online_url, e.organizer, e.category, e.capacity, e.registration_enabled, e.audience, e.scope, e.branch_id, e.region_id, e.id, auth.uid()
  FROM public.events e WHERE e.id = _mid
  RETURNING id INTO _sid;
  _n := public.series_generate(_sid, 100);
  SELECT id INTO _first FROM public.events WHERE series_id = _sid ORDER BY recurrence_key LIMIT 1;
  IF _first IS NULL THEN RAISE EXCEPTION 'Recurrence has no upcoming events'; END IF;
  INSERT INTO public.event_audit_log (actor_id, event_id, action, scope, branch_id, region_id) VALUES (auth.uid(), _sid, 'series_created', _scope, _branch, _region);
  PERFORM public.series_op_end(_prev);
  RETURN jsonb_build_object('series_id', _sid, 'event_id', _first, 'media_event_id', _mid, 'count', _n);
END $function$;

CREATE OR REPLACE FUNCTION public.series_generate(_series uuid, _limit integer DEFAULT 100)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _s public.event_series; _now_local timestamp := now() AT TIME ZONE 'Europe/London';
  _to timestamp; _from timestamp; _cand timestamp; _last timestamp; _inserted integer := 0; _id uuid;
  _start timestamptz; _end timestamptz; _prev text;
BEGIN
  SELECT * INTO _s FROM public.event_series WHERE id = _series FOR UPDATE;
  IF NOT FOUND OR _s.deleted_at IS NOT NULL THEN RETURN 0; END IF;
  _prev := public.series_op_begin();
  _to := date_trunc('day', _now_local) + interval '12 months' + interval '1 day' - interval '1 second';
  _from := coalesce(_s.generated_until + interval '1 second', _s.dtstart_local);
  IF _from > _to THEN PERFORM public.series_op_end(_prev); RETURN 0; END IF;
  FOR _cand IN SELECT * FROM public.series_expand(_s.rule, _s.dtstart_local, _from, _to, 100000) LOOP
    _last := _cand;
    _id := NULL;
    IF _s.all_day THEN
      CONTINUE WHEN (_cand::date + _s.span_days) < _now_local::date;
      INSERT INTO public.events (title, description, location, location_type, online_url, organizer, category, capacity, registration_enabled, audience,
        scope, branch_id, region_id, status, created_by, all_day, start_date, end_date, start_at, end_at, series_id, recurrence_key)
      VALUES (_s.title, _s.description, _s.location, _s.location_type, _s.online_url, _s.organizer, _s.category, _s.capacity, _s.registration_enabled, _s.audience,
        _s.scope, _s.branch_id, _s.region_id, _s.status, _s.created_by, true, _cand::date, _cand::date + _s.span_days, NULL, NULL, _s.id, _cand)
      ON CONFLICT (series_id, recurrence_key) DO NOTHING RETURNING id INTO _id;
    ELSE
      _start := _cand AT TIME ZONE 'Europe/London';
      _end := (_cand + make_interval(mins => _s.duration_minutes)) AT TIME ZONE 'Europe/London';
      CONTINUE WHEN _end < now();
      INSERT INTO public.events (title, description, location, location_type, online_url, organizer, category, capacity, registration_enabled, audience,
        scope, branch_id, region_id, status, created_by, all_day, start_date, end_date, start_at, end_at, series_id, recurrence_key)
      VALUES (_s.title, _s.description, _s.location, _s.location_type, _s.online_url, _s.organizer, _s.category, _s.capacity, _s.registration_enabled, _s.audience,
        _s.scope, _s.branch_id, _s.region_id, _s.status, _s.created_by, false, NULL, NULL, _start, _end, _s.id, _cand)
      ON CONFLICT (series_id, recurrence_key) DO NOTHING RETURNING id INTO _id;
    END IF;
    IF _id IS NOT NULL THEN _inserted := _inserted + 1; END IF;
    EXIT WHEN _inserted >= _limit;
  END LOOP;
  UPDATE public.event_series SET generated_until = CASE WHEN _inserted >= _limit THEN _last ELSE _to END WHERE id = _series;
  PERFORM public.series_op_end(_prev);
  RETURN _inserted;
END $function$;

CREATE OR REPLACE FUNCTION public.update_series_event(_event uuid, _mode text, _data jsonb, _rule text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _e public.events; _s public.event_series; _old uuid; _t record; _new_rule text; _dt timestamp; _timing boolean; _rule_changed boolean;
  _status text := coalesce(nullif(_data->>'status', ''), 'published'); _target uuid; _remaining integer; _done integer; _first uuid; _prev text;
  _del_series uuid; _from timestamp; _protected uuid[] := '{}'; _p public.events; _cand timestamp; _kept jsonb := '[]'::jsonb;
BEGIN
  PERFORM public.require_privacy_accepted();
  PERFORM id FROM public.profiles WHERE id = auth.uid() FOR UPDATE;
  SELECT * INTO _e FROM public.events WHERE id = _event FOR UPDATE;
  IF NOT FOUND OR _e.series_id IS NULL OR _e.series_template OR _e.deleted_at IS NOT NULL OR NOT public.can_manage_event(_event) THEN RAISE EXCEPTION 'Not allowed'; END IF;
  SELECT * INTO _s FROM public.event_series WHERE id = _e.series_id FOR UPDATE;
  IF _s.deleted_at IS NOT NULL OR NOT public.can_manage_event_scope(_s.scope, _s.branch_id, _s.region_id) THEN RAISE EXCEPTION 'Not allowed'; END IF;
  IF _mode NOT IN ('this', 'following', 'all') THEN RAISE EXCEPTION 'Invalid event values'; END IF;

  IF _mode = 'this' THEN
    -- update_event re-checks permissions; the guard trigger marks the occurrence as an exception.
    PERFORM public.update_event(_event, _data || jsonb_build_object('scope', _s.scope, 'branch_id', _s.branch_id));
    RETURN jsonb_build_object('series_id', _s.id, 'event_id', _event, 'kept_off_rule', '[]'::jsonb);
  END IF;

  IF _status NOT IN ('draft', 'published') THEN RAISE EXCEPTION 'Invalid event values'; END IF;
  IF length(trim(coalesce(_data->>'title', ''))) = 0 THEN RAISE EXCEPTION 'Event title and organizer are required'; END IF;
  SELECT * INTO _t FROM public.series_timing(_data);
  _old := _s.id;
  -- The client sends _rule only when the user changed the recurrence; otherwise the series rule is kept.
  _new_rule := upper(coalesce(nullif(_rule, ''), _s.rule));
  _rule_changed := nullif(_rule, '') IS NOT NULL AND upper(_rule) <> _s.rule;
  PERFORM 1 FROM public.series_expand(_new_rule, _t.dtstart_local, _t.dtstart_local, _t.dtstart_local, 1);
  _prev := public.series_op_begin();

  IF _mode = 'all' THEN
    -- Keep the series' first date; take the new time of day (or the new all-day span).
    _dt := CASE WHEN _t.all_day THEN _s.dtstart_local::date::timestamp ELSE _s.dtstart_local::date + (_t.dtstart_local - date_trunc('day', _t.dtstart_local)) END;
    _timing := _rule_changed OR _dt <> _s.dtstart_local OR _t.all_day <> _s.all_day
               OR _t.duration_minutes IS DISTINCT FROM _s.duration_minutes OR _t.span_days <> _s.span_days;
    _target := _s.id;
  ELSE -- following: a new series from this occurrence on; the old one ends just before it
    _dt := _t.dtstart_local;
    _timing := _rule_changed OR _dt <> _e.recurrence_key OR _t.all_day <> _s.all_day
               OR _t.duration_minutes IS DISTINCT FROM _s.duration_minutes OR _t.span_days <> _s.span_days;
    IF nullif(_rule, '') IS NULL AND _s.rule ~ '(^|;)COUNT=' THEN
      SELECT count(*) INTO _done FROM public.series_expand(_s.rule, _s.dtstart_local, _s.dtstart_local, _e.recurrence_key - interval '1 second', 100000);
      _remaining := substring(_s.rule FROM 'COUNT=([0-9]+)')::int - _done;
      _new_rule := public.series_rule_count(_new_rule, _remaining);
    END IF;
    INSERT INTO public.event_series (rule, all_day, dtstart_local, duration_minutes, span_days, status, title, description, location,
      location_type, online_url, organizer, category, capacity, registration_enabled, audience, scope, branch_id, region_id, media_event_id, created_by)
    VALUES (_new_rule, _t.all_day, _dt, _t.duration_minutes, _t.span_days, _status, trim(_data->>'title'), coalesce(_data->>'description', ''),
      coalesce(_data->>'location', ''), coalesce(nullif(_data->>'location_type', ''), 'in_person'), nullif(_data->>'online_url', ''),
      coalesce(nullif(trim(_data->>'organizer'), ''), 'Dialogue Society'), coalesce(_data->>'category', _s.category), nullif(_data->>'capacity', '')::integer,
      coalesce((_data->>'registration_enabled')::boolean, _s.registration_enabled), coalesce(nullif(_data->>'audience', ''), _s.audience),
      _s.scope, _s.branch_id, _s.region_id, _s.media_event_id, _s.created_by)
    RETURNING id INTO _target;
    UPDATE public.event_series SET rule = public.series_rule_until(rule, _e.recurrence_key, all_day), updated_at = now() WHERE id = _s.id;
    -- Exceptions and deleted occurrences from here on move to the new series unchanged.
    UPDATE public.events SET series_id = _target WHERE series_id = _s.id AND recurrence_key >= _e.recurrence_key AND (series_exception OR deleted_at IS NOT NULL);
    IF NOT _timing THEN
      UPDATE public.events SET series_id = _target WHERE series_id = _s.id AND recurrence_key >= _e.recurrence_key;
      UPDATE public.event_series SET generated_until = _s.generated_until WHERE id = _target;
    END IF;
  END IF;

  UPDATE public.event_series SET rule = CASE WHEN _mode = 'all' THEN _new_rule ELSE rule END,
    all_day = _t.all_day, dtstart_local = _dt, duration_minutes = _t.duration_minutes, span_days = _t.span_days, status = _status,
    title = trim(_data->>'title'), description = coalesce(_data->>'description', ''), location = coalesce(_data->>'location', ''),
    location_type = coalesce(nullif(_data->>'location_type', ''), 'in_person'), online_url = nullif(_data->>'online_url', ''),
    organizer = coalesce(nullif(trim(_data->>'organizer'), ''), 'Dialogue Society'), category = coalesce(_data->>'category', category),
    capacity = nullif(_data->>'capacity', '')::integer, registration_enabled = coalesce((_data->>'registration_enabled')::boolean, registration_enabled),
    audience = coalesce(nullif(_data->>'audience', ''), audience), updated_at = now()
  WHERE id = _target;
  SELECT * INTO _s FROM public.event_series WHERE id = _target;

  -- Content of every live, non-exception occurrence.
  UPDATE public.events SET title = _s.title, description = _s.description, location = _s.location, location_type = _s.location_type,
    online_url = _s.online_url, organizer = _s.organizer, category = _s.category, capacity = _s.capacity, registration_enabled = _s.registration_enabled, audience = _s.audience
  WHERE series_id = _target AND NOT series_exception AND deleted_at IS NULL;
  -- Status only for occurrences that have not ended (a published occurrence may not end in the past).
  UPDATE public.events SET status = _s.status
  WHERE series_id = _target AND NOT series_exception AND deleted_at IS NULL AND status <> _s.status AND status <> 'cancelled'
    AND coalesce(end_at, (coalesce(end_date, start_date) + 1)::timestamp AT TIME ZONE 'Europe/London') > now();

  IF _timing THEN
    -- 'all': future occurrences of the series; 'following': the old series' occurrences from here on.
    _del_series := CASE WHEN _mode = 'all' THEN _target ELSE _old END;
    _from := CASE WHEN _mode = 'all' THEN (now() AT TIME ZONE 'Europe/London') ELSE _e.recurrence_key END;
    -- Occurrences with an active registration are never deleted and regenerated.
    SELECT coalesce(array_agg(x.id), '{}') INTO _protected FROM public.events x
    WHERE x.series_id = _del_series AND NOT x.series_exception AND x.deleted_at IS NULL AND x.recurrence_key >= _from
      AND EXISTS (SELECT 1 FROM public.event_registrations g WHERE g.event_id = x.id AND g.status IN ('registered', 'waitlisted'));
    DELETE FROM public.events WHERE series_id = _del_series AND NOT series_exception AND deleted_at IS NULL AND recurrence_key >= _from
      AND NOT (id = ANY (_protected));
    FOR _p IN SELECT * FROM public.events WHERE id = ANY (_protected) ORDER BY recurrence_key FOR UPDATE LOOP
      -- The new rule's occurrence on the same London day, if it has one that has not ended and is free.
      SELECT c INTO _cand FROM public.series_expand(_s.rule, _s.dtstart_local, _p.recurrence_key::date::timestamp,
        _p.recurrence_key::date::timestamp + interval '1 day' - interval '1 second', 1) c;
      IF _cand IS NOT NULL AND (CASE WHEN _s.all_day THEN (_cand::date + _s.span_days) >= (now() AT TIME ZONE 'Europe/London')::date
                                     ELSE ((_cand + make_interval(mins => _s.duration_minutes)) AT TIME ZONE 'Europe/London') > now() END)
         AND NOT EXISTS (SELECT 1 FROM public.events o WHERE o.series_id = _target AND o.recurrence_key = _cand AND o.id <> _p.id) THEN
        UPDATE public.events SET series_id = _target, recurrence_key = _cand, series_exception = true,
          title = _s.title, description = _s.description, location = _s.location, location_type = _s.location_type, online_url = _s.online_url,
          organizer = _s.organizer, category = _s.category, capacity = _s.capacity, registration_enabled = _s.registration_enabled, audience = _s.audience,
          all_day = _s.all_day,
          start_at = CASE WHEN _s.all_day THEN NULL ELSE _cand AT TIME ZONE 'Europe/London' END,
          end_at = CASE WHEN _s.all_day THEN NULL ELSE (_cand + make_interval(mins => _s.duration_minutes)) AT TIME ZONE 'Europe/London' END,
          start_date = CASE WHEN _s.all_day THEN _cand::date END,
          end_date = CASE WHEN _s.all_day THEN _cand::date + _s.span_days END
        WHERE id = _p.id;
      ELSE
        UPDATE public.events SET series_id = _target, series_exception = true,
          title = _s.title, description = _s.description, location = _s.location, location_type = _s.location_type, online_url = _s.online_url,
          organizer = _s.organizer, category = _s.category, capacity = _s.capacity, registration_enabled = _s.registration_enabled, audience = _s.audience
        WHERE id = _p.id;
        _kept := _kept || to_jsonb(_p.id);
      END IF;
    END LOOP;
    UPDATE public.event_series SET generated_until = NULL WHERE id = _target;
    PERFORM public.series_generate(_target, 100);
  END IF;
  INSERT INTO public.event_audit_log (actor_id, event_id, action, scope, branch_id, region_id) VALUES (auth.uid(), _target, 'series_updated', _s.scope, _s.branch_id, _s.region_id);
  SELECT id INTO _first FROM public.events WHERE series_id = _target AND deleted_at IS NULL AND recurrence_key >= coalesce(_e.recurrence_key, '-infinity') ORDER BY recurrence_key LIMIT 1;
  PERFORM public.series_op_end(_prev);
  RETURN jsonb_build_object('series_id', _target, 'event_id', coalesce(_first, _event), 'kept_off_rule', _kept);
END $function$;

CREATE OR REPLACE FUNCTION public.events_series_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF coalesce(current_setting('app.series_op', true), '') = 'on' THEN RETURN NEW; END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.series_id IS NOT NULL OR NEW.series_template OR NEW.series_exception OR NEW.deleted_with_series OR NEW.recurrence_key IS NOT NULL THEN
      RAISE EXCEPTION 'Not allowed';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.series_template THEN RAISE EXCEPTION 'Not allowed'; END IF;
  IF NEW.series_id IS DISTINCT FROM OLD.series_id OR NEW.recurrence_key IS DISTINCT FROM OLD.recurrence_key
     OR NEW.series_template IS DISTINCT FROM OLD.series_template OR NEW.deleted_with_series IS DISTINCT FROM OLD.deleted_with_series
     OR (OLD.series_exception AND NOT NEW.series_exception) THEN
    RAISE EXCEPTION 'Not allowed';
  END IF;
  IF NEW.series_id IS NOT NULL AND ROW(NEW.title, NEW.description, NEW.location, NEW.location_type, NEW.online_url, NEW.organizer,
       NEW.category, NEW.capacity, NEW.registration_enabled, NEW.audience, NEW.all_day, NEW.start_at, NEW.end_at, NEW.start_date, NEW.end_date, NEW.status)
     IS DISTINCT FROM ROW(OLD.title, OLD.description, OLD.location, OLD.location_type, OLD.online_url, OLD.organizer,
       OLD.category, OLD.capacity, OLD.registration_enabled, OLD.audience, OLD.all_day, OLD.start_at, OLD.end_at, OLD.start_date, OLD.end_date, OLD.status) THEN
    NEW.series_exception := true;
  END IF;
  RETURN NEW;
END $function$;

DROP FUNCTION public.approve_event_request(uuid);

CREATE OR REPLACE FUNCTION public.approve_event_request(p_id uuid, p_audience text DEFAULT 'members')
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _uid uuid := public.event_request_actor(); cur public.event_requests; _event uuid; _external boolean; _copies jsonb := '[]'::jsonb;
  _m public.event_request_media; _media uuid; _ext text; _pos integer := 0;
BEGIN
  PERFORM public.require_privacy_accepted();
  IF p_audience IS NULL OR p_audience NOT IN ('public', 'members') THEN RAISE EXCEPTION 'Invalid event values'; END IF;
  cur := public.event_request_locked(p_id);
  PERFORM public.event_request_review_check(cur);
  _external := cur.request_type = 'external';
  IF _external AND (cur.category IS NULL
     OR (cur.all_day AND cur.proposed_start_date IS NULL) OR (NOT cur.all_day AND (cur.proposed_start IS NULL OR cur.proposed_end IS NULL))
     OR (cur.is_online AND cur.online_url IS NULL) OR (NOT cur.is_online AND cur.location_text IS NULL)) THEN
    RAISE EXCEPTION 'Required publish fields missing';
  END IF;
  _event := public.create_event(jsonb_build_object('title', cur.title, 'description', coalesce(cur.description, ''),
    'location', coalesce(cur.location_text, ''), 'location_type', CASE WHEN cur.is_online THEN 'online' ELSE 'in_person' END,
    'online_url', cur.online_url, 'organizer', CASE WHEN _external THEN cur.organizer_name ELSE 'Dialogue Society' END,
    'category', coalesce(cur.category, 'dialogue'), 'all_day', cur.all_day,
    'start_date', cur.proposed_start_date, 'end_date', cur.proposed_end_date, 'start_at', cur.proposed_start, 'end_at', cur.proposed_end,
    'capacity', NULL, 'registration_enabled', true, 'scope', cur.scope, 'branch_id', cur.branch_id, 'audience', p_audience,
    'status', CASE WHEN _external THEN 'published' ELSE 'draft' END));
  IF _external THEN UPDATE public.events SET is_external = true WHERE id = _event; END IF;
  FOR _m IN SELECT * FROM public.event_request_media WHERE request_id = p_id ORDER BY CASE WHEN kind = 'image' THEN 0 ELSE 1 END, created_at, id LIMIT 5 LOOP
    _media := gen_random_uuid();
    _ext := lower(regexp_replace(_m.storage_path, '^.*\.', ''));
    INSERT INTO public.event_media (id, event_id, storage_path, kind, position, uploaded_by, original_name)
    VALUES (_media, _event, _event::text || '/' || _media::text || '.' || _ext, _m.kind, _pos, _uid, _m.original_name);
    _copies := _copies || jsonb_build_object('media_id', _media, 'from', _m.storage_path, 'to', _event::text || '/' || _media::text || '.' || _ext);
    _pos := _pos + 1;
  END LOOP;
  UPDATE public.event_requests SET status = 'approved', reviewer_id = _uid, reviewed_at = now(), event_id = _event,
    notice = 'approved', notice_seen_at = NULL WHERE id = p_id;
  RETURN jsonb_build_object('request_id', p_id, 'event_id', _event, 'published', _external, 'copies', _copies);
END $function$;

REVOKE ALL ON FUNCTION public.approve_event_request(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.approve_event_request(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.submit_event_request(p jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _uid uuid := public.event_request_actor(); r public.event_requests; _scope text; _branch uuid; _region uuid; _id uuid;
  _type text := coalesce(nullif(p->>'request_type', ''), 'proposal');
BEGIN
  PERFORM public.require_privacy_accepted();
  PERFORM id FROM public.profiles WHERE id = _uid FOR UPDATE; -- serialises the open-request limit per user
  IF NOT public.is_member(_uid) THEN RAISE EXCEPTION 'Only members can request events'; END IF; -- followers apply to volunteer instead
  IF public.has_role(_uid, 'regional_director') THEN RAISE EXCEPTION 'Regional directors create events directly'; END IF;
  _scope := CASE WHEN public.has_role(_uid, 'branch_manager') THEN 'region' ELSE 'branch' END;
  IF coalesce(nullif(p->>'scope', ''), _scope) <> _scope THEN
    IF _scope = 'region' THEN RAISE EXCEPTION 'Branch managers create branch events directly'; END IF;
    RAISE EXCEPTION 'Not allowed';
  END IF;
  _branch := public.get_user_branch(_uid);
  SELECT region_id INTO _region FROM public.branches WHERE id = _branch;
  IF _region IS NULL THEN RAISE EXCEPTION 'Not allowed'; END IF;
  IF (SELECT count(*) FROM public.event_requests WHERE requester_id = _uid AND status IN ('submitted', 'under_review') AND deleted_at IS NULL) >= 5 THEN
    RAISE EXCEPTION 'Too many open requests';
  END IF;
  r := public.event_request_fields(p - 'category', _type); -- the category is set by reviewers
  INSERT INTO public.event_requests (requester_id, request_type, scope, branch_id, region_id, title, description, reason, all_day,
    proposed_start, proposed_end, proposed_start_date, proposed_end_date, alt_start, alt_end, alt_start_date, alt_end_date,
    location_text, is_online, online_url, expected_attendees, organizer_name, source, source_url, notes)
  VALUES (_uid, _type, _scope, CASE WHEN _scope = 'branch' THEN _branch END, _region, r.title, r.description, r.reason, r.all_day,
    r.proposed_start, r.proposed_end, r.proposed_start_date, r.proposed_end_date, r.alt_start, r.alt_end, r.alt_start_date, r.alt_end_date,
    r.location_text, r.is_online, r.online_url, r.expected_attendees, r.organizer_name, r.source, r.source_url, r.notes)
  RETURNING id INTO _id;
  RETURN _id;
END $function$;

CREATE OR REPLACE FUNCTION public.get_event_registrations(p_event_id uuid)
 RETURNS TABLE(id uuid, user_id uuid, full_name text, email text, status text, show_name boolean, registered_at timestamp with time zone, cancelled_at timestamp with time zone, attendance_marked_at timestamp with time zone, attendance_marked_by_name text, waitlist_position integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _e public.events;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not signed in'; END IF;
  SELECT * INTO _e FROM public.events WHERE events.id = p_event_id;
  IF NOT FOUND OR _e.deleted_at IS NOT NULL OR _e.series_template OR NOT public.can_manage_event_scope(_e.scope, _e.branch_id, _e.region_id) THEN
    RAISE EXCEPTION 'Not allowed';
  END IF;
  -- National Coordinators see registrations as counts only (get_event_registration_summary).
  IF public.has_role(auth.uid(), 'national_coordinator') THEN RAISE EXCEPTION 'Registrant details are not available'; END IF;
  RETURN QUERY
    SELECT r.id, r.user_id, p.full_name, p.email, r.status, r.show_name, r.registered_at, r.cancelled_at, r.attendance_marked_at,
      m.full_name, public.registration_position(r)
    FROM public.event_registrations r
    LEFT JOIN public.profiles p ON p.id = r.user_id
    LEFT JOIN public.profiles m ON m.id = r.attendance_marked_by
    WHERE r.event_id = p_event_id
    ORDER BY CASE r.status WHEN 'registered' THEN 0 WHEN 'attended' THEN 0 WHEN 'no_show' THEN 0 WHEN 'waitlisted' THEN 1 ELSE 2 END,
      r.registered_at, r.id;
END $function$;

CREATE OR REPLACE FUNCTION public.mark_attendance(p_registration_id uuid, p_status text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _uid uuid := auth.uid(); _event uuid; _e public.events; _r public.event_registrations;
BEGIN
  PERFORM public.require_privacy_accepted();
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not signed in'; END IF;
  IF p_status IS NULL OR p_status NOT IN ('attended', 'no_show') THEN RAISE EXCEPTION 'Invalid attendance status'; END IF;
  PERFORM id FROM public.profiles WHERE id = _uid FOR UPDATE;
  SELECT event_id INTO _event FROM public.event_registrations WHERE id = p_registration_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Not allowed'; END IF;
  SELECT * INTO _e FROM public.events WHERE id = _event FOR UPDATE;
  IF _e.deleted_at IS NOT NULL OR NOT public.can_manage_event_scope(_e.scope, _e.branch_id, _e.region_id) THEN RAISE EXCEPTION 'Not allowed'; END IF;
  IF public.has_role(_uid, 'national_coordinator') THEN RAISE EXCEPTION 'Registrant details are not available'; END IF;
  IF coalesce(public.event_starts(_e) > now(), true) THEN RAISE EXCEPTION 'Event has not started'; END IF;
  SELECT * INTO _r FROM public.event_registrations WHERE id = p_registration_id FOR UPDATE;
  IF _r.status NOT IN ('registered', 'attended', 'no_show') THEN RAISE EXCEPTION 'Invalid attendance status'; END IF;
  UPDATE public.event_registrations SET status = p_status, attendance_marked_by = _uid, attendance_marked_at = now() WHERE id = _r.id;
END $function$;

CREATE OR REPLACE FUNCTION public.request_account_deletion()
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _me uuid := auth.uid(); _id uuid;
BEGIN
  IF _me IS NULL THEN RAISE EXCEPTION 'Not signed in'; END IF;
  PERFORM id FROM public.profiles WHERE id = _me FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Profile not found'; END IF;
  IF public.has_role(_me, 'regional_director') THEN
    RAISE EXCEPTION 'Regional Directors must contact the Dialogue Society office to delete their account';
  END IF;
  IF public.has_role(_me, 'national_coordinator') THEN RAISE EXCEPTION 'National Coordinators cannot be deleted in the app'; END IF;
  IF public.is_follower(_me) THEN RAISE EXCEPTION 'Followers delete their account directly'; END IF;
  IF EXISTS (SELECT 1 FROM public.account_deletion_requests WHERE user_id = _me AND status = 'pending') THEN
    RAISE EXCEPTION 'You already have a pending deletion request';
  END IF;
  INSERT INTO public.account_deletion_requests(user_id) VALUES (_me) RETURNING id INTO _id;
  INSERT INTO public.user_audit_log(actor_id, target_id, action) VALUES (_me, _me, 'deletion_requested');
  RETURN _id;
END $function$;

CREATE OR REPLACE FUNCTION public.authorize_user_deletion(_actor uuid, _target uuid, _request uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _p public.profiles; _audit uuid; _region uuid; _self boolean;
BEGIN
 PERFORM id FROM profiles WHERE id=_actor FOR UPDATE;
 SELECT * INTO _p FROM profiles WHERE id=_target FOR UPDATE;
 IF _actor IS NULL OR _target IS NULL OR _actor=_target THEN RAISE EXCEPTION 'You cannot delete your own account here'; END IF;
 IF public.has_role(_target,'regional_director') THEN RAISE EXCEPTION 'Regional Directors cannot be deleted'; END IF;
 IF public.has_role(_target,'national_coordinator') THEN RAISE EXCEPTION 'National Coordinators cannot be deleted in the app'; END IF;
 IF NOT FOUND OR NOT public.can_manage_user(_actor,_target) THEN RAISE EXCEPTION 'You cannot manage this user'; END IF;
 IF _request IS NULL THEN
  IF _p.status<>'inactive' THEN RAISE EXCEPTION 'Deactivate the user first'; END IF;
 ELSE
  PERFORM id FROM account_deletion_requests WHERE id=_request AND user_id=_target AND status='pending' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'This deletion request is no longer pending'; END IF;
 END IF;
 -- A pending right-to-erasure request remains non-restorable even if the admin uses ordinary deletion.
 SELECT EXISTS(SELECT 1 FROM account_deletion_requests WHERE user_id=_target AND status='pending') INTO _self;
 SELECT region_id INTO _region FROM branches WHERE id=_p.branch_id;
 IF _region IS NULL THEN RAISE EXCEPTION 'Not allowed'; END IF;
 INSERT INTO user_audit_log(actor_id,target_id,action) VALUES(_actor,_target,'user_deleted') RETURNING id INTO _audit;
 INSERT INTO user_deletion_state(target_id,deletion_audit_id,previous_status,self_requested,operation,operation_actor) VALUES(_target,_audit,_p.status,_self,'deleting',_actor);
 UPDATE profiles SET deleted_at=now(),deleted_by=_actor,status='inactive' WHERE id=_target;
 UPDATE account_deletion_requests SET deletion_audit_id=_audit WHERE user_id=_target AND status='pending';
 INSERT INTO recycle_bin_audit_log(actor_id,item_type,item_id,action,branch_id,region_id) VALUES(_actor,'user',_target,'delete',_p.branch_id,_region);
 RETURN _audit;
END $function$;

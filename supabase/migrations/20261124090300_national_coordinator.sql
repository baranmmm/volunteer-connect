-- National Coordinators: last-NC protection, dashboard and structure (regions and branches), Recycle Bin for
-- volunteer applications, branches and regions.
--
-- * The first NC is assigned with SQL only (docs/nc-setup.md). In the app no one can assign, remove, deactivate or
--   delete an NC; on top of that, these triggers refuse to remove the last active NC in any way (SQL included).
-- * Every NC function requires is_nc(): an active NC with an aal2 (MFA) session.
-- * NCs see Regional Directors and Branch Managers in detail; volunteers and followers only as numbers.
-- * Branches and regions are deleted into the Recycle Bin (30 days, restorable) only when they have no active users
--   and no upcoming events; a region takes its branches with it. Items with history stay archived (hidden) instead of
--   being purged, because past events and audit rows still point at them.

-- ---------------------------------------------------------------------------------------------------------------
-- Last active National Coordinator
CREATE FUNCTION public.other_active_nc_exists(_except uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles r JOIN public.profiles p ON p.id = r.user_id
    WHERE r.role = 'national_coordinator' AND r.user_id <> _except AND p.status = 'active' AND p.deleted_at IS NULL)
$$;
CREATE FUNCTION public.is_active_nc(_uid uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.has_role(_uid, 'national_coordinator')
    AND EXISTS (SELECT 1 FROM public.profiles WHERE id = _uid AND status = 'active' AND deleted_at IS NULL)
$$;

CREATE FUNCTION public.guard_last_nc_role() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF OLD.role = 'national_coordinator' AND (TG_OP = 'DELETE' OR NEW.role IS DISTINCT FROM OLD.role OR NEW.user_id IS DISTINCT FROM OLD.user_id)
     AND EXISTS (SELECT 1 FROM public.profiles WHERE id = OLD.user_id AND status = 'active' AND deleted_at IS NULL)
     AND NOT public.other_active_nc_exists(OLD.user_id) THEN
    RAISE EXCEPTION 'The last active National Coordinator cannot be removed';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;
CREATE TRIGGER guard_last_nc_role BEFORE UPDATE OR DELETE ON public.user_roles FOR EACH ROW EXECUTE FUNCTION public.guard_last_nc_role();

CREATE FUNCTION public.guard_last_nc_profile() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF OLD.status = 'active' AND OLD.deleted_at IS NULL AND public.has_role(OLD.id, 'national_coordinator')
     AND (TG_OP = 'DELETE' OR NEW.status <> 'active' OR NEW.deleted_at IS NOT NULL)
     AND NOT public.other_active_nc_exists(OLD.id) THEN
    RAISE EXCEPTION 'The last active National Coordinator cannot be removed';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;
CREATE TRIGGER guard_last_nc_profile BEFORE UPDATE OF status, deleted_at OR DELETE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.guard_last_nc_profile();

REVOKE ALL ON FUNCTION public.other_active_nc_exists(uuid), public.is_active_nc(uuid), public.guard_last_nc_role(), public.guard_last_nc_profile() FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- NC overview
CREATE FUNCTION public.require_nc() RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_nc() THEN RAISE EXCEPTION 'Not allowed'; END IF;
END $$;
REVOKE ALL ON FUNCTION public.require_nc() FROM PUBLIC, anon, authenticated;

-- Upcoming = not deleted, published, not ended.
CREATE FUNCTION public.event_is_upcoming(_e public.events) RETURNS boolean LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT _e.deleted_at IS NULL AND NOT _e.series_template AND _e.status = 'published' AND coalesce(public.event_ends(_e) > now(), false)
$$;

CREATE FUNCTION public.get_nc_dashboard() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.require_nc();
  RETURN jsonb_build_object(
    'regions', (SELECT count(*) FROM public.regions WHERE deleted_at IS NULL),
    'branches', (SELECT count(*) FROM public.branches WHERE deleted_at IS NULL),
    'volunteers', (SELECT count(*) FROM public.profiles p WHERE p.status = 'active' AND p.deleted_at IS NULL AND public.is_member(p.id)),
    'followers', (SELECT count(*) FROM public.profiles p WHERE p.status = 'active' AND p.deleted_at IS NULL AND public.is_follower(p.id)),
    'upcoming_events', (SELECT count(*) FROM public.events e WHERE public.event_is_upcoming(e)),
    'registrations_30d', (SELECT count(*) FROM public.event_registrations r WHERE r.registered_at > now() - interval '30 days' AND r.status <> 'cancelled'),
    'attended_30d', (SELECT count(*) FROM public.event_registrations r WHERE r.status = 'attended' AND r.attendance_marked_at > now() - interval '30 days'),
    'pending_requests', (SELECT count(*) FROM public.event_requests q WHERE q.deleted_at IS NULL AND q.status IN ('submitted', 'under_review')),
    'open_applications', (SELECT count(*) FROM public.volunteer_applications a WHERE a.deleted_at IS NULL AND a.status = 'submitted'));
END $$;

-- Regions with their branches: Regional Directors and Branch Managers in detail, volunteers and followers as numbers.
CREATE FUNCTION public.get_regions_tree() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.require_nc();
  RETURN (SELECT coalesce(jsonb_agg(jsonb_build_object(
      'id', r.id, 'name', r.name,
      'directors', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'name', p.full_name, 'email', p.email, 'phone', p.phone) ORDER BY p.full_name), '[]'::jsonb)
        FROM public.user_roles ur JOIN public.profiles p ON p.id = ur.user_id
        WHERE ur.role = 'regional_director' AND ur.region_id = r.id AND p.deleted_at IS NULL AND p.status = 'active'),
      'upcoming_events', (SELECT count(*) FROM public.events e WHERE e.region_id = r.id AND public.event_is_upcoming(e)),
      'branches', (SELECT coalesce(jsonb_agg(jsonb_build_object(
          'id', b.id, 'name', b.name,
          'managers', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'name', p.full_name, 'email', p.email, 'phone', p.phone) ORDER BY p.full_name), '[]'::jsonb)
            FROM public.profiles p WHERE p.branch_id = b.id AND p.deleted_at IS NULL AND p.status = 'active' AND public.has_role(p.id, 'branch_manager')),
          'volunteers', (SELECT count(*) FROM public.profiles p WHERE p.branch_id = b.id AND p.deleted_at IS NULL AND p.status = 'active'
            AND public.has_role(p.id, 'volunteer')),
          'followers', (SELECT count(*) FROM public.user_followed_branches f JOIN public.profiles p ON p.id = f.user_id
            WHERE f.branch_id = b.id AND p.deleted_at IS NULL AND p.status = 'active' AND public.is_follower(p.id)),
          'upcoming_events', (SELECT count(*) FROM public.events e WHERE e.branch_id = b.id AND public.event_is_upcoming(e))
        ) ORDER BY b.name), '[]'::jsonb) FROM public.branches b WHERE b.region_id = r.id AND b.deleted_at IS NULL)
    ) ORDER BY r.name), '[]'::jsonb) FROM public.regions r WHERE r.deleted_at IS NULL);
END $$;

-- ---------------------------------------------------------------------------------------------------------------
-- Structure: create, rename, delete into the Recycle Bin, restore
CREATE FUNCTION public.clean_structure_name(_name text) RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path = public AS $$
BEGIN
  IF length(btrim(coalesce(_name, ''))) NOT BETWEEN 2 AND 80 THEN RAISE EXCEPTION 'Name must be 2 to 80 characters'; END IF;
  RETURN btrim(_name);
END $$;

CREATE FUNCTION public.create_region(p_name text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _id uuid;
BEGIN
  PERFORM public.require_privacy_accepted();
  PERFORM public.require_nc();
  IF EXISTS (SELECT 1 FROM public.regions WHERE lower(name) = lower(btrim(p_name))) THEN RAISE EXCEPTION 'A region with this name already exists'; END IF;
  INSERT INTO public.regions (name) VALUES (public.clean_structure_name(p_name)) RETURNING id INTO _id;
  RETURN _id;
END $$;

CREATE FUNCTION public.rename_region(p_id uuid, p_name text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.require_privacy_accepted();
  PERFORM public.require_nc();
  IF EXISTS (SELECT 1 FROM public.regions WHERE lower(name) = lower(btrim(p_name)) AND id <> p_id) THEN RAISE EXCEPTION 'A region with this name already exists'; END IF;
  UPDATE public.regions SET name = public.clean_structure_name(p_name) WHERE id = p_id AND deleted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Region not found'; END IF;
END $$;

CREATE FUNCTION public.create_branch(p_name text, p_region_id uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _id uuid;
BEGIN
  PERFORM public.require_privacy_accepted();
  PERFORM public.require_nc();
  IF NOT EXISTS (SELECT 1 FROM public.regions WHERE id = p_region_id AND deleted_at IS NULL) THEN RAISE EXCEPTION 'Region not found'; END IF;
  IF EXISTS (SELECT 1 FROM public.branches WHERE lower(name) = lower(btrim(p_name))) THEN RAISE EXCEPTION 'A branch with this name already exists'; END IF;
  INSERT INTO public.branches (name, region_id) VALUES (public.clean_structure_name(p_name), p_region_id) RETURNING id INTO _id;
  RETURN _id;
END $$;

CREATE FUNCTION public.rename_branch(p_id uuid, p_name text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.require_privacy_accepted();
  PERFORM public.require_nc();
  IF EXISTS (SELECT 1 FROM public.branches WHERE lower(name) = lower(btrim(p_name)) AND id <> p_id) THEN RAISE EXCEPTION 'A branch with this name already exists'; END IF;
  UPDATE public.branches SET name = public.clean_structure_name(p_name) WHERE id = p_id AND deleted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Branch not found'; END IF;
END $$;

-- Refuses while the branch has active users or upcoming (or undated draft) events.
CREATE FUNCTION public.branch_delete_check(_branch uuid) RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.profiles WHERE branch_id = _branch AND status = 'active' AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'This branch still has active users';
  END IF;
  IF EXISTS (SELECT 1 FROM public.events e WHERE e.branch_id = _branch AND e.deleted_at IS NULL AND NOT e.series_template AND e.status <> 'cancelled'
             AND coalesce(public.event_ends(e) > now(), true)) THEN
    RAISE EXCEPTION 'This branch still has upcoming events';
  END IF;
END $$;

CREATE FUNCTION public.delete_branch(p_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _b public.branches;
BEGIN
  PERFORM public.require_privacy_accepted();
  PERFORM public.require_nc();
  SELECT * INTO _b FROM public.branches WHERE id = p_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Branch not found'; END IF;
  PERFORM public.branch_delete_check(p_id);
  UPDATE public.branches SET deleted_at = now(), deleted_by = auth.uid(), deleted_with_region = false WHERE id = p_id;
  INSERT INTO public.recycle_bin_audit_log (actor_id, item_type, item_id, action, branch_id, region_id) VALUES (auth.uid(), 'branch', p_id, 'delete', p_id, _b.region_id);
END $$;

CREATE FUNCTION public.delete_region(p_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _b uuid;
BEGIN
  PERFORM public.require_privacy_accepted();
  PERFORM public.require_nc();
  PERFORM id FROM public.regions WHERE id = p_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Region not found'; END IF;
  IF EXISTS (SELECT 1 FROM public.user_roles r JOIN public.profiles p ON p.id = r.user_id
             WHERE r.role = 'regional_director' AND r.region_id = p_id AND p.status = 'active' AND p.deleted_at IS NULL) THEN
    RAISE EXCEPTION 'This region still has active users';
  END IF;
  IF EXISTS (SELECT 1 FROM public.events e WHERE e.region_id = p_id AND e.deleted_at IS NULL AND NOT e.series_template AND e.status <> 'cancelled'
             AND coalesce(public.event_ends(e) > now(), true)) THEN
    RAISE EXCEPTION 'This region still has upcoming events';
  END IF;
  FOR _b IN SELECT id FROM public.branches WHERE region_id = p_id AND deleted_at IS NULL FOR UPDATE LOOP
    PERFORM public.branch_delete_check(_b);
  END LOOP;
  UPDATE public.branches SET deleted_at = now(), deleted_by = auth.uid(), deleted_with_region = true WHERE region_id = p_id AND deleted_at IS NULL;
  UPDATE public.regions SET deleted_at = now(), deleted_by = auth.uid() WHERE id = p_id;
  INSERT INTO public.recycle_bin_audit_log (actor_id, item_type, item_id, action, branch_id, region_id) VALUES (auth.uid(), 'region', p_id, 'delete', NULL, p_id);
END $$;

-- Restore within 30 days (a branch needs its region; a region brings back the branches deleted with it).
CREATE FUNCTION public.restore_structure(_type text, _id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _b public.branches; _r public.regions;
BEGIN
  PERFORM public.require_nc();
  IF _type = 'branch' THEN
    SELECT * INTO _b FROM public.branches WHERE id = _id FOR UPDATE;
    IF NOT FOUND OR _b.deleted_at IS NULL OR _b.deleted_with_region OR _b.deleted_at <= now() - interval '30 days' THEN RAISE EXCEPTION 'Item cannot be restored'; END IF;
    IF EXISTS (SELECT 1 FROM public.regions WHERE id = _b.region_id AND deleted_at IS NOT NULL) THEN RAISE EXCEPTION 'Restore the region first'; END IF;
    UPDATE public.branches SET deleted_at = NULL, deleted_by = NULL WHERE id = _id;
    INSERT INTO public.recycle_bin_audit_log (actor_id, item_type, item_id, action, branch_id, region_id) VALUES (auth.uid(), 'branch', _id, 'restore', _id, _b.region_id);
  ELSIF _type = 'region' THEN
    SELECT * INTO _r FROM public.regions WHERE id = _id FOR UPDATE;
    IF NOT FOUND OR _r.deleted_at IS NULL OR _r.deleted_at <= now() - interval '30 days' THEN RAISE EXCEPTION 'Item cannot be restored'; END IF;
    UPDATE public.regions SET deleted_at = NULL, deleted_by = NULL WHERE id = _id;
    UPDATE public.branches SET deleted_at = NULL, deleted_by = NULL, deleted_with_region = false WHERE region_id = _id AND deleted_with_region;
    INSERT INTO public.recycle_bin_audit_log (actor_id, item_type, item_id, action, branch_id, region_id) VALUES (auth.uid(), 'region', _id, 'restore', NULL, _id);
  ELSE RAISE EXCEPTION 'Not allowed'; END IF;
  RETURN jsonb_build_object('paths', '[]'::jsonb, 'deleted', false);
END $$;

-- Still referenced by events, users, requests or applications: then it cannot be removed and stays archived.
CREATE FUNCTION public.structure_in_use(_type text, _id uuid) RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF _type = 'branch' THEN
    RETURN EXISTS (SELECT 1 FROM public.profiles WHERE branch_id = _id) OR EXISTS (SELECT 1 FROM public.events WHERE branch_id = _id)
      OR EXISTS (SELECT 1 FROM public.event_series WHERE branch_id = _id) OR EXISTS (SELECT 1 FROM public.event_requests WHERE branch_id = _id)
      OR EXISTS (SELECT 1 FROM public.volunteer_applications WHERE branch_id = _id);
  END IF;
  RETURN EXISTS (SELECT 1 FROM public.branches b WHERE b.region_id = _id AND (b.deleted_at IS NULL OR NOT b.deleted_with_region OR public.structure_in_use('branch', b.id)))
    OR EXISTS (SELECT 1 FROM public.events WHERE region_id = _id) OR EXISTS (SELECT 1 FROM public.event_series WHERE region_id = _id)
    OR EXISTS (SELECT 1 FROM public.event_requests WHERE region_id = _id) OR EXISTS (SELECT 1 FROM public.user_roles WHERE region_id = _id);
END $$;

CREATE FUNCTION public.purge_structure_item(_type text, _id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NOT NULL THEN PERFORM public.require_nc(); END IF;
  IF _type = 'branch' THEN
    PERFORM id FROM public.branches WHERE id = _id AND deleted_at IS NOT NULL FOR UPDATE;
  ELSE
    PERFORM id FROM public.regions WHERE id = _id AND deleted_at IS NOT NULL FOR UPDATE;
  END IF;
  IF NOT FOUND THEN RAISE EXCEPTION 'Not allowed'; END IF;
  IF public.structure_in_use(_type, _id) THEN RAISE EXCEPTION 'This item has history and stays archived'; END IF;
  INSERT INTO public.recycle_bin_audit_log (actor_id, item_type, item_id, action, branch_id, region_id)
  VALUES (auth.uid(), _type, _id, 'permanent_delete', CASE WHEN _type = 'branch' THEN _id END, CASE WHEN _type = 'region' THEN _id END);
  IF _type = 'region' THEN DELETE FROM public.branches WHERE region_id = _id AND deleted_at IS NOT NULL; DELETE FROM public.regions WHERE id = _id;
  ELSE DELETE FROM public.branches WHERE id = _id; END IF;
  RETURN jsonb_build_object('paths', '[]'::jsonb, 'deleted', true);
END $$;

-- Nightly cleanup (service role): branches and regions deleted over 30 days ago that nothing refers to.
CREATE FUNCTION public.purge_expired_structure() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _n integer := 0; _x record;
BEGIN
  FOR _x IN SELECT 'branch' AS t, id FROM public.branches WHERE deleted_at < now() - interval '30 days' AND NOT deleted_with_region
            UNION ALL SELECT 'region', id FROM public.regions WHERE deleted_at < now() - interval '30 days' LOOP
    IF NOT public.structure_in_use(_x.t, _x.id) THEN PERFORM public.purge_structure_item(_x.t, _x.id); _n := _n + 1; END IF;
  END LOOP;
  RETURN _n;
END $$;

-- ---------------------------------------------------------------------------------------------------------------
-- Volunteer applications in the Recycle Bin
CREATE FUNCTION public.restore_volunteer_application(_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _a public.volunteer_applications; _region uuid;
BEGIN
  SELECT * INTO _a FROM public.volunteer_applications WHERE id = _id FOR UPDATE;
  IF NOT FOUND OR _a.deleted_at IS NULL OR _a.deleted_at <= now() - interval '30 days' OR NOT public.can_review_volunteer_application(_a.branch_id) THEN
    RAISE EXCEPTION 'Item cannot be restored';
  END IF;
  SELECT region_id INTO _region FROM public.branches WHERE id = _a.branch_id;
  UPDATE public.volunteer_applications SET deleted_at = NULL, deleted_by = NULL WHERE id = _id;  -- an open one came back withdrawn
  INSERT INTO public.recycle_bin_audit_log (actor_id, item_type, item_id, action, branch_id, region_id) VALUES (auth.uid(), 'volunteer_application', _id, 'restore', _a.branch_id, _region);
  RETURN jsonb_build_object('paths', '[]'::jsonb, 'deleted', false);
END $$;

CREATE FUNCTION public.purge_volunteer_application_item(_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _a public.volunteer_applications; _region uuid;
BEGIN
  SELECT * INTO _a FROM public.volunteer_applications WHERE id = _id FOR UPDATE;
  IF NOT FOUND OR _a.deleted_at IS NULL OR NOT public.can_review_volunteer_application(_a.branch_id) THEN RAISE EXCEPTION 'Not allowed'; END IF;
  SELECT region_id INTO _region FROM public.branches WHERE id = _a.branch_id;
  INSERT INTO public.recycle_bin_audit_log (actor_id, item_type, item_id, action, branch_id, region_id) VALUES (auth.uid(), 'volunteer_application', _id, 'permanent_delete', _a.branch_id, _region);
  DELETE FROM public.volunteer_applications WHERE id = _id;
  RETURN jsonb_build_object('paths', '[]'::jsonb, 'deleted', true);
END $$;

CREATE FUNCTION public.purge_expired_volunteer_applications() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _n integer;
BEGIN
  DELETE FROM public.volunteer_applications WHERE deleted_at < now() - interval '30 days';
  GET DIAGNOSTICS _n = ROW_COUNT;
  RETURN _n;
END $$;

-- ---------------------------------------------------------------------------------------------------------------
-- Recycle Bin listing (redefined): national events and series (no region), applications, branches and regions.
CREATE OR REPLACE FUNCTION public.list_recycle_bin(_type text DEFAULT 'all', _search text DEFAULT '', _offset integer DEFAULT 0)
 RETURNS TABLE(id uuid, type text, title text, role text, branch text, region text, deleted_by_name text, deleted_at timestamptz,
   days_left integer, can_restore boolean, self_requested boolean, event_count integer, total_count bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT (public.is_nc() OR EXISTS (SELECT 1 FROM profiles p JOIN user_roles r ON r.user_id = p.id WHERE p.id = auth.uid() AND p.status = 'active'
      AND p.deleted_at IS NULL AND r.role IN ('branch_manager', 'regional_director'))) THEN RAISE EXCEPTION 'Not allowed'; END IF;
  IF _type NOT IN ('all', 'event', 'user', 'series', 'event_request', 'volunteer_application', 'branch', 'region') THEN RAISE EXCEPTION 'Not allowed'; END IF;
  RETURN QUERY WITH items AS (
    SELECT e.id, 'event'::text AS type, e.title, NULL::text AS role, b.name AS branch, r.name AS region, p.full_name AS deleted_by_name, e.deleted_at,
      greatest(0, ceil(extract(epoch FROM (e.deleted_at + interval '30 days' - now())) / 86400))::integer AS days_left,
      public.can_restore_event(e.id) AS can_restore, false AS self_requested, NULL::integer AS event_count
    FROM events e LEFT JOIN regions r ON r.id = e.region_id LEFT JOIN branches b ON b.id = e.branch_id LEFT JOIN profiles p ON p.id = e.deleted_by
    WHERE e.deleted_at IS NOT NULL AND NOT e.series_template AND NOT e.deleted_with_series AND public.can_manage_recycle_scope(auth.uid(), e.branch_id, e.region_id)
    UNION ALL
    SELECT s.id, 'series', s.title, NULL, b.name, r.name, p.full_name, s.deleted_at,
      greatest(0, ceil(extract(epoch FROM (s.deleted_at + interval '30 days' - now())) / 86400))::integer,
      s.deleted_at > now() - interval '30 days' AND NOT EXISTS (SELECT 1 FROM event_deletion_jobs j JOIN events x ON x.id = j.event_id
        WHERE (x.series_id = s.id OR x.id = s.media_event_id) AND j.operation NOT IN ('archive', 'restore')),
      false, (SELECT count(*) FROM events x WHERE x.series_id = s.id AND x.deleted_with_series)::integer
    FROM event_series s LEFT JOIN regions r ON r.id = s.region_id LEFT JOIN branches b ON b.id = s.branch_id LEFT JOIN profiles p ON p.id = s.deleted_by
    WHERE s.deleted_at IS NOT NULL AND public.can_manage_recycle_scope(auth.uid(), s.branch_id, s.region_id)
    UNION ALL
    SELECT u.id, 'user', u.full_name, (SELECT ur.role::text FROM user_roles ur WHERE ur.user_id = u.id ORDER BY CASE ur.role WHEN 'branch_manager' THEN 0 ELSE 1 END LIMIT 1), b.name, r.name, p.full_name, u.deleted_at,
      greatest(0, ceil(extract(epoch FROM (u.deleted_at + interval '30 days' - now())) / 86400))::integer,
      NOT st.self_requested AND st.operation IN ('deleted', 'restore') AND u.deleted_at > now() - interval '30 days', st.self_requested, NULL::integer
    FROM profiles u JOIN user_deletion_state st ON st.target_id = u.id JOIN branches b ON b.id = u.branch_id JOIN regions r ON r.id = b.region_id LEFT JOIN profiles p ON p.id = u.deleted_by
    WHERE u.deleted_at IS NOT NULL AND public.can_manage_deleted_user(auth.uid(), u.id)
    UNION ALL
    SELECT q.id, 'event_request', q.title, NULL, b.name, r.name, p.full_name, q.deleted_at,
      greatest(0, ceil(extract(epoch FROM (q.deleted_at + interval '30 days' - now())) / 86400))::integer,
      q.deleted_at > now() - interval '30 days', false, NULL::integer
    FROM event_requests q JOIN regions r ON r.id = q.region_id LEFT JOIN branches b ON b.id = q.branch_id LEFT JOIN profiles p ON p.id = q.deleted_by
    WHERE q.deleted_at IS NOT NULL AND public.can_manage_recycle_scope(auth.uid(), q.branch_id, q.region_id)
    UNION ALL
    SELECT a.id, 'volunteer_application', coalesce(nullif(ap.full_name, ''), 'Former member'), NULL, b.name, r.name, p.full_name, a.deleted_at,
      greatest(0, ceil(extract(epoch FROM (a.deleted_at + interval '30 days' - now())) / 86400))::integer,
      a.deleted_at > now() - interval '30 days', false, NULL::integer
    FROM volunteer_applications a JOIN branches b ON b.id = a.branch_id JOIN regions r ON r.id = b.region_id
      LEFT JOIN profiles ap ON ap.id = a.user_id AND ap.deleted_at IS NULL LEFT JOIN profiles p ON p.id = a.deleted_by
    WHERE a.deleted_at IS NOT NULL AND public.can_review_volunteer_application(a.branch_id)
    UNION ALL
    SELECT b.id, 'branch', b.name, NULL, b.name, r.name, p.full_name, b.deleted_at,
      greatest(0, ceil(extract(epoch FROM (b.deleted_at + interval '30 days' - now())) / 86400))::integer,
      b.deleted_at > now() - interval '30 days' AND r.deleted_at IS NULL, false, NULL::integer
    FROM branches b JOIN regions r ON r.id = b.region_id LEFT JOIN profiles p ON p.id = b.deleted_by
    WHERE b.deleted_at IS NOT NULL AND NOT b.deleted_with_region AND public.is_nc()
    UNION ALL
    SELECT r.id, 'region', r.name, NULL, NULL, r.name, p.full_name, r.deleted_at,
      greatest(0, ceil(extract(epoch FROM (r.deleted_at + interval '30 days' - now())) / 86400))::integer,
      r.deleted_at > now() - interval '30 days', false, (SELECT count(*) FROM branches x WHERE x.region_id = r.id AND x.deleted_with_region)::integer
    FROM regions r LEFT JOIN profiles p ON p.id = r.deleted_by
    WHERE r.deleted_at IS NOT NULL AND public.is_nc()
  ) SELECT i.id, i.type, i.title, i.role, i.branch, i.region, i.deleted_by_name, i.deleted_at, i.days_left, i.can_restore, i.self_requested, i.event_count, count(*) OVER ()
    FROM items i
    WHERE (_type = 'all' OR i.type = _type OR (_type = 'event' AND i.type = 'series'))
      AND (coalesce(_search, '') = '' OR position(lower(left(_search, 200)) IN lower(i.title)) > 0)
    ORDER BY i.deleted_at DESC, i.id LIMIT 50 OFFSET greatest(0, least(_offset, 1000000));
END $$;

REVOKE ALL ON FUNCTION public.require_nc(), public.event_is_upcoming(public.events), public.clean_structure_name(text), public.branch_delete_check(uuid),
  public.restore_structure(text, uuid), public.structure_in_use(text, uuid), public.purge_structure_item(text, uuid), public.purge_expired_structure(),
  public.restore_volunteer_application(uuid), public.purge_volunteer_application_item(uuid), public.purge_expired_volunteer_applications() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purge_expired_structure(), public.purge_expired_volunteer_applications() TO service_role;
REVOKE ALL ON FUNCTION public.get_nc_dashboard(), public.get_regions_tree(), public.create_region(text), public.rename_region(uuid, text),
  public.create_branch(text, uuid), public.rename_branch(uuid, text), public.delete_branch(uuid), public.delete_region(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_nc_dashboard(), public.get_regions_tree(), public.create_region(text), public.rename_region(uuid, text),
  public.create_branch(text, uuid), public.rename_branch(uuid, text), public.delete_branch(uuid), public.delete_region(uuid) TO authenticated;


-- Recycle Bin dispatch (redefined): volunteer applications, branches and regions.

CREATE OR REPLACE FUNCTION public.restore_item(_type text, _id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _p public.profiles; _s public.user_deletion_state;
BEGIN
  PERFORM public.require_privacy_accepted();
  IF _type = 'volunteer_application' THEN RETURN public.restore_volunteer_application(_id); END IF;
  IF _type IN ('branch', 'region') THEN RETURN public.restore_structure(_type, _id); END IF;
  IF _type = 'event' THEN RETURN public.restore_event(_id, false); END IF;
  IF _type = 'series' THEN RETURN public.restore_series(_id, false); END IF;
  IF _type = 'event_request' THEN RETURN public.restore_event_request(_id); END IF;
  IF _type <> 'user' THEN RAISE EXCEPTION 'Not allowed'; END IF;
  PERFORM id FROM profiles WHERE id = auth.uid() FOR UPDATE;
  SELECT * INTO _p FROM profiles WHERE id = _id FOR UPDATE;
  SELECT * INTO _s FROM user_deletion_state WHERE target_id = _id FOR UPDATE;
  IF NOT FOUND OR NOT public.can_manage_deleted_user(auth.uid(), _id) OR _s.self_requested OR _p.deleted_at <= now() - interval '30 days' OR _s.operation NOT IN ('deleted', 'restore') THEN RAISE EXCEPTION 'Item cannot be restored'; END IF;
  UPDATE user_deletion_state SET operation = 'restore', operation_actor = auth.uid(), updated_at = now() WHERE target_id = _id;
  RETURN jsonb_build_object('paths', '[]'::jsonb, 'deleted', false);
END $function$;

CREATE OR REPLACE FUNCTION public.permanent_delete_item(_type text, _id uuid, _confirmation text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _e public.events; _paths jsonb; _s public.event_series; _ids jsonb; _q public.event_requests;
BEGIN
  PERFORM public.require_privacy_accepted();
  IF _confirmation IS DISTINCT FROM 'DELETE' THEN RAISE EXCEPTION 'Permanent deletion confirmation required'; END IF;
  PERFORM id FROM profiles WHERE id = auth.uid() FOR UPDATE;
  IF _type = 'volunteer_application' THEN RETURN public.purge_volunteer_application_item(_id); END IF;
  IF _type IN ('branch', 'region') THEN PERFORM public.require_nc(); RETURN public.purge_structure_item(_type, _id); END IF;
  IF _type = 'user' THEN
    IF NOT public.can_manage_deleted_user(auth.uid(), _id) THEN RAISE EXCEPTION 'Not allowed'; END IF;
    RETURN public.prepare_user_purge(_id, auth.uid());
  ELSIF _type = 'event_request' THEN
    SELECT * INTO _q FROM event_requests WHERE id = _id FOR UPDATE;
    IF NOT FOUND OR _q.deleted_at IS NULL OR NOT public.can_manage_recycle_scope(auth.uid(), _q.branch_id, _q.region_id) THEN RAISE EXCEPTION 'Not allowed'; END IF;
    INSERT INTO recycle_bin_audit_log (actor_id, item_type, item_id, action, branch_id, region_id) VALUES (auth.uid(), 'event_request', _id, 'permanent_delete', _q.branch_id, _q.region_id);
    SELECT coalesce(jsonb_agg(o.name ORDER BY o.name), '[]'::jsonb) INTO _paths FROM storage.objects o
      WHERE o.bucket_id = 'event-request-files' AND o.name LIKE _id::text || '/%';
    IF _paths <> '[]'::jsonb THEN
      UPDATE event_requests SET purge_requested_at = now() WHERE id = _id;
      RETURN jsonb_build_object('paths', _paths, 'deleted', false, 'bucket', 'event-request-files');
    END IF;
    DELETE FROM event_requests WHERE id = _id;
    RETURN jsonb_build_object('paths', '[]'::jsonb, 'deleted', true);
  ELSIF _type = 'series' THEN
    SELECT * INTO _s FROM event_series WHERE id = _id FOR UPDATE;
    IF NOT FOUND OR _s.deleted_at IS NULL OR NOT public.can_manage_recycle_scope(auth.uid(), _s.branch_id, _s.region_id) THEN RAISE EXCEPTION 'Not allowed'; END IF;
    INSERT INTO event_deletion_jobs (event_id, operation, requested_by)
      SELECT x.id, 'manual_purge', auth.uid() FROM events x
      WHERE (x.series_id = _id AND x.deleted_with_series) OR (x.id = _s.media_event_id AND x.deleted_at IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM event_series o WHERE o.media_event_id = _s.media_event_id AND o.id <> _id))
    ON CONFLICT (event_id) DO UPDATE SET operation = 'manual_purge', requested_by = auth.uid();
    SELECT coalesce(jsonb_agg(j.event_id), '[]'::jsonb) INTO _ids FROM event_deletion_jobs j JOIN events x ON x.id = j.event_id
      WHERE j.operation = 'manual_purge' AND ((x.series_id = _id AND x.deleted_with_series) OR x.id = _s.media_event_id);
    INSERT INTO recycle_bin_audit_log (actor_id, item_type, item_id, action, branch_id, region_id) VALUES (auth.uid(), 'series', _id, 'permanent_delete', _s.branch_id, _s.region_id);
    RETURN jsonb_build_object('paths', '[]'::jsonb, 'deleted', false, 'events', _ids);
  ELSIF _type <> 'event' THEN RAISE EXCEPTION 'Not allowed'; END IF;
  SELECT * INTO _e FROM events WHERE id = _id FOR UPDATE;
  IF NOT FOUND OR _e.deleted_at IS NULL OR _e.series_template OR _e.deleted_with_series OR NOT public.can_manage_recycle_scope(auth.uid(), _e.branch_id, _e.region_id)
     OR EXISTS (SELECT 1 FROM event_deletion_jobs WHERE event_id = _id AND operation NOT IN ('archive', 'manual_purge')) THEN RAISE EXCEPTION 'Not allowed'; END IF;
  INSERT INTO event_deletion_jobs (event_id, operation, requested_by) VALUES (_id, 'manual_purge', auth.uid())
  ON CONFLICT (event_id) DO UPDATE SET operation = 'manual_purge', requested_by = auth.uid();
  SELECT coalesce(jsonb_agg(name ORDER BY name), '[]'::jsonb) INTO _paths FROM storage.objects WHERE bucket_id = 'event-media' AND (name LIKE _id::text || '/%' OR name LIKE 'deleted/' || _id::text || '/%');
  RETURN jsonb_build_object('paths', _paths, 'deleted', false);
END $function$;

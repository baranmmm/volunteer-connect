-- Trustee role (approved by the user, 2026-11-26): a branch-level, read-only member.
--
-- * Who: people apply as volunteers as before. On approval the reviewer (the branch's Branch Manager or the region's
--   Regional Director) chooses Volunteer or Trustee (approve_volunteer_application gets p_role, default volunteer).
--   Later a Branch Manager switches a member of their branch between Volunteer and Trustee on the Users page
--   (set_user_role, audited as role_change like every role change); Regional Directors and National Coordinators may
--   also set Trustee where they may already change roles.
-- * Read: a trustee is a member of their branch (is_member / is_branch_member include them), so they read exactly what
--   a volunteer of the branch reads: calendar and events, branch tasks and task groups, linked tasks, meetings they
--   are invited to (agenda, decisions, files, invitees), registrant names, mentions.
-- * Write: none. can_create_task, can_create_meeting, can_edit_task, can_edit_task_group and can_edit_meeting refuse
--   trustees, so every task, task group, meeting, agenda, decision, file and invitee RPC (and the meeting-files Storage
--   policies) refuses them. Events need a manager role already. Volunteers' "@all" groups need the volunteer role.
-- * Own tasks: status (set_task_status) and notes (add_task_note, own notes edited/deleted) stay allowed through
--   can_set_task_status; archiving is refused (can_archive_task, new task_json flag can_archive). Personal reminders
--   and the mute switch stay allowed (they change nothing others see).
-- * Assignment: only the branch's Branch Manager assigns a trustee (task_assignee_ok). Volunteers and Regional
--   Directors cannot; "@all" groups (from anyone) never include trustees, so they get no notice from them.
-- * Meetings: only the managers of the meeting's scope (Branch Manager, Regional Director) invite trustees
--   (meeting_invitee_ok); approving a trustee's meeting request (BM or RD) therefore works.
-- * Requests: trustees send event, task and meeting requests like volunteers (request_target_ok; event requests
--   already need is_member).
-- * Counts: National Coordinators see trustees as numbers only (get_nc_dashboard, get_regions_tree, get_branch_map get
--   a trustees count; volunteers no longer count trustees).
-- Additive: new helpers is_trustee, can_archive_task, meeting_invitee_ok; approve_volunteer_application is replaced by
-- a two-argument version (the old one-argument calls still work through the default); the other functions are
-- replaced with the same signatures and grants. No table, policy or data change.

-- ---------------------------------------------------------------------------------------------------------------
-- Helpers

CREATE FUNCTION public.is_trustee(_uid uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.has_role(_uid, 'trustee')
$$;

CREATE OR REPLACE FUNCTION public.is_member(_uid uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.has_any_role(_uid, ARRAY['volunteer', 'trustee', 'branch_manager', 'regional_director']::public.app_role[])
$$;

CREATE OR REPLACE FUNCTION public.is_follower(_uid uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.has_role(_uid, 'follower') AND NOT public.has_any_role(_uid,
    ARRAY['volunteer', 'trustee', 'branch_manager', 'regional_director', 'national_coordinator']::public.app_role[])
$$;

-- ---------------------------------------------------------------------------------------------------------------
-- Write gates: trustees create and edit nothing

CREATE OR REPLACE FUNCTION public.can_create_task(_scope text, _branch uuid, _region uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.work_scope_valid(_scope, _branch, _region) AND (public.can_manage_event_scope(_scope, _branch, _region)
    OR (_scope = 'branch' AND public.is_active_person(auth.uid()) AND public.session_ok() AND public.is_branch_member(auth.uid(), _branch)
        AND NOT public.is_trustee(auth.uid())))
$$;

CREATE OR REPLACE FUNCTION public.can_create_meeting(_scope text, _branch uuid, _region uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.work_scope_valid(_scope, _branch, _region) AND (public.can_manage_event_scope(_scope, _branch, _region)
    OR (_scope = 'branch' AND public.is_active_person(auth.uid()) AND public.session_ok() AND public.is_branch_member(auth.uid(), _branch)
        AND NOT public.is_trustee(auth.uid())))
$$;

CREATE OR REPLACE FUNCTION public.can_edit_task(_task uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.is_active_person(auth.uid()) AND public.session_ok() AND (public.is_member(auth.uid()) OR public.is_nc())
    AND NOT public.is_trustee(auth.uid())
    AND EXISTS (SELECT 1 FROM public.tasks t WHERE t.id = _task AND t.deleted_at IS NULL
      AND (t.created_by = auth.uid() OR public.can_manage_event_scope(t.scope, t.branch_id, t.region_id)))
$$;

CREATE OR REPLACE FUNCTION public.can_edit_task_group(_group uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.is_active_person(auth.uid()) AND public.session_ok() AND (public.is_member(auth.uid()) OR public.is_nc())
    AND NOT public.is_trustee(auth.uid())
    AND EXISTS (SELECT 1 FROM public.task_groups g WHERE g.id = _group
      AND (g.created_by = auth.uid() OR public.can_manage_event_scope('branch', g.branch_id, g.region_id)))
$$;

CREATE OR REPLACE FUNCTION public.can_edit_meeting(_meeting uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.is_active_person(auth.uid()) AND public.session_ok() AND (public.is_member(auth.uid()) OR public.is_nc())
    AND NOT public.is_trustee(auth.uid())
    AND EXISTS (SELECT 1 FROM public.meetings m WHERE m.id = _meeting AND m.deleted_at IS NULL
      AND (m.created_by = auth.uid() OR public.can_manage_event_scope(m.scope, m.branch_id, m.region_id)))
$$;

-- Archiving a done task: as before (assignees and editors), never a trustee (they change only status and notes).
CREATE FUNCTION public.can_archive_task(_task uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT NOT public.is_trustee(auth.uid()) AND public.can_set_task_status(_task)
$$;

CREATE OR REPLACE FUNCTION public.archive_task(p_id uuid, p_archived boolean) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _t public.tasks;
BEGIN
  PERFORM public.require_privacy_accepted();
  PERFORM public.work_actor();
  _t := public.task_locked(p_id);
  IF NOT public.can_archive_task(p_id) THEN RAISE EXCEPTION 'Not allowed'; END IF;
  IF coalesce(p_archived, false) AND _t.status <> 'done' THEN RAISE EXCEPTION 'Only done tasks can be archived'; END IF;
  UPDATE public.tasks SET archived_at = CASE WHEN p_archived THEN coalesce(_t.archived_at, now()) END,
    archived_by = CASE WHEN p_archived THEN coalesce(_t.archived_by, auth.uid()) END
  WHERE id = p_id;
  RETURN coalesce(p_archived, false);
END $$;

CREATE OR REPLACE FUNCTION public.archive_done_tasks(p_ids jsonb) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _ids uuid[] := public.json_uuid_array(p_ids); _n integer;
BEGIN
  PERFORM public.require_privacy_accepted();
  PERFORM public.work_actor();
  IF public.is_trustee(auth.uid()) THEN RAISE EXCEPTION 'Not allowed'; END IF;
  IF cardinality(_ids) > 1000 THEN RAISE EXCEPTION 'Too many tasks'; END IF;
  UPDATE public.tasks t SET archived_at = now(), archived_by = auth.uid()
  WHERE t.id = ANY (_ids) AND t.deleted_at IS NULL AND t.status = 'done' AND t.archived_at IS NULL AND public.can_archive_task(t.id);
  GET DIAGNOSTICS _n = ROW_COUNT;
  RETURN _n;
END $$;

CREATE OR REPLACE FUNCTION public.task_json(_t public.tasks) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object('id', _t.id, 'scope', _t.scope, 'branch_id', _t.branch_id, 'region_id', _t.region_id,
    'branch', (SELECT name FROM public.branches WHERE id = _t.branch_id), 'region', (SELECT name FROM public.regions WHERE id = _t.region_id),
    'title', _t.title, 'description', _t.description, 'status', _t.status, 'priority', _t.priority, 'due_date', _t.due_date,
    'self_task', _t.self_task, 'created_by', _t.created_by,
    'created_by_name', (SELECT full_name FROM public.profiles WHERE id = _t.created_by AND deleted_at IS NULL),
    'event_id', _t.event_id, 'meeting_id', _t.meeting_id, 'decision_id', _t.decision_id, 'created_at', _t.created_at,
    'archived_at', _t.archived_at, 'group_id', _t.group_id,
    'note_count', (SELECT count(*) FROM public.task_notes WHERE task_id = _t.id),
    'assignees', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'full_name', p.full_name) ORDER BY p.full_name, p.id), '[]'::jsonb)
      FROM public.task_assignees a JOIN public.profiles p ON p.id = a.user_id WHERE a.task_id = _t.id AND p.deleted_at IS NULL),
    'mine', EXISTS (SELECT 1 FROM public.task_assignees a WHERE a.task_id = _t.id AND a.user_id = auth.uid()),
    'can_edit', public.can_edit_task(_t.id), 'can_set_status', public.can_set_task_status(_t.id),
    'can_archive', public.can_archive_task(_t.id))
$$;

-- ---------------------------------------------------------------------------------------------------------------
-- Assignment: only the branch's Branch Manager assigns a trustee

CREATE OR REPLACE FUNCTION public.task_assignee_ok(_scope text, _branch uuid, _region uuid, _user uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.is_active_person(_user) AND CASE
    WHEN _scope = 'national' THEN public.is_nc()
      AND public.has_any_role(_user, ARRAY['regional_director', 'branch_manager', 'national_coordinator']::public.app_role[])
    -- A Regional Director: anyone in the region except trustees.
    WHEN EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'regional_director' AND region_id = _region)
      AND public.can_manage_event_scope(_scope, _branch, _region) THEN public.in_work_scope('region', NULL, _region, _user)
        AND NOT public.is_trustee(_user)
    -- The branch's Branch Manager: volunteers, trustees and Branch Managers of the branch.
    WHEN _scope = 'branch' AND public.can_manage_event_scope(_scope, _branch, _region) THEN public.is_branch_member(_user, _branch)
      AND public.has_any_role(_user, ARRAY['volunteer', 'trustee', 'branch_manager']::public.app_role[])
    -- A volunteer: themselves, or another volunteer of their own branch (never upward, never a trustee). Trustees assign
    -- nobody.
    ELSE _scope = 'branch' AND NOT public.is_trustee(auth.uid())
      AND public.is_branch_member(auth.uid(), _branch) AND public.is_branch_member(_user, _branch)
      AND (_user = auth.uid() OR (public.has_role(_user, 'volunteer')
        AND NOT public.has_any_role(_user, ARRAY['trustee', 'branch_manager', 'regional_director', 'national_coordinator']::public.app_role[]))) END
$$;

-- "@all" groups created by a manager: every member the manager may assign, except trustees.
CREATE OR REPLACE FUNCTION public.task_group_people(_branch uuid, _region uuid) RETURNS uuid[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(array_agg(p.id ORDER BY p.full_name, p.id), '{}'::uuid[])
  FROM public.profiles p
  WHERE p.status = 'active' AND p.deleted_at IS NULL AND public.is_branch_member(p.id, _branch)
    AND NOT public.is_trustee(p.id)
    AND public.task_assignee_ok('branch', _branch, _region, p.id)
$$;

-- Members of a volunteer's "@all" group (unchanged rule; trustees spelled out).
CREATE OR REPLACE FUNCTION public.task_group_member_ok(_branch uuid, _user uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = _user AND p.status = 'active' AND p.deleted_at IS NULL)
    AND public.is_branch_member(_user, _branch)
    AND public.has_any_role(_user, ARRAY['volunteer', 'branch_manager']::public.app_role[])
    AND NOT public.has_any_role(_user, ARRAY['trustee', 'regional_director', 'national_coordinator']::public.app_role[])
$$;

-- Adding a member to a group later: never a trustee either.
CREATE OR REPLACE FUNCTION public.task_group_add_member(_g public.task_groups, _user uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _task uuid; _manager boolean := public.can_manage_event_scope('branch', _g.branch_id, _g.region_id);
BEGIN
  IF public.is_trustee(_user) THEN RAISE EXCEPTION 'This person cannot be assigned'; END IF;
  IF _manager AND (NOT public.is_branch_member(_user, _g.branch_id) OR NOT public.task_assignee_ok('branch', _g.branch_id, _g.region_id, _user)) THEN
    RAISE EXCEPTION 'This person cannot be assigned';
  END IF;
  IF NOT _manager AND NOT public.task_group_member_ok(_g.branch_id, _user) THEN RAISE EXCEPTION 'This person cannot be assigned'; END IF;
  IF EXISTS (SELECT 1 FROM public.tasks t JOIN public.task_assignees a ON a.task_id = t.id
             WHERE t.group_id = _g.id AND t.deleted_at IS NULL AND a.user_id = _user) THEN
    RAISE EXCEPTION 'This person is already in the group';
  END IF;
  IF NOT _manager THEN RETURN public.task_group_insert_member_task(_g, public.task_group_body(_g), _user); END IF;
  _task := public.task_insert('branch', _g.branch_id, _g.region_id, public.task_group_body(_g), ARRAY[_user], NULL);
  UPDATE public.tasks SET group_id = _g.id WHERE id = _task;
  RETURN _task;
END $$;

-- ---------------------------------------------------------------------------------------------------------------
-- Meetings: only the managers of the meeting's scope invite trustees

CREATE FUNCTION public.meeting_invitee_ok(_scope text, _branch uuid, _region uuid, _user uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.in_work_scope(_scope, _branch, _region, _user)
    AND (NOT public.is_trustee(_user) OR public.can_manage_event_scope(_scope, _branch, _region))
$$;

CREATE OR REPLACE FUNCTION public.meeting_set_invitees(_m public.meetings, _ids uuid[]) RETURNS uuid[]
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _new uuid[]; _u uuid;
BEGIN
  _ids := ARRAY(SELECT DISTINCT x FROM unnest(coalesce(_ids, '{}'::uuid[])) x WHERE x IS NOT NULL);
  IF cardinality(_ids) > 100 THEN RAISE EXCEPTION 'Too many invitees'; END IF;
  FOREACH _u IN ARRAY _ids LOOP
    IF NOT EXISTS (SELECT 1 FROM public.meeting_invitees WHERE meeting_id = _m.id AND user_id = _u)
      AND NOT public.meeting_invitee_ok(_m.scope, _m.branch_id, _m.region_id, _u) THEN
      RAISE EXCEPTION 'Invitee is not in this scope';
    END IF;
  END LOOP;
  _new := ARRAY(SELECT x FROM unnest(_ids) x WHERE NOT EXISTS (SELECT 1 FROM public.meeting_invitees WHERE meeting_id = _m.id AND user_id = x));
  DELETE FROM public.meeting_invitees WHERE meeting_id = _m.id AND NOT (user_id = ANY (_ids));
  INSERT INTO public.meeting_invitees (meeting_id, user_id, invited_by) SELECT _m.id, x, auth.uid() FROM unnest(_new) x;
  FOREACH _u IN ARRAY _new LOOP
    PERFORM public.notify(_u, 'meeting_invited', 'meeting', _m.id, _m.title, '/meetings/' || _m.id,
      jsonb_build_object('starts_at', _m.starts_at));
  END LOOP;
  RETURN _new;
END $$;

CREATE OR REPLACE FUNCTION public.meeting_apply_quiet(_old public.meetings, p jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _m public.meetings; _ids uuid[]; _u uuid;
BEGIN
  _m := public.meeting_fields(_old, p);
  UPDATE public.meetings SET title = _m.title, description = _m.description, starts_at = _m.starts_at, ends_at = _m.ends_at,
    location_type = _m.location_type, location = _m.location, online_url = _m.online_url WHERE id = _old.id;
  IF p ? 'invitee_ids' THEN
    _ids := ARRAY(SELECT DISTINCT x FROM unnest(public.json_uuid_array(p->'invitee_ids')) x WHERE x IS NOT NULL);
    IF cardinality(_ids) > 100 THEN RAISE EXCEPTION 'Too many invitees'; END IF;
    FOREACH _u IN ARRAY _ids LOOP
      IF NOT EXISTS (SELECT 1 FROM public.meeting_invitees WHERE meeting_id = _old.id AND user_id = _u)
        AND NOT public.meeting_invitee_ok(_old.scope, _old.branch_id, _old.region_id, _u) THEN RAISE EXCEPTION 'Invitee is not in this scope'; END IF;
    END LOOP;
    DELETE FROM public.meeting_invitees WHERE meeting_id = _old.id AND NOT (user_id = ANY (_ids));
    INSERT INTO public.meeting_invitees (meeting_id, user_id, invited_by)
    SELECT _old.id, x, auth.uid() FROM unnest(_ids) x ON CONFLICT DO NOTHING;
  END IF;
END $$;

-- The invitee picker offers trustees only to the managers of the scope.
CREATE OR REPLACE FUNCTION public.list_meeting_people(p_scope text, p_branch uuid DEFAULT NULL, p_region uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF p_scope = 'branch' THEN SELECT region_id INTO p_region FROM public.branches WHERE id = p_branch; END IF;
  IF NOT public.has_accepted_privacy_notice() OR NOT public.can_create_meeting(p_scope, p_branch, p_region) THEN RETURN '[]'::jsonb; END IF;
  RETURN (SELECT coalesce(jsonb_agg(x ORDER BY x->>'full_name', x->>'id'), '[]'::jsonb)
          FROM jsonb_array_elements(public.scope_people(p_scope, p_branch, p_region)) x
          WHERE NOT public.is_trustee((x->>'id')::uuid) OR public.can_manage_event_scope(p_scope, p_branch, p_region));
END $$;

-- ---------------------------------------------------------------------------------------------------------------
-- Requests: trustees ask their branch's Branch Manager or region's Regional Director, like volunteers

CREATE OR REPLACE FUNCTION public.request_target_ok(_requester uuid, _target uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT _requester IS DISTINCT FROM _target AND public.is_active_person(_target) AND public.is_active_person(_requester) AND (
    (public.has_role(_requester, 'regional_director') AND NOT public.has_role(_requester, 'national_coordinator')
      AND public.has_role(_target, 'national_coordinator'))
    OR (public.has_role(_requester, 'branch_manager') AND NOT public.has_any_role(_requester, ARRAY['regional_director', 'national_coordinator']::public.app_role[])
      AND EXISTS (SELECT 1 FROM public.user_roles r JOIN public.profiles p ON p.id = _requester JOIN public.branches b ON b.id = p.branch_id
        WHERE r.user_id = _target AND r.role = 'regional_director' AND r.region_id = b.region_id))
    OR (public.has_any_role(_requester, ARRAY['volunteer', 'trustee']::public.app_role[])
      AND NOT public.has_any_role(_requester, ARRAY['branch_manager', 'regional_director', 'national_coordinator']::public.app_role[])
      AND (EXISTS (SELECT 1 FROM public.user_roles r JOIN public.profiles p ON p.id = _requester JOIN public.branches b ON b.id = p.branch_id
             WHERE r.user_id = _target AND r.role = 'regional_director' AND r.region_id = b.region_id)
        OR (public.has_role(_target, 'branch_manager') AND public.get_user_branch(_target) IS NOT NULL
            AND public.get_user_branch(_target) = public.get_user_branch(_requester)))))
$$;

-- ---------------------------------------------------------------------------------------------------------------
-- Roles: approval as Volunteer or Trustee; Branch Managers switch Volunteer <-> Trustee

DROP FUNCTION public.approve_volunteer_application(uuid);
CREATE FUNCTION public.approve_volunteer_application(p_id uuid, p_role public.app_role DEFAULT 'volunteer') RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid uuid := auth.uid(); _a public.volunteer_applications; _branch text; _role public.app_role := coalesce(p_role, 'volunteer');
BEGIN
  PERFORM public.require_privacy_accepted();
  IF _role NOT IN ('volunteer', 'trustee') THEN RAISE EXCEPTION 'Choose Volunteer or Trustee'; END IF;
  PERFORM id FROM public.profiles WHERE id = _uid FOR UPDATE;
  SELECT * INTO _a FROM public.volunteer_applications WHERE id = p_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND OR NOT public.can_review_volunteer_application(_a.branch_id) OR _a.user_id IS NOT DISTINCT FROM _uid THEN RAISE EXCEPTION 'Not allowed'; END IF;
  IF _a.status <> 'submitted' THEN RAISE EXCEPTION 'This application is no longer open'; END IF;
  PERFORM id FROM public.profiles WHERE id = _a.user_id AND status = 'active' AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND OR NOT public.is_follower(_a.user_id) THEN RAISE EXCEPTION 'The applicant is no longer a follower'; END IF;
  SELECT name INTO _branch FROM public.branches WHERE id = _a.branch_id AND deleted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Branch not found'; END IF;
  DELETE FROM public.user_roles WHERE user_id = _a.user_id AND role = 'follower';
  INSERT INTO public.user_roles (user_id, role) VALUES (_a.user_id, _role);
  UPDATE public.profiles SET branch_id = _a.branch_id WHERE id = _a.user_id;
  INSERT INTO public.user_followed_branches (user_id, branch_id) VALUES (_a.user_id, _a.branch_id) ON CONFLICT DO NOTHING;
  UPDATE public.volunteer_applications SET status = 'approved', reviewer_id = _uid, reviewed_at = now() WHERE id = p_id;
  INSERT INTO public.user_audit_log (actor_id, target_id, action, old_value, new_value) VALUES
    (_uid, _a.user_id, 'role_change', 'follower', _role::text),
    (_uid, _a.user_id, 'branch_change', NULL, _a.branch_id::text);
  PERFORM public.notify(_a.user_id, 'volunteer_application_approved', 'volunteer_application', _a.id, _branch, '/dashboard',
    jsonb_build_object('branch', _branch, 'role', _role::text));
END $$;
REVOKE ALL ON FUNCTION public.approve_volunteer_application(uuid, public.app_role) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.approve_volunteer_application(uuid, public.app_role) TO authenticated;

CREATE OR REPLACE FUNCTION public.set_user_role(_target uuid, _role public.app_role, _region uuid DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _actor uuid := auth.uid(); _old public.app_role; _old_region uuid; _nc boolean;
BEGIN
  PERFORM public.require_privacy_accepted();
  IF _role IS NULL OR _role IN ('follower', 'national_coordinator') THEN RAISE EXCEPTION 'This role cannot be assigned in the app'; END IF;
  IF _actor IS NULL OR _actor = _target THEN RAISE EXCEPTION 'You cannot change your own role'; END IF;
  PERFORM id FROM public.profiles WHERE id = _actor FOR UPDATE;
  _nc := public.is_nc();
  PERFORM id FROM public.profiles WHERE id = _target FOR UPDATE;
  SELECT role, region_id INTO _old, _old_region FROM public.user_roles WHERE user_id = _target AND role IN ('volunteer', 'trustee', 'branch_manager', 'regional_director')
    ORDER BY CASE role WHEN 'regional_director' THEN 0 WHEN 'branch_manager' THEN 1 ELSE 2 END LIMIT 1;
  IF NOT _nc THEN
    IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = _actor AND status = 'active') THEN
      RAISE EXCEPTION 'Only active Regional Directors can change roles';
    ELSIF public.has_role(_actor, 'regional_director') THEN
      IF _role NOT IN ('volunteer', 'trustee', 'branch_manager') THEN RAISE EXCEPTION 'Role must be Volunteer or Branch Manager; Regional Director cannot be assigned'; END IF;
    ELSIF public.has_role(_actor, 'branch_manager') THEN
      -- A Branch Manager only switches a member of their branch between Volunteer and Trustee.
      IF _role NOT IN ('volunteer', 'trustee') OR _old IS NULL OR _old NOT IN ('volunteer', 'trustee') THEN
        RAISE EXCEPTION 'Branch Managers can only switch between Volunteer and Trustee';
      END IF;
    ELSE
      RAISE EXCEPTION 'Only active Regional Directors can change roles';
    END IF;
  END IF;
  IF NOT public.can_manage_user(_actor, _target) THEN RAISE EXCEPTION 'You cannot manage this user'; END IF;
  IF _role = 'regional_director' THEN
    _region := coalesce(_region, _old_region);
    IF _region IS NULL OR NOT EXISTS (SELECT 1 FROM public.regions WHERE id = _region AND deleted_at IS NULL) THEN RAISE EXCEPTION 'Choose a region'; END IF;
  ELSE
    _region := NULL;
    IF public.get_user_branch(_target) IS NULL THEN RAISE EXCEPTION 'Assign a branch first'; END IF;
  END IF;
  IF _old = _role AND _old_region IS NOT DISTINCT FROM _region
     AND (SELECT count(*) FROM public.user_roles WHERE user_id = _target) = 1 THEN RETURN; END IF;
  DELETE FROM public.user_roles WHERE user_id = _target AND role IN ('follower', 'volunteer', 'trustee', 'branch_manager', 'regional_director');
  INSERT INTO public.user_roles (user_id, role, region_id) VALUES (_target, _role, _region);
  INSERT INTO public.user_audit_log (actor_id, target_id, action, old_value, new_value)
  VALUES (_actor, _target, 'role_change', _old::text, _role::text);
END $$;

-- ---------------------------------------------------------------------------------------------------------------
-- Counts: trustees as numbers only

CREATE OR REPLACE FUNCTION public.get_nc_dashboard() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.require_nc();
  RETURN jsonb_build_object(
    'regions', (SELECT count(*) FROM public.regions WHERE deleted_at IS NULL),
    'branches', (SELECT count(*) FROM public.branches WHERE deleted_at IS NULL),
    'volunteers', (SELECT count(*) FROM public.profiles p WHERE p.status = 'active' AND p.deleted_at IS NULL AND public.is_member(p.id)
      AND NOT public.is_trustee(p.id)),
    'trustees', (SELECT count(*) FROM public.profiles p WHERE p.status = 'active' AND p.deleted_at IS NULL AND public.is_trustee(p.id)),
    'followers', (SELECT count(*) FROM public.profiles p WHERE p.status = 'active' AND p.deleted_at IS NULL AND public.is_follower(p.id)),
    'upcoming_events', (SELECT count(*) FROM public.events e WHERE public.event_is_upcoming(e)),
    'registrations_30d', (SELECT count(*) FROM public.event_registrations r WHERE r.registered_at > now() - interval '30 days' AND r.status <> 'cancelled'),
    'attended_30d', (SELECT count(*) FROM public.event_registrations r WHERE r.status = 'attended' AND r.attendance_marked_at > now() - interval '30 days'),
    'pending_requests', (SELECT count(*) FROM public.event_requests q WHERE q.deleted_at IS NULL AND q.status IN ('submitted', 'under_review')),
    'open_applications', (SELECT count(*) FROM public.volunteer_applications a WHERE a.deleted_at IS NULL AND a.status = 'submitted'));
END $$;

CREATE OR REPLACE FUNCTION public.get_regions_tree() RETURNS jsonb
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
          'trustees', (SELECT count(*) FROM public.profiles p WHERE p.branch_id = b.id AND p.deleted_at IS NULL AND p.status = 'active'
            AND public.has_role(p.id, 'trustee')),
          'followers', (SELECT count(*) FROM public.user_followed_branches f JOIN public.profiles p ON p.id = f.user_id
            WHERE f.branch_id = b.id AND p.deleted_at IS NULL AND p.status = 'active' AND public.is_follower(p.id)),
          'upcoming_events', (SELECT count(*) FROM public.events e WHERE e.branch_id = b.id AND public.event_is_upcoming(e))
        ) ORDER BY b.name), '[]'::jsonb) FROM public.branches b WHERE b.region_id = r.id AND b.deleted_at IS NULL)
    ) ORDER BY r.name), '[]'::jsonb) FROM public.regions r WHERE r.deleted_at IS NULL);
END $$;

CREATE OR REPLACE FUNCTION public.get_branch_map() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _nc boolean := public.is_nc(); _regions uuid[];
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_accepted_privacy_notice() THEN RAISE EXCEPTION 'Not allowed'; END IF;
  IF NOT _nc THEN
    SELECT array_agg(region_id) INTO _regions FROM public.user_roles WHERE user_id = auth.uid() AND role = 'regional_director' AND region_id IS NOT NULL;
    IF _regions IS NULL OR NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND status = 'active' AND deleted_at IS NULL) THEN
      RAISE EXCEPTION 'Not allowed';
    END IF;
  END IF;
  RETURN (SELECT coalesce(jsonb_agg(jsonb_build_object(
      'id', b.id, 'name', b.name, 'region_id', b.region_id, 'region', r.name, 'postcode', b.postcode,
      'latitude', b.latitude, 'longitude', b.longitude,
      'managers', coalesce((SELECT jsonb_agg(p.full_name ORDER BY p.full_name) FROM public.profiles p JOIN public.user_roles ur ON ur.user_id = p.id
        WHERE p.branch_id = b.id AND ur.role = 'branch_manager' AND p.status = 'active' AND p.deleted_at IS NULL), '[]'::jsonb),
      'volunteers', (SELECT count(*) FROM public.profiles p JOIN public.user_roles ur ON ur.user_id = p.id
        WHERE p.branch_id = b.id AND ur.role = 'volunteer' AND p.status = 'active' AND p.deleted_at IS NULL),
      'trustees', (SELECT count(*) FROM public.profiles p JOIN public.user_roles ur ON ur.user_id = p.id
        WHERE p.branch_id = b.id AND ur.role = 'trustee' AND p.status = 'active' AND p.deleted_at IS NULL),
      'followers', (SELECT count(*) FROM public.user_followed_branches f JOIN public.profiles p ON p.id = f.user_id JOIN public.user_roles ur ON ur.user_id = p.id
        WHERE f.branch_id = b.id AND ur.role = 'follower' AND p.status = 'active' AND p.deleted_at IS NULL),
      'upcoming_events', (SELECT count(*) FROM public.events e WHERE e.branch_id = b.id AND e.status = 'published' AND e.deleted_at IS NULL
        AND NOT e.series_template AND e.category <> 'meeting' AND NOT e.past_record AND coalesce(public.event_ends(e) > now(), false)),
      'open_tasks', (SELECT count(*) FROM public.tasks t WHERE t.branch_id = b.id AND t.deleted_at IS NULL AND t.archived_at IS NULL AND t.status <> 'done')
    ) ORDER BY r.name, b.name), '[]'::jsonb)
    FROM public.branches b JOIN public.regions r ON r.id = b.region_id
    WHERE b.deleted_at IS NULL AND r.deleted_at IS NULL AND (_nc OR b.region_id = ANY (_regions)));
END $$;

-- ---------------------------------------------------------------------------------------------------------------
-- Grants: the new helpers are internal (called from SECURITY DEFINER functions and RLS helpers only).

REVOKE ALL ON FUNCTION public.is_trustee(uuid), public.can_archive_task(uuid),
  public.meeting_invitee_ok(text, uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;

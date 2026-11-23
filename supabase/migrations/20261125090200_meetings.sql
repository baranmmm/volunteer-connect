-- Meetings: scheduled meetings with invitees, an agenda with decisions, private files, and meeting requests.
-- Visibility is strict: only the creator, the invitees and the managers of the scope (the branch's Branch Manager and
-- the region's Regional Director for a branch meeting, the Regional Director for a region meeting, National
-- Coordinators for a national one). Everyone else gets nothing, counts included. Followers never get anything.
-- Clients only read (RLS); every write is a SECURITY DEFINER RPC that starts with require_privacy_accepted().

-- ---------------------------------------------------------------------------------------------------------------
-- Shared helpers for tasks and meetings ("work" items)

-- The signed-in caller, active, not deleted, a member (volunteer and up) or a National Coordinator with MFA.
CREATE FUNCTION public.work_actor() RETURNS uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not signed in'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND status = 'active' AND deleted_at IS NULL)
    OR NOT public.session_ok() OR NOT (public.is_member(auth.uid()) OR public.is_nc()) THEN
    RAISE EXCEPTION 'Not allowed';
  END IF;
  RETURN auth.uid();
END $$;

-- An active, not deleted person.
CREATE FUNCTION public.is_active_person(_uid uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.profiles WHERE id = _uid AND status = 'active' AND deleted_at IS NULL)
$$;

-- The caller's scope: the narrowest scope of a higher role that includes the requester's branch. Members with a branch
-- get their branch; a Regional Director (no branch of their own as a requester) goes to national.
CREATE FUNCTION public.request_scope_of(_requester uuid, OUT scope text, OUT branch_id uuid, OUT region_id uuid)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF public.has_role(_requester, 'regional_director') THEN scope := 'national'; RETURN; END IF;
  SELECT 'branch', b.id, b.region_id INTO scope, branch_id, region_id
  FROM public.profiles p JOIN public.branches b ON b.id = p.branch_id WHERE p.id = _requester;
  IF scope IS NULL THEN RAISE EXCEPTION 'Not allowed'; END IF;
END $$;

-- People a request may go to: the caller's Branch Managers and Regional Director (volunteers), their Regional Director
-- (Branch Managers), or a National Coordinator (Regional Directors). Followers and National Coordinators: nobody.
CREATE FUNCTION public.request_target_ok(_requester uuid, _target uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT _requester IS DISTINCT FROM _target AND public.is_active_person(_target) AND public.is_active_person(_requester) AND (
    (public.has_role(_requester, 'regional_director') AND NOT public.has_role(_requester, 'national_coordinator')
      AND public.has_role(_target, 'national_coordinator'))
    OR (public.has_role(_requester, 'branch_manager') AND NOT public.has_any_role(_requester, ARRAY['regional_director', 'national_coordinator']::public.app_role[])
      AND EXISTS (SELECT 1 FROM public.user_roles r JOIN public.profiles p ON p.id = _requester JOIN public.branches b ON b.id = p.branch_id
        WHERE r.user_id = _target AND r.role = 'regional_director' AND r.region_id = b.region_id))
    OR (public.has_role(_requester, 'volunteer') AND NOT public.has_any_role(_requester, ARRAY['branch_manager', 'regional_director', 'national_coordinator']::public.app_role[])
      AND (EXISTS (SELECT 1 FROM public.user_roles r JOIN public.profiles p ON p.id = _requester JOIN public.branches b ON b.id = p.branch_id
             WHERE r.user_id = _target AND r.role = 'regional_director' AND r.region_id = b.region_id)
        OR (public.has_role(_target, 'branch_manager') AND public.get_user_branch(_target) IS NOT NULL
            AND public.get_user_branch(_target) = public.get_user_branch(_requester)))))
$$;

-- Who the caller can send a task or meeting request to (for the picker).
CREATE FUNCTION public.list_request_targets() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'full_name', p.full_name,
      'role', CASE WHEN public.has_role(p.id, 'national_coordinator') THEN 'national_coordinator'
                   WHEN public.has_role(p.id, 'regional_director') THEN 'regional_director' ELSE 'branch_manager' END)
    ORDER BY p.full_name, p.id), '[]'::jsonb)
  FROM public.profiles p
  WHERE public.session_ok() AND public.has_accepted_privacy_notice() AND public.request_target_ok(auth.uid(), p.id)
$$;

-- Meetings and tasks may be created by: National Coordinators (national), the region's Regional Director (region, or a
-- branch in the region), the branch's Branch Manager, and members of the branch (meetings; tasks only for themselves).
CREATE FUNCTION public.work_scope_valid(_scope text, _branch uuid, _region uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE _scope
    WHEN 'national' THEN _branch IS NULL AND _region IS NULL
    WHEN 'region' THEN _branch IS NULL AND EXISTS (SELECT 1 FROM public.regions WHERE id = _region AND deleted_at IS NULL)
    WHEN 'branch' THEN EXISTS (SELECT 1 FROM public.branches b JOIN public.regions r ON r.id = b.region_id
      WHERE b.id = _branch AND b.region_id = _region AND b.deleted_at IS NULL AND r.deleted_at IS NULL)
    ELSE false END
$$;
CREATE FUNCTION public.is_branch_member(_uid uuid, _branch uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT _branch IS NOT NULL AND public.is_member(_uid) AND public.get_user_branch(_uid) = _branch
$$;

-- People inside a scope: a branch's members and its region's Regional Directors; a region's members and Regional
-- Directors; nationally only Regional Directors, Branch Managers and National Coordinators (never volunteers).
CREATE FUNCTION public.in_work_scope(_scope text, _branch uuid, _region uuid, _user uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.is_active_person(_user) AND CASE _scope
    WHEN 'national' THEN public.has_any_role(_user, ARRAY['regional_director', 'branch_manager', 'national_coordinator']::public.app_role[])
    WHEN 'region' THEN EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user AND role = 'regional_director' AND region_id = _region)
      OR (public.is_member(_user) AND EXISTS (SELECT 1 FROM public.profiles p JOIN public.branches b ON b.id = p.branch_id WHERE p.id = _user AND b.region_id = _region))
    WHEN 'branch' THEN EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user AND role = 'regional_director' AND region_id = _region)
      OR public.is_branch_member(_user, _branch)
    ELSE false END
$$;

-- ---------------------------------------------------------------------------------------------------------------
-- Tables

CREATE TABLE public.meetings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope text NOT NULL CHECK (scope IN ('branch', 'region', 'national')),
  branch_id uuid REFERENCES public.branches(id),
  region_id uuid REFERENCES public.regions(id),
  title text NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 200),
  description text CHECK (char_length(description) <= 5000),
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  location_type text NOT NULL DEFAULT 'in_person' CHECK (location_type IN ('in_person', 'online')),
  location text CHECK (char_length(location) <= 300),
  online_url text CHECK (char_length(online_url) <= 500),
  status text NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'completed', 'cancelled')),
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  source_request_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  deleted_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  purge_requested_at timestamptz,
  CONSTRAINT meetings_scope_shape CHECK ((scope = 'branch' AND branch_id IS NOT NULL AND region_id IS NOT NULL)
    OR (scope = 'region' AND branch_id IS NULL AND region_id IS NOT NULL) OR (scope = 'national' AND branch_id IS NULL AND region_id IS NULL)),
  CONSTRAINT meetings_time CHECK (ends_at > starts_at AND ends_at <= starts_at + interval '7 days'),
  CONSTRAINT meetings_place CHECK ((location_type = 'in_person' AND online_url IS NULL AND char_length(btrim(coalesce(location, ''))) > 0)
    OR (location_type = 'online' AND online_url ~ '^https://[^[:space:]]+$'))
);
CREATE INDEX meetings_starts_idx ON public.meetings (starts_at) WHERE deleted_at IS NULL;
CREATE INDEX meetings_branch_idx ON public.meetings (branch_id);
CREATE INDEX meetings_region_idx ON public.meetings (region_id);

CREATE TABLE public.meeting_invitees (
  meeting_id uuid NOT NULL REFERENCES public.meetings(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  invited_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (meeting_id, user_id)
);
CREATE INDEX meeting_invitees_user_idx ON public.meeting_invitees (user_id);

CREATE TABLE public.meeting_agenda_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id uuid NOT NULL REFERENCES public.meetings(id) ON DELETE CASCADE,
  position integer NOT NULL,
  title text NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 200),
  notes text CHECK (char_length(notes) <= 5000),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX meeting_agenda_items_meeting_idx ON public.meeting_agenda_items (meeting_id, position);

CREATE TABLE public.meeting_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id uuid NOT NULL REFERENCES public.meetings(id) ON DELETE CASCADE,
  agenda_item_id uuid NOT NULL REFERENCES public.meeting_agenda_items(id) ON DELETE CASCADE,
  text text NOT NULL CHECK (char_length(btrim(text)) BETWEEN 1 AND 2000),
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX meeting_decisions_item_idx ON public.meeting_decisions (agenda_item_id, created_at);

CREATE TABLE public.meeting_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id uuid NOT NULL REFERENCES public.meetings(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('image', 'pdf', 'document')),
  storage_path text NOT NULL UNIQUE,
  original_name text NOT NULL CHECK (char_length(btrim(original_name)) BETWEEN 1 AND 255),
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX meeting_files_meeting_idx ON public.meeting_files (meeting_id, created_at);

CREATE TABLE public.meeting_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  target_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  scope text NOT NULL CHECK (scope IN ('branch', 'national')),
  branch_id uuid REFERENCES public.branches(id),
  region_id uuid REFERENCES public.regions(id),
  topic text NOT NULL CHECK (char_length(btrim(topic)) BETWEEN 1 AND 200),
  note text CHECK (char_length(note) <= 2000),
  proposed_times jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(proposed_times) = 'array' AND jsonb_array_length(proposed_times) <= 3),
  status text NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted', 'approved', 'declined', 'withdrawn')),
  decline_reason text CHECK (char_length(decline_reason) <= 1000),
  meeting_id uuid REFERENCES public.meetings(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT meeting_requests_decline_reason CHECK (status <> 'declined' OR char_length(btrim(coalesce(decline_reason, ''))) >= 10)
);
CREATE INDEX meeting_requests_target_idx ON public.meeting_requests (target_id, status);
CREATE INDEX meeting_requests_requester_idx ON public.meeting_requests (requester_id, created_at DESC);

ALTER TABLE public.meetings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meeting_invitees ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meeting_agenda_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meeting_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meeting_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meeting_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.meetings, public.meeting_invitees, public.meeting_agenda_items, public.meeting_decisions, public.meeting_files,
  public.meeting_requests FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.meetings, public.meeting_invitees, public.meeting_agenda_items, public.meeting_decisions, public.meeting_files,
  public.meeting_requests TO authenticated;
GRANT ALL ON public.meetings, public.meeting_invitees, public.meeting_agenda_items, public.meeting_decisions, public.meeting_files,
  public.meeting_requests TO service_role;

CREATE FUNCTION public.work_touch() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END $$;
REVOKE ALL ON FUNCTION public.work_touch() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER meetings_touch BEFORE UPDATE ON public.meetings FOR EACH ROW EXECUTE FUNCTION public.work_touch();
CREATE TRIGGER meeting_requests_touch BEFORE UPDATE ON public.meeting_requests FOR EACH ROW EXECUTE FUNCTION public.work_touch();

-- ---------------------------------------------------------------------------------------------------------------
-- Visibility and editing

CREATE FUNCTION public.can_view_meeting(_meeting uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.is_active_person(auth.uid()) AND public.session_ok() AND NOT public.is_follower(auth.uid())
    AND EXISTS (SELECT 1 FROM public.meetings m WHERE m.id = _meeting AND m.deleted_at IS NULL AND (
      m.created_by = auth.uid()
      OR EXISTS (SELECT 1 FROM public.meeting_invitees i WHERE i.meeting_id = m.id AND i.user_id = auth.uid())
      OR public.can_manage_event_scope(m.scope, m.branch_id, m.region_id)))
$$;

-- Edit (details, invitees, agenda, decisions, files): the creator and the managers of the scope.
CREATE FUNCTION public.can_edit_meeting(_meeting uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.is_active_person(auth.uid()) AND public.session_ok() AND (public.is_member(auth.uid()) OR public.is_nc())
    AND EXISTS (SELECT 1 FROM public.meetings m WHERE m.id = _meeting AND m.deleted_at IS NULL
      AND (m.created_by = auth.uid() OR public.can_manage_event_scope(m.scope, m.branch_id, m.region_id)))
$$;

CREATE FUNCTION public.can_create_meeting(_scope text, _branch uuid, _region uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.work_scope_valid(_scope, _branch, _region) AND (public.can_manage_event_scope(_scope, _branch, _region)
    OR (_scope = 'branch' AND public.is_active_person(auth.uid()) AND public.session_ok() AND public.is_branch_member(auth.uid(), _branch)))
$$;

CREATE POLICY meetings_read ON public.meetings FOR SELECT TO authenticated USING (deleted_at IS NULL AND public.can_view_meeting(id));
CREATE POLICY meeting_invitees_read ON public.meeting_invitees FOR SELECT TO authenticated USING (public.can_view_meeting(meeting_id));
CREATE POLICY meeting_agenda_items_read ON public.meeting_agenda_items FOR SELECT TO authenticated USING (public.can_view_meeting(meeting_id));
CREATE POLICY meeting_decisions_read ON public.meeting_decisions FOR SELECT TO authenticated USING (public.can_view_meeting(meeting_id));
CREATE POLICY meeting_files_read ON public.meeting_files FOR SELECT TO authenticated USING (public.can_view_meeting(meeting_id));
CREATE POLICY meeting_requests_read ON public.meeting_requests FOR SELECT TO authenticated
  USING (requester_id = (SELECT auth.uid()) OR (target_id = (SELECT auth.uid()) AND (SELECT public.session_ok())));
CREATE POLICY privacy_notice_required ON public.meetings AS RESTRICTIVE FOR SELECT TO authenticated USING ((SELECT public.has_accepted_privacy_notice()));
CREATE POLICY privacy_notice_required ON public.meeting_invitees AS RESTRICTIVE FOR SELECT TO authenticated USING ((SELECT public.has_accepted_privacy_notice()));
CREATE POLICY privacy_notice_required ON public.meeting_agenda_items AS RESTRICTIVE FOR SELECT TO authenticated USING ((SELECT public.has_accepted_privacy_notice()));
CREATE POLICY privacy_notice_required ON public.meeting_decisions AS RESTRICTIVE FOR SELECT TO authenticated USING ((SELECT public.has_accepted_privacy_notice()));
CREATE POLICY privacy_notice_required ON public.meeting_files AS RESTRICTIVE FOR SELECT TO authenticated USING ((SELECT public.has_accepted_privacy_notice()));
CREATE POLICY privacy_notice_required ON public.meeting_requests AS RESTRICTIVE FOR SELECT TO authenticated USING ((SELECT public.has_accepted_privacy_notice()));

-- ---------------------------------------------------------------------------------------------------------------
-- Internal: validate and apply meeting fields; replace invitees; notify.

CREATE FUNCTION public.meeting_locked(_id uuid) RETURNS public.meetings
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _m public.meetings;
BEGIN
  SELECT * INTO _m FROM public.meetings WHERE id = _id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Meeting not found'; END IF;
  RETURN _m;
END $$;

CREATE FUNCTION public.meeting_fields(_m public.meetings, p jsonb) RETURNS public.meetings
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF p ? 'title' THEN _m.title := btrim(coalesce(p->>'title', '')); END IF;
  IF p ? 'description' THEN _m.description := nullif(btrim(coalesce(p->>'description', '')), ''); END IF;
  IF p ? 'starts_at' THEN _m.starts_at := (p->>'starts_at')::timestamptz; END IF;
  IF p ? 'ends_at' THEN _m.ends_at := (p->>'ends_at')::timestamptz; END IF;
  IF p ? 'location_type' THEN _m.location_type := p->>'location_type'; END IF;
  IF p ? 'location' THEN _m.location := nullif(btrim(coalesce(p->>'location', '')), ''); END IF;
  IF p ? 'online_url' THEN _m.online_url := nullif(btrim(coalesce(p->>'online_url', '')), ''); END IF;
  IF _m.location_type = 'online' THEN _m.location := NULL; ELSE _m.online_url := NULL; END IF;
  IF char_length(coalesce(_m.title, '')) NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'Title is required'; END IF;
  IF _m.starts_at IS NULL OR _m.ends_at IS NULL OR _m.ends_at <= _m.starts_at OR _m.ends_at > _m.starts_at + interval '7 days' THEN
    RAISE EXCEPTION 'End must be after start';
  END IF;
  IF _m.location_type NOT IN ('in_person', 'online') THEN RAISE EXCEPTION 'Not allowed'; END IF;
  IF _m.location_type = 'online' AND coalesce(_m.online_url, '') !~ '^https://[^[:space:]]+$' THEN RAISE EXCEPTION 'Online link must start with https://'; END IF;
  IF _m.location_type = 'in_person' AND _m.location IS NULL THEN RAISE EXCEPTION 'Location is required'; END IF;
  RETURN _m;
END $$;

-- Sets the invitee list (ids not in scope are refused). New invitees get a notice; returns the new invitee ids.
CREATE FUNCTION public.meeting_set_invitees(_m public.meetings, _ids uuid[]) RETURNS uuid[]
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _new uuid[]; _u uuid;
BEGIN
  _ids := ARRAY(SELECT DISTINCT x FROM unnest(coalesce(_ids, '{}'::uuid[])) x WHERE x IS NOT NULL);
  IF cardinality(_ids) > 100 THEN RAISE EXCEPTION 'Too many invitees'; END IF;
  FOREACH _u IN ARRAY _ids LOOP
    IF NOT EXISTS (SELECT 1 FROM public.meeting_invitees WHERE meeting_id = _m.id AND user_id = _u)
      AND NOT public.in_work_scope(_m.scope, _m.branch_id, _m.region_id, _u) THEN
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

-- Internal create (also used when a meeting request is approved).
CREATE FUNCTION public.meeting_insert(_scope text, _branch uuid, _region uuid, p jsonb, _invitees uuid[], _source uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _m public.meetings;
BEGIN
  IF NOT public.can_create_meeting(_scope, _branch, _region) THEN RAISE EXCEPTION 'Not allowed'; END IF;
  _m.scope := _scope; _m.branch_id := _branch; _m.region_id := _region; _m.location_type := 'in_person';
  _m := public.meeting_fields(_m, p);
  INSERT INTO public.meetings (scope, branch_id, region_id, title, description, starts_at, ends_at, location_type, location, online_url,
    created_by, source_request_id)
  VALUES (_scope, _branch, _region, _m.title, _m.description, _m.starts_at, _m.ends_at, _m.location_type, _m.location, _m.online_url,
    auth.uid(), _source)
  RETURNING * INTO _m;
  PERFORM public.meeting_set_invitees(_m, _invitees);
  RETURN _m.id;
END $$;

CREATE FUNCTION public.json_uuid_array(p jsonb) RETURNS uuid[]
LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE WHEN jsonb_typeof(p) = 'array' THEN ARRAY(SELECT x::uuid FROM jsonb_array_elements_text(p) x) ELSE '{}'::uuid[] END
$$;

-- ---------------------------------------------------------------------------------------------------------------
-- Client RPCs: meetings

CREATE FUNCTION public.create_meeting(p jsonb) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _scope text := p->>'scope'; _branch uuid := nullif(p->>'branch_id', '')::uuid; _region uuid := nullif(p->>'region_id', '')::uuid;
BEGIN
  PERFORM public.require_privacy_accepted();
  PERFORM public.work_actor();
  IF _scope = 'branch' THEN SELECT region_id INTO _region FROM public.branches WHERE id = _branch; END IF;
  RETURN public.meeting_insert(_scope, _branch, _region, p, public.json_uuid_array(p->'invitee_ids'), NULL);
END $$;

CREATE FUNCTION public.update_meeting(p_id uuid, p jsonb) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _old public.meetings; _m public.meetings; _new uuid[] := '{}'; _u uuid;
BEGIN
  PERFORM public.require_privacy_accepted();
  PERFORM public.work_actor();
  _old := public.meeting_locked(p_id);
  IF NOT public.can_edit_meeting(p_id) THEN RAISE EXCEPTION 'Not allowed'; END IF;
  _m := public.meeting_fields(_old, p);
  UPDATE public.meetings SET title = _m.title, description = _m.description, starts_at = _m.starts_at, ends_at = _m.ends_at,
    location_type = _m.location_type, location = _m.location, online_url = _m.online_url WHERE id = p_id;
  IF p ? 'invitee_ids' THEN _new := public.meeting_set_invitees(_m, public.json_uuid_array(p->'invitee_ids')); END IF;
  IF (_m.starts_at, _m.ends_at, _m.location_type, coalesce(_m.location, ''), coalesce(_m.online_url, ''))
     IS DISTINCT FROM (_old.starts_at, _old.ends_at, _old.location_type, coalesce(_old.location, ''), coalesce(_old.online_url, '')) THEN
    FOR _u IN SELECT user_id FROM public.meeting_invitees WHERE meeting_id = p_id AND NOT (user_id = ANY (_new)) LOOP
      PERFORM public.notify(_u, 'meeting_changed', 'meeting', p_id, _m.title, '/meetings/' || p_id, jsonb_build_object('starts_at', _m.starts_at));
    END LOOP;
  END IF;
  RETURN p_id;
END $$;

-- Scheduled, completed or cancelled. Cancelling notifies every invitee.
CREATE FUNCTION public.set_meeting_status(p_id uuid, p_status text) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _m public.meetings; _u uuid;
BEGIN
  PERFORM public.require_privacy_accepted();
  PERFORM public.work_actor();
  _m := public.meeting_locked(p_id);
  IF NOT public.can_edit_meeting(p_id) THEN RAISE EXCEPTION 'Not allowed'; END IF;
  IF p_status NOT IN ('scheduled', 'completed', 'cancelled') THEN RAISE EXCEPTION 'Not allowed'; END IF;
  IF _m.status = p_status THEN RETURN p_status; END IF;
  UPDATE public.meetings SET status = p_status WHERE id = p_id;
  IF p_status = 'cancelled' THEN
    FOR _u IN SELECT user_id FROM public.meeting_invitees WHERE meeting_id = p_id LOOP
      PERFORM public.notify(_u, 'meeting_cancelled', 'meeting', p_id, _m.title, '/meetings/' || p_id, jsonb_build_object('starts_at', _m.starts_at));
    END LOOP;
  END IF;
  RETURN p_status;
END $$;

-- To the Recycle Bin (30 days, then purged with its files).
CREATE FUNCTION public.delete_meeting(p_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _m public.meetings;
BEGIN
  PERFORM public.require_privacy_accepted();
  PERFORM public.work_actor();
  _m := public.meeting_locked(p_id);
  IF NOT public.can_edit_meeting(p_id) THEN RAISE EXCEPTION 'Not allowed'; END IF;
  UPDATE public.meetings SET deleted_at = now(), deleted_by = auth.uid() WHERE id = p_id;
  INSERT INTO public.recycle_bin_audit_log (actor_id, item_type, item_id, action, branch_id, region_id)
  VALUES (auth.uid(), 'meeting', p_id, 'delete', _m.branch_id, _m.region_id);
END $$;

CREATE FUNCTION public.meeting_json(_m public.meetings) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object('id', _m.id, 'scope', _m.scope, 'branch_id', _m.branch_id, 'region_id', _m.region_id,
    'branch', (SELECT name FROM public.branches WHERE id = _m.branch_id), 'region', (SELECT name FROM public.regions WHERE id = _m.region_id),
    'title', _m.title, 'description', _m.description, 'starts_at', _m.starts_at, 'ends_at', _m.ends_at,
    'location_type', _m.location_type, 'location', _m.location, 'online_url', _m.online_url, 'status', _m.status,
    'created_by', _m.created_by, 'created_by_name', (SELECT full_name FROM public.profiles WHERE id = _m.created_by AND deleted_at IS NULL),
    'invitee_count', (SELECT count(*) FROM public.meeting_invitees WHERE meeting_id = _m.id),
    'invited', EXISTS (SELECT 1 FROM public.meeting_invitees WHERE meeting_id = _m.id AND user_id = auth.uid()),
    'can_edit', public.can_edit_meeting(_m.id))
$$;

-- Upcoming (not yet ended) or past meetings the caller can see.
CREATE FUNCTION public.list_meetings(p_when text DEFAULT 'upcoming', p_limit integer DEFAULT 200) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(jsonb_agg(public.meeting_json(m) ORDER BY
      CASE WHEN p_when = 'past' THEN -extract(epoch FROM m.starts_at) ELSE extract(epoch FROM m.starts_at) END, m.id), '[]'::jsonb)
  FROM (SELECT * FROM public.meetings m
        WHERE m.deleted_at IS NULL AND public.has_accepted_privacy_notice() AND public.can_view_meeting(m.id)
          AND CASE WHEN p_when = 'past' THEN m.ends_at < now() ELSE m.ends_at >= now() END
        ORDER BY CASE WHEN p_when = 'past' THEN -extract(epoch FROM m.starts_at) ELSE extract(epoch FROM m.starts_at) END, m.id
        LIMIT greatest(1, least(coalesce(p_limit, 200), 500))) m
$$;

-- One meeting with invitees, agenda, decisions (and their linked tasks), files. NULL when not visible.
CREATE FUNCTION public.get_meeting(p_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _m public.meetings;
BEGIN
  IF NOT public.has_accepted_privacy_notice() OR NOT public.can_view_meeting(p_id) THEN RETURN NULL; END IF;
  SELECT * INTO _m FROM public.meetings WHERE id = p_id;
  RETURN public.meeting_json(_m) || jsonb_build_object(
    'invitees', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'full_name', p.full_name) ORDER BY p.full_name, p.id), '[]'::jsonb)
      FROM public.meeting_invitees i JOIN public.profiles p ON p.id = i.user_id WHERE i.meeting_id = p_id AND p.deleted_at IS NULL),
    'agenda', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'position', a.position, 'title', a.title, 'notes', a.notes,
        'decisions', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'text', d.text, 'created_at', d.created_at,
            'tasks', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'title', t.title, 'status', t.status) ORDER BY t.created_at), '[]'::jsonb)
                      FROM public.tasks t WHERE t.decision_id = d.id AND t.deleted_at IS NULL AND public.can_view_task(t.id)))
          ORDER BY d.created_at, d.id), '[]'::jsonb) FROM public.meeting_decisions d WHERE d.agenda_item_id = a.id))
      ORDER BY a.position, a.id), '[]'::jsonb) FROM public.meeting_agenda_items a WHERE a.meeting_id = p_id),
    'files', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', f.id, 'kind', f.kind, 'storage_path', f.storage_path,
        'original_name', f.original_name, 'created_at', f.created_at) ORDER BY f.created_at, f.id), '[]'::jsonb)
      FROM public.meeting_files f WHERE f.meeting_id = p_id));
END $$;

-- People who may be invited to a meeting in this scope (the picker). Empty when the caller cannot create there.
CREATE FUNCTION public.list_meeting_people(p_scope text, p_branch uuid DEFAULT NULL, p_region uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF p_scope = 'branch' THEN SELECT region_id INTO p_region FROM public.branches WHERE id = p_branch; END IF;
  IF NOT public.has_accepted_privacy_notice() OR NOT public.can_create_meeting(p_scope, p_branch, p_region) THEN RETURN '[]'::jsonb; END IF;
  RETURN public.scope_people(p_scope, p_branch, p_region);
END $$;

-- People in a scope with their role and branch (internal; callers check rights first).
CREATE FUNCTION public.scope_people(_scope text, _branch uuid, _region uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'full_name', p.full_name, 'branch', b.name,
      'role', (SELECT r.role::text FROM public.user_roles r WHERE r.user_id = p.id
               ORDER BY CASE r.role WHEN 'national_coordinator' THEN 0 WHEN 'regional_director' THEN 1 WHEN 'branch_manager' THEN 2 ELSE 3 END LIMIT 1))
    ORDER BY p.full_name, p.id), '[]'::jsonb)
  FROM public.profiles p LEFT JOIN public.branches b ON b.id = p.branch_id
  WHERE public.in_work_scope(_scope, _branch, _region, p.id)
$$;

-- ---------------------------------------------------------------------------------------------------------------
-- Agenda and decisions (editors: the creator and the scope's managers; invitees read only)

CREATE FUNCTION public.meeting_editable(_meeting uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.work_actor();
  PERFORM public.meeting_locked(_meeting);
  IF NOT public.can_edit_meeting(_meeting) THEN RAISE EXCEPTION 'Not allowed'; END IF;
END $$;

CREATE FUNCTION public.add_agenda_item(p_meeting uuid, p_title text, p_notes text DEFAULT NULL) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _id uuid;
BEGIN
  PERFORM public.require_privacy_accepted();
  PERFORM public.meeting_editable(p_meeting);
  IF (SELECT count(*) FROM public.meeting_agenda_items WHERE meeting_id = p_meeting) >= 50 THEN RAISE EXCEPTION 'Too many agenda items'; END IF;
  IF char_length(btrim(coalesce(p_title, ''))) NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'Title is required'; END IF;
  INSERT INTO public.meeting_agenda_items (meeting_id, position, title, notes)
  VALUES (p_meeting, coalesce((SELECT max(position) + 1 FROM public.meeting_agenda_items WHERE meeting_id = p_meeting), 0),
    btrim(p_title), nullif(btrim(coalesce(p_notes, '')), ''))
  RETURNING id INTO _id;
  RETURN _id;
END $$;

CREATE FUNCTION public.update_agenda_item(p_id uuid, p_title text, p_notes text DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _meeting uuid;
BEGIN
  PERFORM public.require_privacy_accepted();
  SELECT meeting_id INTO _meeting FROM public.meeting_agenda_items WHERE id = p_id;
  IF _meeting IS NULL THEN RAISE EXCEPTION 'Not allowed'; END IF;
  PERFORM public.meeting_editable(_meeting);
  IF char_length(btrim(coalesce(p_title, ''))) NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'Title is required'; END IF;
  UPDATE public.meeting_agenda_items SET title = btrim(p_title), notes = nullif(btrim(coalesce(p_notes, '')), '') WHERE id = p_id;
END $$;

CREATE FUNCTION public.delete_agenda_item(p_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _meeting uuid;
BEGIN
  PERFORM public.require_privacy_accepted();
  SELECT meeting_id INTO _meeting FROM public.meeting_agenda_items WHERE id = p_id;
  IF _meeting IS NULL THEN RAISE EXCEPTION 'Not allowed'; END IF;
  PERFORM public.meeting_editable(_meeting);
  DELETE FROM public.meeting_agenda_items WHERE id = p_id;
END $$;

-- Moves an item one place up (-1) or down (1).
CREATE FUNCTION public.move_agenda_item(p_id uuid, p_direction integer) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _a public.meeting_agenda_items; _b public.meeting_agenda_items;
BEGIN
  PERFORM public.require_privacy_accepted();
  SELECT * INTO _a FROM public.meeting_agenda_items WHERE id = p_id;
  IF NOT FOUND OR p_direction NOT IN (-1, 1) THEN RAISE EXCEPTION 'Not allowed'; END IF;
  PERFORM public.meeting_editable(_a.meeting_id);
  SELECT * INTO _b FROM public.meeting_agenda_items WHERE meeting_id = _a.meeting_id
    AND CASE WHEN p_direction < 0 THEN position < _a.position ELSE position > _a.position END
    ORDER BY CASE WHEN p_direction < 0 THEN -position ELSE position END LIMIT 1;
  IF NOT FOUND THEN RETURN; END IF;
  UPDATE public.meeting_agenda_items SET position = _b.position WHERE id = _a.id;
  UPDATE public.meeting_agenda_items SET position = _a.position WHERE id = _b.id;
END $$;

CREATE FUNCTION public.add_meeting_decision(p_item uuid, p_text text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _meeting uuid; _id uuid;
BEGIN
  PERFORM public.require_privacy_accepted();
  SELECT meeting_id INTO _meeting FROM public.meeting_agenda_items WHERE id = p_item;
  IF _meeting IS NULL THEN RAISE EXCEPTION 'Not allowed'; END IF;
  PERFORM public.meeting_editable(_meeting);
  IF char_length(btrim(coalesce(p_text, ''))) NOT BETWEEN 1 AND 2000 THEN RAISE EXCEPTION 'Decision text is required'; END IF;
  IF (SELECT count(*) FROM public.meeting_decisions WHERE agenda_item_id = p_item) >= 50 THEN RAISE EXCEPTION 'Not allowed'; END IF;
  INSERT INTO public.meeting_decisions (meeting_id, agenda_item_id, text, created_by) VALUES (_meeting, p_item, btrim(p_text), auth.uid())
  RETURNING id INTO _id;
  RETURN _id;
END $$;

CREATE FUNCTION public.update_meeting_decision(p_id uuid, p_text text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _meeting uuid;
BEGIN
  PERFORM public.require_privacy_accepted();
  SELECT meeting_id INTO _meeting FROM public.meeting_decisions WHERE id = p_id;
  IF _meeting IS NULL THEN RAISE EXCEPTION 'Not allowed'; END IF;
  PERFORM public.meeting_editable(_meeting);
  IF char_length(btrim(coalesce(p_text, ''))) NOT BETWEEN 1 AND 2000 THEN RAISE EXCEPTION 'Decision text is required'; END IF;
  UPDATE public.meeting_decisions SET text = btrim(p_text) WHERE id = p_id;
END $$;

CREATE FUNCTION public.delete_meeting_decision(p_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _meeting uuid;
BEGIN
  PERFORM public.require_privacy_accepted();
  SELECT meeting_id INTO _meeting FROM public.meeting_decisions WHERE id = p_id;
  IF _meeting IS NULL THEN RAISE EXCEPTION 'Not allowed'; END IF;
  PERFORM public.meeting_editable(_meeting);
  DELETE FROM public.meeting_decisions WHERE id = p_id;
END $$;

-- ---------------------------------------------------------------------------------------------------------------
-- Files: private bucket meeting-files (25 MB; PDF, images, docx, pptx, xlsx). A slot is reserved first (row with the
-- storage path), then the client uploads to that path; Storage policies only allow paths of reserved slots of meetings
-- the caller may edit (upload/delete) or see (download). Deleting: Storage object first, then the row.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('meeting-files', 'meeting-files', false, 26214400, ARRAY['application/pdf', 'image/jpeg', 'image/png', 'image/webp',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'])
ON CONFLICT (id) DO NOTHING;

CREATE FUNCTION public.can_read_meeting_file(_path text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.meeting_files f WHERE f.storage_path = _path AND public.can_view_meeting(f.meeting_id))
$$;
CREATE FUNCTION public.can_write_meeting_file(_path text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.meeting_files f WHERE f.storage_path = _path AND public.can_edit_meeting(f.meeting_id))
$$;

CREATE POLICY meeting_files_read ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'meeting-files' AND public.can_read_meeting_file(name));
CREATE POLICY meeting_files_upload ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'meeting-files' AND public.can_write_meeting_file(name)
    AND lower(storage.extension(name)) IN ('pdf', 'jpg', 'png', 'webp', 'docx', 'pptx', 'xlsx'));
CREATE POLICY meeting_files_delete ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'meeting-files' AND public.can_write_meeting_file(name));

-- Reserves a file slot (at most 20 per meeting). Returns the new row's id and storage path.
CREATE FUNCTION public.add_meeting_file(p_meeting uuid, p_extension text, p_original_name text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _ext text := lower(btrim(coalesce(p_extension, ''))); _kind text; _id uuid := gen_random_uuid(); _path text;
BEGIN
  PERFORM public.require_privacy_accepted();
  PERFORM public.meeting_editable(p_meeting);
  IF _ext = 'jpeg' THEN _ext := 'jpg'; END IF;
  _kind := CASE WHEN _ext IN ('jpg', 'png', 'webp') THEN 'image' WHEN _ext = 'pdf' THEN 'pdf'
                WHEN _ext IN ('docx', 'pptx', 'xlsx') THEN 'document' END;
  IF _kind IS NULL THEN RAISE EXCEPTION 'File type is not allowed'; END IF;
  IF (SELECT count(*) FROM public.meeting_files WHERE meeting_id = p_meeting) >= 20 THEN RAISE EXCEPTION 'Too many files'; END IF;
  _path := p_meeting || '/' || _id || '.' || _ext;
  INSERT INTO public.meeting_files (id, meeting_id, kind, storage_path, original_name, created_by)
  VALUES (_id, p_meeting, _kind, _path, left(coalesce(nullif(btrim(p_original_name), ''), 'file.' || _ext), 255), auth.uid());
  RETURN jsonb_build_object('id', _id, 'storage_path', _path);
END $$;

-- Removes a file row after its Storage object was deleted (refused while the object still exists).
CREATE FUNCTION public.delete_meeting_file(p_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _f public.meeting_files;
BEGIN
  PERFORM public.require_privacy_accepted();
  SELECT * INTO _f FROM public.meeting_files WHERE id = p_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Not allowed'; END IF;
  PERFORM public.meeting_editable(_f.meeting_id);
  IF EXISTS (SELECT 1 FROM storage.objects WHERE bucket_id = 'meeting-files' AND name = _f.storage_path) THEN
    RAISE EXCEPTION 'Remove stored file first';
  END IF;
  DELETE FROM public.meeting_files WHERE id = p_id;
END $$;

-- ---------------------------------------------------------------------------------------------------------------
-- Meeting requests: a lower role asks a higher role in their chain to hold a meeting.

CREATE FUNCTION public.meeting_request_json(_r public.meeting_requests) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object('id', _r.id, 'kind', 'meeting', 'topic', _r.topic, 'note', _r.note, 'proposed_times', _r.proposed_times,
    'status', _r.status, 'decline_reason', _r.decline_reason, 'meeting_id', _r.meeting_id, 'scope', _r.scope,
    'branch', (SELECT name FROM public.branches WHERE id = _r.branch_id),
    'requester_id', _r.requester_id, 'requester_name', (SELECT full_name FROM public.profiles WHERE id = _r.requester_id AND deleted_at IS NULL),
    'target_id', _r.target_id, 'target_name', (SELECT full_name FROM public.profiles WHERE id = _r.target_id AND deleted_at IS NULL),
    'created_at', _r.created_at, 'reviewed_at', _r.reviewed_at)
$$;

CREATE FUNCTION public.submit_meeting_request(p jsonb) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _me uuid; _target uuid := nullif(p->>'target_id', '')::uuid; _s record; _times jsonb := coalesce(p->'proposed_times', '[]'::jsonb);
  _t jsonb; _id uuid; _topic text := btrim(coalesce(p->>'topic', ''));
BEGIN
  PERFORM public.require_privacy_accepted();
  _me := public.work_actor();
  IF NOT public.request_target_ok(_me, _target) THEN RAISE EXCEPTION 'This person cannot receive your request'; END IF;
  IF char_length(_topic) NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'Title is required'; END IF;
  IF jsonb_typeof(_times) <> 'array' OR jsonb_array_length(_times) > 3 THEN RAISE EXCEPTION 'Not allowed'; END IF;
  FOR _t IN SELECT * FROM jsonb_array_elements(_times) LOOP
    IF (_t->>'starts_at')::timestamptz IS NULL OR (_t->>'ends_at')::timestamptz <= (_t->>'starts_at')::timestamptz THEN
      RAISE EXCEPTION 'End must be after start';
    END IF;
  END LOOP;
  SELECT * INTO _s FROM public.request_scope_of(_me);
  INSERT INTO public.meeting_requests (requester_id, target_id, scope, branch_id, region_id, topic, note, proposed_times)
  VALUES (_me, _target, _s.scope, _s.branch_id, _s.region_id, _topic, nullif(btrim(coalesce(p->>'note', '')), ''), _times)
  RETURNING id INTO _id;
  PERFORM public.notify(_target, 'meeting_request_received', 'meeting_request', _id, _topic, '/requests?tab=review');
  RETURN _id;
END $$;

CREATE FUNCTION public.meeting_request_locked(_id uuid) RETURNS public.meeting_requests
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _r public.meeting_requests;
BEGIN
  SELECT * INTO _r FROM public.meeting_requests WHERE id = _id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Request not found'; END IF;
  RETURN _r;
END $$;

CREATE FUNCTION public.withdraw_meeting_request(p_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _r public.meeting_requests;
BEGIN
  PERFORM public.require_privacy_accepted();
  PERFORM public.work_actor();
  _r := public.meeting_request_locked(p_id);
  IF _r.requester_id IS DISTINCT FROM auth.uid() OR _r.status <> 'submitted' THEN RAISE EXCEPTION 'Not allowed'; END IF;
  UPDATE public.meeting_requests SET status = 'withdrawn' WHERE id = p_id;
END $$;

CREATE FUNCTION public.decline_meeting_request(p_id uuid, p_reason text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _r public.meeting_requests;
BEGIN
  PERFORM public.require_privacy_accepted();
  PERFORM public.work_actor();
  _r := public.meeting_request_locked(p_id);
  IF _r.target_id IS DISTINCT FROM auth.uid() OR _r.status <> 'submitted' THEN RAISE EXCEPTION 'Not allowed'; END IF;
  IF char_length(btrim(coalesce(p_reason, ''))) < 10 OR char_length(p_reason) > 1000 THEN RAISE EXCEPTION 'Decline reason is too short'; END IF;
  UPDATE public.meeting_requests SET status = 'declined', decline_reason = btrim(p_reason), reviewed_at = now() WHERE id = p_id;
  PERFORM public.notify(_r.requester_id, 'meeting_request_declined', 'meeting_request', p_id, _r.topic, '/requests?tab=mine',
    jsonb_build_object('reason', btrim(p_reason)));
END $$;

-- Approves: creates a scheduled meeting owned by the target (details as edited before saving), the requester invited.
CREATE FUNCTION public.approve_meeting_request(p_id uuid, p_meeting jsonb) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _r public.meeting_requests; _meeting uuid;
BEGIN
  PERFORM public.require_privacy_accepted();
  PERFORM public.work_actor();
  _r := public.meeting_request_locked(p_id);
  IF _r.target_id IS DISTINCT FROM auth.uid() OR _r.status <> 'submitted' THEN RAISE EXCEPTION 'Not allowed'; END IF;
  IF NOT public.is_active_person(_r.requester_id) THEN RAISE EXCEPTION 'Not allowed'; END IF;
  _meeting := public.meeting_insert(_r.scope, _r.branch_id, _r.region_id, coalesce(p_meeting, '{}'::jsonb),
    array_append(public.json_uuid_array(p_meeting->'invitee_ids'), _r.requester_id), p_id);
  UPDATE public.meeting_requests SET status = 'approved', meeting_id = _meeting, reviewed_at = now() WHERE id = p_id;
  PERFORM public.notify(_r.requester_id, 'meeting_request_approved', 'meeting_request', p_id, _r.topic, '/meetings/' || _meeting);
  RETURN _meeting;
END $$;

CREATE FUNCTION public.list_my_meeting_requests() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(jsonb_agg(public.meeting_request_json(r) ORDER BY r.created_at DESC), '[]'::jsonb)
  FROM public.meeting_requests r WHERE r.requester_id = auth.uid() AND public.has_accepted_privacy_notice() AND public.session_ok()
$$;
-- Requests to the caller: 'open' (submitted) or 'decided'.
CREATE FUNCTION public.list_meeting_requests_to_review(p_filter text DEFAULT 'open') RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(jsonb_agg(public.meeting_request_json(r) ORDER BY r.created_at DESC), '[]'::jsonb)
  FROM public.meeting_requests r WHERE r.target_id = auth.uid() AND public.has_accepted_privacy_notice() AND public.session_ok()
    AND CASE WHEN p_filter = 'decided' THEN r.status IN ('approved', 'declined') ELSE r.status = 'submitted' END
$$;

-- ---------------------------------------------------------------------------------------------------------------
-- Grants

REVOKE ALL ON FUNCTION public.work_actor(), public.is_active_person(uuid), public.request_scope_of(uuid), public.request_target_ok(uuid, uuid),
  public.work_scope_valid(text, uuid, uuid), public.is_branch_member(uuid, uuid), public.in_work_scope(text, uuid, uuid, uuid),
  public.meeting_locked(uuid), public.meeting_fields(public.meetings, jsonb), public.meeting_set_invitees(public.meetings, uuid[]),
  public.meeting_insert(text, uuid, uuid, jsonb, uuid[], uuid), public.json_uuid_array(jsonb), public.meeting_json(public.meetings),
  public.scope_people(text, uuid, uuid), public.meeting_editable(uuid), public.meeting_request_json(public.meeting_requests),
  public.meeting_request_locked(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.list_request_targets(), public.can_view_meeting(uuid), public.can_edit_meeting(uuid), public.can_create_meeting(text, uuid, uuid),
  public.create_meeting(jsonb), public.update_meeting(uuid, jsonb), public.set_meeting_status(uuid, text), public.delete_meeting(uuid),
  public.list_meetings(text, integer), public.get_meeting(uuid), public.list_meeting_people(text, uuid, uuid),
  public.add_agenda_item(uuid, text, text), public.update_agenda_item(uuid, text, text), public.delete_agenda_item(uuid), public.move_agenda_item(uuid, integer),
  public.add_meeting_decision(uuid, text), public.update_meeting_decision(uuid, text), public.delete_meeting_decision(uuid),
  public.can_read_meeting_file(text), public.can_write_meeting_file(text), public.add_meeting_file(uuid, text, text), public.delete_meeting_file(uuid),
  public.submit_meeting_request(jsonb), public.withdraw_meeting_request(uuid), public.decline_meeting_request(uuid, text),
  public.approve_meeting_request(uuid, jsonb), public.list_my_meeting_requests(), public.list_meeting_requests_to_review(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_request_targets(), public.can_view_meeting(uuid), public.can_edit_meeting(uuid), public.can_create_meeting(text, uuid, uuid),
  public.create_meeting(jsonb), public.update_meeting(uuid, jsonb), public.set_meeting_status(uuid, text), public.delete_meeting(uuid),
  public.list_meetings(text, integer), public.get_meeting(uuid), public.list_meeting_people(text, uuid, uuid),
  public.add_agenda_item(uuid, text, text), public.update_agenda_item(uuid, text, text), public.delete_agenda_item(uuid), public.move_agenda_item(uuid, integer),
  public.add_meeting_decision(uuid, text), public.update_meeting_decision(uuid, text), public.delete_meeting_decision(uuid),
  public.can_read_meeting_file(text), public.can_write_meeting_file(text), public.add_meeting_file(uuid, text, text), public.delete_meeting_file(uuid),
  public.submit_meeting_request(jsonb), public.withdraw_meeting_request(uuid), public.decline_meeting_request(uuid, text),
  public.approve_meeting_request(uuid, jsonb), public.list_my_meeting_requests(), public.list_meeting_requests_to_review(text) TO authenticated;

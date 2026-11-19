CREATE TYPE public.user_audit_action AS ENUM ('status_change', 'role_change', 'branch_change');
CREATE TABLE public.user_audit_log (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 actor_id uuid NOT NULL,
 target_id uuid NOT NULL,
 action public.user_audit_action NOT NULL,
 old_value text,
 new_value text,
 created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.user_audit_log TO authenticated;
GRANT SELECT ON public.user_audit_log TO service_role;
REVOKE ALL ON public.user_audit_log FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.user_audit_log FROM authenticated;
ALTER TABLE public.user_audit_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users and managers read permitted history" ON public.user_audit_log FOR SELECT TO authenticated USING (target_id = auth.uid() OR public.can_manage_user(auth.uid(), target_id));
CREATE INDEX user_audit_log_target_created_idx ON public.user_audit_log (target_id, created_at DESC, id DESC);

CREATE OR REPLACE FUNCTION public.set_user_role(_target uuid, _role public.app_role)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _actor uuid := auth.uid(); _old public.app_role;
BEGIN
 IF _role IS NULL OR _role NOT IN ('volunteer', 'branch_manager') THEN
  RAISE EXCEPTION 'Role must be Volunteer or Branch Manager; Regional Director cannot be assigned';
 END IF;
 IF _actor IS NULL OR _actor = _target THEN RAISE EXCEPTION 'You cannot change your own role'; END IF;
 PERFORM id FROM public.profiles WHERE id = _actor FOR UPDATE;
 IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = _actor AND status = 'active') OR NOT public.has_role(_actor, 'regional_director') THEN RAISE EXCEPTION 'Only active Regional Directors can change roles'; END IF;
 PERFORM id FROM public.profiles WHERE id = _target FOR UPDATE;
 IF NOT public.can_manage_user(_actor, _target) THEN RAISE EXCEPTION 'You cannot manage this user'; END IF;
 SELECT role INTO _old FROM public.user_roles WHERE user_id = _target AND role IN ('volunteer','branch_manager') ORDER BY CASE WHEN role = 'branch_manager' THEN 0 ELSE 1 END LIMIT 1;
 IF _old = _role AND (SELECT count(*) FROM public.user_roles WHERE user_id = _target) = 1 THEN RETURN; END IF;
 DELETE FROM public.user_roles WHERE user_id = _target AND role IN ('volunteer','branch_manager');
 INSERT INTO public.user_roles(user_id, role) VALUES (_target, _role);
 INSERT INTO public.user_audit_log(actor_id, target_id, action, old_value, new_value) VALUES (_actor, _target, 'role_change', _old::text, _role::text);
END $$;

CREATE OR REPLACE FUNCTION public.set_user_branch(_target uuid, _branch uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _actor uuid := auth.uid(); _old uuid; _region uuid;
BEGIN
 IF _actor IS NULL OR _actor = _target THEN RAISE EXCEPTION 'You cannot move your own branch'; END IF;
 PERFORM id FROM public.profiles WHERE id = _actor FOR UPDATE;
 IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = _actor AND status = 'active') OR NOT public.has_role(_actor, 'regional_director') THEN RAISE EXCEPTION 'Only active Regional Directors can move users'; END IF;
 SELECT region_id INTO _region FROM public.user_roles WHERE user_id = _actor AND role = 'regional_director' LIMIT 1;
 SELECT branch_id INTO _old FROM public.profiles WHERE id = _target FOR UPDATE;
 IF NOT public.can_manage_user(_actor, _target) THEN RAISE EXCEPTION 'You cannot manage this user'; END IF;
 IF NOT EXISTS (SELECT 1 FROM public.branches WHERE id = _branch AND region_id = _region) THEN RAISE EXCEPTION 'The new branch must belong to your region'; END IF;
 IF _old IS NOT DISTINCT FROM _branch THEN RETURN; END IF;
 UPDATE public.profiles SET branch_id = _branch WHERE id = _target;
 INSERT INTO public.user_audit_log(actor_id, target_id, action, old_value, new_value) VALUES (_actor, _target, 'branch_change', _old::text, _branch::text);
END $$;

CREATE OR REPLACE FUNCTION public.set_user_status(_target uuid, _status public.profile_status)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _actor uuid := auth.uid(); _old public.profile_status;
BEGIN
 IF _actor IS NULL OR _actor = _target THEN RAISE EXCEPTION 'You cannot change your own status'; END IF;
 PERFORM id FROM public.profiles WHERE id = _actor FOR UPDATE;
 SELECT status INTO _old FROM public.profiles WHERE id = _target FOR UPDATE;
 IF NOT public.can_manage_user(_actor, _target) THEN RAISE EXCEPTION 'Not allowed'; END IF;
 IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = _actor AND status = 'active') THEN RAISE EXCEPTION 'Not allowed'; END IF;
 IF _status IS NULL THEN RAISE EXCEPTION 'Status is required'; END IF;
 IF _old = _status THEN RETURN; END IF;
 UPDATE public.profiles SET status = _status WHERE id = _target;
 INSERT INTO public.user_audit_log(actor_id, target_id, action, old_value, new_value) VALUES (_actor, _target, 'status_change', _old::text, _status::text);
END $$;

CREATE FUNCTION public.get_user_audit_history(_target uuid, _offset integer DEFAULT 0)
RETURNS TABLE(id uuid, action public.user_audit_action, old_value text, new_value text, created_at timestamptz, actor_name text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
 IF auth.uid() IS NULL OR NOT (auth.uid() = _target OR public.can_manage_user(auth.uid(), _target)) THEN RAISE EXCEPTION 'Not allowed'; END IF;
 RETURN QUERY SELECT a.id, a.action, a.old_value, a.new_value, a.created_at, COALESCE(NULLIF(p.full_name, ''), 'Former member') FROM public.user_audit_log a LEFT JOIN public.profiles p ON p.id = a.actor_id WHERE a.target_id = _target ORDER BY a.created_at DESC, a.id DESC LIMIT 100 OFFSET greatest(_offset, 0);
END $$;
REVOKE ALL ON FUNCTION public.set_user_role(uuid, public.app_role), public.set_user_branch(uuid, uuid), public.set_user_status(uuid, public.profile_status), public.get_user_audit_history(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_user_role(uuid, public.app_role), public.set_user_branch(uuid, uuid), public.set_user_status(uuid, public.profile_status), public.get_user_audit_history(uuid, integer) TO authenticated;
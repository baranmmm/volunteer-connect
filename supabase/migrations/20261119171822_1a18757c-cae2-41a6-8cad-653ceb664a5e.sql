-- 1. Column-level protection on profiles
REVOKE UPDATE ON public.profiles FROM anon, authenticated;
GRANT UPDATE (full_name, phone) ON public.profiles TO authenticated;

-- 2. Remove direct writes
REVOKE INSERT, UPDATE, DELETE ON public.regions, public.branches, public.user_roles FROM anon, authenticated;
REVOKE INSERT, DELETE ON public.profiles FROM anon, authenticated;

-- 6. Only regions/branches readable by anon
REVOKE ALL ON public.profiles, public.user_roles FROM anon;

-- 3 + 4. Tighter management rules
CREATE OR REPLACE FUNCTION public.can_manage_user(_actor uuid, _target uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT _actor IS NOT NULL AND _target IS NOT NULL AND _actor <> _target
    AND EXISTS (SELECT 1 FROM public.profiles WHERE id = _actor AND status = 'active')
    AND (
      (
        public.has_role(_actor, 'branch_manager')
        AND public.get_user_branch(_actor) IS NOT NULL
        AND public.get_user_branch(_target) = public.get_user_branch(_actor)
        AND NOT public.has_role(_target, 'branch_manager')
        AND NOT public.has_role(_target, 'regional_director')
      )
      OR
      (
        public.has_role(_actor, 'regional_director')
        AND NOT public.has_role(_target, 'regional_director')
        AND EXISTS (
          SELECT 1 FROM public.profiles p
          JOIN public.branches b ON b.id = p.branch_id
          WHERE p.id = _target
            AND b.region_id = (SELECT region_id FROM public.user_roles
                               WHERE user_id = _actor AND role = 'regional_director' LIMIT 1)
        )
      )
    )
$$;

-- 5. Function execution
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_user_branch(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_user_region(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_manage_user(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_user_status(uuid, public.profile_status) TO authenticated;
-- Trigger-only functions stay non-callable by app users
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.rls_auto_enable() FROM authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon;
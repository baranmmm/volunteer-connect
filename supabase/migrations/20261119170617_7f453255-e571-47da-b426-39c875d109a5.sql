REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM public, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM public, anon;
REVOKE EXECUTE ON FUNCTION public.get_user_branch(uuid) FROM public, anon;
REVOKE EXECUTE ON FUNCTION public.get_user_region(uuid) FROM public, anon;
REVOKE EXECUTE ON FUNCTION public.can_manage_user(uuid, uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_user_branch(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_user_region(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_manage_user(uuid, uuid) TO authenticated;
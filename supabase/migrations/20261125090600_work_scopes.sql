-- Where the caller may create tasks and meetings (the scope picker in the forms): National Coordinators national; a
-- Regional Director their region and its branches; a Branch Manager or a volunteer their branch (a volunteer's task is
-- a self-task). The create RPCs check the same rules again.
CREATE FUNCTION public.list_my_work_scopes() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(jsonb_agg(s ORDER BY s->>'sort', s->>'label'), '[]'::jsonb) FROM (
    SELECT jsonb_build_object('scope', 'national', 'branch_id', NULL, 'region_id', NULL, 'label', NULL, 'sort', '0') AS s
    WHERE public.is_nc()
    UNION ALL
    SELECT jsonb_build_object('scope', 'region', 'branch_id', NULL, 'region_id', r.id, 'label', r.name, 'sort', '1')
    FROM public.user_roles ur JOIN public.regions r ON r.id = ur.region_id AND r.deleted_at IS NULL
    WHERE ur.user_id = auth.uid() AND ur.role = 'regional_director'
    UNION ALL
    SELECT jsonb_build_object('scope', 'branch', 'branch_id', b.id, 'region_id', b.region_id, 'label', b.name, 'sort', '2')
    FROM public.branches b JOIN public.regions r ON r.id = b.region_id AND r.deleted_at IS NULL
    WHERE b.deleted_at IS NULL AND (
      EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.role = 'regional_director' AND ur.region_id = b.region_id)
      OR public.is_branch_member(auth.uid(), b.id))
  ) x
  WHERE public.is_active_person(auth.uid()) AND public.session_ok() AND public.has_accepted_privacy_notice()
$$;
REVOKE ALL ON FUNCTION public.list_my_work_scopes() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_my_work_scopes() TO authenticated;

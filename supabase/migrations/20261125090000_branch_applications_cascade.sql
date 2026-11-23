-- Follow-up to the Roles module: what happens to personal rows when a branch is permanently deleted.
-- The only hard delete of branches and regions is purge_structure_item (Recycle Bin "Delete permanently" by a
-- National Coordinator, and purge_expired_structure from the nightly cleanup).
-- * Volunteer applications are personal data with no value without their branch: they go with it (CASCADE), and they
--   no longer keep a deleted branch archived.
-- * Followed branches already cascade (user_followed_branches_branch_id_fkey).

ALTER TABLE public.volunteer_applications DROP CONSTRAINT volunteer_applications_branch_id_fkey;
ALTER TABLE public.volunteer_applications ADD CONSTRAINT volunteer_applications_branch_id_fkey
  FOREIGN KEY (branch_id) REFERENCES public.branches(id) ON DELETE CASCADE;

-- Still referenced by events, users or requests: then it cannot be removed and stays archived.
CREATE OR REPLACE FUNCTION public.structure_in_use(_type text, _id uuid) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF _type = 'branch' THEN
    RETURN EXISTS (SELECT 1 FROM public.profiles WHERE branch_id = _id) OR EXISTS (SELECT 1 FROM public.events WHERE branch_id = _id)
      OR EXISTS (SELECT 1 FROM public.event_series WHERE branch_id = _id) OR EXISTS (SELECT 1 FROM public.event_requests WHERE branch_id = _id);
  END IF;
  RETURN EXISTS (SELECT 1 FROM public.branches b WHERE b.region_id = _id AND (b.deleted_at IS NULL OR NOT b.deleted_with_region OR public.structure_in_use('branch', b.id)))
    OR EXISTS (SELECT 1 FROM public.events WHERE region_id = _id) OR EXISTS (SELECT 1 FROM public.event_series WHERE region_id = _id)
    OR EXISTS (SELECT 1 FROM public.event_requests WHERE region_id = _id) OR EXISTS (SELECT 1 FROM public.user_roles WHERE region_id = _id);
END $$;
REVOKE ALL ON FUNCTION public.structure_in_use(text, uuid) FROM PUBLIC, anon, authenticated;

-- branches.deleted_by / regions.deleted_by (Recycle Bin) without a foreign key to profiles.
-- With the key, profiles and branches had two relationships (profiles.branch_id and branches.deleted_by), so the
-- app's embedded reads like profiles?select=*,branches(name,regions(name)) became ambiguous for PostgREST and failed.
-- deleted_by only records who deleted the item; the Recycle Bin shows it through a LEFT JOIN, so a dangling id after
-- a user is purged shows no name, which is what a deleted user should show anyway.
ALTER TABLE public.branches DROP CONSTRAINT branches_deleted_by_fkey;
ALTER TABLE public.regions DROP CONSTRAINT regions_deleted_by_fkey;

-- user_followed_branches.user_id references auth.users (ON DELETE CASCADE) instead of profiles. With both keys in
-- public, PostgREST saw the table as a many-to-many link between profiles and branches, which made the app's
-- profiles?select=*,branches(...) embed ambiguous. Rows still go when the account is erased (auth.users → cascade).
ALTER TABLE public.user_followed_branches DROP CONSTRAINT user_followed_branches_user_id_fkey;
ALTER TABLE public.user_followed_branches ADD CONSTRAINT user_followed_branches_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
NOTIFY pgrst, 'reload schema';

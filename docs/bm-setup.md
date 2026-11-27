# Setting up the first Branch Manager of a branch

A branch with no Branch Manager and a region with no Regional Director cannot approve anyone in the app: volunteer
applications are reviewed only by the branch's BM or the region's RD, and an NC can make someone a BM only once they
have a branch. Until the app can do this (planned: "Assign Branch Manager" for NCs on the Users page), the first BM
of such a branch is set up with SQL, once, by someone with database access. Like `docs/nc-setup.md`: the Supabase SQL
editor of the right project, as the `postgres` role; never in an e2e or CI script.

It approves the person's open volunteer application **straight to Branch Manager** of that branch, with exactly the
changes the app's approval makes (`approve_volunteer_application`): the follower role is replaced by
`branch_manager`, the branch is set and followed, the application is marked approved, and the two audit rows
(`role_change` follower → branch_manager, `branch_change`) are written. The recorded reviewer (`reviewer_id`,
`actor_id`) is the single active National Coordinator. No notice is sent (the person knows).

## 1. The person signs up and applies

They join at `/join`, choose the branch, apply as a volunteer and **confirm their email** (the link in the sign-up
email). They are then a follower with one open application to that branch.

## 2. Dry run

In the SQL editor, paste the block below, put their email and the branch's exact name at the top, keep
`_dry_run := true` and run it. It checks everything and changes nothing:
- exactly one branch with that name (not deleted);
- exactly one account with that email: confirmed, active, not deleted, still a follower;
- exactly one open volunteer application of that person to that branch;
- the branch has **no** active Branch Manager (if it has one, that BM approves in the app instead);
- exactly one active National Coordinator (the recorded reviewer).

Expected result: an error that starts with `DRY RUN OK (nothing changed): … would become Branch Manager of …`. Any
other error names the check that failed; nothing was changed.

```sql
DO $$
DECLARE
  _email   text    := 'new.manager@example.org';  -- the new Branch Manager's sign-in email
  _branch  text    := 'Medway';                    -- the branch they applied to (its exact name)
  _dry_run boolean := true;                        -- true: check only, nothing is changed; then false to apply
  _branch_id uuid; _user uuid; _app uuid; _nc uuid; _n integer;
BEGIN
  -- 1. Exactly one branch with this name, not deleted.
  SELECT count(*), min(id::text)::uuid INTO _n, _branch_id FROM public.branches
  WHERE lower(name) = lower(btrim(_branch)) AND deleted_at IS NULL;
  IF _n <> 1 THEN RAISE EXCEPTION 'Branch "%": % matching branches (need exactly 1)', _branch, _n; END IF;

  -- 2. Exactly one account with this email; confirmed, active, not deleted, still a follower (no member role).
  SELECT count(*), min(id::text)::uuid INTO _n, _user FROM auth.users WHERE lower(email) = lower(btrim(_email));
  IF _n <> 1 THEN RAISE EXCEPTION 'Email %: % matching accounts (need exactly 1)', _email, _n; END IF;
  IF (SELECT email_confirmed_at FROM auth.users WHERE id = _user) IS NULL THEN
    RAISE EXCEPTION 'Email % is not confirmed yet: confirm it from the sign-up email first', _email;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = _user AND status = 'active' AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'The account of % is not active (or is deleted)', _email;
  END IF;
  IF NOT public.is_follower(_user) THEN
    RAISE EXCEPTION 'The account of % already has a member role: nothing to bootstrap', _email;
  END IF;

  -- 3. Exactly one open volunteer application of this person to this branch.
  SELECT count(*), min(id::text)::uuid INTO _n, _app FROM public.volunteer_applications
  WHERE user_id = _user AND branch_id = _branch_id AND status = 'submitted' AND deleted_at IS NULL;
  IF _n <> 1 THEN RAISE EXCEPTION 'Open volunteer applications of % to %: % (need exactly 1)', _email, _branch, _n; END IF;

  -- 4. No conflict: the branch has no active Branch Manager (one who exists approves in the app instead).
  IF EXISTS (SELECT 1 FROM public.user_roles r JOIN public.profiles p ON p.id = r.user_id
             WHERE r.role = 'branch_manager' AND p.branch_id = _branch_id AND p.status = 'active' AND p.deleted_at IS NULL) THEN
    RAISE EXCEPTION 'Branch % already has an active Branch Manager: approve the application in the app instead', _branch;
  END IF;

  -- 5. The reviewer recorded in the audit and on the application: the single active National Coordinator.
  SELECT count(*), min(r.user_id::text)::uuid INTO _n, _nc FROM public.user_roles r JOIN public.profiles p ON p.id = r.user_id
  WHERE r.role = 'national_coordinator' AND p.status = 'active' AND p.deleted_at IS NULL;
  IF _n <> 1 THEN RAISE EXCEPTION 'Active National Coordinators: % (need exactly 1 as the recorded reviewer)', _n; END IF;

  -- 6. The same changes as approve_volunteer_application (20261210090100), with the role Branch Manager.
  DELETE FROM public.user_roles WHERE user_id = _user AND role = 'follower';
  INSERT INTO public.user_roles (user_id, role) VALUES (_user, 'branch_manager');
  UPDATE public.profiles SET branch_id = _branch_id WHERE id = _user;
  INSERT INTO public.user_followed_branches (user_id, branch_id) VALUES (_user, _branch_id) ON CONFLICT DO NOTHING;
  UPDATE public.volunteer_applications SET status = 'approved', reviewer_id = _nc, reviewed_at = now() WHERE id = _app;
  INSERT INTO public.user_audit_log (actor_id, target_id, action, old_value, new_value) VALUES
    (_nc, _user, 'role_change', 'follower', 'branch_manager'),
    (_nc, _user, 'branch_change', NULL, _branch_id::text);

  IF _dry_run THEN
    RAISE EXCEPTION 'DRY RUN OK (nothing changed): % would become Branch Manager of % (application %). Set _dry_run := false to apply.',
      _email, _branch, _app;
  END IF;
  RAISE NOTICE 'Done: % is now Branch Manager of % (application %)', _email, _branch, _app;
END $$;
```

## 3. Apply

Run the same block with `_dry_run := false`. Expected: the NOTICE `Done: … is now Branch Manager of … (application …)`
(the SQL editor may show only "Success. No rows returned"). The block is one statement: it changes everything or
nothing. Running it a second time is refused ("already has a member role").

## 4. Verify

```sql
SELECT u.email, p.status, b.name AS branch,
  (SELECT string_agg(r.role::text, ', ') FROM public.user_roles r WHERE r.user_id = u.id) AS roles,
  (SELECT a.status FROM public.volunteer_applications a WHERE a.user_id = u.id ORDER BY a.created_at DESC LIMIT 1) AS application,
  (SELECT string_agg(l.action || ': ' || coalesce(l.old_value, '-') || ' → ' || coalesce(l.new_value, '-'), '; ' ORDER BY l.created_at)
     FROM public.user_audit_log l WHERE l.target_id = u.id) AS audit,
  EXISTS (SELECT 1 FROM public.user_followed_branches f WHERE f.user_id = u.id AND f.branch_id = p.branch_id) AS follows_branch
FROM auth.users u JOIN public.profiles p ON p.id = u.id LEFT JOIN public.branches b ON b.id = p.branch_id
WHERE lower(u.email) = lower('new.manager@example.org');
```

Expected: `status` active, `branch` the branch, `roles` `branch_manager`, `application` approved, `audit`
`role_change: follower → branch_manager; branch_change: - → <branch id>`, `follows_branch` true.

The new Branch Manager reloads the app (or signs out and in) to get the manager menus. From then on the branch's
volunteer applications are approved in the app as usual.

Tested on a local stack (rolled back): the dry run, the apply, the verification, the refused second run, a branch
that already has a Branch Manager, and an email without an open application to the branch.

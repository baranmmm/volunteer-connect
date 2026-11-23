# Setting up a National Coordinator

National Coordinators (NCs) are never assigned in the app. The first NC, and any later one, is assigned with SQL by
someone with database access. Run it in the Supabase SQL editor of the right project, as the `postgres` role. Never
run it in an e2e or CI script.

## 1. The person creates an account

They sign up in the Hub like everyone else, confirm their email, and become a follower.

## 2. Assign the role with SQL

Replace the example address with theirs. The block checks that exactly one account matches before changing anything.

```sql
BEGIN;
DO $$
DECLARE _id uuid;
BEGIN
  SELECT id INTO STRICT _id FROM auth.users WHERE lower(email) = lower('coordinator@example.org');
  -- National Coordinator only: no member or follower role, no branch, active.
  DELETE FROM public.user_roles WHERE user_id = _id AND role IN ('follower', 'volunteer', 'branch_manager', 'regional_director');
  INSERT INTO public.user_roles (user_id, role) VALUES (_id, 'national_coordinator') ON CONFLICT (user_id, role) DO NOTHING;
  UPDATE public.profiles SET status = 'active', branch_id = NULL WHERE id = _id;
END $$;
COMMIT;
```

## 3. First sign-in: the authenticator

On their next sign-in the Hub shows only the two-factor screen:
1. Scan the QR code with an authenticator app (Google Authenticator, Microsoft Authenticator, 1Password and so on).
2. Enter the 6-digit code.

From then on every sign-in asks for a code. The database refuses NC actions from sessions without it.

## Replacing or removing an NC

The last active NC cannot lose the role, be deactivated or be deleted. Database triggers enforce this, for SQL as
well. Assign the new NC first (step 2), then remove the old one:

```sql
DELETE FROM public.user_roles
WHERE role = 'national_coordinator' AND user_id = (SELECT id FROM auth.users WHERE lower(email) = lower('old.coordinator@example.org'));
```

## Lost authenticator

With database access, remove the NC's factors in the Supabase dashboard (Authentication → Users → the user → MFA
factors), or with the admin API. The next sign-in then shows the set-up screen again.

## QA test account

e2e seeds `nc@dsvolunteer.test` on QA. To give it an authenticator, run `cd e2e && npm run qa:nc-mfa` once, while CI is
idle. The script stores the secret as `E2E_NC_TOTP_SECRET` in `e2e/.env.qa` and never prints it. Copy the same value
into the GitHub `qa` environment secret `E2E_NC_TOTP_SECRET`.

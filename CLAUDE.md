@AGENTS.md

# Dialogue Society Volunteer Hub

Bilingual (EN/TR) volunteer hub for Dialogue Society branches, packaged as a PWA/native app.
TanStack Start + React 19 + Supabase, client-side SPA only (every route `ssr: false`).

## Working agreement
Claude Code makes frontend (`src/`) and database (`supabase/migrations/`) changes. Lovable is used only for new
screens and design, and still syncs two-way on `main`.
- Every task gets its own branch from `main`. Pull `main` before starting. Never commit or push to `main` directly:
  changes go through a PR and the user merges it.
- **No parallel work with Lovable.** When the user says a Lovable task is running, do not touch `src/` or
  `supabase/` until they say it has finished.
- Never rewrite pushed history (Lovable mirrors it), and keep `main` buildable.

### Risk levels
**Low risk**: UI and test work that does not touch migrations, RLS, grants, auth or the deletion/GDPR flow.
1. Run `npx tsc --noEmit` at the repo root, and inside `e2e/` when it changed.
2. Run ESLint on the changed files only: `npx eslint <changed files>`. The rest of `src/` has known formatting issues.
3. Run only the Playwright specs related to the change, against QA (`cd e2e && npx playwright test <specs>`).
   Do not run the full suite locally; CI runs it.
4. Push and open the PR without asking. The description has a short summary and the test results.
5. Report back only the PR link.

**High risk**: migrations, RLS, grants, SECURITY DEFINER functions, auth, and deletion/GDPR.
1. Do a rolled-back dry run on QA and write a migration summary.
2. Run the checks from the low-risk steps 1-3.
3. Show the summary and wait for approval before pushing.

### Always ask first
- Pushing to `main`, force pushing, `git reset --hard`, rebase.
- Deleting any file, migration files included.
- Any connection to the production database, and any `supabase db push`. Production migrations go only through
  the `PROD DB migrate` workflow (`.github/workflows/prod-db-migrate.yml`), with the user's approval.
- Reading, showing or changing `.env`, `e2e/.env.qa` or any other key or secret file.

## Roles
- `regional_director`: manages every branch in their region (region on `user_roles.region_id`). Only role
  that can change roles or move users between branches. Cannot be deleted in-app.
- `branch_manager`: manages volunteers in their own branch (approve/reject, activate/deactivate, delete).
- `volunteer`: own profile only. New sign-ups are `pending` volunteers until a manager approves them.

## Security rules
- RLS is enabled on every table. RLS and grants are the real enforcement; UI checks are convenience only.
- No direct client writes except the column-granted own-row fields `profiles.full_name`, `phone`, `preferred_language`.
- Every other change goes through SECURITY DEFINER RPCs: `set_user_status`, `set_user_role`, `set_user_branch`,
  `request_account_deletion`, `cancel_account_deletion`. History is read through `get_user_audit_history`.
- User deletion only through the `deleteUser` server function (`src/lib/delete-user.functions.ts`).
- The service_role key lives only in server code, e2e seed/teardown/API tests and GitHub secrets. Never in
  browser code and never in a `VITE_*` variable.

## Database migrations (`supabase/migrations/`)
- Every change is a **new** file with a new timestamp (`YYYYMMDDHHMMSS_description.sql`). Never edit, rename or
  delete an existing migration, even an unreleased one.
- RLS stays enabled on every table, new tables included.
- Never grant `INSERT`, `UPDATE`, `DELETE` or `TRUNCATE` to `anon`.
- `SECURITY DEFINER` functions pin the search path (`SET search_path = ''` or `public`, with schema-qualified
  names), `REVOKE EXECUTE ... FROM PUBLIC, anon`, and `GRANT EXECUTE ... TO authenticated` only.
- QA gets migrations from `E2E (QA)`, which migrates before every test run on every branch (feature-branch
  migrations included), from the nightly `QA DB migrate`, or from `npm run qa:migrate` in `e2e/` (applies without a
  prompt). Production only through `PROD DB migrate`, dry-run first (see `e2e/README.md`).

## i18n
No hardcoded user-facing strings. Every string is a key in both `src/locales/en.json` and `src/locales/tr.json`.
DB error messages map to keys through `ERROR_KEYS` in `src/lib/i18n.ts`.

## data-testid convention
kebab-case `page-element[-qualifier]` (e.g. `users-row-status-badge`, `user-details-delete-button`).
Never derived from visible or translated text. Lists expose record ids as `data-user-id` / `data-request-id`.
Toasts go through `src/lib/toast.ts` so they carry `toast-success` / `toast-error`.
The same rules apply to UI built by Claude Code and by Lovable.

## E2E tests (`e2e/`)
Separate npm package with Playwright + TypeScript page objects; see `e2e/README.md`.
- Runs only against the QA Supabase project `impdbvwsaancutwlrmac`; a guard aborts if the production ref
  `kcxmjscxooqqhsgrhknb` appears anywhere in the environment.
- Locators: `getByTestId` first, then `getByRole`. Never text locators (the UI is bilingual).
- First QA setup order: `npm run qa:migrate` → `npm run qa:seed` → `npm test` (run inside `e2e/`).

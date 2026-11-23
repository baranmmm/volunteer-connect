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
Every module is one PR. Never run the full Playwright suite locally: CI runs it (nightly, and with the `full-ci` label).
Local tests run on the local Supabase stack (Docker, `cd e2e && npm run local:up`), not on the remote QA project.

**Low risk**: UI and test work that does not touch migrations, RLS, grants, auth or the deletion/GDPR flow.
1. Run `npx tsc --noEmit` at the repo root, and inside `e2e/` when it changed.
2. Run ESLint on the changed files only: `npx eslint <changed files>`. The rest of `src/` has known formatting issues.
3. Run Vitest (`npx vitest run`).
4. Run only the Playwright specs related to the change on the local stack
   (`cd e2e && npm run local:test -- --grep "$(npm run -s related -- --grep-only)"`, or name the specs).
5. Push and open the PR without asking or waiting for approval. The description has a short summary and the test
   results.
6. Report back only the PR link.

**High risk**: migrations, RLS, grants, SECURITY DEFINER functions, auth, and deletion/GDPR.
1. Do a rolled-back dry run on the local stack (`npm run local:dryrun -- ../supabase/migrations/<file>.sql`), then
   apply it locally (`npm run local:migrate`) and run the related specs there.
2. Run the checks from the low-risk steps 1-4.
3. If the dry run is clean and nothing deviates from the spec, push and open the PR without waiting for approval.
   Put the migration summary in the PR description, with the line "Merge sonrası prod migration gerekli: <file>".
   Stop and ask only for a deviation from the spec, a security or authorization decision the spec does not cover,
   a need to touch an existing migration, or a test that is still red after two attempts.

### CI (`.github/workflows/`)
- `checks.yml` on every PR and push to main: tsc (app and e2e), ESLint on changed files, Vitest.
- `e2e-pr.yml` (E2E (local)) on every PR, in three shards: each shard starts its own local Supabase stack
  (`npm run local:up`: every migration, seed, local TOTP for the NC) and never touches QA. PRs run `@smoke` plus the
  specs related to the changed files (`e2e/scripts/select-specs.mjs`; a changed migration runs every spec of its
  area, test-infrastructure changes run everything). The `full-ci` label runs the full suite.
- `e2e.yml` (E2E (QA)) on the shared QA project: push to main runs `@smoke`, the full suite runs nightly at 02:00 UTC
  on main after migrating QA, and `workflow_dispatch` runs a chosen suite. Its runs wait in the workflow-level
  `qa-db` queue and are never cancelled while running.
- A new push to a PR cancels that PR's earlier E2E (local) runs (`cancel-superseded.yml`).
- Applying migrations to remote QA by hand (`npm run qa:migrate`, `npm run qa:dryrun`) only while CI is idle:
  check that `gh run list` shows no run in progress, and set `E2E_RUN_ID` for local runs and teardown.

### Always ask first
- Pushing to `main`, force pushing, `git reset --hard`, rebase.
- Deleting any file, migration files included.
- Any connection to the production database, and any `supabase db push`. Production migrations go only through
  the `PROD DB migrate` workflow (`.github/workflows/prod-db-migrate.yml`), with the user's approval.
- Reading, showing or changing `.env`, `e2e/.env.qa` or any other key or secret file.

## Roles
Ranking: follower < volunteer < branch_manager < regional_director < national_coordinator. Full matrix: `docs/roles.md`.
- `follower`: everyone who signs up (active at once, no branch, follows at least one branch). Sees only public
  published events (and cancelled ones they registered for), their own registrations, applications and profile.
  Applies to volunteer (`volunteer_applications`); approval by the branch's BM or the region's RD makes them a volunteer.
- `volunteer`: own profile; members events of their branch/region and national ones.
- `branch_manager`: manages volunteers in their own branch (approve/reject, activate/deactivate, delete).
- `regional_director`: manages every branch in their region (region on `user_roles.region_id`); volunteer ↔ BM roles
  and branch moves within the region. Cannot be deleted in-app.
- `national_coordinator`: assigned only with SQL (`docs/nc-setup.md`), never in the app; every NC right requires an
  aal2 (MFA) session (`is_nc()`, `session_ok()`, `requireMember`). Manages RDs/BMs, regions/branches and national
  events; sees volunteers and followers only as numbers. The last active NC is protected by triggers.

## Security rules
- RLS is enabled on every table. RLS and grants are the real enforcement; UI checks are convenience only.
- `anon` reads no table data except branch and region names (sign-up and filters). Public events reach signed-out
  visitors only through `get_public_events`, `get_public_event` and `get_public_event_image` (the one deliberate
  exception to "SECURITY DEFINER → authenticated only"); they return public fields only, never online links or people.
- No direct client writes except the column-granted own-row fields `profiles.full_name`, `phone`, `preferred_language`.
- Every other change goes through SECURITY DEFINER RPCs: `set_user_status`, `set_user_role`, `set_user_branch`,
  `request_account_deletion`, `cancel_account_deletion`, the volunteer application, followed branch and structure
  RPCs. Every client write RPC starts with `PERFORM public.require_privacy_accepted();` (Vitest guard in
  `src/test/privacy-db.test.ts`). History is read through `get_user_audit_history`.
- User deletion only through the `deleteUser` server function (`src/lib/delete-user.functions.ts`); followers delete
  their own account with `deleteMyFollowerAccount` (typed full name, non-restorable).
- The service_role key lives only in server code, e2e seed/teardown/API tests and GitHub secrets. Never in
  browser code and never in a `VITE_*` variable.

## Database migrations (`supabase/migrations/`)
- Every change is a **new** file with a new timestamp (`YYYYMMDDHHMMSS_description.sql`). Never edit, rename or
  delete an existing migration, even an unreleased one.
- RLS stays enabled on every table, new tables included.
- Never grant `INSERT`, `UPDATE`, `DELETE` or `TRUNCATE` to `anon`.
- `SECURITY DEFINER` functions pin the search path (`SET search_path = ''` or `public`, with schema-qualified
  names), `REVOKE EXECUTE ... FROM PUBLIC, anon`, and `GRANT EXECUTE ... TO authenticated` only.
- QA gets migrations from `E2E (QA)`, which migrates before every run on main (push and nightly), from
  `QA DB migrate` (manual), or from `npm run qa:migrate` in `e2e/` (applies without a prompt; only while CI is idle).
  PR runs apply every migration to their own local stack only. Production only through `PROD DB migrate`, dry-run first (see `e2e/README.md`).

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
- Runs against the local stack (`E2E_TARGET=local`, localhost only) or the QA Supabase project
  `impdbvwsaancutwlrmac` (CI); a guard aborts if the production ref `kcxmjscxooqqhsgrhknb` appears anywhere in the
  environment.
- `@smoke` (about 15 tests) covers the critical flows; tag a test with `{ tag: "@smoke" }` only when it guards one.
- Passwords are masked in traces, error-context, reports and CI artifacts (`e2e/setup/redact-reporter.ts`,
  `e2e/setup/redact.ts`). Type passwords only into fields whose test id contains `password`.
- Locators: `getByTestId` first, then `getByRole`. Never text locators (the UI is bilingual).
- First QA setup order: `npm run qa:migrate` → `npm run qa:seed` → `npm test` (run inside `e2e/`).

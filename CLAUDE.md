@AGENTS.md

# Dialogue Society Volunteer Hub

Bilingual (EN/TR) volunteer hub for Dialogue Society branches, packaged as a PWA/native app.
Published app: **https://ds-volunteer.lovable.app** (Lovable). Pre-launch status and settings: `docs/prelaunch.md`.
TanStack Start + React 19 + Supabase. Public signed-out routes server-render for performance and link previews ("/",
"/events", "/events/$id", "/sign-in", "/join", "/privacy/attendees"); everything signed-in stays client-only
(`ssr: false`). Approved exception: the server never knows the session (localStorage), so server-rendered pages show
the signed-out view, `<html data-session>` hides it for members until their client view, and pages with signed image
links send `Cache-Control: private, no-store`.

## Working agreement
Claude Code makes frontend (`src/`) and database (`supabase/migrations/`) changes. Lovable is used only for new
screens and design, and still syncs two-way on `main`.
- Every task gets its own branch from `main`. Pull `main` before starting. Never commit or push to `main` directly:
  changes go through a PR, merged with `gh pr merge` under the merge rule below.
- **No parallel work with Lovable.** When the user says a Lovable task is running, do not touch `src/` or
  `supabase/` until they say it has finished.
- Never rewrite pushed history (Lovable mirrors it), and keep `main` buildable.
- Before every push to a PR branch, check the PR is still open (`gh pr view <n> --json state`); if it was merged,
  open a new PR.

### Local checks (every PR)
Local tests run on the local Supabase stack (Docker, `cd e2e && npm run local:up`), never on the remote QA project.
Never run the full Playwright suite locally.
**One session at a time on the local stack.** Every worktree and session shares one Docker stack (project
`dsvh-e2e-local`, fixed ports), so a reset or seed in one session breaks another's running tests. Only one session
runs local e2e (`local:test`, `local:reset/up/down/migrate/seed/dryrun`) at a time: each of these takes a machine-wide
lock (`e2e/setup/local-lock.ts`, `~/.cache/dsvh-e2e/local-stack.lock`) and refuses to start while another live
process holds it. Wait for the other session; never delete the lock file or set `E2E_LOCAL_LOCK=off` to get around
it (that is for CI runners, which have a stack each). Subagents of one session run their e2e one after another.
**Only the main session changes the local stack's schema.** It applies migrations (`local:migrate`, `local:dryrun`,
`supabase db push`, any SQL that changes schema or the migration history) one at a time and in timestamp order.
Subagents never run migration commands against the shared stack: they write and commit the migration files and ask
the main session to apply them; `local:test` stays allowed for them.
1. `npx tsc --noEmit` at the repo root, and inside `e2e/` when it changed.
2. ESLint on the changed files only: `npx eslint <changed files>` (the rest of `src/` has known formatting issues).
3. Vitest: `npx vitest run`.
4. Playwright `@smoke` plus the specs related to the change, on the local stack:
   `cd e2e && npm run local:test -- --grep "$(npm run -s related -- --grep-only)"` (the related set always includes
   `@smoke`).
5. Every new migration: a local dry run first: `npm run local:reset` (every migration from scratch on the local
   stack), plus `npm run local:dryrun -- ../supabase/migrations/<file>.sql` for the rolled-back preview, then the
   related tests on that stack.
Put the local results (commands and pass/fail counts) in the PR description.

### Merge rule
- **Non-critical change:** when every local check passes, merge to `main` yourself (`gh pr merge --merge`, never
  squash or rebase: Lovable mirrors history) without asking. Report the PR link and the result.
- **Critical change:** run the same local checks, then stop and ask the user before merging. Critical means any of:
  auth or sign-in; RLS policies or grants; deleting or rewriting existing production data; secrets or env handling;
  email sending limits; anything that cannot be rolled back.
- **Any local check fails:** do not merge. Fix it, or report back (a test still red after two attempts: report).
- Still stop and ask for a deviation from the spec, a security or authorization decision the spec does not cover, or
  a need to touch an existing migration.

### Migrations and production
- **Until the pre-launch prod reset has been applied** (`docs/prelaunch.md`): any PR that adds a table holding user
  data, or columns/rows the reset must handle, updates `scripts/prelaunch/report.sql` and
  `scripts/prelaunch/reset.sql` in the same PR (delete counts, delete order, keep rules), with
  `src/test/prelaunch-reset-db.test.ts` seeding the new data and green. The reset aborts if any public table it does
  not know holds rows, so a missed table blocks reset day. Remove this rule once the reset is applied.
- Production migrations run only through the `PROD DB migrate` workflow (`.github/workflows/prod-db-migrate.yml`,
  `main` only): a `dry-run` first, then `apply` with `confirm: APPLY PROD`. Never `supabase db push` or a direct
  connection to production from this machine.
- **Migrations first, code second**, so production never runs code without its schema: the PR's new migration files
  go to `main` first as their own small PR (migrations only, so `main` stays buildable), `PROD DB migrate` applies
  them, and only then the code PR is merged.
- **Additive, non-critical migrations** (new tables, new columns, new or changed functions with no data loss): when
  the local dry run and tests pass, do this as part of the merge without asking.
- **Destructive or data-changing migrations** (dropping or rewriting data, changing what existing rows mean) and
  migrations of a critical change: dry run locally, then ask the user before applying to production.
- After applying, check the workflow's "Migration list (after)" (local and remote columns match for every file) and
  report it in the PR.

### CI (`.github/workflows/`)
GitHub Actions has the free 2,000 minutes a month and a $0 budget (usage stops at the limit): nothing heavy runs
automatically.
- `checks.yml` on pull requests only (about 2–3 minutes): tsc (app and e2e), ESLint on changed files, Vitest.
- `e2e-pr.yml` (E2E (local)) and `e2e.yml` (E2E): **manual only** (`workflow_dispatch`). E2E (local) runs `related`
  (`@smoke` + the specs related to the branch's changes, `e2e/scripts/select-specs.mjs`) or `full` on the chosen
  branch; E2E runs a chosen suite on `local` (default) or `qa` (migrates QA first).
- `e2e-local.yml` (reusable): each of three shards starts its own local Supabase stack, then one merged report.
- Scheduled jobs run on production pg_cron, not GitHub: `outbox-flush` (every minute, sends emails and pushes),
  `notification-digest`, `task-reminders`, `event-reminders`, `recycle-bin-cleanup` (03:30 UTC), `purge-guest-data`,
  `extend-event-series`. Jobs that need the app POST to `/api/public/...` through pg_net with the Vault secrets
  `app_url` and `scheduled_jobs_secret` (the same value as `SCHEDULED_JOBS_SECRET`). Do not change their schedules
  without asking.
- `task-reminders.yml` and `cleanup-deleted-events.yml` are **manual-only fallbacks** (`workflow_dispatch`). They call
  the published app at the GitHub repository **variable** `APP_URL` (`https://ds-volunteer.lovable.app`) and fail with
  a clear message when it is empty; never hardcode the app URL in a workflow.
- `cancel-superseded.yml` is switched off (manual trigger only) and can be deleted.
- QA runs on a small instance with a limited disk IO budget: add nothing that runs on QA regularly.
- Branch protection / required checks are not available on this private repository's plan, so nothing blocks
  `gh pr merge`; check the PR's checks yourself before merging.
- When CI is red, read the log first and tell the user the cause before changing anything; when the cause is
  infrastructure (QA, runner, network), do not re-run the same code.
- Applying migrations to remote QA by hand (`npm run qa:migrate`, `npm run qa:dryrun`) only while CI is idle:
  check that `gh run list` shows no run in progress, and set `E2E_RUN_ID` for local runs and teardown.

### Always ask first
- Pushing to `main` directly, force pushing, `git reset --hard`, rebase. (Merging a PR under the merge rule is
  allowed.)
- Deleting any file, migration files included.
- Any production migration outside the merge rule above (destructive or critical ones), and any connection to the
  production database other than the `PROD DB migrate` workflow.
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
- MFA/2FA is only required for national_coordinator. It is never required or added for follower, volunteer,
  branch_manager or regional_director. Ask the user before changing this.
- Tasks and meetings: `docs/tasks.md`, `docs/meetings.md`. Media tab: `docs/media.md`. Followers get nothing; NCs only national items and
  RD/BM/NC people (never volunteer names).

## Security rules
- RLS is enabled on every table. RLS and grants are the real enforcement; UI checks are convenience only.
- `anon` reads no table data except branch and region names (sign-up and filters). Public events reach signed-out
  visitors only through `get_public_events`, `get_public_event` and `get_public_event_image` (the one deliberate
  exception to "SECURITY DEFINER → authenticated only"); they return public fields only, never online links or people.
  The link-preview route `/api/public/event-image/<id>` serves a cover (bytes, never the path) only after
  `get_public_event_image` confirms the event is public.
- No direct client writes except the column-granted own-row fields `profiles.full_name`, `phone`, `preferred_language`.
- Every other change goes through SECURITY DEFINER RPCs: `set_user_status`, `set_user_role`, `set_user_branch`,
  `request_account_deletion`, `cancel_account_deletion`, the volunteer application, followed branch and structure
  RPCs. Every client write RPC starts with `PERFORM public.require_privacy_accepted();` (Vitest guard in
  `src/test/privacy-db.test.ts`). History is read through `get_user_audit_history`.
- Guests (no account) and event-update subscribers: only through server functions using service-role-only RPCs
  (`guest_*`, `subscriber_*`), never anon grants. Their emails go through `email_outbox` and the Brevo sender
  (`docs/email.md`); attendee privacy notice: `src/content/attendee-privacy-notice.md`.
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
- QA gets migrations from `E2E`, which migrates QA before its manual `qa` runs, from
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

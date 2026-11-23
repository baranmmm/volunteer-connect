# E2E tests (Playwright + TypeScript)

Page Object Model tests for the Dialogue Society Volunteer Hub. They run against the **local Supabase stack**
(Docker; everyday work, see _Local stack_) or the QA Supabase project `impdbvwsaancutwlrmac` (ds-volunteer-qa;
CI). Every entry point (Playwright config, app
server, migrate, seed, teardown, API client) calls `setup/guard.ts`, which aborts if the production ref
`kcxmjscxooqqhsgrhknb` appears anywhere in the environment. Requests to production are also blocked
inside the browser.

This folder is a separate npm package: the app's `tsconfig`, Vite build, ESLint and `bun.lock` never see it.

## Setup

```sh
bun install                 # in the repository root (app dependencies, used by the e2e dev server)
cd e2e
npm ci
npx playwright install --with-deps chromium
cp .env.qa.example .env.qa  # then fill in the QA values (git-ignored)
```

`npm run qa:migrate` also needs the [Supabase CLI](https://supabase.com/docs/guides/local-development/cli/getting-started).

## Local stack (Docker) — everyday work

Needs Docker (Docker Desktop or colima) and the Supabase CLI. Nothing is read from `.env.qa`: test users get a
fixed test password (`LOCAL_TEST_PASSWORD` in `setup/env.ts`), and the keys are the local stack's defaults, written
to the git-ignored `e2e/.env.local`.

```sh
npm run local:up        # supabase start (project dir e2e/local), bootstrap + all migrations, seed users
npm run local:test -- tests/ui/registrations.spec.ts          # related specs only
npm run local:test -- --grep "$(npm run -s related -- --grep-only)"   # @smoke + specs related to your changes
npm run local:dryrun -- ../supabase/migrations/<new>.sql      # rolled-back dry run: pg_proc/policy diff, definer checks
npm run local:migrate   # then apply the new migration locally and run its specs
npm run local:reset     # fresh database (all migrations again) + seed
npm run local:down
```

Never run the full suite locally; CI runs it nightly and when a PR has the `full-ci` label.

## First QA setup — order matters

```sh
npm run qa:migrate   # Session pooler (IPv4): rls_auto_enable check/bootstrap, db push dry-run, db push only if pending
npm run qa:seed      # checks the schema first; fails with "Önce migrate çalıştırın" if tables are missing
npm test             # starts the app on BASE_URL against QA, then runs all projects
```

`npm run qa:first-run` chains all three.

## Everyday commands

| Command | What it does |
|---|---|
| `npm run guard` | Checks the environment targets QA only |
| `npm run qa:seed` | Idempotently creates/resets the seeded users and writes `.auth/users.json` |
| `npm test` | All projects: `desktop-chromium`, `mobile-pixel7`, `api` |
| `npm run test:ui` / `npm run test:api` | UI projects only / API permission tests only |
| `npm run qa:teardown` | Deletes this run's `fresh-*@dsvolunteer.test` users (`E2E_RUN_ID`) and any older than 2 hours, plus their test events: events those users created, and `E2E Event …` events whose creator no longer exists. Recent users of other runs (e.g. CI running at the same time on the shared QA database) are never touched. QA only (guarded). |
| `npm run smoke` | `@smoke` tests only (critical flows) |
| `npm run related [-- <base>]` | Which specs the current changes need (`scripts/select-specs.mjs`), and why |
| `npm run qa:dryrun -- <file>` | Rolled-back migration dry run on remote QA (only while CI is idle) |
| `npm run redact -- <dirs>` | Masks passwords in existing artifacts (CI does this before every upload) |
| `npm run report` | Opens the newest HTML report (`npm run report -- <run-id>` for a given run). Locally every run writes to its own `test-results/<run-id>/` and `playwright-report/<run-id>/` (`E2E_RUN_ID`, or a timestamp), so traces of earlier runs are kept; folders older than 7 days are removed when a run starts. CI keeps the flat `test-results/` and `playwright-report/`. |

**Local runs share the QA database with CI.** Give each local run an id so its teardown can clean up after it
without touching a CI run in progress: `E2E_RUN_ID=local-$(date +%s) npm test`, then the same id for `npm run qa:teardown`.

## How it works

- **Seeded users** (`data/users.ts`): regional director (South of England), manager + volunteer + pending in
  Medway and in Brighton, a follower of Medway, a National Coordinator and one disposable user. Tests never modify them.
- **National Coordinators** need MFA: `freshUser({ role: "national_coordinator" })` enrols an authenticator in-process
  (`totpSecret` on the returned user, never stored) and `pageAs` signs it in at aal2. The seeded NC's secret is local
  (`.auth/local/nc-totp.json`, written by the seed) or, on QA, `E2E_NC_TOTP_SECRET` from `npm run qa:nc-mfa` (run once by
  a person; it writes `.env.qa` without printing the value, then copy it to the GitHub `qa` secret).
- **Fresh events**: `freshEvent()` creates events as a fresh manager through the app's RPCs (`create_event`,
  `cancel_event`), titled `E2E Event …`, and deletes them after the test.
  `freshSeries()` does the same for recurring series (`create_series`); `trackSeries()` registers a series created
  through the UI. Both remove every occurrence, split part, series row and media holder after the test.
- **Screenshots** for ad-hoc UI review go to `e2e/screenshots/` (git-ignored).
- **Fresh users**: every test that changes data creates its own user with the `freshUser()` fixture
  (`fresh-<run>-…@dsvolunteer.test`). It is deleted after the test; `qa:teardown` removes leftovers.
- **Auth**: `setup/auth.setup.ts` writes one storageState per role. Only `tests/ui/auth.spec.ts` signs in through the UI.
- **Locators**: `getByTestId` first, then `getByRole`. Never text locators: the UI is bilingual. Seeded data
  (names, emails) may be asserted because it is not translated. Language is asserted through `<html lang>`.
- **App server**: `setup/start-app.ts` runs `vite dev` with the QA values. `SUPABASE_SERVICE_ROLE_KEY` (QA only,
  never `VITE_`-prefixed) is passed to the server for the `deleteUser` server function. `tests/api/bundle-secrets.spec.ts`
  checks it never reaches the browser.

## Production migrations (`PROD DB migrate`)

`.github/workflows/prod-db-migrate.yml` is the only way migrations reach production. Nobody runs `supabase db push`
against production by hand.

**Rules**
- Manual only (Actions → *PROD DB migrate* → *Run workflow*), from `main` only. Any other branch fails immediately.
- **The first run after any migration change must be `mode: dry-run`.** Read the job summary and check that it lists
  only the migrations you expect. Only then run `mode: apply`.
- `mode: apply` also needs `confirm` set to exactly `APPLY PROD`. Otherwise the job fails before it touches the database.
- It has its own concurrency group `prod-db`, so two production runs never overlap; it does not wait for the QA
  workflows. Apply to QA first and let the E2E suite pass before applying to production.

**What a run does**
1. `check` job (no secrets): main branch and the `confirm` input.
2. `migrate` job in the GitHub environment `production`: validates the connection, then runs
   `supabase migration list` and `supabase db push --dry-run`. The output of both goes to the job summary.
3. Only for `apply` + `APPLY PROD`: `supabase db push --yes`, then `supabase migration list` again.

**Setup (once, by the repo owner)**
- Environment `production` with secrets `PROD_DB_POOLER_URL` (Session pooler URL **without** the password) and
  `PROD_DB_PASSWORD`.
- Recommended in the environment settings: *Deployment branches* = `main` only, and *Required reviewers*, so every run
  waits for approval.

**Safety**
- The job stops if the pooler URL contains the QA ref `impdbvwsaancutwlrmac`, its user does not contain the production
  ref `kcxmjscxooqqhsgrhknb`, it contains a password, or it is not a `*.pooler.supabase.com` Session pooler URL.
- The URL, its host, user and the password are masked in the logs (`::add-mask::`) and replaced with `***` in the job summary.
- Supabase CLI is pinned to 3.2.0 (`.github/scripts/prod-db-migrate.mjs` passes `--remote=<url>` and `--output-format text`).

## CI

- `.github/workflows/checks.yml`: every PR and push to main — tsc (app, e2e), ESLint on changed files, Vitest.
- `.github/workflows/e2e.yml`: guard → **QA migrate** → seed → tests in 3 shards (own `E2E_RUN_ID` and teardown
  each) → merged HTML report artifact. Which tests:
  - **pull request**: `@smoke` + the specs related to the changed files (`scripts/select-specs.mjs`, shown in the
    run's summary). A changed migration runs every spec of each area it touches; changes to `e2e/setup`,
    `e2e/fixtures`, the Playwright config, package files or the Supabase client run the full suite.
  - **`full-ci` label** on the PR: the full suite (adding another label starts a run that does nothing).
  - **push to main**: `@smoke`. **Nightly 02:00 UTC** on main: the full suite (including `qa:migrate`).
  - The migrate step runs `npm run qa:migrate` (Supabase CLI 3.2.0). It applies the commit's pending migrations
    before the tests run against them. When nothing is pending it logs
    `No pending migrations: QA is up to date, nothing applied.` and does not run `db push`.
- `.github/workflows/qa-db-migrate.yml`: manual only, with a seed + API smoke run (the nightly migrate is part of
  the nightly full suite).
- **Secret masking**: `setup/redact-reporter.ts` is the first reporter; it masks the test password and any value
  typed into a `password` field in step titles, errors, traces and error-context before other reporters copy them.
  Every job also runs `setup/redact.ts` over its artifacts before uploading. Screenshots and videos show password
  fields as dots.
- `.github/workflows/prod-db-migrate.yml`: production, manual only; see _Production migrations_ above.
- The two QA workflows share the `qa-db` concurrency group, so they never overlap on the shared QA database.
  GitHub keeps one _pending_ run per group, so a newer push can cancel an older queued E2E run. Nothing is lost:
  the run that goes ahead migrates first and so also applies the cancelled run's migrations.
  `prod-db-migrate.yml` uses its own `prod-db` group.
- **Feature-branch migrations reach QA.** QA is shared, so a migration pushed on a branch is applied to QA before
  it is merged. Migrations are never edited (see `CLAUDE.md`), so this is harmless while the branch gets merged.
  If a branch is abandoned after its migration reached QA, later `db push` runs fail with
  _remote migration versions not found in the local migrations directory_. Ask the repo owner before repairing QA:
  undo the migration's objects, then mark it reverted with
  `supabase migration repair --status reverted <version> --db-url <QA pooler URL>`.
- Secrets live in the GitHub environment `qa`: `QA_SUPABASE_URL`, `QA_SUPABASE_PUBLISHABLE_KEY`,
  `QA_SUPABASE_SERVICE_ROLE_KEY`, `QA_SUPABASE_DB_POOLER_URL` (no password), `QA_SUPABASE_DB_PASSWORD`, `E2E_USER_PASSWORD`.

## data-testids

All test ids requested from Lovable (commit `884c943`) are in place, including option ids for every Radix
Select (`<select-test-id>-option-<value>`), dialog containers, empty/loading/error states and `data-status` on
the pending screen. Page objects use only `getByTestId` (and `data-user-id` / `data-request-id` attributes).
New UI must follow the same convention; see `CLAUDE.md`.

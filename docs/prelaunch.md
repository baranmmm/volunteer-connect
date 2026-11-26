# Pre-launch (Medway pilot)

Status and checklist for starting the pilot from a clean production database.

## Published app
- URL: **https://ds-volunteer.lovable.app** (Lovable).
- Supabase Auth **Site URL** is set to the published URL (sign-up and password-reset links point there).
- Supabase Auth uses **custom SMTP (Brevo)** for its own emails (sign-up confirmation, password reset).

## Lovable secrets (Project Settings → Secrets)
| Secret | Status |
|---|---|
| `APP_URL` | set (public origin for links in emails, canonical/OG URLs) |
| `EMAIL_FROM` | set (verified Brevo sender) |
| `EMAIL_LINK_SECRET` | set (signs confirm/cancel/unsubscribe links) |
| `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET` | set (bot check on the public forms) |
| `BREVO_API_KEY` | **added only after the prod reset**, so no email goes out for test data; until then queued emails stay pending |
| `SCHEDULED_JOBS_SECRET` | **to add** (one secret for `/api/public/outbox-flush`, `/api/public/task-reminders` and `/api/public/cleanup-deleted-events`; the same value in GitHub and Supabase Vault, `docs/push.md` "Production setup / troubleshooting") |
| `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | Web Push (`docs/push.md`) |

## GitHub
- Repository **variable** `APP_URL` = `https://ds-volunteer.lovable.app` (Settings → Secrets and variables → Actions →
  Variables). `Task reminders` and `Cleanup Recycle Bin` (manual-only fallbacks; pg_cron runs both jobs) fail with a
  clear message while it is empty.
- Secret `SCHEDULED_JOBS_SECRET`: the same value as in Lovable (used by both manual fallback workflows; pg_cron's
  outbox tick and Recycle Bin cleanup use the same value from Supabase Vault).

## Prod reset (clean start)
The reset keeps only the National Coordinator account with the dotted email (auth user, identities, sessions, MFA
factor, profile, role, followed branches, consents, settings, privacy acceptances), the **15** imported Dialogue Society
past events with all their media rows, the **6** highlight videos, and the reference data (regions, branches,
postcode geocode cache). Everything else user-generated goes: every other account, events, registrations, guests,
subscribers, meetings, tasks, task groups, notifications, the email outbox, requests and applications, audit and log rows.
The rules are the same in all three scripts (never fixed ids, test data keeps arriving until reset day):

| Script | What it does |
|---|---|
| `scripts/prelaunch/report.sql` | read-only: the keep set, per-table/per-bucket delete counts, FK checks, tables it does not know |
| `scripts/prelaunch/storage-delete-list.sql` | read-only: every Storage object outside the keep set (`bucket_id, name`) and a summary per bucket |
| `scripts/prelaunch/reset.sql` | one `DO` block, written to run unchanged as a migration: guard, deletes, reassignments, verification |

Reset guard: with no dotted NC and no imported events it only raises a NOTICE and changes nothing, so fresh local
stacks, CI, QA and the PGlite fixture pass it (leftover e2e channel videos on QA or a local stack do not count). Otherwise it aborts (nothing
changed) unless it finds exactly 1 dotted NC (active, with an MFA factor), 15 events and 6 videos, no kept event in a
series or deletion job, and no unknown public table holding rows. Its final verification aborts the whole migration on
any mismatch; a second run changes nothing. Tests: `src/test/prelaunch-reset-db.test.ts` (PGlite).

It is a **critical** change (deletes production data, cannot be undone without the backup): every step below runs
only with the user's explicit OK.

### Reset day
**0. Full backup to your Mac** (never through a GitHub workflow or artifact: treat the repository as public).
You need the database password (Supabase dashboard → Project Settings → Database; reset it there if you don't have
it) and the **Session pooler** host: dashboard → **Connect** → **Session pooler** → copy the host from the connection
string (it looks like `aws-0-<region>.pooler.supabase.com`; copy it, don't type it). Port **5432**, user
`postgres.kcxmjscxooqqhsgrhknb`, database `postgres`.

`pg_dump` must be the same or a newer **major** version than the server. Check the server in the SQL editor with
`SHOW server_version;` and the client with `pg_dump --version`. If `pg_dump` is missing or older, install the client
tools with Homebrew (`libpq` ships `pg_dump` and `psql` and tracks the newest PostgreSQL):
```zsh
brew install libpq
export PATH="$(brew --prefix libpq)/bin:$PATH"   # this terminal only (libpq is keg-only)
pg_dump --version
```
Then, in the same terminal (zsh), paste one block at a time:
```zsh
mkdir -p ~/ds-backups && chmod 700 ~/ds-backups
POOLER_HOST='<paste the Session pooler host>'
F=~/ds-backups/prod-$(date +%Y%m%d-%H%M).sql
D=${F%.sql}-data.sql
read -rs 'PGPW?Database password: '; echo      # typed invisibly: never echoed, not in history, not in a file

# 1) Full dump (schema + data) of public, auth and storage: the complete record, e.g. for a new project.
PGPASSWORD="$PGPW" PGSSLMODE=require pg_dump --host "$POOLER_HOST" --port 5432 \
  --username postgres.kcxmjscxooqqhsgrhknb --dbname postgres \
  --format=plain --no-owner --no-privileges \
  --schema=public --schema=auth --schema=storage --file "$F"

# 2) Data only, for a targeted restore into this project: every public table and the auth tables the reset touches.
PGPASSWORD="$PGPW" PGSSLMODE=require pg_dump --host "$POOLER_HOST" --port 5432 \
  --username postgres.kcxmjscxooqqhsgrhknb --dbname postgres \
  --format=plain --data-only --no-owner --no-privileges \
  --table='public.*' --table=auth.users --table=auth.identities --table=auth.mfa_factors \
  --table=auth.sessions --table=auth.refresh_tokens --table=auth.one_time_tokens \
  --table=auth.flow_state --table=auth.audit_log_entries --file "$D"

unset PGPW
```
`--no-owner --no-privileges` leaves out `ALTER ... OWNER` and `GRANT` lines that only fit this project's roles; grants
and RLS policies of `public` are recreated by the migrations anyway, and `auth`/`storage` belong to Supabase.
Supabase-managed schemas other than these three (e.g. `extensions`, `vault`, `realtime`) are not needed. If `pg_dump`
stops with *permission denied* or a version mismatch, stop and fix that first: no reset without a verified backup.

Verify both files before going on (each `grep -c` must print 1; the row counts must match the report's totals for
`auth.users` and `events`):
```zsh
for f in "$F" "$D"; do test -s "$f" && ls -lh "$f" || echo "EMPTY: $f"; done
grep -c '^COPY auth\.users ' "$F"; grep -c '^COPY public\.events ' "$F"
for t in auth.users public.events; do
  echo "$t rows: $(awk -v p="COPY $t (" 'index($0, p) == 1 {f = 1; next} f && $0 == "\\." {print n + 0; exit} f {n++}' "$F")"
done
chmod 600 "$F" "$D"
```
Storage **files are not in the dump** (only their `storage.objects` metadata rows). Objects deleted in step 2 cannot be
brought back from it: if you want copies, download them from the dashboard (Storage → bucket → select → Download)
before step 2. Do step 2 only after this backup is verified.

**1. Report.** Run `scripts/prelaunch/report.sql` in the Supabase SQL editor (SELECT only) and check: exactly one
KEEP account (the dotted NC, MFA `n` ≥ 1), 15 imported events, 6 highlight videos, the FK checks that must be 0, and
**no `NOT COVERED` rows** (a table added since the scripts were written: update report.sql and reset.sql first).

**2. Storage first.** Run `scripts/prelaunch/storage-delete-list.sql` (SELECT only). The rows starting with `#` are
the per-bucket summary (delete / keep / total); the other rows are the objects to delete. Delete them in the dashboard
(Storage → bucket → select the files or folders → Delete). The SQL never deletes `storage.objects` (Supabase's
`protect_objects_delete` blocks it; files go through the Storage API). Kept: the folders of the 15 events (photos and
their `.w640.webp`/`.w1280.webp` copies) and the posters of the 6 videos (`videos/<id>.jpg`). Run the list again: it
must show `delete 0` for every bucket.

**3. Migration PR (migrations only).** On a branch from `main`, copy the script unchanged:
`cp scripts/prelaunch/reset.sql supabase/migrations/<YYYYMMDDHHMMSS>_prelaunch_reset.sql` (a timestamp later than
every existing migration). Local checks as for every migration (`npm run local:reset` / `local:dryrun` on a stack of
your own: it must print the "not the production database" NOTICE), PR, then the user's OK to merge.

**4. Apply.** `PROD DB migrate` with `dry-run` first, then `apply` with `confirm: APPLY PROD`. The migration either
completes with its own verification or rolls back completely (the log shows the NOTICE with the per-table counts, or
the reason it aborted).

**5. Check.** Run `report.sql` again: every `DELETE rows` and `DELETE storage` line is 0, one KEEP account, 15 events,
6 videos. Run `storage-delete-list.sql` once more (anything uploaded between steps 2 and 4: delete it). Check the
workflow's "Migration list (after)": local and remote columns match for every file.

**Restore (only if the reset went wrong).** The reset runs in one transaction, so a failed run changes nothing; a
restore is needed only if a *successful* run removed something that should have stayed. Rehearse on a throwaway
project or your own local stack first.
- *Targeted data restore into this project* (keeps the project, its keys, Auth settings and Storage): restore `$D` in
  one transaction after emptying exactly the tables it contains. `session_replication_role = replica` is needed
  here, and only here: a data-only load would otherwise fire the app's triggers (`on_auth_user_created` would create
  duplicate profiles, `validate_event` would reject published past events, guards and email triggers would run) and
  trip over circular foreign keys (`profiles.deleted_by`, `notifications.digest_id`). The dump is one consistent
  snapshot, so skipping FK checks while loading it is safe. **Not verified on the hosted project:** whether its
  `postgres` role may set `session_replication_role` (it may on the local stack; on hosted Supabase `postgres` is not a
  full superuser). Check it in the SQL editor before reset day with `BEGIN; SET LOCAL session_replication_role =
  replica; ROLLBACK;` — if that fails, this path is not available and the new-project path below is the restore.
  Create `~/ds-backups/restore-prepare.sql` with:
  ```sql
  SET LOCAL session_replication_role = replica;
  DO $$ BEGIN
    EXECUTE (SELECT 'TRUNCATE ' || string_agg(format('%I.%I', schemaname, tablename), ', ') FROM pg_tables
             WHERE schemaname = 'public'
                OR (schemaname = 'auth' AND tablename IN ('users','identities','mfa_factors','sessions','refresh_tokens',
                    'one_time_tokens','flow_state','audit_log_entries'))) || ' CASCADE';
  END $$;
  ```
  then run (the password read the same way as in step 0):
  ```zsh
  PGPASSWORD="$PGPW" PGSSLMODE=require psql --host "$POOLER_HOST" --port 5432 \
    --username postgres.kcxmjscxooqqhsgrhknb --dbname postgres -v ON_ERROR_STOP=1 \
    --single-transaction --file ~/ds-backups/restore-prepare.sql --file "$D"
  unset PGPW
  ```
  `CASCADE` also empties the auth tables that reference these (MFA challenges and AMR claims, WebAuthn, OAuth
  consents, SAML relay states): short-lived rows the restored users simply recreate on their next sign-in; no
  `storage` table references `auth.users`. The migration history (`supabase_migrations`) is not touched. Storage
  objects deleted in step 2 stay deleted: their restored rows would point at missing files, so
  delete those media rows again or upload the files you downloaded.
- *New Supabase project* (cleanest when the whole project is in doubt): restore the full dump `$F` into a fresh
  project. Its `auth` and `storage` schemas already exist there, so follow Supabase's current "backup and restore"
  guide (roles, schema and data restored separately, data with `session_replication_role = replica`) rather than
  replaying `$F` as is; then re-point the app's secrets and the Auth settings to the new project.

**6. After the reset:** add `BREVO_API_KEY` in Lovable, then check a sign-up, a guest registration and the scheduled
jobs end to end (`cron.job`, `cron.job_run_details`, `net._http_response`: `outbox-flush` and `recycle-bin-cleanup`
answer 200).

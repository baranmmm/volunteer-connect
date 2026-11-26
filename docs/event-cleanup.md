# Recycle Bin cleanup

## Deployment setup

1. Set **SCHEDULED_JOBS_SECRET** in **Lovable → Project Settings → Secrets** (the one secret of every scheduled route:
   cleanup, task reminders and the outbox tick; how to make it and where else it goes: `docs/push.md` "Production setup
   / troubleshooting"). It is server-only; never use a `VITE_` name. An unset or empty secret refuses every call (401).
2. Set the identical value in **GitHub repository → Settings → Secrets and variables → Actions → New repository secret**, named **SCHEDULED_JOBS_SECRET**.
3. Publish the app before enabling or manually running the workflow.

Production endpoint:

`${APP_URL}/api/public/cleanup-deleted-events`, where `APP_URL` is the GitHub repository variable holding the published app URL (`https://ds-volunteer.lovable.app`); the workflow fails with a clear message when it is empty

The pg_cron job `recycle-bin-cleanup` runs daily at **03:30 UTC**: `public.recycle_bin_cleanup_tick()` → `public.post_scheduled_route()` POSTs the endpoint through pg_net with `Authorization: Bearer <secret>`, reading `app_url` and `scheduled_jobs_secret` from Supabase Vault (5 minute timeout; the answer lands in `net._http_response`). It does nothing when either Vault entry is missing. The workflow `.github/workflows/cleanup-deleted-events.yml` is a **manual-only fallback** (**Run workflow**) with the same secret, to drain a backlog sooner or when pg_cron is down. Missing/incorrect authorization returns an empty 401. Do not print the secret or use shell tracing.

Check (Supabase SQL editor): `select jobname, schedule, active from cron.job where jobname = 'recycle-bin-cleanup';`, and after 03:30 UTC `select status_code, content, created from net._http_response order by created desc limit 5;` (a 200 with counts only).

## Retention and execution

- Only items deleted **strictly more than 30 days ago** qualify for scheduled cleanup.
- Each run processes at most **25 events and 25 users**, with Storage deletions in batches of **100 paths**. A larger backlog drains across runs; manual runs can drain it sooner.
- Normally deletion occurs at the next daily run after the retention window. Backlogs can extend that delay.
- Files are removed through the Storage API before media and event rows. Registrations and other application data are not removed by cleanup. Future registration foreign keys must accommodate purging; a restrictive foreign key blocks finalization safely.
- Response bodies contain only `{ "events": number, "users": number, "files": number }`. Failed processing returns 500 (and fails a manual workflow run).
- User deletion immediately sets an RLS-hidden, inactive profile and bans the Auth account; the existing audit/request RPCs mark completion after blocking succeeds. After retention, the durable purge operation records a personal-data-free audit before Auth erasure, then removes operation state. Profile/role cascades and existing SET NULL references apply.
- Each authorized processing run writes count-only completion/failure details to `event_cleanup_audit`. Each type writes delete/restore/permanent-delete entries to `recycle_bin_audit_log`; events additionally retain `event_audit_log`. A null actor means scheduled cleanup.
- Database event locks and durable purge jobs protect restore races and make repeat runs safe.

## Attachment access

Soft deletion hides event/media rows immediately. The authenticated delete operation moves attachments to a denied private `deleted/` path before reporting completion. Existing signed URLs then cannot find the original object. A real Storage check verified an old URL changed from 200 to 400 after moving the file, and restoring returned the original file.

RLS does not re-evaluate already-issued signed URLs. A direct database soft-delete call, or an interrupted Storage archive, can leave an old URL usable until archiving finishes or its existing five-minute token expires. Authorized managers can restore interrupted archives through the Recycle Bin. Already downloaded/browser-cached bytes cannot be revoked. No application can erase a copy someone has already downloaded.

## Recovery and extensibility

- `/recycle-bin` is available only to active managers. Database list/restore/permanent-delete functions enforce branch/region scope; Branch Managers cannot recover another manager's account, and Regional Directors cannot delete another director.
- User recovery reinstates the previous status. An account deactivated before deletion remains inactive and must be activated separately by its manager. Self-requested deletion is scheduled for erasure, never recoverable.
- Add future types to the SQL list and typed mutation dispatch, then supply a server-only resource cleanup/restore adapter; do not create a parallel user-deletion system.
- Permanent deletion requires exact `DELETE`, validates permissions before service access, and uses the same durable purge adapters as the scheduler.
- Security advisory: authenticated SECURITY DEFINER calls are intentional, input-validated, and permission-checked. The pre-existing leaked-password-protection warning remains unchanged.

Full signed-in Branch Manager/Regional Director/Volunteer preview checks are not available through managed sessions for this external Supabase project; isolated database permission tests and real Storage movement checks cover those layers separately.
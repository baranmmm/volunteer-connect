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

## GitHub
- Repository **variable** `APP_URL` = `https://ds-volunteer.lovable.app` (Settings → Secrets and variables → Actions →
  Variables). Must be set **after the workflow-URL PR merges**; `Task reminders` and `Cleanup Recycle Bin` fail with a
  clear message while it is empty.
- Secret `CLEANUP_CRON_SECRET`: the same value as in Lovable (already used by both workflows).

## Prod reset (clean start)
1. Read-only report: run `scripts/prelaunch/report.sql` in the Supabase SQL editor (SELECT only) and check:
   - exactly **one** KEEP account: the National Coordinator with the dotted email;
   - the **15** imported Dialogue Society past events and the **6** channel highlight videos (with their photos and
     posters in Storage);
   - the per-table and per-bucket delete counts and the FK checks.
2. The reset migration (keep by explicit ids, delete everything else in dependency order, Storage cleanup through the
   Storage API) is written from that output. It deletes data, so it is **critical**: it runs through
   `PROD DB migrate` only after the user's explicit OK.
3. After the reset: add `BREVO_API_KEY` in Lovable, then check a sign-up, a guest registration and the scheduled
   workflows (`Task reminders`, `Cleanup Recycle Bin`) end to end.

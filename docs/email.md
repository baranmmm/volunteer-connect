# Email

The hub sends its emails from one queue, `email_outbox`, through the [Brevo](https://www.brevo.com) transactional
API. Everything stays on free tiers: Brevo's free plan allows **300 emails a day**, and the sender never goes over it.

## What is sent

| Template | When | Recipient | Calendar file |
| --- | --- | --- | --- |
| `guest_confirm` | a guest registers for a public event | the guest | none (no seat yet) |
| `registration_confirmed` | registered, waitlisted, promoted from the waitlist, or a guest registers again (resent) | member or confirmed guest | `METHOD:REQUEST` (not for the waitlist) |
| `event_update` | a published public event's time or place changes (also "To be announced" → a real place) | registered and waitlisted | `METHOD:REQUEST`, same UID, new SEQUENCE (not for the waitlist) |
| `event_reminder` | two London days before the start | registered (not waitlisted) | none |
| `registration_cancelled` | the person cancels | member or guest | `METHOD:CANCEL`, SEQUENCE + 1 |
| `event_cancelled` | the event is cancelled or removed | registered and waitlisted | `METHOD:CANCEL` (not for the waitlist) |
| `subscriber_confirm` | "Get event updates" (double opt-in) | the subscriber | none |
| `event_announcement` | a manager announces an upcoming public event | confirmed subscribers in the target | none |
| `task_reminder` | task reminders (`docs/tasks.md`) | the assignee | none |
| `notice` | at once: a task assigned to me, a meeting invitation, requests waiting for my review (`docs/notifications.md`) | the member | none |
| `daily_digest` | 08:00 London, when the member has new unread notices of daily-summary types (`docs/notifications.md`) | the member | none |

Event emails go only to public events (not meetings, not past-event records). The database queues them with
triggers; the sender renders them **at send time** from the current data, so an email always shows the latest time
and place. Event and guest templates are English only (`src/lib/email/templates.ts`); member notice emails (`notice`,
`task_reminder`, `daily_digest`) follow the member's `preferred_language` (English or Turkish, read at send time with
`notice_email_context`; type names come from the app's locale files). Each has a branded HTML part (inline CSS, real
text with a heading, no images) and a plain-text part. Times are Europe/London.

- **Guests** get signed links (`src/lib/email/links.server.ts`): `/e/confirm` (valid 48 hours) and `/e/cancel`
  (shown until the event starts). **Members** get a link to `/events/<id>` in the app and cancel there.
- **Online events**: the joining link is never in an email or calendar file; the place reads "Online — the organisers
  will share the joining details".
- **Calendar files** (`src/lib/email/ics.ts`): UID `<registration id>@dialoguesociety-hub` (one entry per attendee and
  event; the registration row is reused when someone registers again), SEQUENCE from `events.ics_sequence`, which the
  database bumps on every time/place change and on cancel.
- **Member notice emails**: `notice` is rendered from the notice itself at send time (title, actor, link to the item
  on `APP_URL`); it is skipped when the notice was read or removed meanwhile, or the type's email was turned off.
  `daily_digest`: at most one per member and London day, never empty, the counts per kind of the unread notices since
  the last one (`payload {count, kinds, types, day}`) and a button to `/notifications`.
- **Stop links** (`src/lib/email/links.server.ts`): every member notice email carries a signed link
  `/e/notices?t=<user>.<type>.<expiry day>.<signature>` (HMAC with `EMAIL_LINK_SECRET`, never stored, valid 60 days)
  that turns that type's emails off without signing in (a click on the page confirms; `notice_email_unsubscribe`,
  service role only), the `List-Unsubscribe` / `List-Unsubscribe-Post` headers for `notice` and `task_reminder`
  (`POST /api/public/notice-unsubscribe?t=`; Brevo's `headers` field), and a link to `/profile#notifications`. The
  daily summary has one stop link per type in it and no `List-Unsubscribe` header (it covers several types).
- **Announcements** carry an unsubscribe link (`/updates/unsubscribe`) and `List-Unsubscribe` /
  `List-Unsubscribe-Post` headers pointing at the one-click endpoint `POST /api/public/unsubscribe?t=…`.

## Sending

`flushOutbox()` in `src/lib/email/outbox.server.ts` claims rows with `claim_email_batch`, renders them and sends them:

- **Priorities** (`email_priority`): 1 transactional (confirmations, updates, cancellations), 2 reminders (event and
  task), member notice emails (`notice`) and the daily summary, 3 announcements; oldest first within a priority.
- **Daily limit**: 300 per London day (`email_daily_limit()`), counting sent and in-flight rows. Whatever does not fit
  stays pending for the next run or the next day.
- **Results**: `finish_email` marks a row `sent`, `skipped` (no longer applies: unsubscribed, cancelled, event closed,
  or the recipient is rejected by Brevo) or `retry` (rate limit, Brevo error, network: back-off of attempts × 10 minutes;
  `failed` after 5 attempts). A crashed run's claims return after 15 minutes.
- **When it runs**:
  - right after a member action that queues notice emails (task create/edit, task groups, meetings and invitees,
    task/meeting/event requests, accepting or approving a request): up to 60 emails of priorities 1–2
    (`flushNoticeEmails`, `src/lib/notice-emails.server.ts`); anything else waits for the scheduled run;
  - right after an action, for its transactional emails (member register/cancel, guest and subscriber forms, event
    changes; announcements send up to 50 at once);
  - in the scheduled run (`/api/public/task-reminders`, the "Task reminders" workflow at 07:05, 08:05, 09:05, 13:05 and
    18:05 UTC): it queues the daily summaries (from 08:00 London), task and event reminders, then sends up to 300 of
    every priority. The later runs drain the
    outbox; announcements over the daily limit continue the next day.
- Each call is bounded (at most 300 rows, about 20 seconds) and never throws. Logs contain only template names and
  error codes, never addresses or content.

## Configuration (server environment, never `VITE_*`)

| Variable | Required | Meaning |
| --- | --- | --- |
| `BREVO_API_KEY` | yes, to send | Brevo API key (SMTP & API → API keys). |
| `EMAIL_FROM` | yes, to send | Sender, `Dialogue Society <events@example.org>` or a bare address; must be a sender verified in Brevo (authenticate the domain with SPF/DKIM there). |
| `APP_URL` | recommended | Public origin for links in emails, e.g. `https://hub.example.org`. Without it the request origin is used. |
| `EMAIL_LINK_SECRET` | optional | Secret for signed email links. Without it a secret is derived from the service role key; rotating either invalidates links already sent. |
| `EMAIL_TRANSPORT` | tests only | `capture`: render and store instead of sending (below). |

Without `BREVO_API_KEY` or `EMAIL_FROM`, nothing is claimed: the rows stay `pending` and go out once the sender is
configured (subject to the daily limit and the usual skip rules).

## Capture mode (tests)

The e2e app server (`e2e/setup/start-app.ts`) runs with `EMAIL_TRANSPORT=capture`, a fixed `EMAIL_LINK_SECRET` and
`APP_URL` set to the app's base URL. A claimed email is rendered and stored on its row with `capture_email`
(`payload.captured`: to, subject, text, html, attachments with the `.ics` text) and counts as sent. No Brevo key or
GitHub secret is needed. Tests read emails with `e2e/api/outbox.ts` (`waitForEmail`, `linkFrom`, `icsFrom`,
`triggerScheduledRun`).

## Retention

`purge_guest_data()` (nightly: pg_cron where available, and the "Cleanup Recycle Bin" workflow through
`/api/public/cleanup-deleted-events`) deletes guest registrations 12 months after the event ended, unconfirmed guests
after 48 hours, unconfirmed subscribers after 7 days, finished outbox rows after 30 days and rate-limit windows after
2 days.

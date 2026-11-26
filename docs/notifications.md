# Notifications

In-app notices for tasks, meetings and requests (members only: followers get none). The rule is **less noise**: a
person hears only about what directly concerns them, never about their own actions, and similar notices are grouped.
Database: `supabase/migrations/20261128090000_notification_settings_self_reminders.sql` (on top of
`20261125090100_notifications.sql`); in-app notices always immediate and the daily summary as an email:
`20261208090000_notifications_inapp_immediate.sql`; notice emails, email switches and stop links:
`20261208090100_notification_emails.sql`; mentions at once, sending order, Auth reserve and the 250 warning:
`20261208090200_email_priorities_budget.sql`. Texts: `src/lib/notification-text.ts` (i18n keys `notifications.kinds.*`,
`notifications.groups.*`), never stored sentences.

## Who gets what

| Event | Who is notified | Kind | Type |
|---|---|---|---|
| A task is assigned to me (on create or when added) | The new assignee | `task_assigned` | `task_assigned` |
| I am @mentioned in a task note | The mentioned person | `task_note_mention` | `mention` |
| Requests wait for my review | Each reviewer, one grouped notice | `review_waiting` | `review` |
| A task I created moves to Blocked or Done (by someone else) | The creator | `task_status_changed` | `task_status` |
| Someone writes a note on a task assigned to me | Every assignee except the author; someone also @mentioned gets only the mention | `task_note_added` | `task_note` |
| An assignee writes a note on a task I created | The creator (unless mentioned, or already told as an assignee) | `task_note_added` | `task_note` |
| A reminder of a task assigned to me | The assignee (only when reminders are turned on) | `task_reminder` | `task_reminder` |
| I am invited to a meeting; it changes or is cancelled | The invitees | `meeting_invited` / `meeting_changed` / `meeting_cancelled` | `meeting` |
| My task or meeting request is decided | The requester | `task_request_accepted` / `_declined`, `meeting_request_approved` / `_declined` | `request_decided` |

- The actor is never notified (`notify()` skips them). Other status changes (To do, In progress) notify nobody.
- Per-request "received" notices (`task_request_received`, `meeting_request_received`) are no longer created: the
  grouped `review_waiting` notice replaces them. Old ones still render.
- Task and meeting notices carry `payload.branch` (the branch name) for grouping.

## Types, settings and defaults (Profile > Notifications)

- **In the app**: every notice that is on appears at once, for every role (never held). **Locked** (always on in the
  app): `task_assigned`, `mention`, `review` — disabled in-app switch and a short explanation. The others can be turned
  off in the app (`set_notification_setting`; off means no notice and so no email).
- **Email** (`set_notification_email`, any type, locked ones included; default **on for every role**). The timing is
  fixed per kind (`notification_email_mode`), shown under each row (`notification_email_timing`):

  | Type | Email |
  |---|---|
  | `task_assigned` (`task_assigned`, `task_group_created`) | at once, one per notice (template `notice`) |
  | `review` (the grouped `review_waiting` notice) | at once when it is created or its count goes up (a new request); while one email is still waiting it is reused (sent with the current count) |
  | `meeting` | invitations (`meeting_invited`) at once; changes and cancellations in the daily summary |
  | `mention` (`task_note_mention`) | at once, one per mention (`20261208090200`) |
  | `task_reminder` | its own email at once (`task_reminder`; the switch is `notification_preferences.task_reminder_emails`) |
  | `task_status`, `task_note`, `request_decided` | in the daily summary |

  Turning an email off cancels that type's notice emails still waiting. The old per-person delivery choice
  (`types.<type>.delivery`, "Immediately" / "Daily summary") is no longer read; nothing stored was rewritten, and
  everyone starts with every email on (`20261208090100_notification_emails.sql`).
- **Stop links**: every notice email has a signed "Stop these emails" link for its type (`/e/notices?t=`, a click
  confirms; the daily summary has one per type in it) and a `List-Unsubscribe` one-click header
  (`POST /api/public/notice-unsubscribe?t=`), plus a link to Profile > Notifications (`/profile#notifications`).
  See `docs/email.md`.
- **Note notices group per task**: while a person's "new note" notice for a task is unread, further notes update it
  ("3 new notes on: <task>", `payload.count`). Note and mention notices link to `/tasks?task=<id>&note=<note id>`;
  the panel scrolls to that note and highlights it (`task-note` with `data-highlighted="true"`).

## Daily summary email

- A notice of a daily-summary kind whose type's email is on is marked for the email (`notifications.email_digest`).
- At 08:00 London time `run_notification_digest` (the Task reminders workflow, or pg_cron where available) queues per
  active person with marked notices not yet summarised **one** `email_outbox` row, template `daily_digest`,
  `payload {count, kinds, types, day}`, then sets `email_digested_at` on every marked notice. Only notices **still
  unread** at that moment, of types still on in the app with their email on, count: a notice read before the summary
  is settled and never emailed later. At most one per person and London day (`notification_digest_log`, with
  `email_id`); notices that arrive after today's email wait for tomorrow's.
- **Never an empty summary**: nothing new and unread since the last one means no email and no log row.
- No in-app `daily_digest` notice any more (the items are already in the app). Older `daily_digest` notices still
  render and expand to their items (`digest_id`). Notices held before `20261208090000` were released by that
  migration and went into the next summary email; `held` is always false now (check constraint).
- The emails themselves: `docs/email.md`.

## Email budget warning

When the app has sent 250 emails in a London day (`email_budget_warning_at()`), every active National Coordinator and
Branch Manager gets one in-app notice `email_budget_warning` (entity type `email_budget`, link `/dashboard`, payload
`{day, sent, limit, app_limit}`): "250 of 300 emails were sent today … consider a paid email plan". Once per person
and day (the notice itself is the log), always on, never emailed. See `docs/email.md`.

## Grouping (dashboard Notifications card)

`groupNotifications` (`src/lib/notification-groups.ts`, pure, Vitest-covered):
- Unread notices with the same kind + `payload.branch` + `payload.status` become one expandable line when there are
  at least two ("4 tasks in Medway were completed"). Read notices are always single lines.
- `review_waiting` and `daily_digest` are never grouped.
- Items of an older in-app daily summary sit under it (grouped there as well); an item whose summary is not in the
  loaded list stays at the top level. New summaries are emails only.
- The card loads the latest 30 notices (`DASHBOARD_NOTIFICATIONS`). "Mark all as read" marks every unread notice.

## Requests waiting for review ("Waiting for you")

- `get_review_waiting()` returns `{work, event_requests, applications, total, branches (≤3)}` for the caller: task and
  meeting requests sent to them, event requests and volunteer applications in the scopes they manage.
- One `review_waiting` notice per reviewer (`entity_type 'review'`, link `/requests?tab=review`), updated in place by
  triggers and deleted when nothing waits. Text: "3 requests from Medway are waiting for you" ("…from Medway and
  Brighton…"; no branch when none is known).
- Opening Requests > To review marks the review notice read (`mark_notifications_read` with entity type `review`).
- **Requests badge** = `total` plus unread decisions on my own task/meeting requests. On phones Requests is under
  More, and the **More badge** is the sum of the badges of the items it holds (`moreBadgeCount`). The bottom bar
  keeps at most 5 items.
- **Dashboard "Waiting for you" card** at the top for anyone with something waiting (hidden at zero), with the counts
  by kind, up to three branches and a link to To review. It replaced the former "Pending requests" card.

## Badges

| Badge | Counts |
|---|---|
| Tasks | Unread `task_assigned`, `task_note_mention`, `task_note_added` (opening the task marks them read) |
| Meetings | Unread meeting notices (opening the meeting marks them read) |
| Requests | `get_review_waiting().total` + unread task/meeting request decisions (opening Requests marks those read) |
| More (phones) | Sum of the badges of the items under More |

## Test ids

- Dashboard: `dashboard-notifications`, `dashboard-notification` (`data-notification-id`, `data-kind`,
  `data-unread`), `dashboard-notification-group` (`data-kind`, `data-count`, `data-unread`) with its toggle
  `dashboard-notification-group-toggle` (`aria-expanded`), `dashboard-notification-digest` (`data-count`,
  `data-notification-id`) with `dashboard-notification-digest-toggle`, `dashboard-notifications-mark-all`,
  `dashboard-notifications-empty`.
- Waiting for you: `dashboard-waiting`, `dashboard-waiting-count` (`data-count`), `dashboard-waiting-link`.
- Badges (`data-count`): `nav-requests-badge`, `nav-tasks-badge`, `nav-meetings-badge`, `mobile-nav-<kind>-badge`,
  `mobile-nav-more-badge`.
- Profile: `profile-notifications` (`id="notifications"`), `profile-notification-type` (`data-type`, `data-locked`,
  `data-enabled`, `data-email`, `data-email-timing`), `profile-notification-enabled`, `profile-notification-email`,
  `profile-notification-email-timing`.
- Stop link page (`/e/notices`): `notice-email-link-page`, `notice-email-unsubscribe-button`,
  `notice-email-link-state` (`data-state` `unsubscribed` / `invalid`), `notice-email-link-error`,
  `notice-email-settings-link`.
- E2E: `e2e/tests/ui/notifications.spec.ts`.

## One "waiting" count

The Requests badge, the mobile More badge, the dashboard "Waiting for you" card, the grouped `review_waiting` notice
and the /requests "To review" tab counter all use the same calculation: `review_waiting_for()` in the database
(`get_review_waiting()` for the signed-in person, `useReviewWaiting()` in the app). It counts task and meeting requests
sent to the person, event requests and volunteer applications in the scopes they manage.

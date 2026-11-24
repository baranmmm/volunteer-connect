# Notifications

In-app notices for tasks, meetings and requests (members only: followers get none). The rule is **less noise**: a
person hears only about what directly concerns them, never about their own actions, and similar notices are grouped.
Database: `supabase/migrations/20261128090000_notification_settings_self_reminders.sql` (on top of
`20261125090100_notifications.sql`). Texts: `src/lib/notification-text.ts` (i18n keys `notifications.kinds.*`,
`notifications.groups.*`), never stored sentences.

## Who gets what

| Event | Who is notified | Kind | Type |
|---|---|---|---|
| A task is assigned to me (on create or when added) | The new assignee | `task_assigned` | `task_assigned` |
| I am @mentioned in a task note | The mentioned person | `task_note_mention` | `mention` |
| Requests wait for my review | Each reviewer, one grouped notice | `review_waiting` | `review` |
| A task I created moves to Blocked or Done (by someone else) | The creator | `task_status_changed` | `task_status` |
| An assignee writes a note on a task I created | The creator (unless mentioned) | `task_note_added` | `task_note` |
| A reminder of a task assigned to me | The assignee (only when reminders are turned on) | `task_reminder` | `task_reminder` |
| I am invited to a meeting; it changes or is cancelled | The invitees | `meeting_invited` / `meeting_changed` / `meeting_cancelled` | `meeting` |
| My task or meeting request is decided | The requester | `task_request_accepted` / `_declined`, `meeting_request_approved` / `_declined` | `request_decided` |

- The actor is never notified (`notify()` skips them). Other status changes (To do, In progress) notify nobody.
- Per-request "received" notices (`task_request_received`, `meeting_request_received`) are no longer created: the
  grouped `review_waiting` notice replaces them. Old ones still render.
- Task and meeting notices carry `payload.branch` (the branch name) for grouping.

## Types, settings and defaults (Profile > Notifications)

- **Locked** (always on, immediate): `task_assigned`, `mention`, `review`. Shown with disabled controls and a short
  explanation.
- **Changeable**: `task_status`, `task_note`, `task_reminder`, `meeting`, `request_decided`: on/off, and delivery
  **Immediately** or **Daily summary** (`set_notification_setting`; the database refuses locked types).
- **Default delivery**: immediately for volunteers, daily summary for Branch Managers, Regional Directors and
  National Coordinators (`notification_default_delivery`).
- "Email reminders for tasks" stays in the same section (`set_task_reminder_emails`).

## Daily summary

Notices set to the daily summary are stored *held*: they are neither listed nor counted. At 08:00 London time
`run_notification_digest` (pg_cron, or the Task reminders workflow) creates one `daily_digest` notice per person
(`payload {count, kinds, day}`, link `/dashboard`) and releases the held notices with `digest_id` set to it.
On the dashboard it reads "Your daily summary: 7 updates" and expands to its items; expanding marks the summary line
read (its items stay unread until opened or "Mark all as read"). No email is sent yet.

## Grouping (dashboard Notifications card)

`groupNotifications` (`src/lib/notification-groups.ts`, pure, Vitest-covered):
- Unread notices with the same kind + `payload.branch` + `payload.status` become one expandable line when there are
  at least two ("4 tasks in Medway were completed"). Read notices are always single lines.
- `review_waiting` and `daily_digest` are never grouped.
- Items of a daily summary sit under it (grouped there as well); an item whose summary is not in the loaded list
  stays at the top level.
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
- Profile: `profile-notifications`, `profile-notification-type` (`data-type`, `data-locked`, `data-enabled`,
  `data-delivery`), `profile-notification-enabled`, `profile-notification-delivery` with
  `profile-notification-delivery-immediate` / `profile-notification-delivery-digest`, `profile-task-reminder-emails`.
- E2E: `e2e/tests/ui/notifications.spec.ts`.

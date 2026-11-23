# Tasks

Tasks belong to a scope: a **branch**, a **region** or **national**. The database enforces every rule below through
RLS and SECURITY DEFINER RPCs (`supabase/migrations/20261125090300_tasks.sql`). The screens only reflect those rules.
Followers have no access to tasks or task requests: they get no menu item, the routes redirect them, and RLS returns
nothing.

## Who can do what

| | Volunteer | Branch Manager | Regional Director | National Coordinator (MFA) |
|---|---|---|---|---|
| See | Every task of their branch, tasks they created or are assigned to | Same, plus region tasks of their region | Every task in their region (branch and region tasks) | National tasks; tasks they are assigned to |
| Create | Self-tasks in their branch, assigned only to themselves | Branch tasks in their branch | Region tasks, or branch tasks in their region | National tasks |
| Assign | Only themselves | Volunteers and Branch Managers of their branch | Anyone in the region (members and the region's RDs) | Regional Directors, Branch Managers and National Coordinators. Never volunteers. |
| Edit everything | Their own self-tasks | Tasks of their branch | Tasks in their region | National tasks |
| Change status | Tasks assigned to them | Same, plus the tasks they edit | Same | Same |
| Delete (Recycle Bin) | Their own self-tasks | Tasks of their branch | Tasks in their region | National tasks |

- **Editors.** "Edit everything" means the task's creator and the managers of its scope (`can_edit_task`). Assignees
  who are not editors can change the status only (`set_task_status`).
- **Scope.** A task's scope never changes after creation.
- **Volunteers.** A volunteer's task is a self-task: the database replaces any assignee list with the volunteer.
- **NC privacy.** National Coordinators never see volunteer names. National tasks can only have RD, BM or NC assignees,
  and NCs cannot see branch or region tasks.

## Fields

| Field | Rule |
|---|---|
| Title | Required, at most 200 characters |
| Description | At most 5000 characters |
| Status | `todo`, `in_progress`, `blocked` or `done`. A fixed list: Kanban has these four columns. |
| Priority | `low`, `medium`, `high` or `urgent` |
| Due date | Optional London calendar date |
| Assignees | Several people, at most 50 |
| Linked event | Optional. Must be an event the user can see, in the same scope. Managers see the linked tasks on the event page (`get_event_tasks`). |
| Source meeting decision | Optional. "Create task" on a decision sets `decision_id` and `meeting_id`. The task's scope is the meeting's scope. |

## Views (`/tasks`)

- **Views.** Kanban (drag and drop changes the status; each card also has a status select for keyboard use), List
  (filters, sort, group by status or assignee) and Calendar (month view, tasks on their due date, overdue highlighted).
- **Remembered choice.** The chosen view is stored per user in `localStorage` (`dsvh-tasks-view:<user id>`, wrapped in
  try/catch). Without storage the default is Kanban.
- **My tasks.** A "My tasks" filter chip shows only tasks assigned to you.
- **Detail.** The task opens in a side panel: `/tasks?task=<id>`. Opening it marks its notices read.
- **Dashboard.** The "My tasks" card (volunteer and up) shows open and overdue counts and the next 5 tasks by due date,
  with due-tomorrow and overdue tasks highlighted.

## Task requests

Anyone can ask a person in a higher role in their chain to take on a task:

| Requester | Can ask |
|---|---|
| Volunteer | Their branch's Branch Manager or their region's Regional Director |
| Branch Manager | Their region's Regional Director |
| Regional Director | A National Coordinator |

The flow:
1. The request lands on the target's `/requests` page, under "To review". The target and the Requests badge get a
   notice.
2. **Accept** creates a task assigned to the target. Its scope is the requester's branch, or national when a Regional
   Director asked a National Coordinator.
3. **Decline** needs a note of at least 10 characters. The requester sees the note under "My requests".
4. The requester can withdraw an open request.

## Reminders

The task form has a "Reminders" section. It is shown only when the task has a due date, and only the creator and the
scope's managers can set it. The options can be combined:

| Option | Choices | Default |
|---|---|---|
| Before the due date | 1, 2, 3 or 7 days before, or a custom number of days (several allowed) | 3 days |
| Repeat | None, daily, every N days or weekly, from a start date until the task is done or the due date passes | None |
| Overdue | Every N days after the due date until the task is done | Off |

- **Assignees.** They see the reminder settings read only and can mute reminders for themselves on that task.
- **When reminders stop.** When the task is done or deleted, when the person is no longer an assignee, or when they
  could no longer be assigned there (for example, they moved branch).
- **Scheduler.** `run_task_reminders()` runs at 09:00 Europe/London (pg_cron at 08:05 and 09:05 UTC when available,
  otherwise the "Task reminders" GitHub workflow calls `/api/public/task-reminders` with `CLEANUP_CRON_SECRET`).
  - It is idempotent: `task_reminder_log` allows one reminder per task, person and London day.
  - Before 09:00 London time it does nothing.
- **What a reminder creates.**
  - An in-app notice (`task_reminder`).
  - An `email_outbox` row (template `task_reminder`, payload with the title, due date and link, status `pending`),
    unless the person turned off "Email reminders for tasks" in Profile. **No email is sent yet**: a sender (SMTP
    through Brevo or Resend) will process the outbox later.

## Notifications

| Event | Who is notified | Notice |
|---|---|---|
| A task is created with assignees, or an assignee is added | Each new assignee, never someone who assigned themselves | `task_assigned` |
| An assignee changes the status | The creator | `task_status_changed` |
| A task request is received | The target | `task_request_received` |
| A task request is accepted or declined | The requester | `task_request_accepted` / `task_request_declined` |

- **Storage.** Notices are stored per user with read/unread (`notifications`). Users read only their own.
- **Badges.** The Tasks badge counts unseen assignments; opening the task marks its notices read.

## Recycle Bin

A deleted task goes to the Recycle Bin for 30 days, the same pattern as events.
- **Restore.** The managers of the task's scope can restore it.
- **Permanent deletion.** Tasks are deleted permanently after 30 days (`purge_expired_work_items`), or earlier with
  "Delete permanently".
- **Branches and regions.** A branch or region with tasks stays archived (`structure_in_use`).

## Test ids

All kebab-case, never derived from text. Lists expose `data-task-id` / `data-request-id` / `data-user-id`.

- **Page**:
  - Header and views: `tasks-new`, `tasks-view-kanban|list|calendar` (aria-pressed), `tasks-filter-mine` (aria-pressed), `tasks-empty`
  - List filters: `tasks-filter-status|priority|assignee|branch|due`, `tasks-sort`, `tasks-group`
- **Kanban**:
  - Board: `tasks-kanban`, `tasks-kanban-column` (data-status), `tasks-kanban-count`
  - Cards: `task-card` (data-task-id, data-status, data-overdue), `task-card-open`, `task-card-assignees`, `task-card-status` (the keyboard alternative to dragging), `task-due` (data-overdue)
- **List**: `tasks-list`, `tasks-list-group` (data-group), `tasks-list-row` (data-task-id, data-status, data-overdue)
- **Calendar**:
  - `tasks-calendar` (data-month), `tasks-calendar-previous|next`, `tasks-calendar-title`
  - `tasks-calendar-day` (data-day), `tasks-calendar-item` (data-task-id, data-overdue)
  - On phones: `tasks-calendar-agenda`, `tasks-calendar-empty`, plus `tasks-calendar-undated`
- **Side panel**:
  - `task-panel` (data-task-id), `task-panel-detail` (data-status), `task-panel-not-found`
  - Fields: `task-panel-title`, `task-panel-description`, `task-panel-status`, `task-panel-due`, `task-panel-scope`, `task-panel-creator`, `task-panel-assignees`
  - Links: `task-panel-event-link`, `task-panel-meeting-link`, `task-panel-decision`
  - Reminders and actions: `task-panel-reminders`, `task-panel-mute-reminders`, `task-panel-edit`, `task-panel-delete`
  - Delete confirm: `task-delete-dialog`, `task-delete-confirm`, `task-delete-cancel`, `task-delete-error`
- **Form** (`task-form`):
  - Scope: `task-form-scope` (or `-scope-fixed`), `task-form-no-scopes`, `task-form-from-decision`
  - Fields: `task-form-title`, `task-form-description`, `task-form-status`, `task-form-priority`, `task-form-due-date`, `task-form-assignees` (PersonPicker: `-option` with data-user-id, `-checkbox`, `-search`, `-empty`), `task-form-event`
  - Reminders: `task-form-reminders`, `task-form-remind-before-1|2|3|7`, `task-form-remind-custom`, `task-form-repeat-kind`, `task-form-repeat-every`, `task-form-repeat-start`, `task-form-overdue-toggle`, `task-form-overdue-every`
  - Errors and buttons: `task-form-<field>-error`, `task-form-error`, `task-form-submit`, `task-form-cancel`
- **Badges**: `task-status-badge` (data-status), `task-priority-badge` (data-priority)
- **Dashboard**: `dashboard-my-tasks` (data-open, data-overdue), `dashboard-my-tasks-open`, `dashboard-my-tasks-overdue`, `dashboard-my-tasks-empty`, `dashboard-my-task-item` (data-task-id, data-due-soon, data-overdue), `dashboard-my-tasks-link`
- **Event page** (managers): `event-linked-tasks`, `event-linked-task` (data-task-id, data-status)
- **Task request form**: `request-type-card-task` (plus `-hint`), `task-request-form`, `-target` (with `-target-option`), `-title`, `-description`, `-priority`, `-due-date`, `-error`, `-submit`, `-cancel`
- **Requests lists**:
  - My requests: `work-requests-list`, `work-request-row` (data-request-id, data-kind, data-status), with `work-request-status`, `-decline-note`, `-withdraw`, `-withdraw-confirm`, `-open-task`, `-open-meeting`
  - To review: `work-review-list-open|decided`, `work-review-row` (data-request-id, data-kind, data-status), with `work-review-requester`, `-accept`, `-approve`, `-decline`, `-decline-note`, `-decline-confirm`, `-decline-cancel`, `-error`, `work-review-open-task`
- **Notifications and badges**:
  - Dashboard card: `dashboard-notifications`, `dashboard-notification` (data-notification-id, data-kind, data-unread), `dashboard-notifications-mark-all`, `dashboard-notifications-empty`
  - Nav badges (data-count): `nav-tasks-badge`, `nav-requests-badge`, `mobile-nav-tasks-badge`, `mobile-nav-requests-badge`
  - Profile: `profile-task-reminder-emails`

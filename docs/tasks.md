# Tasks

Tasks belong to a scope: a **branch**, a **region** or **national**. The database enforces every rule below through
RLS and SECURITY DEFINER RPCs (`supabase/migrations/20261125090300_tasks.sql`, v2 changes in
`20261126090200_tasks_v2.sql`). The screens only reflect those rules.
Followers have no access to tasks or task requests: they get no menu item, the routes redirect them, and RLS returns
nothing.

## Who can do what

| | Volunteer | Branch Manager | Regional Director | National Coordinator (MFA) |
|---|---|---|---|---|
| See | Every task of their branch, tasks they created or are assigned to | Same, plus region tasks of their region | Every task in their region (branch and region tasks) | National tasks; tasks they are assigned to |
| Create | Tasks in their branch (themselves when nobody is chosen) | Branch tasks in their branch | Region tasks, or branch tasks in their region | National tasks |
| Assign | Themselves and other volunteers of their branch. Never BMs, RDs or NCs (that stays a task request). | Volunteers and Branch Managers of their branch | Anyone in the region (members and the region's RDs) | Regional Directors, Branch Managers and National Coordinators. Never volunteers. |
| Edit everything | Tasks they created | Tasks of their branch | Tasks in their region | National tasks |
| Change status | Tasks assigned to them | Same, plus the tasks they edit | Same | Same |
| Archive (done tasks) | Tasks assigned to them, and tasks they edit | Same | Same | Same |
| Notes | Write on tasks assigned to them or that they edit; edit/delete their own notes | Same, plus tasks of their branch | Same, plus tasks in their region | Same, for national tasks |
| Delete (Recycle Bin) | Tasks they created | Tasks of their branch | Tasks in their region | National tasks |

- **Editors.** "Edit everything" means the task's creator and the managers of its scope (`can_edit_task`). Assignees
  who are not editors can change the status only (`set_task_status`).
- **Scope.** A task's scope never changes after creation.
- **Volunteers.** A task a volunteer creates is a self-task (`self_task`). With nobody chosen it is assigned to the
  volunteer; they may also choose other volunteers of their own branch (`list_task_people` offers exactly those). Anyone
  else is refused with "This person cannot be assigned".
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
| Linked event | Optional. Must be an event the user can see, in the same scope. Everyone who can see the event sees the linked tasks they may see on the event page (`get_event_tasks`). |
| Archived | Only done tasks. Set by assignees and editors; cleared automatically when the task leaves "done". Not a delete. |
| Source meeting decision | Optional. "Create task" on a decision sets `decision_id` and `meeting_id`. The task's scope is the meeting's scope. |

## The task form

- **Short by default.** Visible: title, assignees (a searchable combobox with chips, `PeopleCombobox`) and due date.
  Everything else is under **More options**, collapsed every time the form opens: description, priority (default
  medium), status, linked event, scope and reminders. Errors in the collapsed part open it.
- **Scope.** Defaults to the caller's own branch from `list_my_work_scopes` (otherwise the first option). It is fixed,
  and shown above the title, for a task from a meeting decision, from an event page, or when editing.
- **Volunteers** get themselves preselected on a new task.
- **From an event.** "Add task" on the event page (`event-add-task`) opens the form linked to that event, in the
  event's scope. It is shown to people who may create tasks in that scope.

## Views (`/tasks`)

- **Views.** Kanban (drag and drop changes the status; each card also has a status select for keyboard use), List
  (filters, sort, group by status, assignee or "Mine first") and Calendar (month view, tasks on their due date,
  overdue highlighted).
- **Status colours.** To do, In progress, Blocked and Done have their own tints on Kanban columns, cards and status
  badges, in light and dark mode, always next to the written label (`src/components/tasks/task-status-colors.ts`).
  Every text colour on a tint reaches 4.5:1 (checked by `src/test/task-status-colors.test.ts`).
- **Remembered choice.** The chosen view is stored per user in `localStorage` (`dsvh-tasks-view:<user id>`, wrapped in
  try/catch). Without storage the default is Kanban.
- **My tasks.** A "My tasks" filter chip shows only tasks assigned to you. It starts on for anyone with at least one
  (not archived) task assigned; someone with none, for example a manager who only hands tasks out, starts with every
  task. When all tasks are shown, yours carry an "Assigned to you" badge and an accent border, and come first in each
  Kanban column.
- **Archive.** Done tasks can be archived (panel button, or "Archive all done" in the Kanban Done column header, in
  the Done group of the list grouped by status, or in the list filter bar; it archives the shown done tasks you may
  change and reports how many). Archived tasks are hidden from Kanban, list and calendar. The "Archived" chip shows
  only archived tasks, each with "Unarchive".
- **Detail.** The task opens in a side panel: `/tasks?task=<id>`. Opening it marks its notices read (assignments,
  status changes, reminders, mentions and notes are all `task` notices).

## Notes

Every task has a notes thread in the side panel (oldest first; author, time, "edited", mentioned people).
- **Who writes.** Assignees, the creator and the scope's managers (`can_set_task_status`). Everyone who can see the
  task reads the notes. Authors edit and delete their own notes (deleting asks for confirmation). At most 500 notes per
  task and 4000 characters per note.
- **Mentions.** Typing "@" or the Mention button opens a picker of the people who can see the task
  (`list_task_mention_people`); chosen people show as chips and are sent with the note (at most 20). The database
  refuses anyone who cannot see the task. Mentioned people get `task_note_mention` (an edit notifies only newly added
  people).
- **Creator notice.** The creator gets `task_note_added` when an assignee writes a note (unless mentioned in it).
- **Cards** show the note count when there is at least one.
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

Reminders are **off** for every new task. Under "More options", "Remind me" turns them on (it needs a due date) and
only then shows the settings, starting from 3 days before. Only the creator and the scope's managers can set them. An
edit keeps the existing settings unless "Remind me" is turned off. The options can be combined:

| Option | Choices | Default when turned on |
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
| Someone is @mentioned in a note | The mentioned person | `task_note_mention` |
| An assignee writes a note | The creator (unless mentioned) | `task_note_added` |
| A task request is received | The target | `task_request_received` |
| A task request is accepted or declined | The requester | `task_request_accepted` / `task_request_declined` |

- **Storage.** Notices are stored per user with read/unread (`notifications`). Users read only their own.
- **Badges.** The Tasks badge counts unseen task notices (assignments, mentions, notes); opening the task marks its
  notices read.

## Recycle Bin

A deleted task goes to the Recycle Bin for 30 days, the same pattern as events.
- **Restore.** The managers of the task's scope can restore it.
- **Permanent deletion.** Tasks are deleted permanently after 30 days (`purge_expired_work_items`), or earlier with
  "Delete permanently".
- **Branches and regions.** A branch or region with tasks stays archived (`structure_in_use`).

## Test ids

All kebab-case, never derived from text. Lists expose `data-task-id` / `data-request-id` / `data-user-id`.

- **Page**:
  - Header and views: `tasks-new`, `tasks-view-kanban|list|calendar` (aria-pressed), `tasks-filter-mine` and `tasks-filter-archived` (aria-pressed), `tasks-empty` (with `tasks-empty-show-all`)
  - List filters: `tasks-filter-status|priority|assignee|branch|due`, `tasks-sort`, `tasks-group` (none, status, assignee, mine), `tasks-archive-done` (data-count)
- **Kanban**:
  - Board: `tasks-kanban`, `tasks-kanban-column` (data-status), `tasks-kanban-count`, `tasks-kanban-archive-done` (data-count, Done column)
  - Cards: `task-card` (data-task-id, data-status, data-overdue, data-mine, data-archived), `task-card-open`, `task-card-mine`, `task-card-notes` (data-count), `task-card-assignees`, `task-card-status` (the keyboard alternative to dragging), `task-card-unarchive`, `task-due` (data-overdue)
- **List**: `tasks-list`, `tasks-list-group` (data-group: a status, a user id, `mine` / `others`), `tasks-list-archive-done`, `tasks-list-row` (data-task-id, data-status, data-overdue, data-mine, data-archived), `tasks-list-row-mine`, `task-card-unarchive`
- **Calendar**:
  - `tasks-calendar` (data-month), `tasks-calendar-previous|next`, `tasks-calendar-title`
  - `tasks-calendar-day` (data-day), `tasks-calendar-item` (data-task-id, data-overdue)
  - On phones: `tasks-calendar-agenda`, `tasks-calendar-empty`, plus `tasks-calendar-undated`
- **Side panel**:
  - `task-panel` (data-task-id), `task-panel-detail` (data-status, data-archived), `task-panel-not-found`
  - Fields: `task-panel-title`, `task-panel-description`, `task-panel-status`, `task-panel-due`, `task-panel-scope`, `task-panel-creator`, `task-panel-assignees`
  - Links: `task-panel-event-link`, `task-panel-meeting-link`, `task-panel-decision`
  - Reminders and actions: `task-panel-reminders`, `task-panel-mute-reminders`, `task-panel-archive`, `task-panel-unarchive`, `task-panel-archived`, `task-panel-edit`, `task-panel-delete`
  - Notes: `task-notes` (data-count), `task-notes-empty`, `task-note` (data-note-id, data-mine), `task-note-author`, `task-note-edited`, `task-note-body`, `task-note-mentions`, `task-note-edit`, `task-note-delete`, `task-note-delete-dialog`, `task-note-delete-confirm`, `task-note-delete-cancel`
  - Note composer: `task-note-input`, `task-note-mention` (opens the picker), `task-note-mention-search`, `task-note-mention-option` (data-user-id), `task-note-mention-chip` (data-user-id) with `task-note-mention-chip-remove`, `task-note-submit`, `task-note-save`, `task-note-cancel`, `task-note-error`
  - Delete confirm: `task-delete-dialog`, `task-delete-confirm`, `task-delete-cancel`, `task-delete-error`
- **Form** (`task-form`):
  - Scope: `task-form-scope` (or `-scope-fixed`), `task-form-no-scopes`, `task-form-from-decision`, `task-form-from-event`
  - Visible fields: `task-form-title`, `task-form-due-date`, `task-form-assignees` (PeopleCombobox, data-count: `-open`, `-search`, `-option` with data-user-id and aria-selected, `-chip` with data-user-id, `-chip-remove`, `-empty`)
  - More options: `task-form-more` (aria-expanded), `task-form-more-section`, `task-form-description`, `task-form-status`, `task-form-priority`, `task-form-event`
  - Reminders: `task-form-reminders` (data-on), `task-form-reminders-toggle`, `task-form-reminders-need-due`, `task-form-remind-before-1|2|3|7`, `task-form-remind-custom`, `task-form-repeat-kind`, `task-form-repeat-every`, `task-form-repeat-start`, `task-form-overdue-toggle`, `task-form-overdue-every`
  - Errors and buttons: `task-form-<field>-error`, `task-form-error`, `task-form-submit`, `task-form-cancel`
- **Badges**: `task-status-badge` (data-status), `task-priority-badge` (data-priority)
- **Dashboard**: `dashboard-my-tasks` (data-open, data-overdue), `dashboard-my-tasks-open`, `dashboard-my-tasks-overdue`, `dashboard-my-tasks-empty`, `dashboard-my-task-item` (data-task-id, data-due-soon, data-overdue), `dashboard-my-tasks-link`
- **Event page** (everyone who can see the event): `event-linked-tasks`, `event-linked-task` (data-task-id, data-status, data-archived), `event-linked-tasks-empty`, `event-add-task`
- **Task request form**: `request-type-card-task` (plus `-hint`), `task-request-form`, `-target` (with `-target-option`), `-title`, `-description`, `-priority`, `-due-date`, `-error`, `-submit`, `-cancel`
- **Requests lists**:
  - My requests: `work-requests-list`, `work-request-row` (data-request-id, data-kind, data-status), with `work-request-status`, `-decline-note`, `-withdraw`, `-withdraw-confirm`, `-open-task`, `-open-meeting`
  - To review: `work-review-list-open|decided`, `work-review-row` (data-request-id, data-kind, data-status), with `work-review-requester`, `-accept`, `-approve`, `-decline`, `-decline-note`, `-decline-confirm`, `-decline-cancel`, `-error`, `work-review-open-task`
- **Notifications and badges**:
  - Dashboard card: `dashboard-notifications`, `dashboard-notification` (data-notification-id, data-kind, data-unread), `dashboard-notifications-mark-all`, `dashboard-notifications-empty`
  - Nav badges (data-count): `nav-tasks-badge`, `nav-requests-badge`, `mobile-nav-tasks-badge`, `mobile-nav-requests-badge`
  - Profile: `profile-task-reminder-emails`

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
- **Trustees** (`docs/roles.md#trustees`). They see what a volunteer of the branch sees but create and edit nothing.
  On tasks assigned to them they change the status only (no archive: `can_archive` is false). They write notes on
  every task of their branch they can read, assigned to them or not (`can_add_task_note`, task flag `can_add_note`;
  `20261211090000_trustee_task_notes.sql`), and edit/delete only their own notes. Only the
  branch's Branch Manager assigns them (`list_task_people` offers them only to that BM); Regional Directors and
  volunteers cannot. "@all" groups never include them (`task_group_people`, `task_group_member_ok`,
  `task_group_add_member`). New task and Add task are hidden for them.
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
| Linked event | Optional. Must be an event the user can see, in the same scope. Everyone who can see the event sees the linked tasks they may see on the event page (`get_event_tasks`). A meeting's calendar entry also lists the tasks created from that meeting's decisions (`tasks.meeting_id`, read through RLS in `getEventTasks`), each task once. |
| Archived | Only done tasks. Set by assignees and editors; cleared automatically when the task leaves "done". Not a delete. |
| Source meeting decision | Optional. "Create task" on a decision sets `decision_id` and `meeting_id`. The task's scope is the meeting's scope. |

## The task form

- **Short by default.** Visible: title, assignees (a searchable combobox with chips, `PeopleCombobox`) and due date.
  Everything else is under **More options**, collapsed every time the form opens: description, priority (default
  medium), status, linked event, scope and reminders. Errors in the collapsed part open it.
- **Scope.** Defaults to the caller's own branch from `list_my_work_scopes` (otherwise the first option). It is fixed,
  and shown above the title, for a task from a meeting decision, from an event page, or when editing.
- **Single scope.** When `list_my_work_scopes` returns exactly one scope (volunteers, Branch Managers, National
  Coordinators), the form has no scope field and uses that scope; an edited task shows no scope line (a task from an
  event or a decision still says where it goes). The detection is shared with meetings:
  `useWorkScopes()` in `src/components/work/use-work-scopes.ts` returns `{ scopes, single, loading }`.
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
- **Default view: every task.** `/tasks` shows every task you can see. The "My tasks" chip narrows the list to tasks
  assigned to you; it starts **off** on every visit.
- **Compact rows.** Kanban cards, list rows and calendar items are compact: the title on one line, then (cards) one
  small line with the link icons (meeting, event), high/urgent priority, the due date, notes, the assignees' initials
  (at most two, then "+N"; names in the tooltip and for screen readers) and the status pill. On Kanban the pill is a
  small select in the status colours (the keyboard alternative to dragging). Low and medium priority are not shown on
  rows (the panel and the priority filter still have them).
- **Mine and others.** Your own tasks (assigned to you) stand out in every view: an accent left border, a light
  primary tint over the status tint, a bold title and a filled "Mine" marker (an icon-only marker with screen-reader
  text in the calendar, where your tasks also come first on each day). They come first in each Kanban column. Other people's tasks are quieter: muted title text and no shadow, back to full
  strength on hover and keyboard focus (`focus-within`). No opacity is used, because at 0.75 the muted and red text
  fell below 4.5:1; `src/test/task-status-colors.test.ts` checks the muted text and every text colour on the mine tint
  (`TASK_MINE`, `TASK_OTHER`, `TASK_OTHER_TEXT` in `task-status-colors.ts`).
- **Scope labels.** Cards, list rows, calendar items (screen-reader text and tooltip) and the panel show the scope
  (branch, region or national) only to someone with more than one scope (Regional Directors). With one scope every
  task comes from there, so the labels are hidden.
- **Branch and region filters (RD, NC).** Shown only to someone with more than one scope, above every view (Kanban,
  list and calendar). Branch is a multi-select of the branches (from the visible tasks and the work scopes) plus
  "Region-wide" (region-scope tasks); National Coordinators also get Region (regions plus "National" for national
  tasks), and the branch options narrow to the chosen regions. Nothing chosen means all; a task must match both. The
  choice is stored per user in `localStorage` (`dsvh-tasks-filters:<user id>`, try/catch; a remembered value that is no
  longer offered stops filtering). "My tasks" shows every task assigned to you in any branch, region or scope: while
  it is on, both filters are ignored, shown disabled with a short hint, and come back when it is turned off
  (`matchesScopeFilter`, `scopeFilterOptions` in `src/lib/tasks.ts`). Branch Managers and volunteers see no such filter.
- **Archive.** Done tasks can be archived (panel button, or "Archive all done" in the Kanban Done column header, in
  the Done group of the list grouped by status, or in the list filter bar; it archives the shown done tasks you may
  change and reports how many). Archived tasks are hidden from Kanban, list and calendar. The "Archived" chip shows
  only archived tasks, each with "Unarchive".
- **Detail.** The task opens in a side panel: `/tasks?task=<id>`. Opening it marks its notices read (assignments,
  status changes, reminders, mentions and notes are all `task` notices).

## Task groups ("@all")

Schema and RPCs: `supabase/migrations/20261205090000_task_groups.sql`.
- **Creating.** In the task form a branch's managers (its Branch Manager, the region's Regional Director) can tick
  "@all: every member of the branch" (`task-form-all-members`, new branch tasks only, also from a meeting decision).
  `create_task_group` creates one `task_groups` row (title, description, priority, due date, branch, creator, event /
  meeting decision link) and one ordinary task per active member of the branch at save time (volunteers and Branch
  Managers of the branch: `is_branch_member` + `task_assignee_ok`), each with `tasks.group_id`. Every member gets the
  normal `task_assigned` notice (never the creator for their own task).
- **Members.** Each member owns their task (status, notes, done, archive, own reminders) and sees only that task in
  their views and My tasks.
- **Everyone else** who can see branch tasks sees ONE row per group: Kanban (by the derived status, not draggable),
  list (with a toggle that lists each member's task and status), calendar, the meeting decision and the event's
  Linked tasks. The row shows the title, "All members (N)", a progress bar (done of all) and the counts per status.
- **Derived status.** Never stored (`task_group_status`): all done → Done; any In progress or Done → In progress;
  otherwise To do (blocked members count as To do; the counts show them).
- **Group panel** (`/tasks?group=<id>`): details, progress and members (each opens its task). Editors (the creator and
  the branch's managers, `can_edit_task_group`) edit title, description, priority and due date (written to every
  member task in the same transaction), add members (their own task and notice) or remove them (their task goes to the
  Recycle Bin; a group keeps at least one member), and delete the group after confirming (every member task goes to
  the Recycle Bin, then the group row is removed; `tasks.group_id` is ON DELETE SET NULL, so a restored task comes back
  as an ordinary task).
- **Visibility.** `task_groups` has RLS with the branch-task rule (`can_view_task_group`); writes only through the
  SECURITY DEFINER RPCs, each starting with `require_privacy_accepted()`.
- **Test ids**: `task-form-all-members` (`-hint`), `task-group-card` (data-group-id, data-status) with
  `task-group-card-open`, `task-group-row` (data-group-id) with `task-group-row-toggle` (aria-expanded) and
  `task-group-row-open`, `tasks-calendar-item` (data-group-id), `task-group-members-label` (data-count),
  `task-group-progress` (data-done, data-total), `task-group-counts`, `task-group-members`, `task-group-member`
  (data-task-id, data-user-id, data-status) with `task-group-member-open` and `task-group-member-remove`; panel
  `task-group-panel` (data-group-id), `task-group-panel-detail`, `-title`, `-description`, `-due`, `-edit`, `-delete`,
  `-meeting-link`, `-not-found`; `task-group-add` with `task-group-add-people` (PeopleCombobox) and
  `task-group-add-submit`; `task-group-remove-dialog` (`-confirm`, `-cancel`); `task-group-form` (`-title`,
  `-description`, `-due-date`, `-priority`, `-submit`, `-cancel`, `-error`); `task-group-delete-dialog` (`-confirm`,
  `-cancel`, `-error`); meeting decision `meeting-decision-group` (`-toggle`, `-edit`, `-delete`); event page
  `event-linked-group` (`-toggle`).

## Notes

Every task has a notes thread in the side panel (oldest first; author, time, "edited", mentioned people). In the note
box Enter saves the note and Shift+Enter adds a new line (Enter is ignored while an input method is composing text).
- **Who writes.** Assignees, the creator and the scope's managers, plus trustees on every readable task of their branch
  (`can_add_task_note`; the panel shows the note box when the task's `can_add_note` flag is true). Everyone who can see the
  task reads the notes. Authors edit and delete their own notes (deleting asks for confirmation). At most 500 notes per
  task and 4000 characters per note.
- **Mentions.** Typing "@" or the Mention button opens a picker of the people who can see the task
  (`list_task_mention_people`); chosen people show as chips and are sent with the note (at most 20). The database
  refuses anyone who cannot see the task. Mentioned people get `task_note_mention` (an edit notifies only newly added
  people).
- **Creator notice.** The creator gets `task_note_added` when an assignee or a trustee writes a note (unless mentioned in
  it or an assignee).
  When a trustee writes a note on a task with no active creator (account deleted or no longer active), the branch's
  Branch Managers get it instead (`20261211090100_trustee_note_creator_fallback.sql`; never the author, nobody twice).
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

- **Assignees.** They see the task's reminder settings read only. "Mute this task's reminders for me" silences only
  the task's reminders for them.
- **My reminders.** Any assignee (volunteers included) can add their own reminders in the side panel, with the same
  options as the form (days before, repeat, overdue). They apply only to that assignee, next to the task's reminders,
  are not silenced by the mute switch, and nobody else sees them (`task_assignees.my_reminders`, set through
  `set_my_task_reminders`, which refuses anyone not assigned; null clears them). Off by default ("Add a reminder"), and
  they need a due date.
- **When reminders stop.** When the task is done or deleted, when the person is no longer an assignee, or when they
  could no longer be assigned there (for example, they moved branch).
- **Scheduler.** `run_task_reminders()` runs at 09:00 Europe/London (pg_cron at 08:05 and 09:05 UTC when available,
  otherwise the "Task reminders" GitHub workflow calls `/api/public/task-reminders` with `SCHEDULED_JOBS_SECRET`). The
  reminder emails are sent by the minute outbox tick (`/api/public/outbox-flush`, `docs/email.md`).
  - It is idempotent: `task_reminder_log` allows one reminder per task, person and London day.
  - Before 09:00 London time it does nothing.
- **What a reminder creates.**
  - An in-app notice (`task_reminder`).
  - An `email_outbox` row (template `task_reminder`, payload with the title, due date and link, status `pending`),
    unless the person turned off "Email reminders for tasks" in Profile. The email sender (Brevo, see `docs/email.md`)
    sends it in the same scheduled run, as a reminder (priority 2) within the daily email limit.

## Notifications

Who gets which notice, the settings (in-app and email switches, email timing), grouping and the "Waiting for you" card:
see [notifications.md](notifications.md). For tasks in short:

| Event | Who is notified | Notice |
|---|---|---|
| A task is created with assignees, or an assignee is added | Each new assignee, never someone who assigned themselves | `task_assigned` (always on) |
| A task moves to Blocked or Done (by someone else) | The creator | `task_status_changed` |
| Someone is @mentioned in a note | The mentioned person | `task_note_mention` (always on) |
| An assignee or a trustee writes a note | The creator (unless mentioned); for a trustee's note on a task with no active creator, the branch's Branch Managers | `task_note_added` |
| A reminder is due (reminders turned on) | The assignee | `task_reminder` |
| A task request waits for review | The target, in one grouped notice | `review_waiting` (always on) |
| A task request is accepted or declined | The requester | `task_request_accepted` / `task_request_declined` |

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
  - Branch/region filters (RD, NC; every view): `tasks-filter-branches` (opener, data-count; data-disabled and
    aria-disabled while My tasks is on) with `tasks-filter-branches-option` (data-value = branch id or `region-wide`,
    aria-checked) and `tasks-filter-branches-all`; `tasks-filter-regions` (NC) with `tasks-filter-regions-option`
    (data-value = region id or `national`) and `tasks-filter-regions-all`; `tasks-filter-scope-hint` (My tasks on)
  - List filters: `tasks-filter-status|priority|assignee|due`, `tasks-sort`, `tasks-group` (none, status, assignee, mine), `tasks-archive-done` (data-count)
- **Kanban**:
  - Board: `tasks-kanban`, `tasks-kanban-column` (data-status), `tasks-kanban-count`, `tasks-kanban-archive-done` (data-count, Done column)
  - Cards: `task-card` (data-task-id, data-status, data-overdue, data-mine, data-archived), `task-card-open`, `task-card-mine`, `task-card-scope` (data-scope; more than one scope only), `task-card-notes` (data-count), `task-card-assignees` (data-count), `task-card-status` (the status pill select, the keyboard alternative to dragging), `task-card-unarchive`, `task-due` (data-overdue), `task-link-meeting`, `task-link-event`
- **List**: `tasks-list`, `tasks-list-group` (data-group: a status, a user id, `mine` / `others`), `tasks-list-archive-done`, `tasks-list-row` (data-task-id, data-status, data-overdue, data-mine, data-archived), `tasks-list-row-mine`, `tasks-list-row-assignees` (data-count), `tasks-list-row-scope` (data-scope; more than one scope only), `task-card-unarchive`
- **Calendar**:
  - `tasks-calendar` (data-month), `tasks-calendar-previous|next`, `tasks-calendar-title`
  - `tasks-calendar-day` (data-day), `tasks-calendar-item` (data-task-id, data-overdue, data-mine), `tasks-calendar-item-mine`, `tasks-calendar-item-scope` (screen-reader text; more than one scope only)
  - On phones: `tasks-calendar-agenda`, `tasks-calendar-empty`, plus `tasks-calendar-undated`
- **Side panel**:
  - `task-panel` (data-task-id), `task-panel-detail` (data-status, data-archived), `task-panel-not-found`
  - Fields: `task-panel-title`, `task-panel-description`, `task-panel-status`, `task-panel-due`, `task-panel-scope` (more than one scope only), `task-panel-creator`, `task-panel-assignees`
  - Links: `task-panel-event-link`, `task-panel-meeting-link`, `task-panel-decision`
  - My reminders: `task-panel-my-reminders` (data-on), `task-panel-my-reminders-add`, `-need-due`, `-summary`, `-edit`, `-form` (with the form's option ids under this prefix: `task-panel-my-reminders-remind-before-1|2|3|7`, `-remind-custom`, `-repeat-kind`, `-repeat-every`, `-repeat-start`, `-overdue-toggle`, `-overdue-every`, `-<field>-error`), `-save`, `-cancel`, `-remove`, `-error`
  - Reminders and actions: `task-panel-reminders`, `task-panel-mute-reminders`, `task-panel-archive`, `task-panel-unarchive`, `task-panel-archived`, `task-panel-edit`, `task-panel-delete`
  - Notes: `task-notes` (data-count), `task-notes-empty`, `task-note` (data-note-id, data-mine), `task-note-author`, `task-note-edited`, `task-note-body`, `task-note-mentions`, `task-note-edit`, `task-note-delete`, `task-note-delete-dialog`, `task-note-delete-confirm`, `task-note-delete-cancel`
  - Note composer: `task-note-input`, `task-note-mention` (opens the picker), `task-note-mention-search`, `task-note-mention-option` (data-user-id), `task-note-mention-chip` (data-user-id) with `task-note-mention-chip-remove`, `task-note-submit`, `task-note-save`, `task-note-cancel`, `task-note-error`
  - Delete confirm: `task-delete-dialog`, `task-delete-confirm`, `task-delete-cancel`, `task-delete-error`
- **Form** (`task-form`):
  - Scope: `task-form-scope` (or `-scope-fixed`; neither for a single-scope user, except `-scope-fixed` for a task from an event or a decision), `task-form-no-scopes`, `task-form-from-decision`, `task-form-from-event`
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

## Profile: change password (and the logo link)

Not task-specific, but documented here with the other Profile sections.

- **Change password** (`src/components/app/ChangePassword.tsx`, `src/lib/change-password.ts`): a collapsed section
  with the current, new and confirm fields (show/hide toggles), the sign-up strength rule (at least 8 characters; Supabase
  Auth checks again) and "Sign out of other devices" (on by default).
  - The current password is checked by signing in with it on a separate, throwaway Supabase client (no storage), so
    the app's own session is never replaced.
  - People without an authenticator: the new password is set on that fresh session (this also satisfies Supabase's
    "Secure password change", which needs a sign-in within the last 24 hours). National Coordinators: it is set on
    their own aal2 (MFA) session; an aal1 session cannot change it.
  - The throwaway session is always signed out; with the option on, `signOut({ scope: "others" })` ends every other
    session. Passwords are never logged or shown; e2e types them only into fields whose test id contains `password`.
  - Test ids: `profile-password`, `profile-password-toggle` (aria-expanded), `profile-password-current`,
    `profile-password-new`, `profile-password-confirm` (each with `-error`), `profile-password-sign-out-others`,
    `profile-password-submit`, `profile-password-cancel`, `profile-password-error`.
- **Logo link** (`src/components/app/LogoLink.tsx`): the logo and title in the sidebar, the mobile header, the public
  pages and the privacy page link home: `/dashboard` when signed in, `/` when signed out; accessible name "Go to home".
  Test id `logo-home-link` (`data-target`).

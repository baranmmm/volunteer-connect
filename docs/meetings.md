# Meetings

Meetings belong to a scope: a **branch**, a **region** or **national**. The database enforces every rule below through
RLS and SECURITY DEFINER RPCs (`supabase/migrations/20261125090200_meetings.sql`, then
`20261126090000_meeting_calendar_link.sql` and `20261126090100_recurring_meetings.sql`). The screens only reflect those
rules. Followers have no access to meetings or meeting requests.

## One calendar

Every meeting is also a calendar entry: `meetings.event_id` links it to an event with the category `meeting`.
- The entry is members-only, has no registration, capacity or waitlist, and is visible to exactly the people who can
  see the meeting. It never appears in `get_public_events`, `get_public_event` or the ICS feed, and upcoming-event
  counts leave it out.
- Title, description, start/end, place and cancellation are mirrored both ways by triggers in the same transaction.
- Deleting and restoring go through the meeting: its entry disappears and comes back with it. Deleting the entry
  directly is refused.
- The meeting page links to its entry ("Open in calendar", `/events/<event_id>`).

## Visibility

Only these people can see a meeting:
- the **creator**;
- the **invitees**;
- the **managers of its scope**:
  - branch meeting: the branch's Branch Manager and the region's Regional Director;
  - region meeting: the Regional Director;
  - national meeting: National Coordinators.

Everyone else gets nothing. This applies to:
- the `meetings` rows and the agenda, decision, invitee and file rows;
- the RPCs, counts and files;
- dashboard cards.

Meetings never appear on the public `/events` pages or the ICS feed.

## Who can do what

| | Volunteer | Branch Manager | Regional Director | National Coordinator (MFA) |
|---|---|---|---|---|
| Create | In their branch | In their branch | In their region, or a branch in it | National |
| Invite | People of their branch and the region's RD | Same | People in the region | Regional Directors, Branch Managers and National Coordinators. Never volunteers. |
| Edit (details, invitees, agenda, decisions, files, status) | Meetings they created | Meetings they created, or of their branch | Meetings they created, or in their region | Meetings they created, or national |
| Read only | Meetings they are invited to | Same | Same | Same |

## Fields

| Field | Rule |
|---|---|
| Title | Required, at most 200 characters |
| Description | At most 5000 characters |
| Start and end | Required. The end is after the start, and at most 7 days later. Entered in London time. |
| Place | In person (location required) or online. An online link must start with `https://`. |
| Status | `scheduled`, `completed` or `cancelled` |
| Invitees | At most 100 |

**Agenda.** Ordered items, each with a title and notes. Each item has decisions (text). The creator and the scope's
managers edit them; invitees read only. Editors can mark an item **resolved**; items copied from a series template are
**standing** (badge "Standing").

On the meeting page each agenda item is a toggle row (Notion-style), collapsed by default:
- The row shows a chevron, the number and title, small counts ("2 decisions, 3 tasks", plural forms in both languages;
  nothing when both are zero) and the Standing / Resolved badges.
- Click, Enter or Space expands it: notes, the resolved checkbox, reorder/edit/delete (editors), the decisions and the
  tasks created from them with their status badges. The toggle is a button with `aria-expanded` and `aria-controls`.
- "Expand all / Collapse all" opens or closes every item. A just-added item opens expanded, ready for its decisions.

**Decision editor.** Enter saves the decision and Shift+Enter adds a new line (Enter is ignored while an input
method is composing text, so IME users can confirm characters).

**Decision to task.** "Create task" on a decision opens the task form prefilled:
- the title comes from the decision;
- the scope is the meeting's scope;
- the meeting and the decision are linked.

The decision then shows the linked task and its status, and the task links back to the meeting.
- **Side panel.** Clicking a task under a decision (and in "From last meeting" and the series tasks) opens it in the
  task side panel on the meeting page, with every detail and action (`/meetings/<id>?task=<task id>`, so a refresh
  keeps it open). Closing the panel reads the meeting again.
- **Edit and Delete.** Each task row under a decision has Edit (the task form) and Delete (asks first; the task goes
  to the Recycle Bin) icon buttons, shown when the caller may edit that task (`can_edit` from `get_task`; the
  database checks again in `update_task` / `delete_task`).
- **On the calendar entry.** The meeting's calendar entry (`/events/<event_id>`) lists these tasks under "Linked
  tasks", next to the tasks linked to the event itself. There the scope, branch and region are under a collapsed
  "Details" toggle.

**Files.** Files go in the private bucket `meeting-files`, which the migration creates only when it is missing.
- Limits: 25 MB per file, at most 20 per meeting. Types: PDF, JPEG/PNG/WebP, DOCX, PPTX, XLSX.
- The original name is stored.
- Upload: a slot is reserved first (`add_meeting_file`), then the browser uploads to that path. Storage policies only
  accept reserved paths of meetings the user may edit.
- Download: signed URLs valid for 5 minutes, only for people who can see the meeting.
- Removal: the Storage object first, then the row (`delete_meeting_file`).

## The meeting form

Visible: title, start and end (the end follows start + 1 hour until it is changed), in person or online with the
place or link, and invitees. In person is the default, so a meeting saves with title, date, time and location. Times
are London time.

- **Scope.** The "Where" field shows only when the user can create in more than one scope (`useWorkScopes().single`
  from `list_my_work_scopes`). With one scope (for example a volunteer or a Branch Manager) it is used automatically.
- **Invitees.** A collapsible section, collapsed every time the form opens. Its header shows the count and the first
  three names ("Invitees (8): Ali, Ayse, John +5"); inside is the searchable people picker with chips.

"More options" is collapsed every time the form opens. It holds the description and, when creating:
- **Agenda**: titles added one by one, sent as `agenda` (standing items for a recurring meeting).
- **Files**: picked before saving and uploaded with the usual reserve-then-upload flow once the meeting exists (to the
  first occurrence of a series). Rejected files are listed one by one; the meeting is still created.
- **Repeat**: does not repeat, weekly or monthly; every 1-4 weeks/months; 2-52 meetings, the last at most 12 months
  after the first. Sent as `recurrence`.

**Carry over** (create only; `meeting-form-carry`, shown when there is something to carry, collapsed): the unresolved,
not yet carried agenda items of the last 10 earlier meetings in the same place that the caller may edit
(`list_meeting_carry_over`), with their decisions and the decisions' not-done tasks. Ticking an item ticks all its
decisions and tasks; each can be unticked (an "@all" group is one entry). After the meeting is created,
`carry_over_agenda` copies the chosen items (title, notes) and decisions into it and moves the chosen tasks to the new
decisions (same task ids, nothing duplicated; a group moves whole), in one transaction; the old item gets `carried_to`
and is no longer offered or shown under "From last meeting". If the carry-over is refused, the meeting stays and an
error toast says why. Test ids: `-carry` (data-count), `-carry-toggle` (aria-expanded), `-carry-meeting`
(data-meeting-id), `-carry-item` (data-item-id), `-carry-decision` (data-decision-id), `-carry-task` (data-task-id or
data-group-id).

Approving a meeting request uses the same form without the people picker and the create-only options.

## Recurring meetings

`create_meeting` with `recurrence` creates every occurrence at once (`meeting_series`). Each occurrence is an ordinary
meeting with its own calendar entry, agenda, decisions, notes and files. London wall-clock time is kept across clock
changes. Invitees are copied to every occurrence and told once (about the first one).

- **Who.** The same rights as single meetings: whoever may create a meeting in a scope may create a recurring one.
- **Edit.** Editing an occurrence asks: this meeting, this and following, or all (`update_meeting_series`). A time
  change moves every chosen occurrence by the same amount. Only the edited occurrence's invitees are notified.
- **Cancel and delete.** Both ask the same question. Delete uses `delete_meeting_series` (each occurrence goes to the
  Recycle Bin). Cancel sets each chosen occurrence that is still scheduled to cancelled (each notifies its invitees).
  Rescheduling a cancelled occurrence changes that occurrence only.
- **Standing agenda items.** The series template (`set_meeting_series_agenda`, editors). New items are added to the
  upcoming occurrences that do not have them yet.
- **From last meeting.** On an occurrence with an earlier one, `get_meeting` returns `from_last`: the previous
  occurrence's unresolved agenda items and its open (not done) tasks, read live. Resolving the item or finishing the
  task removes it.
- **Series tasks.** `get_meeting_series_tasks` lists every task created from a decision in any occurrence (only tasks
  the caller can see), with a status filter on the page (open by default).
- The page shows "Meeting n of N" with links to the previous and next occurrence; list cards show a repeat icon.

## Pages

- `/meetings` is one timeline, oldest at the top: older past meetings behind "Show earlier meetings (N)", the two
  most recent past meetings (faded: dashed border and muted background, no opacity), the next three upcoming meetings
  (prominent, under "Coming up"), then the later upcoming ones behind "Show more upcoming (N)"
  (`meetingTimeline` in `src/lib/meetings.ts`). The old `?tab=past` link opens the same page.
- `/meetings/<id>` shows, in order: details (with "Open in calendar" and, for a series, its position and links), the
  editor actions, "From last meeting", the agenda with decisions, invitees, files, and for a series the series tasks
  and (editors) the standing agenda items.
- The dashboard card "Upcoming meetings" shows the next 3 meetings the user can see.
- **Single scope.** Users with one possible scope see no scope/branch label on meeting cards or the meeting page
  (every meeting they see comes from that place). The same applies to the branch name in a volunteer's event request
  form; region requests and reviewers still see where a request goes.
- **Invitees** on the meeting page are a collapsible section, collapsed by default, with the same header as the form
  ("Invitees (8): Ali, Ayse, John +5"); expanding it lists the invitees.

## Meeting requests

A lower role asks a higher role in their chain to hold a meeting. The chain is the same as for task requests:
- volunteer → their Branch Manager or Regional Director;
- Branch Manager → their Regional Director;
- Regional Director → a National Coordinator.

A request has a topic, up to 3 proposed times and a note. The target either:
- **approves**: the meeting form opens prefilled and editable before saving, and creates a scheduled meeting owned by
  the target with the requester invited. The scope is the requester's branch, or national for a Regional Director's
  request.
- **declines** with a note of at least 10 characters, which the requester sees.

## Notifications

Settings, the daily summary, grouping and the "Waiting for you" card: see [notifications.md](notifications.md).
For meetings in short:

| Event | Who is notified | Notice |
|---|---|---|
| Invited (on create or when added; once for a recurring meeting) | The invitee | `meeting_invited` |
| Time or place changed | Every invitee | `meeting_changed` |
| Cancelled | Every invitee | `meeting_cancelled` |
| Meeting request waits for review | The target, in one grouped notice | `review_waiting` (always on) |
| Meeting request approved or declined | The requester | `meeting_request_approved` / `meeting_request_declined` |

Meeting notices (type `meeting`) can be turned off in the app; invitations are emailed at once, changes and cancellations
come in the daily summary email (email switch in Profile > Notifications). Opening the meeting marks its
notices read.

## Recycle Bin

A deleted meeting goes to the Recycle Bin for 30 days.
- **Restore.** The managers of its scope can restore it.
- **Files while deleted.** The files stay in Storage, but nobody can read them while the meeting is deleted.
- **Permanent deletion.** It removes the stored files first, then the row: the server calls `purge_meeting` with the
  service role, from "Delete permanently" or from the nightly cleanup.
- **Branches and regions.** A branch or region with meetings stays archived.

## Test ids

All kebab-case, never derived from text. Lists expose `data-meeting-id`, `data-item-id`, `data-decision-id`,
`data-file-id` and `data-user-id`.

- **List** (`/meetings`):
  - Header: `meetings-new`
  - Timeline: `meetings-timeline`, `meetings-list`, `meetings-show-earlier` / `meetings-show-later` (aria-expanded, data-count), `meetings-earlier`, `meetings-recent`, `meetings-next` (with `meetings-empty-upcoming`), `meetings-later`; `meetings-empty` (no meetings at all), `meetings-retry`
  - Cards: `meeting-card` (data-meeting-id, data-status), with `meeting-card-title`, `meeting-card-status`, `meeting-card-invited`, `meeting-card-scope` (only with more than one scope), `meeting-card-recurring`
- **Detail**:
  - Page: `meeting-detail` (data-meeting-id, data-status), `meeting-not-found`, `meeting-back`
  - Facts: `meeting-title`, `meeting-status`, `meeting-invited`, `meeting-when`, `meeting-online-link`, `meeting-location`, `meeting-scope` (only with more than one scope), `meeting-creator`, `meeting-description`, `meeting-open-calendar`
  - Series: `meeting-series-info` (data-position, data-count), `meeting-series-previous`, `meeting-series-next`
  - From last meeting: `meeting-from-last` (data-meeting-id), `meeting-from-last-item` (data-item-id), `meeting-from-last-task` (data-task-id, data-status), `meeting-from-last-link`, `meeting-from-last-empty`
  - Series panel: `meeting-series` (data-series-id), `meeting-series-tasks` (data-filter), `meeting-series-tasks-filter`, `meeting-series-task` (data-task-id, data-status, data-meeting-id), `meeting-series-tasks-empty`; editors: `meeting-series-agenda`, `meeting-series-agenda-input` (one item per line), `meeting-series-agenda-save`, `meeting-series-agenda-error`
  - Scope dialog (series edit, cancel, delete): `meeting-scope-dialog`, `meeting-scope-this|following|all` (radios), `meeting-scope-confirm`, `meeting-scope-dismiss`, `meeting-scope-error`
  - Invitees: `meeting-invitees`, `meeting-invitees-toggle` (aria-expanded, data-count; collapsed by default), then `meeting-invitee` (data-user-id) or `meeting-invitees-empty` inside
  - Editors: `meeting-edit`, `meeting-complete`, `meeting-cancel`, `meeting-reschedule`, `meeting-reopen`, `meeting-delete`
  - Confirm dialog: `meeting-confirm-dialog`, `meeting-cancel-confirm`, `meeting-delete-confirm`, `meeting-confirm-dismiss`, `meeting-confirm-error`
- **Agenda**:
  - `meeting-agenda`, `meeting-agenda-empty`, `meeting-agenda-expand-all` (aria-pressed)
  - Row (always visible): `meeting-agenda-item` (data-item-id, data-resolved, data-standing, data-expanded), `meeting-agenda-item-toggle` (aria-expanded, aria-controls), `meeting-agenda-item-title`, `meeting-agenda-item-counts` (data-decisions, data-tasks), `meeting-agenda-standing`, `meeting-agenda-resolved-badge` (read only)
  - Body (`meeting-agenda-item-body`, rendered only when expanded; tests expand first): `meeting-agenda-item-notes`, the resolved checkbox (editors) `meeting-agenda-resolved`, the editing buttons below and the decisions
  - Editing: `meeting-agenda-add`, `meeting-agenda-form`, `meeting-agenda-title`, `meeting-agenda-notes`, `meeting-agenda-save`, `meeting-agenda-cancel`, `meeting-agenda-edit`, `meeting-agenda-up`, `meeting-agenda-down`
  - Delete: `meeting-agenda-delete`, then `meeting-agenda-delete-dialog`, `-confirm`, `-cancel`
- **Decisions**:
  - `meeting-decision` (data-decision-id), `meeting-decision-text-value`, `meeting-decisions-empty`
  - Editing: `meeting-decision-add`, `meeting-decision-form`, `meeting-decision-text`, `meeting-decision-save`, `meeting-decision-cancel`, `meeting-decision-edit`, `meeting-decision-delete`
  - Tasks: `meeting-decision-task-row` with `meeting-decision-task` (data-task-id, data-status; opens the side panel), `meeting-decision-task-edit`, `meeting-decision-task-delete`, then `meeting-decision-task-delete-dialog` with `-confirm` / `-cancel`; `meeting-decision-create-task`
  - Side panel on the meeting page: `task-panel` (see docs/tasks.md)
  - Calendar entry: `event-meeting-details` with `event-meeting-details-toggle` (aria-expanded, collapsed by default)
- **Files**: `meeting-files`, `meeting-files-empty`, `meeting-file-upload`, `meeting-file-input`, `meeting-file` (data-file-id), `meeting-file-name`, `meeting-file-download`, `meeting-file-delete`, `meeting-file-errors`
- **Form** (prefix `meeting-form`, or `work-review-meeting` when approving a request, or `meeting-reschedule-form`):
  - Shell and scope: `-dialog`, `-scope` (or `-scope-fixed`); neither is shown when the user has one scope
  - Fields: `-title`, `-description`, `-start-date`, `-start-time`, `-end-date`, `-end-time`
  - Place: `-place-in-person`, `-place-online`, `-location`, `-online-url`
  - Invitees: `-invitees-toggle` (aria-expanded, data-count; collapsed on open), then inside `-invitees` (PeopleCombobox, data-count) with `-invitees-open`, `-invitees-search`, `-invitees-option` (data-user-id), `-invitees-chip` (data-user-id), `-invitees-chip-remove`, `-invitees-empty`
  - More options: `-more` (data-state), `-more-content`; agenda `-agenda` (data-count), `-agenda-input`, `-agenda-add`, `-agenda-item`, `-agenda-remove`; files `-files` (data-count), `-files-input`, `-files-pick`, `-file`, `-file-remove`, `-file-errors`; repeat `-repeat-none|weekly|monthly`, `-repeat-interval`, `-repeat-count`, `-repeat-error`
  - After a create with rejected files: `-file-errors` and `-submit` (continue)
  - Errors and buttons: `-<field>-error`, `-submit`, `-cancel`, `-error`
- **Dashboard**: `dashboard-upcoming-meetings`, `dashboard-upcoming-meeting-item` (data-meeting-id, data-status), `dashboard-upcoming-meetings-empty`, `dashboard-upcoming-meetings-link`
- **Meeting request form**:
  - `request-type-card-meeting` (plus `-hint`), `meeting-request-form`, `-target` (with `-target-option`), `-topic`, `-note`
  - Proposed times: `meeting-request-time-<n>` with `-start-date|start-time|end-date|end-time`, `meeting-request-add-time`, `-remove-time`
  - Buttons: `-error`, `-submit`, `-cancel`
- **Requests lists** (shared with tasks): `work-request-row`, `work-request-open-meeting`, `work-review-row`, `work-review-approve`, `work-review-decline`, `work-review-open-meeting`
- **Badges**: `nav-meetings-badge`, `mobile-nav-meetings-badge` (data-count)

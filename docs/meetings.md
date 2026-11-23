# Meetings

Meetings belong to a scope: a **branch**, a **region** or **national**. The database enforces every rule below through
RLS and SECURITY DEFINER RPCs (`supabase/migrations/20261125090200_meetings.sql`). The screens only reflect those
rules. Followers have no access to meetings or meeting requests.

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
managers edit them; invitees read only.

**Decision to task.** "Create task" on a decision opens the task form prefilled:
- the title comes from the decision;
- the scope is the meeting's scope;
- the meeting and the decision are linked.

The decision then shows the linked task and its status, and the task links back to the meeting.

**Files.** Files go in the private bucket `meeting-files`, which the migration creates only when it is missing.
- Limits: 25 MB per file, at most 20 per meeting. Types: PDF, JPEG/PNG/WebP, DOCX, PPTX, XLSX.
- The original name is stored.
- Upload: a slot is reserved first (`add_meeting_file`), then the browser uploads to that path. Storage policies only
  accept reserved paths of meetings the user may edit.
- Download: signed URLs valid for 5 minutes, only for people who can see the meeting.
- Removal: the Storage object first, then the row (`delete_meeting_file`).

## Pages

- `/meetings` has Upcoming and Past tabs.
- `/meetings/<id>` shows details, invitees, the agenda with decisions, and files.
- The dashboard card "Upcoming meetings" shows the next 3 meetings the user can see.

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

| Event | Who is notified | Notice |
|---|---|---|
| Invited (on create or when added) | The invitee | `meeting_invited` |
| Time or place changed | Every invitee | `meeting_changed` |
| Cancelled | Every invitee | `meeting_cancelled` |
| Meeting request received | The target | `meeting_request_received` |
| Meeting request approved or declined | The requester | `meeting_request_approved` / `meeting_request_declined` |

Opening the meeting marks its notices read.

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
  - Header and tabs: `meetings-new`, `meetings-tab-upcoming|past`
  - Lists: `meetings-list` and `meetings-empty` (data-when), `meetings-retry`
  - Cards: `meeting-card` (data-meeting-id, data-status), with `meeting-card-title`, `meeting-card-status`, `meeting-card-invited`, `meeting-card-scope`
- **Detail**:
  - Page: `meeting-detail` (data-meeting-id, data-status), `meeting-not-found`, `meeting-back`
  - Facts: `meeting-title`, `meeting-status`, `meeting-invited`, `meeting-when`, `meeting-online-link`, `meeting-location`, `meeting-scope`, `meeting-creator`, `meeting-description`
  - Invitees: `meeting-invitees`, `meeting-invitee` (data-user-id), `meeting-invitees-empty`
  - Editors: `meeting-edit`, `meeting-complete`, `meeting-cancel`, `meeting-reschedule`, `meeting-reopen`, `meeting-delete`
  - Confirm dialog: `meeting-confirm-dialog`, `meeting-cancel-confirm`, `meeting-delete-confirm`, `meeting-confirm-dismiss`, `meeting-confirm-error`
- **Agenda**:
  - `meeting-agenda`, `meeting-agenda-empty`, `meeting-agenda-item` (data-item-id), `meeting-agenda-item-title`, `meeting-agenda-item-notes`
  - Editing: `meeting-agenda-add`, `meeting-agenda-form`, `meeting-agenda-title`, `meeting-agenda-notes`, `meeting-agenda-save`, `meeting-agenda-cancel`, `meeting-agenda-edit`, `meeting-agenda-up`, `meeting-agenda-down`
  - Delete: `meeting-agenda-delete`, then `meeting-agenda-delete-dialog`, `-confirm`, `-cancel`
- **Decisions**:
  - `meeting-decision` (data-decision-id), `meeting-decision-text-value`, `meeting-decisions-empty`
  - Editing: `meeting-decision-add`, `meeting-decision-form`, `meeting-decision-text`, `meeting-decision-save`, `meeting-decision-cancel`, `meeting-decision-edit`, `meeting-decision-delete`
  - Tasks: `meeting-decision-task` (data-task-id, data-status), `meeting-decision-create-task`
- **Files**: `meeting-files`, `meeting-files-empty`, `meeting-file-upload`, `meeting-file-input`, `meeting-file` (data-file-id), `meeting-file-name`, `meeting-file-download`, `meeting-file-delete`, `meeting-file-errors`
- **Form** (prefix `meeting-form`, or `work-review-meeting` when approving a request, or `meeting-reschedule-form`):
  - Shell and scope: `-dialog`, `-scope` (or `-scope-fixed`)
  - Fields: `-title`, `-description`, `-start-date`, `-start-time`, `-end-date`, `-end-time`
  - Place: `-place-in-person`, `-place-online`, `-location`, `-online-url`
  - Invitees: `-invitees` (PersonPicker)
  - Errors and buttons: `-<field>-error`, `-submit`, `-cancel`, `-error`
- **Dashboard**: `dashboard-upcoming-meetings`, `dashboard-upcoming-meeting-item` (data-meeting-id, data-status), `dashboard-upcoming-meetings-empty`, `dashboard-upcoming-meetings-link`
- **Meeting request form**:
  - `request-type-card-meeting` (plus `-hint`), `meeting-request-form`, `-target` (with `-target-option`), `-topic`, `-note`
  - Proposed times: `meeting-request-time-<n>` with `-start-date|start-time|end-date|end-time`, `meeting-request-add-time`, `-remove-time`
  - Buttons: `-error`, `-submit`, `-cancel`
- **Requests lists** (shared with tasks): `work-request-row`, `work-request-open-meeting`, `work-review-row`, `work-review-approve`, `work-review-decline`, `work-review-open-meeting`
- **Badges**: `nav-meetings-badge`, `mobile-nav-meetings-badge` (data-count)

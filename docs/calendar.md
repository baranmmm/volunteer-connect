# Calendar and events

How events, registrations and requests work in the Volunteer Hub. The rules are enforced in the database:
RLS policies and SECURITY DEFINER RPCs. The interface only reflects them.

## Roles and permissions

| Action | Volunteer | Branch Manager (BM) | Regional Director (RD) | National Coordinator (planned) |
| --- | --- | --- | --- | --- |
| See published and cancelled events | Own branch, and region events of own region | Same, plus drafts of own branch | Everything in own region | — |
| Create and edit events | — | Own branch only | Own region (branch or region scope) | — |
| Create a region-wide event | — | No: requests it instead | Yes | — |
| Register for events | Yes | Yes | Yes | — |
| See the attendee list and attendance | Names that members chose to show | Own branch events | Own region events | Counts only |
| Request an event | Branch scope | Region scope | No: creates events directly | — |
| Review requests | — | Branch requests of own branch | All requests of own region | Counts only |
| Recycle Bin (restore or permanently delete) | — | Own branch | Own region | — |

## Event statuses

| Status | Who sees it | Notes |
| --- | --- | --- |
| Draft | Managers of the scope | Only a title is required; dates may be unset. |
| Published | Everyone in scope | Needs a date, a time (or all day), a place or an `https` online link, and a category. It cannot end in the past. |
| Cancelled | Everyone in scope | Stays visible and struck through. Registration closes. "Add to calendar" and "Share" are hidden. |
| Deleted | Managers, in the Recycle Bin | Hidden everywhere else. Restorable for 30 days. |

- All-day events store London calendar dates, never timestamps.
- Timed events store UTC instants and are always shown in Europe/London time.
- Events created from an external request are marked "External" and show "Organised by …".

## One calendar: meetings in the calendar

Every meeting is also a calendar entry: an event with the category **Meeting** (`MEETING_CATEGORY`,
`isMeetingEvent()` in `src/lib/event-rules.ts`), linked by `meetings.event_id`. The database keeps the two in step.

| Rule | Behaviour |
| --- | --- |
| Who sees it | Exactly the people who can see the meeting: its creator, its invitees and the managers of its scope. Other members of the branch do not. |
| Never public | Members only. Never on the public `/events` pages, in `get_public_*` or in the ICS feed. |
| No registration | No registration, capacity, waiting list, event files or event recurrence. |
| Calendar | List and month views show it with a Meeting badge. Clicking it opens the event page, where **Open meeting** leads to `/meetings/<id>`. |
| Managing it | People who can edit the meeting get Edit (the meeting form), Cancel / Reopen and Delete on the event page. These act on the meeting. For a recurring meeting, Delete asks "this / this and following / all". Deleting the event directly is refused. |
| Recurring meetings | A meeting series (weekly or monthly, every 1–4, 2–52 meetings within 12 months). Each occurrence has its own calendar entry (`events.series_id` stays empty). |
| Counts | Dashboard "Upcoming events" and the other event counts leave meetings out. Meetings have their own dashboard card. |
| Tasks | Every viewer of an event (meetings included) sees its linked tasks on the event page. |

## Event form

The form shows only **title, category, date/time and place** (in person or online). The online link sits next to
the place, because it is required when the event is online. Everything else is in collapsible sections. They are
all collapsed whenever the form opens:

| Section | Fields |
| --- | --- |
| Description | Description, organiser (default "Dialogue Society") |
| Registration & capacity | Capacity (default unlimited), registration open (default on) |
| Audience | Branch (fixed for a BM) or national (NC), visible to (default members only) |
| Files | Images, PDFs, Word and PowerPoint (max 5) |
| Repeat | Event recurrence (new events, or a series edited for "following" / "all") |

A Regional Director's scope and branch stay visible, because the branch must be chosen. A validation error inside a
collapsed section opens that section and focuses the field. A BM publishes with title, place and start: End follows
Start + 2 hours.

**Category Meeting** (create only) turns the form into a meeting form. It shows invitees (people of the chosen
scope, from `listMeetingPeople`) and the meeting repeat (does not repeat / weekly / monthly, every 1–4,
2–52 meetings). It hides registration, audience, files, all day and "Save draft". Saving calls `createMeeting` and
opens the new meeting's page. An existing event can never become a meeting, and a meeting can never become an
event: edit lists only event categories, and the database refuses the change.

### Test ids

| Element | Test id |
| --- | --- |
| Section / its trigger (`aria-expanded`) | `event-form-section-<description\|registration\|audience\|files\|repeat>` (`data-open`) / `…-toggle` |
| Category options | `event-form-category-option-<category>` |
| Form mode | `event-form` has `data-mode="event"` or `"meeting"` |
| Meeting invitees | `event-form-invitees` (PeopleCombobox: `-open`, `-option`, `-chip`, `-search`) |
| Meeting repeat | `event-form-meeting-repeat-freq` (`-option-<none\|weekly\|monthly>`), `event-form-meeting-repeat-interval` (`-option-<1..4>`), `event-form-meeting-repeat-count` |
| Meeting badge (card, month entry) | `event-meeting-badge`; cards and month entries carry `data-category` |
| Event page of a meeting | `event-detail[data-category="meeting"]`, `event-open-meeting`, `event-meeting-actions`, `event-reopen-meeting-button` (Edit, Cancel and Delete keep `event-edit-button`, `event-cancel-event-button`, `event-delete-button`, `event-delete-confirm`) |

## Recurring events

| Rule | Behaviour |
| --- | --- |
| Pattern | RRULE (daily, weekly, monthly, yearly or custom), expanded in Europe/London time. |
| Generation | Occurrences are generated ahead by a nightly job, which only adds and never changes existing ones. |
| Editing | You edit "This event", "This and following" or "All events". |
| Registered occurrences | Never deleted or regenerated. They keep their id and become exceptions. If the new rule no longer produces their day, they stay and the manager is warned. |
| Deleting a series | Everything goes to the Recycle Bin as one item. |

## Registrations and waiting list

| Topic | Rule |
| --- | --- |
| Capacity | Optional. When the event is full, new registrations join the waiting list. |
| Promotion | Waiting-list places are promoted in order (FIFO) when a place frees up or capacity rises. The member gets a "promoted" notice. |
| Lowering capacity | Nobody is removed. Managers see an "over capacity" warning, except on cancelled events. |
| When | You can register until the event ends and cancel until it starts. |
| Names | Shown to members who can see the event unless the member ticks "Don't show my name". Email addresses are never shown. |
| Notices | Cancellation, removal to the Recycle Bin, and date, time or place changes notify registered members. |
| Attendance | Managers mark attended or no-show after the start. The CSV export contains name, email, status and attendance only. |

## Event requests

| | External | Proposal |
| --- | --- | --- |
| Purpose | An event someone else organises (leaflet, invitation, website) | An event we could organise |
| Required fields | Title, organiser, source, date and time | Title, date and time |
| Optional fields | Place or online link, event page link, notes, up to 3 files (JPG, PNG, WebP or PDF, 10 MB each) | Alternative date, place, expected attendees, reason |
| On approval | **Published** at once (needs category and place) and marked External; files are copied to the event | A **draft** that the approver finishes in the event form |

**Request lifecycle**

| Step | Rule |
| --- | --- |
| Statuses | Submitted → Under review → Approved / Declined, or Withdrawn by the requester |
| Requester edits | Allowed only while Submitted |
| Reviewer edits | Allowed while Submitted or Under review; editing moves the request to Under review. The scope, type, requester and status cannot be changed. Approval uses the edited values. |
| Decline | Needs a reason of at least 10 characters |
| Open-request limit | At most 5 open requests per member |
| Deleting an open request | It is withdrawn first, so a restore never reopens it |
| Duplicates | Approval warns about events on the same day with a similar title |

## Recycle Bin and GDPR

| Item | Rule |
| --- | --- |
| Retention | Deleted events, series, requests and accounts stay 30 days, then a nightly job removes them permanently. |
| Order of removal | Files are always removed through Storage before the database rows. |
| Self-requested account erasure | Cannot be restored. |
| Erased user | References become NULL. Registration counts and attendance stay as anonymous rows; requests stay with the managers without a name. |
| Deleting a user | Not-yet-started registrations are cancelled and the waiting list is promoted. Open requests are withdrawn. |
| Downloaded files | Media and attachments use signed links that expire after 5 minutes. Files already downloaded cannot be revoked. |

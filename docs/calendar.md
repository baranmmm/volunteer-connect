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

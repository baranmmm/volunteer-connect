# Roles and permissions

Five roles on the ladder, from lowest to highest: **Follower < Volunteer < Branch Manager (BM) < Regional Director (RD) <
National Coordinator (NC)**, plus **Trustee** beside Volunteer (a read-only branch member, not a step on the ladder). Roles live only in `user_roles`. The database enforces every rule below through RLS, grants and
SECURITY DEFINER functions; the menus and screens only reflect it.

- **Follower.** Everyone who signs up from now on. A follower is active straight away, has no branch of their own, and follows at least one branch.
- **Volunteer.** Members of a branch. Existing members keep their roles. A follower becomes a volunteer when their application is approved.
- **Trustee** (TR "Mütevelli"). A read-only member of one branch: reads exactly what a volunteer of that branch reads,
  changes nothing. See [Trustees](#trustees).
- **National Coordinator.** Assigned only with SQL (`docs/nc-setup.md`). An NC acts only with an MFA (aal2) session.

## Permission matrix

| What | Follower | Volunteer | Branch Manager | Regional Director | National Coordinator (aal2) |
|---|---|---|---|---|---|
| Public events (all branches) | See, register | See, register | See, register | See, register | See (counts only for registrations) |
| Members events | — | Own branch and region, national | Own branch (+ drafts), region, national | Whole region (+ drafts), national | All published/cancelled; national drafts |
| Create / edit events | — | — | Own branch | Branches and region of their region | National events only |
| Event audience (Members only / Public) | — | — | Set in the form | Set in the form | Set in the form |
| Registrant names | Never | Shown names on events they can see | Full list for managed events | Full list for managed events | Never (counts only, no CSV) |
| Mark attendance, export CSV | — | — | Managed events | Managed events | — |
| Event requests (proposal / external) | — (applies to volunteer instead) | Submit for own branch | Submit region requests; review own branch | Review region | — (counts on the dashboard) |
| Volunteer application | Submit one open at a time, withdraw, remove | — | Review own branch (approve → volunteer of that branch) | Review region | Counts only |
| Followed branches | Add/remove (at least one) | Add/remove (own branch always followed) | Same | Same | Same |
| Users page | — | — | Own branch members | Region members | Regional Directors and Branch Managers only; volunteers and followers as numbers per branch |
| Approve / deactivate / delete users | — | — | Own branch volunteers | Region (not RDs) | RDs and BMs (status, deletion of BMs) |
| Change roles, move branches | — | — | — | Volunteer ↔ BM, within the region | RD ↔ BM ↔ volunteer (RDs with a region), any branch; never NC |
| Regions and branches | — | — | — | — | Create, rename, delete (only without active users and upcoming events), restore |
| Recycle Bin | — | — | Own branch (events, tasks, meetings, users) | Region | National events, tasks, meetings; regions, branches |
| Tasks: see | — | All tasks of own branch; own and assigned tasks; linked tasks on events they can see | Same (+ region tasks of own region) | All tasks in the region | National tasks; tasks assigned to them |
| Tasks: create / assign | — | Tasks in own branch for themselves and/or other volunteers of the branch (never upward: that is a task request) | Branch tasks; volunteers and BMs of own branch | Region or branch tasks; anyone in the region | National tasks; RDs, BMs and NCs only |
| Tasks: edit | — | Tasks they created; status of tasks assigned to them | Tasks of own branch; status when assigned | Tasks in the region | National tasks |
| Tasks: archive / notes | — | Archive done tasks and write notes on tasks assigned to them or they created; edit/delete own notes; @mention people who can see the task | Same, plus tasks of own branch | Same, plus tasks in the region | Same, for national tasks |
| Task / meeting requests | — | To own BM or RD | To own RD; review those sent to them | To an NC; review those sent to them | Review those sent to them |
| Meetings: see | — | Created by them or invited | Same + meetings of own branch | Same + meetings in the region | Same + national meetings |
| Meetings: create / invite (single or recurring) | — | Own branch; branch members | Own branch; branch members and the RD | Region or a branch in it; people in the region | National; RDs, BMs and NCs only |
| Media, Training | Hidden and refused | Yes | Yes | Yes | Yes |
| Requests (`/requests`) | "My requests" (volunteer application) | "My requests" | "My requests" and "Waiting for my approval": volunteer applications, pending sign-ups, account deletion requests, event, task and meeting requests of own branch | Same, for the region | "Waiting for my approval" only: task and meeting requests sent to them |
| Delete own account | Directly (type full name) | Request to manager | Request to RD | Contact the office | Contact the office (never in the app) |
| Donate (external link) | Menu and dashboard | Menu | Menu | Menu | Menu |

Signed-out visitors can open `/events`, `/events/:id` and `/api/ics`. They see only these fields of public events:
- title, description, dates (Europe/London), all-day, branch, region and category;
- the physical location, or an "Online event" label instead of a link;
- the organiser of an external event;
- the first image, through a 5-minute signed link;
- the registration state as a word: places available, full or closed.

They see no online links, attendees, emails, creators, or files other than the first image. `anon` has no table access; it gets data only from `get_public_events`, `get_public_event` and `get_public_event_image`.

## Trustees

Migrations `20261210090000_app_role_trustee.sql` (the enum value) and `20261210090100_trustee_role.sql` (the rules).
A trustee is a member of their branch (`is_member`, `is_branch_member`), so every read rule of a volunteer of the
branch applies; `is_trustee()` takes away every write.

| What | Trustee |
|---|---|
| Becoming one | Sign-up is unchanged (people apply as volunteers). The reviewer (the branch's BM or the region's RD) chooses Volunteer or Trustee on approval (`approve_volunteer_application(p_id, p_role)`, default volunteer; audited `follower → trustee`). |
| Switching | The branch's BM switches a member of the branch between Volunteer and Trustee on the user page (`set_user_role`, audited `role_change`). RDs may also set Trustee (Volunteer, Trustee or BM) within their region; NCs where they already change roles. |
| See | Same as a volunteer of the branch: calendar and events (members events of the branch and region, national), every branch task and task group, linked tasks, meetings they created or are invited to (agenda, decisions, files, invitees), registrant names they are allowed to see. |
| Create / edit | Nothing: no events, tasks, "@all" groups, meetings, agenda items, decisions, files or invitees (`can_create_task`, `can_create_meeting`, `can_edit_task`, `can_edit_task_group`, `can_edit_meeting` refuse them, and with them every RPC and the meeting-files Storage policies). A volunteer who becomes a trustee loses edit rights on what they created. |
| Own tasks | Change the status and write notes (edit/delete their own notes); personal reminders and the mute switch. Archiving is refused (`can_archive_task`, `task_json.can_archive`). |
| Assigned by | Only the branch's Branch Manager (`task_assignee_ok`). Volunteers and Regional Directors cannot assign a trustee (an RD editing a task keeps a trustee assigned earlier). "@all" groups, from anyone, never include trustees and send them nothing; a trustee cannot be added to a group later. |
| Meetings | Invited only by the managers of the meeting's scope: the branch's BM or the region's RD (`meeting_invitee_ok`). Volunteers' pickers leave trustees out. |
| Requests | Event, task and meeting requests like volunteers (to the branch's BM or the region's RD). Register for events like volunteers. |
| NC | Counts only: `trustees` in `get_nc_dashboard`, `get_regions_tree` and `get_branch_map` (volunteer counts leave trustees out). |
| UI | "Trustee" / "Mütevelli" badge; New task, New meeting and Add task are hidden (`useWorkScopes().canCreate`); edit controls follow the database flags. |

Test ids: approval `volunteer-application-approve-role` (fieldset, data-value) with
`volunteer-application-approve-role-volunteer|trustee` (radios) and `volunteer-application-approve-role-hint`;
`volunteer-application-approve` carries data-role. User page: `change-role-option-trustee`, `change-role-trustee-hint`.
Counts: `data-trustees` on `users-branch-count` and the Regions branch lines, `nc-stat-trustees`.

## Rules worth knowing

- **Privacy notice.** Every client write RPC first checks that the current notice is confirmed. The exceptions are the confirmation itself and account deletion.
- **MFA for NCs.** An NC session without MFA (aal1) gets nothing from the database beyond its own profile. The app shows only the MFA set-up or verification screen until the session is aal2.
- **The last NC.** The last active NC cannot be deactivated, soft-deleted, lose the role or be deleted. Triggers enforce this, so it holds for SQL too.
- **Approval is atomic.** Approving a volunteer application changes the role from follower to volunteer (or trustee, when the reviewer chooses it) and sets the branch, with audit rows (`role_change`, `branch_change`), in one transaction.
- **Structure deletion.** A deleted branch or region goes to the Recycle Bin for 30 days.
  - Deleting a region also deletes its branches, and restoring the region brings them back.
  - Items that past events or users still refer to stay archived (hidden) and are never purged.

// The trustee role in the UI (docs/roles.md#trustees): the Branch Manager approves an application as a trustee, switches
// a member between Volunteer and Trustee on the user page (both audited in the history), trustees read meetings and
// tasks with no create or edit controls (status on their own task only; notes on every task of their branch), and they send task requests to
// their Branch Manager. Every person and item is created for this test in a temporary branch (cleaned up by the
// fixtures); every check looks at this test's own ids.
import type { Page } from "@playwright/test";
import { test, expect, runId } from "../../fixtures/roles";
import { adminClient, getRoles } from "../../api/SupabaseClient";
import { MEETING_TITLE_PREFIX, TASK_TITLE_PREFIX, createMeetingAs, createTaskAs, inDays, workRpc } from "../../api/work";
import { APP_LOAD_TIMEOUT } from "../../pages/app";
import { UserDetailsPage } from "../../pages/UserDetailsPage";

let n = 0;
const taskTitle = (label: string) => `${TASK_TITLE_PREFIX}${runId} trustee-${Date.now().toString(36)}-${++n} ${label}`;
const meetingTitle = (label: string) => `${MEETING_TITLE_PREFIX}${runId} trustee-${Date.now().toString(36)}-${++n} ${label}`;

async function openTask(page: Page, taskId: string) {
  await page.goto(`/tasks?task=${taskId}`);
  await expect(page.locator(`[data-testid="task-panel"][data-task-id="${taskId}"]`)).toBeVisible({ timeout: APP_LOAD_TIMEOUT });
  await expect(page.getByTestId("task-panel-detail")).toBeVisible({ timeout: APP_LOAD_TIMEOUT });
}

test.describe("trustees", () => {
  test("the Branch Manager approves an application as a trustee", async ({ freshUser, freshBranch, pageAs }) => {
    const branch = await freshBranch("trustee-approve");
    const manager = await freshUser({ role: "branch_manager", branch });
    const follower = await freshUser({ role: "follower", branch });
    const applied = await workRpc(follower, "submit_volunteer_application", {
      p: { branch_id: branch, motivation: "I would like to support the branch as a trustee.", time_commitment: "few_hours_month", commitment: true },
    });
    expect(applied.error).toBeNull();

    const page = await pageAs(manager);
    await page.goto("/requests?tab=review");
    const row = page.locator(`[data-testid="volunteer-application-review-row"][data-application-id="${applied.data as string}"]`);
    await expect(row).toBeVisible({ timeout: APP_LOAD_TIMEOUT });
    const choice = row.getByTestId("volunteer-application-approve-role");
    await expect(choice).toHaveAttribute("data-value", "volunteer");
    await expect(row.getByTestId("volunteer-application-approve-role-hint")).toBeVisible();
    await row.getByTestId("volunteer-application-approve-role-trustee").check();
    await expect(row.getByTestId("volunteer-application-approve")).toHaveAttribute("data-role", "trustee");
    await row.getByTestId("volunteer-application-approve").click();
    await expect(page.getByTestId("toast-success").last()).toBeVisible();
    await expect.poll(() => getRoles(follower.id)).toEqual(["trustee"]);
    const { data: audit } = await adminClient()
      .from("user_audit_log")
      .select("actor_id, old_value, new_value")
      .eq("target_id", follower.id)
      .eq("action", "role_change");
    expect(audit).toEqual([{ actor_id: manager.id, old_value: "follower", new_value: "trustee" }]);
  });

  test("the Branch Manager switches a volunteer to trustee and back on the user page (audited)", async ({ freshUser, freshBranch, pageAs }) => {
    const branch = await freshBranch("trustee-switch");
    const manager = await freshUser({ role: "branch_manager", branch });
    const volunteer = await freshUser({ role: "volunteer", branch });
    const page = await pageAs(manager);
    const details = new UserDetailsPage(page);
    await details.goto(volunteer.id);

    await details.chooseRole("trustee");
    await expect(page.getByTestId("change-role-trustee-hint")).toBeVisible();
    // A Branch Manager may offer only Volunteer and Trustee.
    await expect(page.getByTestId("change-role-option-branch_manager")).toHaveCount(0);
    await details.roleDialog().confirm();
    await expect(details.roleDialog().root).toBeHidden();
    await expect.poll(() => getRoles(volunteer.id)).toEqual(["trustee"]);
    await expect(details.role()).toHaveText(/Trustee/, { timeout: APP_LOAD_TIMEOUT });

    await details.chooseRole("volunteer");
    await details.roleDialog().confirm();
    await expect.poll(() => getRoles(volunteer.id)).toEqual(["volunteer"]);

    await details.openHistory();
    await expect(details.historyPanel().locator('[data-testid="history-entry"][data-action="role_change"]')).toHaveCount(2);
  });

  test("meeting and task pages are read-only for a trustee (status on their own task, notes on every branch task)", async ({ freshUser, freshBranch, pageAs }) => {
    const branch = await freshBranch("trustee-readonly");
    const manager = await freshUser({ role: "branch_manager", branch });
    const volunteer = await freshUser({ role: "volunteer", branch });
    const trustee = await freshUser({ role: "trustee", branch });
    const meeting = await createMeetingAs(manager, {
      scope: "branch",
      branch_id: branch,
      title: meetingTitle("board"),
      starts_at: inDays(6),
      ends_at: inDays(6, 1),
      invitee_ids: [trustee.id],
    });
    const item = (await workRpc(manager, "add_agenda_item", { p_meeting: meeting, p_title: "Accounts", p_notes: "Review" })).data as string;
    expect((await workRpc(manager, "add_meeting_decision", { p_item: item, p_text: "Approve the budget" })).error).toBeNull();
    const own = await createTaskAs(manager, { scope: "branch", branch_id: branch, title: taskTitle("own"), assignee_ids: [trustee.id] });
    const other = await createTaskAs(manager, { scope: "branch", branch_id: branch, title: taskTitle("other"), assignee_ids: [volunteer.id] });

    const page = await pageAs(trustee);
    await page.goto("/meetings");
    await expect(page.getByTestId("meetings-timeline").or(page.getByTestId("meetings-empty"))).toBeVisible({ timeout: APP_LOAD_TIMEOUT });
    await expect(page.getByTestId("meetings-new")).toHaveCount(0);

    await page.goto(`/meetings/${meeting}`);
    await expect(page.getByTestId("meeting-detail")).toBeVisible({ timeout: APP_LOAD_TIMEOUT });
    const agendaItem = page.locator(`[data-testid="meeting-agenda-item"][data-item-id="${item}"]`);
    await agendaItem.getByTestId("meeting-agenda-item-toggle").click();
    await expect(agendaItem.getByTestId("meeting-decision")).toHaveCount(1);
    for (const id of ["meeting-edit", "meeting-cancel", "meeting-delete", "meeting-agenda-add", "meeting-agenda-edit", "meeting-decision-add", "meeting-decision-create-task", "meeting-file-upload"])
      await expect(page.getByTestId(id), id).toHaveCount(0);

    // A branch meeting the trustee is not invited to: listed and readable, still read only.
    const uninvited = await createMeetingAs(manager, {
      scope: "branch",
      branch_id: branch,
      title: meetingTitle("managers only"),
      starts_at: inDays(7),
      ends_at: inDays(7, 1),
      invitee_ids: [],
    });
    const uninvitedItem = (await workRpc(manager, "add_agenda_item", { p_meeting: uninvited, p_title: "Plans", p_notes: "Draft" })).data as string;
    await page.goto("/meetings");
    await expect(page.locator(`[data-testid="meeting-card"][data-meeting-id="${uninvited}"]`)).toBeVisible({ timeout: APP_LOAD_TIMEOUT });
    await page.goto(`/meetings/${uninvited}`);
    await expect(page.getByTestId("meeting-detail")).toBeVisible({ timeout: APP_LOAD_TIMEOUT });
    await expect(page.locator(`[data-testid="meeting-agenda-item"][data-item-id="${uninvitedItem}"]`)).toBeVisible();
    for (const id of ["meeting-edit", "meeting-cancel", "meeting-delete", "meeting-agenda-add", "meeting-file-upload"])
      await expect(page.getByTestId(id), id).toHaveCount(0);
    // A volunteer of the branch still does not see it.
    const asVolunteer = await pageAs(volunteer);
    await asVolunteer.goto(`/meetings/${uninvited}`);
    await expect(asVolunteer.getByTestId("meeting-not-found")).toBeVisible({ timeout: APP_LOAD_TIMEOUT });

    // A branch task assigned to someone else: the note box, and no edit controls.
    await openTask(page, other);
    await expect(page.getByTestId("tasks-new")).toHaveCount(0);
    for (const id of ["task-panel-status", "task-panel-edit", "task-panel-delete", "task-panel-archive"])
      await expect(page.getByTestId(id), id).toHaveCount(0);
    await page.getByTestId("task-note-input").fill("Noted by the trustee.");
    await page.getByTestId("task-note-submit").click();
    await expect(page.locator('[data-testid="task-note"][data-mine="true"]')).toHaveCount(1);
    const { data: notes } = await adminClient().from("task_notes").select("author_id, body").eq("task_id", other);
    expect(notes).toEqual([{ author_id: trustee.id, body: "Noted by the trustee." }]);
    await expect(page.getByTestId("task-panel-status")).toHaveCount(0);

    await openTask(page, own);
    await expect(page.getByTestId("task-panel-edit")).toHaveCount(0);
    await page.getByTestId("task-panel-status").selectOption("done");
    await expect(page.getByTestId("task-panel-detail")).toHaveAttribute("data-status", "done");
    // Done, but no archive for a trustee.
    await expect(page.getByTestId("task-panel-archive")).toHaveCount(0);
    await page.getByTestId("task-note-input").fill("Read and agreed.");
    await page.getByTestId("task-note-submit").click();
    await expect(page.locator('[data-testid="task-note"][data-mine="true"]')).toHaveCount(1);
  });

  test("a trustee sends a task request to their Branch Manager", async ({ freshUser, freshBranch, pageAs }) => {
    const branch = await freshBranch("trustee-request");
    const manager = await freshUser({ role: "branch_manager", branch });
    const trustee = await freshUser({ role: "trustee", branch });
    const requestTitle = taskTitle("please");
    const page = await pageAs(trustee);
    await page.goto("/requests");
    await page.getByTestId("my-requests-new").click({ timeout: APP_LOAD_TIMEOUT });
    await page.getByTestId("request-type-card-task").click();
    const form = page.getByTestId("task-request-form");
    await expect(form).toBeVisible();
    await form.getByTestId("task-request-target").click();
    await page.locator(`[data-testid="task-request-target-option"][data-user-id="${manager.id}"]`).click();
    await form.getByTestId("task-request-title").fill(requestTitle);
    await form.getByTestId("task-request-submit").click();
    await expect(form).toBeHidden();
    const request = (await adminClient().from("task_requests").select("id, target_id").eq("title", requestTitle).single()).data!;
    expect(request.target_id).toBe(manager.id);
    await expect(page.locator(`[data-testid="work-request-row"][data-request-id="${request.id as string}"]`)).toHaveAttribute("data-status", "submitted");
  });
});

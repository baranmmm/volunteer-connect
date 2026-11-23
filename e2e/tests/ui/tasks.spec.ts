// Tasks in the UI: creating and assigning, the Kanban (drag and drop on desktop, the status select on phones), the
// list and calendar views, reminder settings, self-tasks, upward task requests, the Recycle Bin and long titles at
// 390 px. Every item is created by fresh users in a temporary branch (cleaned up by the fixtures) and every check
// looks at this test's own ids only.
import type { Page } from "@playwright/test";
import { test, expect, runId, type TestUser } from "../../fixtures/roles";
import { adminClient } from "../../api/SupabaseClient";
import { TASK_TITLE_PREFIX, createTaskAs, workRpc } from "../../api/work";
import { APP_LOAD_TIMEOUT } from "../../pages/app";
import { RecycleBinPage } from "../../pages/RecycleBinPage";
import { pickOption } from "../../pages/components/select";

let n = 0;
const title = (label: string) => `${TASK_TITLE_PREFIX}${runId} ui-${Date.now().toString(36)}-${++n} ${label}`;
/** London "YYYY-MM-DD" `days` from today. */
const londonDay = (days = 0) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(new Date(Date.now() + days * 86400000));

const card = (page: Page, id: string) => page.locator(`[data-testid="task-card"][data-task-id="${id}"]`);
const column = (page: Page, status: string) => page.locator(`[data-testid="tasks-kanban-column"][data-status="${status}"]`);
const listRow = (page: Page, id: string) => page.locator(`[data-testid="tasks-list-row"][data-task-id="${id}"]`);
const calendarItem = (page: Page, id: string) => page.locator(`[data-testid="tasks-calendar-item"][data-task-id="${id}"]`);
const pickerOption = (page: Page, prefix: string, userId: string) =>
  page.locator(`[data-testid="${prefix}-option"][data-user-id="${userId}"]`);

/** /tasks (optionally with the panel of one task open), once the page has loaded. */
async function openTasks(page: Page, taskId?: string) {
  await page.goto(taskId ? `/tasks?task=${taskId}` : "/tasks");
  await expect(page.getByTestId("tasks-view-kanban")).toBeVisible({ timeout: APP_LOAD_TIMEOUT });
  if (taskId) await expect(page.getByTestId("task-panel-detail")).toBeVisible({ timeout: APP_LOAD_TIMEOUT });
}
/** The id of the task whose panel is open (the form opens the new task's panel after saving). */
async function openedTaskId(page: Page) {
  await expect(page).toHaveURL(/[?&]task=[0-9a-f-]{36}/, { timeout: APP_LOAD_TIMEOUT });
  return new URL(page.url()).searchParams.get("task")!;
}
async function branchTeam(freshBranch: (label: string) => Promise<string>, freshUser: (o: { role: "branch_manager" | "volunteer"; branch: string }) => Promise<TestUser>, label: string) {
  const branch = await freshBranch(label);
  const manager = await freshUser({ role: "branch_manager", branch });
  const volunteer = await freshUser({ role: "volunteer", branch });
  return { branch, manager, volunteer };
}

test.describe("Tasks", () => {
  test("a branch manager creates and assigns a task; the assignee moves it on the Kanban; the manager is told", { tag: "@smoke" }, async ({ freshUser, freshBranch, pageAs, isMobile }) => {
    const { manager, volunteer } = await branchTeam(freshBranch, freshUser, "tasks-kanban");
    const name = title("kanban");
    const due = londonDay(7);

    const managerPage = await pageAs(manager);
    await openTasks(managerPage);
    await managerPage.getByTestId("tasks-new").click();
    const form = managerPage.getByTestId("task-form");
    await form.getByTestId("task-form-title").fill(name);
    await form.getByTestId("task-form-priority").selectOption("high");
    await form.getByTestId("task-form-due-date").fill(due);
    await pickerOption(managerPage, "task-form-assignees", volunteer.id).getByTestId("task-form-assignees-checkbox").check();
    await form.getByTestId("task-form-submit").click();
    await expect(managerPage.getByTestId("toast-success").first()).toBeVisible();
    const id = await openedTaskId(managerPage);
    await expect(column(managerPage, "todo").locator(`[data-task-id="${id}"]`)).toHaveCount(1);
    const created = (await workRpc(manager, "get_task", { p_id: id })).data as { priority: string; due_date: string; assignees: { id: string }[] };
    expect([created.priority, created.due_date, created.assignees.map((a) => a.id)]).toEqual(["high", due, [volunteer.id]]);

    // The assignee moves it: drag and drop on desktop, the keyboard-friendly status select on phones.
    const page = await pageAs(volunteer);
    await openTasks(page);
    await expect(card(page, id)).toBeVisible();
    await expect(card(page, id)).toHaveAttribute("data-status", "todo");
    if (isMobile) await card(page, id).getByTestId("task-card-status").selectOption("in_progress");
    else await card(page, id).dragTo(column(page, "in_progress"));
    await expect(column(page, "in_progress").locator(`[data-testid="task-card"][data-task-id="${id}"]`)).toBeVisible();
    await expect.poll(async () => (await adminClient().from("tasks").select("status").eq("id", id).single()).data?.status).toBe("in_progress");
    await page.reload();
    await expect(column(page, "in_progress").locator(`[data-testid="task-card"][data-task-id="${id}"]`)).toBeVisible({ timeout: APP_LOAD_TIMEOUT });

    // The assignee's panel: status only, no edit or delete.
    await card(page, id).getByTestId("task-card-open").click();
    const panel = page.getByTestId("task-panel");
    await expect(panel.getByTestId("task-panel-status")).toHaveValue("in_progress");
    await expect(panel.getByTestId("task-panel-edit")).toHaveCount(0);
    await expect(panel.getByTestId("task-panel-delete")).toHaveCount(0);

    // The manager gets a status notice on the dashboard.
    await managerPage.goto("/dashboard");
    await expect(managerPage.getByTestId("dashboard-notifications").locator('[data-testid="dashboard-notification"][data-kind="task_status_changed"]')).toBeVisible({ timeout: APP_LOAD_TIMEOUT });
    const notices = await adminClient().from("notifications").select("kind").eq("user_id", manager.id).eq("entity_id", id);
    expect((notices.data ?? []).map((x) => x.kind)).toContain("task_status_changed");
  });

  test("views: the list view is remembered after a reload, the calendar shows the due day, 'My tasks' hides others' tasks", async ({ freshUser, freshBranch, pageAs }) => {
    const { branch, manager, volunteer } = await branchTeam(freshBranch, freshUser, "tasks-views");
    const today = londonDay(0);
    const mine = await createTaskAs(manager, { scope: "branch", branch_id: branch, title: title("mine"), due_date: today, assignee_ids: [volunteer.id] });
    const other = await createTaskAs(manager, { scope: "branch", branch_id: branch, title: title("other"), due_date: today });

    const page = await pageAs(volunteer);
    await openTasks(page);
    await page.getByTestId("tasks-view-list").click();
    await expect(listRow(page, mine)).toBeVisible();
    await page.reload();
    await expect(page.getByTestId("tasks-view-list")).toHaveAttribute("aria-pressed", "true", { timeout: APP_LOAD_TIMEOUT });
    await expect(page.getByTestId("tasks-view-kanban")).toHaveAttribute("aria-pressed", "false");
    await expect(listRow(page, mine)).toBeVisible({ timeout: APP_LOAD_TIMEOUT });
    await expect(listRow(page, other)).toBeVisible();

    // Calendar: both on today's date (the agenda list on phones, the month grid on desktop).
    await page.getByTestId("tasks-view-calendar").click();
    const day = page.locator(`[data-testid="tasks-calendar-day"][data-day="${today}"]`);
    await expect(day.locator(`[data-testid="tasks-calendar-item"][data-task-id="${mine}"]`)).toBeVisible();
    await expect(day.locator(`[data-testid="tasks-calendar-item"][data-task-id="${other}"]`)).toBeVisible();

    // "My tasks" keeps only the tasks assigned to me, in every view.
    await page.getByTestId("tasks-filter-mine").click();
    await expect(page.getByTestId("tasks-filter-mine")).toHaveAttribute("aria-pressed", "true");
    await expect(calendarItem(page, other)).toHaveCount(0);
    await expect(calendarItem(page, mine)).toBeVisible();
    await page.getByTestId("tasks-view-list").click();
    await expect(listRow(page, mine)).toBeVisible();
    await expect(listRow(page, other)).toHaveCount(0);
  });

  test("reminder settings: the manager sets them in the form; the assignee sees them read-only and mutes them", async ({ freshUser, freshBranch, pageAs }) => {
    const { branch, manager, volunteer } = await branchTeam(freshBranch, freshUser, "tasks-reminders");
    const id = await createTaskAs(manager, { scope: "branch", branch_id: branch, title: title("reminders"), due_date: londonDay(10), assignee_ids: [volunteer.id] });

    const managerPage = await pageAs(manager);
    await openTasks(managerPage, id);
    await managerPage.getByTestId("task-panel-edit").click();
    const reminders = managerPage.getByTestId("task-form").getByTestId("task-form-reminders");
    await expect(reminders).toBeVisible();
    await expect(reminders.getByTestId("task-form-remind-before-3")).toBeChecked();
    await reminders.getByTestId("task-form-remind-before-7").check();
    await reminders.getByTestId("task-form-repeat-kind").selectOption("every_n");
    await reminders.getByTestId("task-form-repeat-every").fill("4");
    await reminders.getByTestId("task-form-overdue-toggle").check();
    await reminders.getByTestId("task-form-overdue-every").fill("2");
    await managerPage.getByTestId("task-form-submit").click();
    await expect(managerPage.getByTestId("task-form")).toBeHidden();
    await expect(managerPage.getByTestId("toast-success").first()).toBeVisible();
    const detail = (await workRpc(manager, "get_task", { p_id: id })).data as { reminders: Record<string, unknown> };
    expect(detail.reminders).toMatchObject({ before_days: [3, 7], repeat_kind: "every_n", repeat_every_days: 4, overdue_every_days: 2 });

    const page = await pageAs(volunteer);
    await openTasks(page, id);
    await expect(page.getByTestId("task-panel-reminders")).toBeVisible();
    await expect(page.getByTestId("task-panel-reminders").locator("input, select, textarea")).toHaveCount(0);
    await expect(page.getByTestId("task-panel-edit")).toHaveCount(0);
    const mute = page.getByTestId("task-panel-mute-reminders");
    await expect(mute).toHaveAttribute("aria-checked", "false");
    await mute.click();
    await expect(mute).toHaveAttribute("aria-checked", "true");
    await expect
      .poll(async () => (await adminClient().from("task_assignees").select("reminders_muted").eq("task_id", id).eq("user_id", volunteer.id).single()).data?.reminders_muted)
      .toBe(true);
  });

  test("a volunteer creates a self-task: the only person offered is themselves", async ({ freshUser, freshBranch, pageAs }) => {
    const { volunteer } = await branchTeam(freshBranch, freshUser, "tasks-self");
    const page = await pageAs(volunteer);
    await openTasks(page);
    await page.getByTestId("tasks-new").click();
    const form = page.getByTestId("task-form");
    const options = form.getByTestId("task-form-assignees-option");
    await expect(options).toHaveCount(1, { timeout: APP_LOAD_TIMEOUT });
    await expect(options).toHaveAttribute("data-user-id", volunteer.id);
    await expect(options.getByTestId("task-form-assignees-checkbox")).toBeChecked();
    await form.getByTestId("task-form-title").fill(title("self"));
    await form.getByTestId("task-form-submit").click();
    const id = await openedTaskId(page);
    const detail = (await workRpc(volunteer, "get_task", { p_id: id })).data as { self_task: boolean; created_by: string; assignees: { id: string }[] };
    expect([detail.self_task, detail.created_by, detail.assignees.map((a) => a.id)]).toEqual([true, volunteer.id, [volunteer.id]]);
    await expect(page.getByTestId("task-panel-status")).toBeVisible();
  });

  test("upward task request: the manager accepts one (a task for them) and declines another with a note", async ({ freshUser, freshBranch, pageAs }) => {
    const { manager, volunteer } = await branchTeam(freshBranch, freshUser, "tasks-request");
    const acceptedTitle = title("please");
    const page = await pageAs(volunteer);
    await page.goto("/requests");
    await page.getByTestId("my-requests-new").click({ timeout: APP_LOAD_TIMEOUT });
    await page.getByTestId("request-type-card-task").click();
    const form = page.getByTestId("task-request-form");
    await expect(form).toBeVisible();
    await form.getByTestId("task-request-target").click();
    await page.locator(`[data-testid="task-request-target-option"][data-user-id="${manager.id}"]`).click();
    await form.getByTestId("task-request-title").fill(acceptedTitle);
    await form.getByTestId("task-request-submit").click();
    await expect(form).toBeHidden();
    const accepted = (await adminClient().from("task_requests").select("id").eq("title", acceptedTitle).single()).data!.id as string;
    await expect(page.locator(`[data-testid="work-request-row"][data-request-id="${accepted}"]`)).toHaveAttribute("data-status", "submitted");
    const declinedRes = await workRpc(volunteer, "submit_task_request", { p: { target_id: manager.id, title: title("another") } });
    expect(declinedRes.error).toBeNull();
    const declined = declinedRes.data as string;

    const reviewer = await pageAs(manager);
    await reviewer.goto("/requests?tab=review");
    const acceptRow = reviewer.locator(`[data-testid="work-review-row"][data-request-id="${accepted}"]`);
    await acceptRow.getByTestId("work-review-accept").click({ timeout: APP_LOAD_TIMEOUT });
    await expect(reviewer.getByTestId("toast-success").first()).toBeVisible();
    await expect.poll(async () => (await adminClient().from("task_requests").select("status").eq("id", accepted).single()).data?.status).toBe("accepted");
    const taskId = (await adminClient().from("task_requests").select("task_id").eq("id", accepted).single()).data!.task_id as string;
    const task = (await workRpc(manager, "get_task", { p_id: taskId })).data as { title: string; assignees: { id: string }[] };
    expect([task.title, task.assignees.map((a) => a.id)]).toEqual([acceptedTitle, [manager.id]]);

    const declineRow = reviewer.locator(`[data-testid="work-review-row"][data-request-id="${declined}"]`);
    await declineRow.getByTestId("work-review-decline").click();
    await declineRow.getByTestId("work-review-decline-note").fill("Short");
    await expect(declineRow.getByTestId("work-review-decline-confirm")).toBeDisabled();
    const note = "We are covering this next month.";
    await declineRow.getByTestId("work-review-decline-note").fill(note);
    await declineRow.getByTestId("work-review-decline-confirm").click();
    await expect.poll(async () => (await adminClient().from("task_requests").select("status").eq("id", declined).single()).data?.status).toBe("declined");

    await page.reload();
    const mine = page.locator(`[data-testid="work-request-row"][data-request-id="${declined}"]`);
    await expect(mine).toHaveAttribute("data-status", "declined", { timeout: APP_LOAD_TIMEOUT });
    await expect(mine.getByTestId("work-request-decline-note")).toContainText(note);
    await expect(page.locator(`[data-testid="work-request-row"][data-request-id="${accepted}"]`)).toHaveAttribute("data-status", "accepted");
  });

  test("the manager deletes a task and restores it from the Recycle Bin", async ({ freshUser, freshBranch, pageAs }) => {
    const { branch, manager } = await branchTeam(freshBranch, freshUser, "tasks-bin");
    const name = title("bin");
    const id = await createTaskAs(manager, { scope: "branch", branch_id: branch, title: name });
    const page = await pageAs(manager);
    await openTasks(page, id);
    await page.getByTestId("task-panel-delete").click();
    await page.getByTestId("task-delete-confirm").click();
    await expect(page.getByTestId("task-panel")).toBeHidden();
    await expect(page.getByTestId("toast-success").first()).toBeVisible();
    await expect(card(page, id)).toHaveCount(0);

    const bin = new RecycleBinPage(page);
    await bin.goto();
    await pickOption(page, "recycle-bin-type-filter", "recycle-bin-type-option", "task");
    await bin.find(id, name);
    await expect(bin.row(id)).toHaveAttribute("data-item-type", "task");
    await bin.restore(id);

    await openTasks(page);
    await expect(card(page, id)).toBeVisible({ timeout: APP_LOAD_TIMEOUT });
  });

  test.describe("at 390 px", () => {
    test.use({ viewport: { width: 390, height: 844 } });

    test("a 150-character unbroken title does not make any view scroll sideways", async ({ freshUser, freshBranch, pageAs }) => {
      const { branch, manager, volunteer } = await branchTeam(freshBranch, freshUser, "tasks-long");
      const prefix = `${TASK_TITLE_PREFIX}${runId} `;
      const long = prefix + "X".repeat(150 - prefix.length);
      const id = await createTaskAs(manager, { scope: "branch", branch_id: branch, title: long, due_date: londonDay(0), assignee_ids: [volunteer.id] });
      const page = await pageAs(manager);
      await page.setViewportSize({ width: 390, height: 844 });
      await openTasks(page);
      const sideways = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      await expect(card(page, id)).toBeVisible({ timeout: APP_LOAD_TIMEOUT });
      expect(await sideways(), "kanban").toBeLessThanOrEqual(0);
      await page.getByTestId("tasks-view-list").click();
      await expect(listRow(page, id)).toBeVisible();
      expect(await sideways(), "list").toBeLessThanOrEqual(0);
      await page.getByTestId("tasks-view-calendar").click();
      await expect(calendarItem(page, id)).toBeVisible();
      expect(await sideways(), "calendar").toBeLessThanOrEqual(0);
      await calendarItem(page, id).click();
      await expect(page.getByTestId("task-panel-title")).toBeVisible({ timeout: APP_LOAD_TIMEOUT });
      expect(await sideways(), "panel").toBeLessThanOrEqual(0);
    });
  });
});

// Tasks in the UI: the short form (title, assignees, due date; the rest under "More options"), the Kanban (drag and
// drop on desktop, the status select on phones), every task by default with my tasks marked ("My tasks" off), scope
// labels only for people with more than one scope, the list and calendar views, reminder settings (off by default),
// an assignee's own reminders, volunteer assignment, notes with @mentions, archiving, tasks from an event page, upward
// task requests, the RD branch filter with My tasks, the Recycle Bin and long titles at 390 px. Every item is created by fresh users in a temporary branch (cleaned up by the fixtures) and every check
// looks at this test's own ids only.
import type { Page } from "@playwright/test";
import { test, expect, runId, type TestUser } from "../../fixtures/roles";
import { adminClient } from "../../api/SupabaseClient";
import { TASK_TITLE_PREFIX, createTaskAs, workRpc } from "../../api/work";
import { APP_LOAD_TIMEOUT } from "../../pages/app";
import { RecycleBinPage } from "../../pages/RecycleBinPage";
import { pickOption } from "../../pages/components/select";
import { NotificationBell } from "../../pages/components/NotificationBell";

let n = 0;
const title = (label: string) => `${TASK_TITLE_PREFIX}${runId} ui-${Date.now().toString(36)}-${++n} ${label}`;
/** London "YYYY-MM-DD" `days` from today. */
const londonDay = (days = 0) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(new Date(Date.now() + days * 86400000));

const card = (page: Page, id: string) => page.locator(`[data-testid="task-card"][data-task-id="${id}"]`);
const column = (page: Page, status: string) => page.locator(`[data-testid="tasks-kanban-column"][data-status="${status}"]`);
const listRow = (page: Page, id: string) => page.locator(`[data-testid="tasks-list-row"][data-task-id="${id}"]`);
const calendarItem = (page: Page, id: string) => page.locator(`[data-testid="tasks-calendar-item"][data-task-id="${id}"]`);
const comboOption = (page: Page, prefix: string, userId: string) =>
  page.locator(`[data-testid="${prefix}-option"][data-user-id="${userId}"]`);

/** Chooses people in the form's assignee combobox (the dropdown is closed again afterwards). */
async function pickAssignees(page: Page, userIds: string[]) {
  await page.getByTestId("task-form").getByTestId("task-form-assignees-open").click();
  for (const id of userIds) await comboOption(page, "task-form-assignees", id).click();
  await page.keyboard.press("Escape");
  for (const id of userIds)
    await expect(page.getByTestId("task-form").locator(`[data-testid="task-form-assignees-chip"][data-user-id="${id}"]`)).toBeVisible();
}

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
  test("a branch manager creates and assigns a task; the assignee moves it on the Kanban; the manager is told of Done", { tag: "@smoke" }, async ({ freshUser, freshBranch, pageAs, isMobile }) => {
    const { manager, volunteer } = await branchTeam(freshBranch, freshUser, "tasks-kanban");
    const name = title("kanban");
    const due = londonDay(7);

    const managerPage = await pageAs(manager);
    await openTasks(managerPage);
    await managerPage.getByTestId("tasks-new").click();
    const form = managerPage.getByTestId("task-form");
    // The short form: title, assignee and due date only; "More options" starts collapsed.
    await expect(form.getByTestId("task-form-more")).toHaveAttribute("aria-expanded", "false");
    await expect(form.getByTestId("task-form-description")).toHaveCount(0);
    await form.getByTestId("task-form-title").fill(name);
    await pickAssignees(managerPage, [volunteer.id]);
    await form.getByTestId("task-form-due-date").fill(due);
    await form.getByTestId("task-form-submit").click();
    await expect(managerPage.getByTestId("toast-success").first()).toBeVisible();
    const id = await openedTaskId(managerPage);
    // Every task is shown by default (My tasks is off).
    await expect(managerPage.getByTestId("tasks-filter-mine")).toHaveAttribute("aria-pressed", "false");
    await expect(column(managerPage, "todo").locator(`[data-task-id="${id}"]`)).toHaveCount(1);
    const created = (await workRpc(manager, "get_task", { p_id: id })).data as { priority: string; due_date: string; assignees: { id: string }[]; reminders: { before_days: number[]; repeat_kind: string } };
    expect([created.priority, created.due_date, created.assignees.map((a) => a.id)]).toEqual(["medium", due, [volunteer.id]]);
    expect(created.reminders).toMatchObject({ before_days: [], repeat_kind: "none" });

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

    // The creator hears only when the task moves to Blocked or Done (a manager gets it in the daily summary by default).
    const statusNotices = async () =>
      ((await adminClient().from("notifications").select("kind").eq("user_id", manager.id).eq("entity_id", id)).data ?? []).map((x) => x.kind);
    expect(await statusNotices()).not.toContain("task_status_changed");
    await panel.getByTestId("task-panel-status").selectOption("done");
    await expect.poll(statusNotices).toContain("task_status_changed");
  });

  test("views: every task by default (My tasks off) with mine marked and first; one scope means no scope labels; list view is remembered; calendar marks mine", async ({ freshUser, freshBranch, pageAs }) => {
    const { branch, manager, volunteer } = await branchTeam(freshBranch, freshUser, "tasks-views");
    const today = londonDay(0);
    const other = await createTaskAs(manager, { scope: "branch", branch_id: branch, title: title("a other"), due_date: today });
    const mine = await createTaskAs(manager, { scope: "branch", branch_id: branch, title: title("b mine"), due_date: today, assignee_ids: [volunteer.id] });

    const page = await pageAs(volunteer);
    await openTasks(page);
    const mineFilter = page.getByTestId("tasks-filter-mine");
    // All tasks: mine is marked and first in its column, the other is not marked.
    await expect(card(page, other)).toBeVisible({ timeout: APP_LOAD_TIMEOUT });
    await expect(mineFilter).toHaveAttribute("aria-pressed", "false");
    await expect(card(page, mine)).toHaveAttribute("data-mine", "true");
    await expect(card(page, mine).getByTestId("task-card-mine")).toBeVisible();
    await expect(card(page, other)).toHaveAttribute("data-mine", "false");
    await expect(card(page, other).getByTestId("task-card-mine")).toHaveCount(0);
    await expect(column(page, "todo").getByTestId("task-card").first()).toHaveAttribute("data-task-id", mine);
    // A volunteer works in one branch only: no scope labels on cards.
    await expect(card(page, mine).getByTestId("task-card-scope")).toHaveCount(0);

    // "My tasks" narrows to mine.
    await mineFilter.click();
    await expect(mineFilter).toHaveAttribute("aria-pressed", "true");
    await expect(card(page, mine)).toBeVisible();
    await expect(card(page, other)).toHaveCount(0);

    // List: the same marking; "Mine first" grouping; no scope label.
    await mineFilter.click();
    await page.getByTestId("tasks-view-list").click();
    await expect(listRow(page, mine)).toHaveAttribute("data-mine", "true");
    await expect(listRow(page, mine).getByTestId("tasks-list-row-mine")).toBeVisible();
    await expect(listRow(page, other).getByTestId("tasks-list-row-mine")).toHaveCount(0);
    await expect(listRow(page, other).getByTestId("tasks-list-row-scope")).toHaveCount(0);
    await page.getByTestId("tasks-group").selectOption("mine");
    await expect(page.locator('[data-testid="tasks-list-group"][data-group="mine"]').locator(`[data-task-id="${mine}"]`)).toBeVisible();
    await expect(page.locator('[data-testid="tasks-list-group"][data-group="others"]').locator(`[data-task-id="${other}"]`)).toBeVisible();

    // The view is remembered; My tasks starts off again.
    await page.reload();
    await expect(page.getByTestId("tasks-view-list")).toHaveAttribute("aria-pressed", "true", { timeout: APP_LOAD_TIMEOUT });
    await expect(page.getByTestId("tasks-view-kanban")).toHaveAttribute("aria-pressed", "false");
    await expect(listRow(page, mine)).toBeVisible({ timeout: APP_LOAD_TIMEOUT });
    await expect(listRow(page, other)).toBeVisible();
    await expect(mineFilter).toHaveAttribute("aria-pressed", "false");

    // Calendar: both on today's date (the agenda list on phones, the month grid on desktop), mine marked.
    await page.getByTestId("tasks-view-calendar").click();
    const day = page.locator(`[data-testid="tasks-calendar-day"][data-day="${today}"]`);
    await expect(day.locator(`[data-testid="tasks-calendar-item"][data-task-id="${mine}"]`)).toHaveAttribute("data-mine", "true");
    await expect(day.locator(`[data-testid="tasks-calendar-item"][data-task-id="${other}"]`)).toHaveAttribute("data-mine", "false");
    await expect(calendarItem(page, other).getByTestId("tasks-calendar-item-scope")).toHaveCount(0);
    await mineFilter.click();
    await expect(calendarItem(page, other)).toHaveCount(0);
    await expect(calendarItem(page, mine)).toBeVisible();

    // The panel and the form show no scope either.
    await calendarItem(page, mine).click();
    await expect(page.getByTestId("task-panel-title")).toBeVisible({ timeout: APP_LOAD_TIMEOUT });
    await expect(page.getByTestId("task-panel-creator")).toBeVisible();
    await expect(page.getByTestId("task-panel-scope")).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("task-panel")).toBeHidden();
    await page.getByTestId("tasks-new").click();
    const form = page.getByTestId("task-form");
    await form.getByTestId("task-form-more").click();
    await expect(form.getByTestId("task-form-more-section")).toBeVisible();
    await expect(form.getByTestId("task-form-scope")).toHaveCount(0);
    await expect(form.getByTestId("task-form-scope-fixed")).toHaveCount(0);

    // A Regional Director (region and branch scopes) sees the scope labels.
    const director = await freshUser({ role: "regional_director" });
    const rdPage = await pageAs(director);
    await openTasks(rdPage);
    await expect(card(rdPage, other).getByTestId("task-card-scope")).toHaveAttribute("data-scope", "branch", { timeout: APP_LOAD_TIMEOUT });
  });

  test("branch filter (RD): one branch hides other branches; My tasks ignores it (shown disabled) and turning it off restores it", async ({ freshUser, freshBranch, pageAs }) => {
    const branchA = await freshBranch("tasks-filter-a");
    const branchB = await freshBranch("tasks-filter-b");
    const director = await freshUser({ role: "regional_director" });
    const inA = await createTaskAs(director, { scope: "branch", branch_id: branchA, title: title("filter a") });
    const mineInB = await createTaskAs(director, { scope: "branch", branch_id: branchB, title: title("filter b mine"), assignee_ids: [director.id] });

    const page = await pageAs(director);
    await openTasks(page);
    await expect(card(page, mineInB)).toBeVisible({ timeout: APP_LOAD_TIMEOUT });
    const branches = page.getByTestId("tasks-filter-branches");
    await expect(branches).toHaveAttribute("data-count", "0");
    await branches.click();
    await expect(page.locator('[data-testid="tasks-filter-branches-option"][data-value="region-wide"]')).toBeVisible();
    await page.locator(`[data-testid="tasks-filter-branches-option"][data-value="${branchA}"]`).click();
    await expect(page.locator(`[data-testid="tasks-filter-branches-option"][data-value="${branchA}"]`)).toHaveAttribute("aria-checked", "true");
    await page.keyboard.press("Escape");
    await expect(branches).toHaveAttribute("data-count", "1");
    await expect(card(page, inA)).toBeVisible();
    await expect(card(page, mineInB)).toHaveCount(0);

    // My tasks shows every task assigned to me, in any branch; the branch filter is ignored and shown disabled.
    await page.getByTestId("tasks-filter-mine").click();
    await expect(card(page, mineInB)).toBeVisible();
    await expect(card(page, inA)).toHaveCount(0);
    await expect(branches).toHaveAttribute("data-disabled", "true");
    await expect(branches).toHaveAttribute("aria-disabled", "true");
    await expect(page.getByTestId("tasks-filter-scope-hint")).toBeVisible();

    // Off again: the branch choice is back (and remembered after a reload).
    await page.getByTestId("tasks-filter-mine").click();
    await expect(page.getByTestId("tasks-filter-scope-hint")).toHaveCount(0);
    await expect(branches).not.toHaveAttribute("data-disabled", "true");
    await expect(branches).toHaveAttribute("data-count", "1");
    await expect(card(page, mineInB)).toHaveCount(0);
    await expect(card(page, inA)).toBeVisible();
    await page.reload();
    await expect(card(page, inA)).toBeVisible({ timeout: APP_LOAD_TIMEOUT });
    await expect(page.getByTestId("tasks-filter-branches")).toHaveAttribute("data-count", "1");
    await expect(card(page, mineInB)).toHaveCount(0);
  });

  test("a volunteer adds, edits and removes their own reminders on a task assigned to them", { tag: "@smoke" }, async ({ freshUser, freshBranch, pageAs }) => {
    const { branch, manager, volunteer } = await branchTeam(freshBranch, freshUser, "tasks-my-reminders");
    const id = await createTaskAs(manager, { scope: "branch", branch_id: branch, title: title("my reminders"), due_date: londonDay(10), assignee_ids: [volunteer.id] });
    const undated = await createTaskAs(manager, { scope: "branch", branch_id: branch, title: title("no due"), assignee_ids: [volunteer.id] });
    const stored = async () => (await adminClient().from("task_assignees").select("my_reminders").eq("task_id", id).eq("user_id", volunteer.id).single()).data?.my_reminders ?? null;

    const page = await pageAs(volunteer);
    await openTasks(page, id);
    const section = page.getByTestId("task-panel-my-reminders");
    // Off by default.
    await expect(section).toHaveAttribute("data-on", "false");
    await expect(section.getByTestId("task-panel-my-reminders-form")).toHaveCount(0);
    await section.getByTestId("task-panel-my-reminders-add").click();
    const form = section.getByTestId("task-panel-my-reminders-form");
    // The same options as the task form, starting from 3 days before.
    await expect(form.getByTestId("task-panel-my-reminders-remind-before-3")).toBeChecked();
    await form.getByTestId("task-panel-my-reminders-remind-before-1").check();
    await form.getByTestId("task-panel-my-reminders-overdue-toggle").check();
    await form.getByTestId("task-panel-my-reminders-overdue-every").fill("0");
    await form.getByTestId("task-panel-my-reminders-save").click();
    await expect(form.getByTestId("task-panel-my-reminders-overdue_every_days-error")).toBeVisible();
    await form.getByTestId("task-panel-my-reminders-overdue-every").fill("2");
    await form.getByTestId("task-panel-my-reminders-save").click();
    await expect(page.getByTestId("toast-success").first()).toBeVisible();
    await expect(section).toHaveAttribute("data-on", "true");
    await expect(section.getByTestId("task-panel-my-reminders-summary")).toBeVisible();
    await expect.poll(stored).toMatchObject({ before_days: [1, 3], repeat_kind: "none", overdue_every_days: 2 });
    // Only for them: the task's own reminders stay off.
    const detail = (await workRpc(volunteer, "get_task", { p_id: id })).data as { reminders: { before_days: number[] }; my_reminders: { before_days: number[] } };
    expect([detail.reminders.before_days, detail.my_reminders.before_days]).toEqual([[], [1, 3]]);

    // Edit: weekly repeat.
    await section.getByTestId("task-panel-my-reminders-edit").click();
    await expect(form.getByTestId("task-panel-my-reminders-remind-before-1")).toBeChecked();
    await form.getByTestId("task-panel-my-reminders-repeat-kind").selectOption("weekly");
    await form.getByTestId("task-panel-my-reminders-save").click();
    await expect.poll(async () => ((await stored()) as { repeat_kind?: string } | null)?.repeat_kind).toBe("weekly");

    // Remove.
    await section.getByTestId("task-panel-my-reminders-remove").click();
    await expect(section).toHaveAttribute("data-on", "false");
    await expect(section.getByTestId("task-panel-my-reminders-add")).toBeVisible();
    await expect.poll(stored).toBeNull();

    // Reminders need a due date.
    await openTasks(page, undated);
    await expect(page.getByTestId("task-panel-my-reminders-need-due")).toBeVisible();
    await expect(page.getByTestId("task-panel-my-reminders-add")).toHaveCount(0);
  });

  test("reminder settings: the manager sets them in the form; the assignee sees them read-only and mutes them", async ({ freshUser, freshBranch, pageAs }) => {
    const { branch, manager, volunteer } = await branchTeam(freshBranch, freshUser, "tasks-reminders");
    const id = await createTaskAs(manager, { scope: "branch", branch_id: branch, title: title("reminders"), due_date: londonDay(10), assignee_ids: [volunteer.id] });

    const managerPage = await pageAs(manager);
    await openTasks(managerPage, id);
    await managerPage.getByTestId("task-panel-edit").click();
    const form = managerPage.getByTestId("task-form");
    await form.getByTestId("task-form-more").click();
    const reminders = form.getByTestId("task-form-reminders");
    await expect(reminders).toBeVisible();
    // Off by default; "Remind me" starts from 3 days before.
    await expect(reminders.getByTestId("task-form-reminders-toggle")).not.toBeChecked();
    await expect(reminders.getByTestId("task-form-remind-before-3")).toHaveCount(0);
    await reminders.getByTestId("task-form-reminders-toggle").check();
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

  test("a volunteer assigns themselves and another volunteer of their branch; managers are not offered", async ({ freshUser, freshBranch, pageAs }) => {
    const { branch, manager, volunteer } = await branchTeam(freshBranch, freshUser, "tasks-self");
    const colleague = await freshUser({ role: "volunteer", branch });
    const page = await pageAs(volunteer);
    await openTasks(page);
    await page.getByTestId("tasks-new").click();
    const form = page.getByTestId("task-form");
    // Themselves preselected; the dropdown offers the other volunteer but not the Branch Manager.
    await expect(form.locator(`[data-testid="task-form-assignees-chip"][data-user-id="${volunteer.id}"]`)).toBeVisible({ timeout: APP_LOAD_TIMEOUT });
    await form.getByTestId("task-form-assignees-open").click();
    await expect(comboOption(page, "task-form-assignees", colleague.id)).toBeVisible();
    await expect(comboOption(page, "task-form-assignees", manager.id)).toHaveCount(0);
    await page.keyboard.press("Escape");
    await pickAssignees(page, [colleague.id]);
    await form.getByTestId("task-form-title").fill(title("self"));
    await form.getByTestId("task-form-submit").click();
    const id = await openedTaskId(page);
    const detail = (await workRpc(volunteer, "get_task", { p_id: id })).data as { self_task: boolean; created_by: string; assignees: { id: string }[] };
    expect([detail.self_task, detail.created_by, detail.assignees.map((a) => a.id).sort()]).toEqual([true, volunteer.id, [volunteer.id, colleague.id].sort()]);
    await expect(page.getByTestId("task-panel-status")).toBeVisible();
  });

  test("notes: an assignee writes a note with an @mention (the mentioned person and the creator are told), edits and deletes it", { tag: "@smoke" }, async ({ freshUser, freshBranch, pageAs }) => {
    const { branch, manager, volunteer } = await branchTeam(freshBranch, freshUser, "tasks-notes");
    const colleague = await freshUser({ role: "volunteer", branch });
    const id = await createTaskAs(manager, { scope: "branch", branch_id: branch, title: title("notes"), assignee_ids: [volunteer.id] });

    const page = await pageAs(volunteer);
    await openTasks(page, id);
    const notes = page.getByTestId("task-notes");
    await expect(notes.getByTestId("task-notes-empty")).toBeVisible({ timeout: APP_LOAD_TIMEOUT });
    const input = notes.getByTestId("task-note-input");
    await input.click();
    // Typing "@" opens the picker of people who can see the task.
    await input.pressSequentially("Venue booked, please check @");
    await page.locator(`[data-testid="task-note-mention-option"][data-user-id="${colleague.id}"]`).click();
    await expect(notes.locator(`[data-testid="task-note-mention-chip"][data-user-id="${colleague.id}"]`)).toBeVisible();
    await notes.getByTestId("task-note-submit").click();
    await expect(page.getByTestId("toast-success").first()).toBeVisible();
    const note = notes.getByTestId("task-note");
    await expect(note).toHaveCount(1);
    await expect(note).toHaveAttribute("data-mine", "true");
    await expect(note.getByTestId("task-note-body")).toContainText("@");
    const noteId = (await note.getAttribute("data-note-id"))!;
    await expect
      .poll(async () => ((await adminClient().from("notifications").select("kind").eq("user_id", colleague.id).eq("entity_id", id)).data ?? []).map((n) => n.kind))
      .toContain("task_note_mention");
    const creatorKinds = ((await adminClient().from("notifications").select("kind").eq("user_id", manager.id).eq("entity_id", id)).data ?? []).map((n) => n.kind);
    expect(creatorKinds).toContain("task_note_added");

    // The mentioned person sees the notice behind the header bell, and the note count on the card.
    const other = await pageAs(colleague);
    await other.goto("/dashboard");
    const bell = new NotificationBell(other);
    await bell.open();
    await expect(bell.notice("task_note_mention")).toBeVisible({ timeout: APP_LOAD_TIMEOUT });
    await bell.close();
    await openTasks(other);
    await expect(card(other, id).getByTestId("task-card-notes")).toHaveAttribute("data-count", "1");
    // Only the author edits or deletes a note.
    await card(other, id).getByTestId("task-card-open").click();
    await expect(other.locator(`[data-testid="task-note"][data-note-id="${noteId}"]`)).toHaveAttribute("data-mine", "false");
    await expect(other.getByTestId("task-note-edit")).toHaveCount(0);

    // The author edits, then deletes (with a confirmation).
    await note.getByTestId("task-note-edit").click();
    await note.getByTestId("task-note-input").fill("Venue booked for Friday.");
    await note.getByTestId("task-note-save").click();
    await expect(note.getByTestId("task-note-body")).toHaveText("Venue booked for Friday.");
    await expect(note.getByTestId("task-note-edited")).toBeVisible();
    await note.getByTestId("task-note-delete").click();
    await page.getByTestId("task-note-delete-confirm").click();
    await expect(notes.getByTestId("task-notes-empty")).toBeVisible();
    await expect.poll(async () => (await adminClient().from("task_notes").select("id").eq("id", noteId)).data?.length).toBe(0);
  });

  test("archive: Archive all done on the Kanban, the Archived filter with Unarchive, and archive from the panel", async ({ freshUser, freshBranch, pageAs }) => {
    const { branch, manager, volunteer } = await branchTeam(freshBranch, freshUser, "tasks-archive");
    const done1 = await createTaskAs(manager, { scope: "branch", branch_id: branch, title: title("done one"), status: "done", assignee_ids: [volunteer.id] });
    const done2 = await createTaskAs(manager, { scope: "branch", branch_id: branch, title: title("done two"), status: "done" });
    const open = await createTaskAs(manager, { scope: "branch", branch_id: branch, title: title("open"), status: "in_progress" });
    const archivedAt = async (taskId: string) => (await adminClient().from("tasks").select("archived_at").eq("id", taskId).single()).data?.archived_at ?? null;

    const page = await pageAs(manager);
    await openTasks(page);
    await expect(card(page, done1)).toBeVisible({ timeout: APP_LOAD_TIMEOUT });
    await expect(card(page, done1)).toHaveAttribute("data-archived", "false");
    const archiveAll = column(page, "done").getByTestId("tasks-kanban-archive-done");
    await expect(archiveAll).toHaveAttribute("data-count", "2");
    await archiveAll.click();
    await expect(page.getByTestId("toast-success").first()).toBeVisible();
    await expect(card(page, done1)).toHaveCount(0);
    await expect(card(page, done2)).toHaveCount(0);
    await expect(card(page, open)).toBeVisible();
    await expect.poll(() => archivedAt(done1)).not.toBeNull();
    expect(await archivedAt(done2)).not.toBeNull();
    expect(await archivedAt(open)).toBeNull();

    // The Archived filter shows only archived tasks; Unarchive brings one back to the board.
    const archivedFilter = page.getByTestId("tasks-filter-archived");
    await archivedFilter.click();
    await expect(archivedFilter).toHaveAttribute("aria-pressed", "true");
    await expect(card(page, done1)).toHaveAttribute("data-archived", "true");
    await expect(card(page, open)).toHaveCount(0);
    await card(page, done1).getByTestId("task-card-unarchive").click();
    await expect(card(page, done1)).toHaveCount(0);
    await expect.poll(() => archivedAt(done1)).toBeNull();
    await archivedFilter.click();
    await expect(column(page, "done").locator(`[data-testid="task-card"][data-task-id="${done1}"]`)).toBeVisible();

    // From the panel: archive, then unarchive.
    await card(page, done1).getByTestId("task-card-open").click();
    await page.getByTestId("task-panel-archive").click();
    await expect(page.getByTestId("task-panel-unarchive")).toBeVisible();
    await expect.poll(() => archivedAt(done1)).not.toBeNull();
    await page.getByTestId("task-panel-unarchive").click();
    await expect(page.getByTestId("task-panel-archive")).toBeVisible();
    await expect.poll(() => archivedAt(done1)).toBeNull();
  });

  test("a task from an event page: the manager adds it, and a volunteer sees it in the event's linked tasks", async ({ freshUser, freshBranch, freshEvent, pageAs }) => {
    const { branch, manager, volunteer } = await branchTeam(freshBranch, freshUser, "tasks-event");
    const event = await freshEvent(manager, { label: "with tasks", status: "published", startInMinutes: 3 * 24 * 60, branchId: branch });
    const page = await pageAs(manager);
    await page.goto(`/events/${event.id}`);
    await page.getByTestId("event-add-task").click({ timeout: APP_LOAD_TIMEOUT });
    const form = page.getByTestId("task-form");
    await expect(form.getByTestId("task-form-from-event")).toBeVisible();
    await expect(form.getByTestId("task-form-scope-fixed")).toHaveAttribute("data-scope", `branch:${branch}`);
    const name = title("event");
    await form.getByTestId("task-form-title").fill(name);
    await form.getByTestId("task-form-submit").click();
    await expect(form).toBeHidden();
    const created = (await adminClient().from("tasks").select("id, event_id").eq("title", name).single()).data!;
    expect(created.event_id).toBe(event.id);
    await expect(page.locator(`[data-testid="event-linked-task"][data-task-id="${created.id}"]`)).toBeVisible();

    const other = await pageAs(volunteer);
    await other.goto(`/events/${event.id}`);
    await expect(other.locator(`[data-testid="event-linked-task"][data-task-id="${created.id}"]`)).toHaveAttribute("data-status", "todo", { timeout: APP_LOAD_TIMEOUT });
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

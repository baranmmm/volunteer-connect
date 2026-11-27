// "@all" task groups and meeting carry-over in the UI: the branch manager assigns a task to every member, members see
// only their own task, everyone else one group row (Kanban by derived status, list with members, calendar), the group
// panel edits (to every member task), adds and removes members and deletes after confirming; a group from a meeting
// decision shows as one row there and on the meeting's calendar entry; a new meeting carries over an unresolved item
// with its decision and open task (moved, not copied). Fresh users in a temporary branch; checks look at own ids only.
import type { Page } from "@playwright/test";
import { decisionAction } from "../../pages/components/DecisionActions";
import { test, expect, runId, type TestUser } from "../../fixtures/roles";
import { adminClient } from "../../api/SupabaseClient";
import { MEETING_TITLE_PREFIX, TASK_TITLE_PREFIX, createMeetingAs, inDays, workRpc } from "../../api/work";
import { APP_LOAD_TIMEOUT } from "../../pages/app";
import { pickOption } from "../../pages/components/select";
import { setStatusByMenu, showBoard } from "../../pages/components/tasks";

let n = 0;
const title = (label: string) => `${TASK_TITLE_PREFIX}${runId} grp-${Date.now().toString(36)}-${++n} ${label}`;
const londonDay = (days = 0) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(new Date(Date.now() + days * 86400000));
const groupCard = (page: Page, id: string) => page.locator(`[data-testid="task-group-card"][data-group-id="${id}"]`);
const column = (page: Page, status: string) => page.locator(`[data-testid="tasks-kanban-column"][data-status="${status}"]`);

async function openTasks(page: Page, query = "") {
  await page.goto(`/tasks${query}`);
  await expect(page.getByTestId("tasks-view-kanban")).toBeVisible({ timeout: APP_LOAD_TIMEOUT });
  if (!query) await showBoard(page);
}
async function team(freshBranch: (label: string) => Promise<string>, freshUser: (o: { role: "branch_manager" | "volunteer"; branch: string }) => Promise<TestUser>, label: string) {
  const branch = await freshBranch(label);
  const manager = await freshUser({ role: "branch_manager", branch });
  const v1 = await freshUser({ role: "volunteer", branch });
  const v2 = await freshUser({ role: "volunteer", branch });
  return { branch, manager, v1, v2 };
}
type GroupJson = { id: string; title: string; status: string; member_count: number; members: { task_id: string; user_id: string }[] };
const groupsOf = async (who: TestUser) => ((await workRpc(who, "list_task_groups")).data ?? []) as GroupJson[];

test.describe("Task groups (@all)", () => {
  test("@all: one task per member; members see only their own; the manager sees one group row with progress; edit, members and delete", async ({ freshUser, freshBranch, pageAs }) => {
    test.setTimeout(120_000);
    const { branch, manager, v1, v2 } = await team(freshBranch, freshUser, "groups-ui");
    const name = title("bring a friend");
    const due = londonDay(5);

    // The manager creates it with "@all" in the short form.
    const page = await pageAs(manager);
    await openTasks(page);
    await page.getByTestId("tasks-new").click();
    const form = page.getByTestId("task-form");
    await form.getByTestId("task-form-title").fill(name);
    await form.getByTestId("task-form-all-members").check();
    await expect(form.getByTestId("task-form-assignees")).toHaveCount(0);
    await form.getByTestId("task-form-due-date").fill(due);
    await form.getByTestId("task-form-submit").click();
    await expect(form).toBeHidden({ timeout: APP_LOAD_TIMEOUT });
    await expect(page).toHaveURL(/[?&]group=[0-9a-f-]{36}/, { timeout: APP_LOAD_TIMEOUT });
    const groupId = new URL(page.url()).searchParams.get("group")!;
    const panel = page.getByTestId("task-group-panel");
    await expect(panel.getByTestId("task-group-panel-title")).toHaveText(name);
    await expect(panel.getByTestId("task-group-member")).toHaveCount(3);
    const [g] = (await groupsOf(manager)).filter((x) => x.id === groupId);
    expect(g!.members.map((m) => m.user_id).sort()).toEqual([manager.id, v1.id, v2.id].sort());
    const v1Task = g!.members.find((m) => m.user_id === v1.id)!.task_id;
    await page.keyboard.press("Escape");

    // A member: only their own task, no group row; they move it to In progress.
    const asV1 = await pageAs(v1);
    await openTasks(asV1);
    await expect(asV1.locator(`[data-testid="task-card"][data-task-id="${v1Task}"]`)).toHaveAttribute("data-mine", "true", { timeout: APP_LOAD_TIMEOUT });
    await expect(groupCard(asV1, groupId)).toHaveCount(0);
    for (const m of g!.members.filter((x) => x.user_id !== v1.id))
      await expect(asV1.locator(`[data-testid="task-card"][data-task-id="${m.task_id}"]`)).toHaveCount(0);
    await setStatusByMenu(asV1, asV1.locator(`[data-testid="task-card"][data-task-id="${v1Task}"]`).getByTestId("task-card-menu"), "in_progress");
    await expect.poll(async () => (await adminClient().from("tasks").select("status").eq("id", v1Task).single()).data?.status).toBe("in_progress");

    // The manager is a member too (their own task). The group row is for people outside the group: a volunteer who
    // joined the branch after the snapshot.
    const outsider = await freshUser({ role: "volunteer", branch });
    const asOutsider = await pageAs(outsider);
    await openTasks(asOutsider);
    const card = groupCard(asOutsider, groupId);
    await expect(column(asOutsider, "in_progress").locator(`[data-testid="task-group-card"][data-group-id="${groupId}"]`)).toBeVisible({ timeout: APP_LOAD_TIMEOUT });
    await expect(card.getByTestId("task-group-members-label")).toHaveAttribute("data-count", "3");
    await expect(card.getByTestId("task-group-progress")).toHaveAttribute("data-done", "0");
    // Not draggable and no status menu: each member changes their own task.
    await expect(card.getByTestId("task-card-menu")).toHaveCount(0);
    await asOutsider.getByTestId("tasks-view-list").click();
    const row = asOutsider.locator(`[data-testid="task-group-row"][data-group-id="${groupId}"]`);
    await row.getByTestId("task-group-row-toggle").click();
    await expect(row.getByTestId("task-group-member")).toHaveCount(3);
    await expect(row.locator(`[data-testid="task-group-member"][data-task-id="${v1Task}"]`)).toHaveAttribute("data-status", "in_progress");

    // The manager edits the group: the title goes to every member task.
    await openTasks(page, `?group=${groupId}`);
    await panel.getByTestId("task-group-panel-edit").click();
    const editForm = page.getByTestId("task-group-form");
    const renamed = `${name} (two)`;
    await editForm.getByTestId("task-group-form-title").fill(renamed);
    await editForm.getByTestId("task-group-form-submit").click();
    await expect(page.getByTestId("toast-success")).toBeVisible();
    await expect.poll(async () => {
      const r = await adminClient().from("tasks").select("title").eq("group_id", groupId).is("deleted_at", null);
      return [...new Set((r.data ?? []).map((x) => x.title))];
    }).toEqual([renamed]);

    // Members: the outsider is added (own task), v2 is removed after confirming.
    await panel.getByTestId("task-group-add-people-open").click();
    await page.locator(`[data-testid="task-group-add-people-option"][data-user-id="${outsider.id}"]`).click();
    await page.keyboard.press("Escape");
    await panel.getByTestId("task-group-add-submit").click();
    await expect(panel.locator(`[data-testid="task-group-member"][data-user-id="${outsider.id}"]`)).toBeVisible({ timeout: APP_LOAD_TIMEOUT });
    await panel.locator(`[data-testid="task-group-member"][data-user-id="${v2.id}"]`).getByTestId("task-group-member-remove").click();
    await page.getByTestId("task-group-remove-confirm").click();
    await expect(panel.locator(`[data-testid="task-group-member"][data-user-id="${v2.id}"]`)).toHaveCount(0, { timeout: APP_LOAD_TIMEOUT });
    await expect(panel.getByTestId("task-group-member")).toHaveCount(3);

    // Delete asks first, then every member task goes to the Recycle Bin.
    await panel.getByTestId("task-group-panel-delete").click();
    const dialog = page.getByTestId("task-group-delete-dialog");
    await dialog.getByTestId("task-group-delete-cancel").click();
    await expect(panel.getByTestId("task-group-panel-title")).toBeVisible();
    await panel.getByTestId("task-group-panel-delete").click();
    await dialog.getByTestId("task-group-delete-confirm").click();
    await expect(dialog).toBeHidden({ timeout: APP_LOAD_TIMEOUT });
    await expect.poll(async () => (await adminClient().from("task_groups").select("id").eq("id", groupId)).data?.length).toBe(0);
    const left = await adminClient().from("tasks").select("deleted_at").eq("title", renamed);
    expect((left.data ?? []).every((x) => x.deleted_at !== null)).toBe(true);
  });

  test("a volunteer creates @all for their branch: every volunteer and the manager get a task; the manager is notified and opens the group", async ({ freshUser, freshBranch, pageAs }) => {
    const { manager, v1, v2 } = await team(freshBranch, freshUser, "groups-volunteer");
    const name = title("volunteer all");
    const page = await pageAs(v1);
    await openTasks(page);
    await page.getByTestId("tasks-new").click();
    const form = page.getByTestId("task-form");
    await form.getByTestId("task-form-title").fill(name);
    await form.getByTestId("task-form-all-members").check();
    await form.getByTestId("task-form-submit").click();
    await expect(form).toBeHidden({ timeout: APP_LOAD_TIMEOUT });
    await expect(page).toHaveURL(/[?&]group=[0-9a-f-]{36}/, { timeout: APP_LOAD_TIMEOUT });
    const groupId = new URL(page.url()).searchParams.get("group")!;
    const [g] = (await groupsOf(v1)).filter((x) => x.id === groupId);
    expect(g!.members.map((m) => m.user_id).sort()).toEqual([manager.id, v1.id, v2.id].sort());
    // The manager's notice: "<name> created a task for all members", linking to the group (no approval step).
    const notice = await adminClient()
      .from("notifications")
      .select("kind, link, actor_id")
      .eq("user_id", manager.id)
      .eq("kind", "task_group_created")
      .single();
    expect(notice.data).toEqual({ kind: "task_group_created", link: `/tasks?group=${groupId}`, actor_id: v1.id });
    const managerPage = await pageAs(manager);
    await managerPage.goto(notice.data!.link);
    await expect(managerPage.getByTestId("task-group-panel").getByTestId("task-group-panel-title")).toHaveText(name, { timeout: APP_LOAD_TIMEOUT });
  });

  test("a group from a meeting decision is one row under the decision and on the meeting's calendar entry", async ({ freshUser, freshBranch, pageAs }) => {
    const { branch, manager, v1 } = await team(freshBranch, freshUser, "groups-meeting");
    const meeting = await createMeetingAs(manager, { scope: "branch", branch_id: branch, title: `${MEETING_TITLE_PREFIX}${runId} grp`, starts_at: inDays(3), ends_at: inDays(3, 1), invitee_ids: [v1.id] });
    const item = (await workRpc(manager, "add_agenda_item", { p_meeting: meeting, p_title: "Outreach" })).data as string;
    await workRpc(manager, "add_meeting_decision", { p_item: item, p_text: `${TASK_TITLE_PREFIX}${runId} everyone brings a friend` });
    const page = await pageAs(manager);
    await page.goto(`/meetings/${meeting}`);
    const agendaItem = page.locator(`[data-testid="meeting-agenda-item"][data-item-id="${item}"]`);
    await agendaItem.getByTestId("meeting-agenda-item-toggle").click({ timeout: APP_LOAD_TIMEOUT });
    await decisionAction(page, agendaItem.getByTestId("meeting-decision"), "create-task");
    const form = page.getByTestId("task-form");
    await form.getByTestId("task-form-all-members").check();
    await form.getByTestId("task-form-submit").click();
    await expect(form).toBeHidden({ timeout: APP_LOAD_TIMEOUT });
    const row = agendaItem.getByTestId("meeting-decision-group");
    await expect(row).toHaveCount(1, { timeout: APP_LOAD_TIMEOUT });
    await expect(agendaItem.getByTestId("meeting-decision-task")).toHaveCount(0);
    await expect(agendaItem.getByTestId("meeting-agenda-item-counts")).toHaveAttribute("data-tasks", "1");
    await expect(row.getByTestId("task-group-members-label")).toHaveAttribute("data-count", "3");
    await row.getByTestId("meeting-decision-group-toggle").click();
    await expect(row.getByTestId("task-group-member")).toHaveCount(3);
    // A member's task opens in the side panel on the meeting page.
    await row.getByTestId("task-group-member-open").first().click();
    await expect(page).toHaveURL(new RegExp(`/meetings/${meeting}\\?task=`));
    await expect(page.getByTestId("task-panel-title")).toBeVisible({ timeout: APP_LOAD_TIMEOUT });
    await page.keyboard.press("Escape");

    const eventId = (await adminClient().from("meetings").select("event_id").eq("id", meeting).single()).data!.event_id as string;
    await page.goto(`/events/${eventId}`);
    await expect(page.getByTestId("event-linked-group")).toHaveCount(1, { timeout: APP_LOAD_TIMEOUT });
    await expect(page.getByTestId("event-linked-task")).toHaveCount(0);
  });

  test("carry-over: a new meeting brings an unresolved item and its decision; the open task is shared (never moved or copied)", async ({ freshUser, freshBranch, pageAs }) => {
    const { branch, manager, v1 } = await team(freshBranch, freshUser, "groups-carry");
    const oldTitle = `${MEETING_TITLE_PREFIX}${runId} carry old`;
    const newTitle = `${MEETING_TITLE_PREFIX}${runId} carry new`;
    const old = await createMeetingAs(manager, { scope: "branch", branch_id: branch, title: oldTitle, starts_at: inDays(-7), ends_at: inDays(-7, 1) });
    const item = (await workRpc(manager, "add_agenda_item", { p_meeting: old, p_title: "Hall booking" })).data as string;
    const decision = (await workRpc(manager, "add_meeting_decision", { p_item: item, p_text: "Ask for quotes" })).data as string;
    const task = (await workRpc(manager, "create_task", { p: { scope: "branch", branch_id: branch, title: title("quotes"), decision_id: decision, assignee_ids: [v1.id] } })).data as string;

    const page = await pageAs(manager);
    await page.goto("/meetings");
    await page.getByTestId("meetings-new").click({ timeout: APP_LOAD_TIMEOUT });
    const form = page.getByTestId("meeting-form");
    await form.getByTestId("meeting-form-title").fill(newTitle);
    await form.getByTestId("meeting-form-start-date").fill(londonDay(4));
    await pickOption(page, "meeting-form-start-time", "meeting-form-start-time-option", "18:00");
    await form.getByTestId("meeting-form-location").fill("Hall");
    const toggle = form.getByTestId("meeting-form-carry-toggle");
    await expect(toggle).toHaveAttribute("aria-expanded", "false", { timeout: APP_LOAD_TIMEOUT });
    await toggle.click();
    await form.locator(`[data-testid="meeting-form-carry-item"][data-item-id="${item}"]`).check();
    await expect(form.locator(`[data-testid="meeting-form-carry-decision"][data-decision-id="${decision}"]`)).toBeChecked();
    // The decision's open task is listed read-only (no checkbox): it is shared, not moved.
    const listed = form.locator(`[data-testid="meeting-form-carry-task"][data-task-id="${task}"]`);
    await expect(listed).toBeVisible();
    await expect(listed.locator("input")).toHaveCount(0);
    await form.getByTestId("meeting-form-submit").click();
    await expect(page).toHaveURL(/\/meetings\/[0-9a-f-]{36}/, { timeout: APP_LOAD_TIMEOUT });
    const created = page.url().split("/meetings/")[1]!.split("?")[0]!;
    await expect(page.getByTestId("meeting-agenda-item-title")).toHaveText("Hall booking", { timeout: APP_LOAD_TIMEOUT });
    // One task, still on the earlier meeting and its decision; the copy points to the decision.
    expect((await adminClient().from("tasks").select("meeting_id, decision_id").eq("id", task).single()).data).toEqual({ meeting_id: old, decision_id: decision });
    const copy = (await adminClient().from("meeting_decisions").select("id, carried_from").eq("meeting_id", created).single()).data!;
    expect(copy.carried_from).toBe(decision);
    // Not copied: no task on the copy, and the new meeting owns none.
    expect((await adminClient().from("tasks").select("id").eq("decision_id", copy.id)).data).toEqual([]);
    expect((await adminClient().from("tasks").select("id").eq("meeting_id", created)).data).toEqual([]);
    expect((await adminClient().from("meeting_agenda_items").select("carried_to").eq("id", item).single()).data!.carried_to).not.toBeNull();

    // The task shows under the decision in both meetings, counted in both.
    for (const meetingId of [created, old]) {
      await page.goto(`/meetings/${meetingId}`);
      const agendaItem = page.getByTestId("meeting-agenda-item").first();
      await expect(agendaItem.getByTestId("meeting-agenda-item-counts")).toHaveAttribute("data-tasks", "1", { timeout: APP_LOAD_TIMEOUT });
      await agendaItem.getByTestId("meeting-agenda-item-toggle").click();
      const toggleTasks = agendaItem.getByTestId("meeting-decision-tasks-toggle");
      await expect(toggleTasks).toHaveAttribute("data-tasks", "1");
      await toggleTasks.click();
      await expect(agendaItem.locator(`[data-testid="meeting-decision-task"][data-task-id="${task}"]`)).toBeVisible();
    }

    // Tasks page: listed once (under the meeting where it was created), with "Also in" naming the new meeting.
    await page.goto("/tasks");
    const row = page.locator(`[data-testid="tasks-list-row"][data-task-id="${task}"]`);
    await expect(row).toHaveCount(1, { timeout: APP_LOAD_TIMEOUT });
    const also = row.getByTestId("tasks-list-row-decision-also-in");
    await expect(also).toHaveAttribute("data-count", "1");
    await expect(also).toContainText(newTitle);
  });
});

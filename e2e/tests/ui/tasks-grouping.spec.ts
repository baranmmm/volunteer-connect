// The Tasks page layout: full content width, List by default, "Group by" (Source by default: meeting agenda item,
// event, Other tasks; also Due date and Assignee) with done/total, collapsible headers remembered per user (all-done
// sections start collapsed), compact one-line rows with a status menu, the "mine" highlight without a pill, @all groups
// as one row in their source group, and the Board with the same sections as swimlanes (drag still changes the status).
// Fresh users in a temporary branch; checks look at own ids only.
import type { Page } from "@playwright/test";
import { test, expect, runId, type TestUser } from "../../fixtures/roles";
import { adminClient } from "../../api/SupabaseClient";
import { MEETING_TITLE_PREFIX, TASK_TITLE_PREFIX, createMeetingAs, createTaskAs, inDays, workRpc } from "../../api/work";
import { APP_LOAD_TIMEOUT } from "../../pages/app";
import { setStatusByMenu, showBoard } from "../../pages/components/tasks";

let n = 0;
const title = (label: string) => `${TASK_TITLE_PREFIX}${runId} grpby-${Date.now().toString(36)}-${++n} ${label}`;
const londonDay = (days = 0) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(new Date(Date.now() + days * 86400000));
const section = (page: Page, key: string) => page.locator(`[data-testid="tasks-section"][data-section-key="${key}"]`);
const listRow = (page: Page, id: string) => page.locator(`[data-testid="tasks-list-row"][data-task-id="${id}"]`);
const status = async (id: string) => (await adminClient().from("tasks").select("status").eq("id", id).single()).data?.status;

/** A branch team with a meeting (two agenda items, decisions) and an event, and tasks from each source. */
async function setup(
  freshBranch: (label: string) => Promise<string>,
  freshUser: (o: { role: "branch_manager" | "volunteer" | "regional_director"; branch?: string }) => Promise<TestUser>,
  freshEvent: (owner: TestUser, spec: { label: string; status: "published"; startInMinutes: number }) => Promise<{ id: string; title: string }>,
) {
  const branch = await freshBranch("grpby");
  const manager = await freshUser({ role: "branch_manager", branch });
  const volunteer = await freshUser({ role: "volunteer", branch });
  const meetingTitle = `${MEETING_TITLE_PREFIX}${runId} grpby committee`;
  const meeting = await createMeetingAs(manager, { scope: "branch", branch_id: branch, title: meetingTitle, starts_at: inDays(-3), ends_at: inDays(-3, 1), invitee_ids: [volunteer.id] });
  const item = async (t: string) => (await workRpc(manager, "add_agenda_item", { p_meeting: meeting, p_title: t })).data as string;
  const decision = async (i: string, t: string) => (await workRpc(manager, "add_meeting_decision", { p_item: i, p_text: t })).data as string;
  const plan = await item("Iftar plan");
  const hall = await item("Hall booking");
  const caterer = await decision(plan, "Book a caterer");
  const quotes = await decision(hall, "Ask for quotes");
  const event = await freshEvent(manager, { label: "grpby dinner", status: "published", startInMinutes: 20 * 1440 });
  const t = (label: string, extra: Record<string, unknown>) =>
    createTaskAs(manager, { scope: "branch", branch_id: branch, title: title(label), ...extra });
  const longTitle = "a long title that must stay readable on one line: book the caterer and confirm the dietary requirements";
  const tasks = {
    mine: await t(longTitle, { decision_id: caterer, assignee_ids: [volunteer.id], due_date: londonDay(-1) }),
    planOther: await t("plan other", { decision_id: caterer, assignee_ids: [manager.id], due_date: londonDay(9) }),
    hallDone1: await t("hall done 1", { decision_id: quotes, assignee_ids: [manager.id], status: "done", due_date: londonDay(-10) }),
    hallDone2: await t("hall done 2", { decision_id: quotes, assignee_ids: [manager.id], status: "done" }),
    event: await t("event flyers", { event_id: event.id, assignee_ids: [volunteer.id], due_date: londonDay(30) }),
    other: await t("noticeboard", { assignee_ids: [manager.id] }),
  };
  return { branch, manager, volunteer, meeting, meetingTitle, plan, hall, caterer, event, tasks };
}

test.describe("Tasks: grouping and compact rows", () => {
  test("List by default, full width, grouped by source with done/total; collapse is remembered; all-done sections start collapsed", { tag: "@smoke" }, async ({ freshUser, freshBranch, freshEvent, pageAs, isMobile }) => {
    test.setTimeout(120_000);
    const s = await setup(freshBranch, freshUser, freshEvent);
    const page = await pageAs(s.volunteer);
    await page.goto("/tasks");
    await expect(page.getByTestId("tasks-view-list")).toHaveAttribute("aria-pressed", "true", { timeout: APP_LOAD_TIMEOUT });
    await expect(page.getByTestId("tasks-group-by")).toHaveValue("source");
    await expect(page.locator("main")).toHaveAttribute("data-width", "wide");

    // Source sections: "<agenda item> · <meeting> (<date>)", the event, then Other tasks; each with done/total.
    const plan = section(page, `agenda:${s.plan}`);
    await expect(plan.locator(`[data-task-id="${s.tasks.mine}"]`)).toBeVisible({ timeout: APP_LOAD_TIMEOUT });
    await expect(plan.locator(`[data-task-id="${s.tasks.planOther}"]`)).toBeVisible();
    await expect(plan.getByTestId("tasks-section-label")).toContainText(`Iftar plan · ${s.meetingTitle} (`);
    await expect(plan.getByTestId("tasks-section-progress")).toHaveAttribute("data-total", "2");
    await expect(section(page, `event:${s.event.id}`).locator(`[data-task-id="${s.tasks.event}"]`)).toBeVisible();
    await expect(section(page, `event:${s.event.id}`).getByTestId("tasks-section-label")).toContainText(s.event.title);
    await expect(section(page, "other").locator(`[data-task-id="${s.tasks.other}"]`)).toBeVisible();
    const order = await page.getByTestId("tasks-section").evaluateAll((els) => els.map((e) => e.getAttribute("data-section-key")));
    expect(order.indexOf(`agenda:${s.plan}`)).toBeLessThan(order.indexOf(`event:${s.event.id}`));
    expect(order.indexOf(`event:${s.event.id}`)).toBeLessThan(order.indexOf("other"));

    // Every task in "Hall booking" is done: it starts collapsed, with 2/2.
    const hall = section(page, `agenda:${s.hall}`);
    await expect(hall).toHaveAttribute("data-collapsed", "true");
    await expect(hall.getByTestId("tasks-section-progress")).toHaveAttribute("data-done", "2");
    await expect(hall.locator(`[data-task-id="${s.tasks.hallDone1}"]`)).toHaveCount(0);

    // Compact rows: one line, the long title gets most of the row; mine: accent bar and bold, no pill.
    const row = listRow(page, s.tasks.mine);
    await expect(row).toHaveAttribute("data-mine", "true");
    const box = (await row.boundingBox())!;
    expect(box.height).toBeLessThanOrEqual(48);
    const titleBox = (await row.getByTestId("tasks-list-row-title").boundingBox())!;
    expect(titleBox.width / box.width).toBeGreaterThan(isMobile ? 0.3 : 0.5);
    expect(await row.getByTestId("tasks-list-row-title").evaluate((el) => Number(getComputedStyle(el).fontWeight))).toBeGreaterThanOrEqual(700);
    expect(await page.getByTestId("tasks-list-item").filter({ has: row }).evaluate((el) => getComputedStyle(el).borderLeftWidth)).toBe("4px");
    await expect(page.getByTestId("tasks-list-row-mine")).toHaveCount(0);
    // No horizontal page scroll (phones included).
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);

    // The status pill opens a menu.
    const pill = page.locator(`[data-testid="tasks-list-item"]`).filter({ has: row }).getByTestId("tasks-list-row-status");
    await setStatusByMenu(page, pill, "in_progress");
    await expect.poll(() => status(s.tasks.mine)).toBe("in_progress");
    await expect(plan.getByTestId("tasks-section-progress")).toHaveAttribute("data-done", "0");

    // Collapse and open are remembered per user.
    await plan.getByTestId("tasks-section-toggle").click();
    await expect(plan).toHaveAttribute("data-collapsed", "true");
    await expect(plan.getByTestId("tasks-section-toggle")).toHaveAttribute("aria-expanded", "false");
    await hall.getByTestId("tasks-section-toggle").click();
    await expect(hall.locator(`[data-task-id="${s.tasks.hallDone1}"]`)).toBeVisible();
    await page.reload();
    await expect(section(page, `agenda:${s.plan}`)).toHaveAttribute("data-collapsed", "true", { timeout: APP_LOAD_TIMEOUT });
    await expect(section(page, `agenda:${s.hall}`)).toHaveAttribute("data-collapsed", "false");

    // Due date grouping (remembered): Overdue, Next week, Later, No date.
    await page.getByTestId("tasks-group-by").selectOption("due");
    await expect(section(page, "due:nextWeek").locator(`[data-task-id="${s.tasks.planOther}"]`)).toBeVisible();
    await expect(section(page, "due:later").locator(`[data-task-id="${s.tasks.event}"]`)).toBeVisible();
    await expect(section(page, "due:none").locator(`[data-task-id="${s.tasks.other}"]`)).toBeVisible();
    await page.reload();
    await expect(page.getByTestId("tasks-group-by")).toHaveValue("due", { timeout: APP_LOAD_TIMEOUT });
    // None: one plain list without headers.
    await page.getByTestId("tasks-group-by").selectOption("none");
    await expect(page.getByTestId("tasks-section")).toHaveCount(1);
    await expect(page.getByTestId("tasks-section-toggle")).toHaveCount(0);
    await page.getByTestId("tasks-group-by").selectOption("source");

    // Other pages keep the reading width.
    await page.goto("/dashboard");
    await expect(page.locator("main")).toHaveAttribute("data-width", "default", { timeout: APP_LOAD_TIMEOUT });
  });

  test("Board: the same sections as collapsible swimlanes; drag between columns and the card menu change the status", async ({ freshUser, freshBranch, freshEvent, pageAs, isMobile }) => {
    test.setTimeout(120_000);
    const s = await setup(freshBranch, freshUser, freshEvent);
    const page = await pageAs(s.manager);
    await page.goto("/tasks");
    await expect(page.getByTestId("tasks-view-kanban")).toBeVisible({ timeout: APP_LOAD_TIMEOUT });
    await showBoard(page);
    const lane = section(page, `agenda:${s.plan}`);
    const cell = (st: string) => lane.locator(`[data-testid="tasks-kanban-column"][data-status="${st}"]`);
    const card = lane.locator(`[data-testid="task-card"][data-task-id="${s.tasks.planOther}"]`);
    await expect(cell("todo").locator(`[data-task-id="${s.tasks.planOther}"]`)).toBeVisible({ timeout: APP_LOAD_TIMEOUT });
    // No per-card status select: the column is the status.
    await expect(page.getByTestId("task-card-status")).toHaveCount(0);
    // Titles wrap to two lines at most instead of being cut short.
    expect(await card.getByTestId("task-card-title").evaluate((el) => getComputedStyle(el).webkitLineClamp)).toBe("2");

    if (isMobile) await setStatusByMenu(page, card.getByTestId("task-card-menu"), "in_progress");
    else await card.dragTo(cell("in_progress"), { sourcePosition: { x: 6, y: 3 } });
    await expect(cell("in_progress").locator(`[data-task-id="${s.tasks.planOther}"]`)).toBeVisible();
    await expect.poll(() => status(s.tasks.planOther)).toBe("in_progress");
    await setStatusByMenu(page, cell("in_progress").locator(`[data-task-id="${s.tasks.planOther}"]`).getByTestId("task-card-menu"), "done");
    await expect.poll(() => status(s.tasks.planOther)).toBe("done");

    // The all-done lane starts collapsed; lanes collapse like list sections.
    await expect(section(page, `agenda:${s.hall}`)).toHaveAttribute("data-collapsed", "true");
    await lane.getByTestId("tasks-section-toggle").click();
    await expect(lane).toHaveAttribute("data-collapsed", "true");
    await expect(cell("done")).toHaveCount(0);
  });

  test("an @all group from a meeting decision is one row inside its agenda item's section", async ({ freshUser, freshBranch, pageAs }) => {
    test.setTimeout(120_000);
    const branch = await freshBranch("grpby-all");
    const manager = await freshUser({ role: "branch_manager", branch });
    await freshUser({ role: "volunteer", branch });
    const meeting = await createMeetingAs(manager, { scope: "branch", branch_id: branch, title: `${MEETING_TITLE_PREFIX}${runId} grpby all`, starts_at: inDays(-2), ends_at: inDays(-2, 1) });
    const item = (await workRpc(manager, "add_agenda_item", { p_meeting: meeting, p_title: "Outreach" })).data as string;
    const decision = (await workRpc(manager, "add_meeting_decision", { p_item: item, p_text: "Everyone brings a friend" })).data as string;
    const created = await workRpc(manager, "create_task_group", { p: { scope: "branch", branch_id: branch, title: title("bring a friend"), decision_id: decision } });
    expect(created.error).toBeNull();
    const groupId = created.data as string;
    // Someone outside the group (joined after it was made) sees the one group row.
    const outsider = await freshUser({ role: "volunteer", branch });
    // Invited to the meeting afterwards (test setup), so its agenda item labels the section.
    const invited = await adminClient().from("meeting_invitees").insert({ meeting_id: meeting, user_id: outsider.id });
    expect(invited.error).toBeNull();
    const page = await pageAs(outsider);
    await page.goto("/tasks");
    const sec = section(page, `agenda:${item}`);
    await expect(sec.locator(`[data-testid="task-group-row"][data-group-id="${groupId}"]`)).toHaveCount(1, { timeout: APP_LOAD_TIMEOUT });
    await expect(sec.getByTestId("tasks-section-progress")).toHaveAttribute("data-total", "1");
  });
});

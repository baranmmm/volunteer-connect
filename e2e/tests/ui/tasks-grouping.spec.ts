// The Tasks page layout: full content width, List by default, "Group by" Meeting by default (meeting > agenda item >
// tasks, with the decision under each task; then Events > event and Other tasks), done/total per level, only the
// newest meeting open by default and all-done sections closed, Expand all / Collapse all, collapse remembered per user,
// the Sort inside sections, assignee names ("Medway Manager", phones "Medway M.", "You", "+1"), the Created column
// (desktop only) and the drawer's "Created … by …"; compact one-line rows with a status menu, @all groups as one row,
// and the Board with the same sections as swimlanes. Fresh users in a temporary branch; checks look at own ids only.
import type { Page } from "@playwright/test";
import { test, expect, runId, type TestUser } from "../../fixtures/roles";
import { adminClient } from "../../api/SupabaseClient";
import { MEETING_TITLE_PREFIX, TASK_TITLE_PREFIX, createMeetingAs, createTaskAs, inDays, workRpc } from "../../api/work";
import { APP_LOAD_TIMEOUT } from "../../pages/app";
import { setStatusByMenu, showBoard, withTaskFilters } from "../../pages/components/tasks";

let n = 0;
const title = (label: string) => `${TASK_TITLE_PREFIX}${runId} grpby-${Date.now().toString(36)}-${++n} ${label}`;
const londonDay = (days = 0) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(new Date(Date.now() + days * 86400000));
const section = (page: Page, key: string) => page.locator(`[data-testid="tasks-section"][data-section-key="${key}"]`);
const listRow = (page: Page, id: string) => page.locator(`[data-testid="tasks-list-row"][data-task-id="${id}"]`);
const status = async (id: string) => (await adminClient().from("tasks").select("status").eq("id", id).single()).data?.status;

const topKeys = (page: Page) =>
  page.locator('[data-testid="tasks-section"][data-depth="0"]').evaluateAll((els) => els.map((e) => e.getAttribute("data-section-key")));
const rowIds = (scope: ReturnType<typeof section>) =>
  scope.locator(':scope > div > ul [data-testid="tasks-list-row"]').evaluateAll((els) => els.map((e) => e.getAttribute("data-task-id")));
/** "26 Nov": today's London date as the Created column shows it (English, current year). */
const createdToday = () => new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", day: "numeric", month: "short" }).format(new Date());

/**
 * A branch team: an older meeting (one agenda item), the newest meeting (two agenda items with decisions, the second
 * all done, plus a task linked to the meeting but no decision), an event and tasks from each place.
 */
async function setup(
  freshBranch: (label: string) => Promise<string>,
  freshUser: (o: { role: "branch_manager" | "volunteer" | "regional_director"; branch?: string }) => Promise<TestUser>,
  freshEvent: (owner: TestUser, spec: { label: string; status: "published"; startInMinutes: number }) => Promise<{ id: string; title: string }>,
) {
  const branch = await freshBranch("grpby");
  const manager = await freshUser({ role: "branch_manager", branch });
  const volunteer = await freshUser({ role: "volunteer", branch });
  const colleague = await freshUser({ role: "volunteer", branch });
  // Readable names for the assignee display.
  for (const [u, name] of [[manager, "Medway Manager"], [colleague, "Kent Volunteer"]] as const) {
    const r = await adminClient().from("profiles").update({ full_name: name }).eq("id", u.id);
    expect(r.error).toBeNull();
  }
  const meetingTitle = `${MEETING_TITLE_PREFIX}${runId} grpby committee`;
  const oldTitle = `${MEETING_TITLE_PREFIX}${runId} grpby older`;
  const invitees = [volunteer.id, colleague.id];
  const oldMeeting = await createMeetingAs(manager, { scope: "branch", branch_id: branch, title: oldTitle, starts_at: inDays(-10), ends_at: inDays(-10, 1), invitee_ids: invitees });
  const meeting = await createMeetingAs(manager, { scope: "branch", branch_id: branch, title: meetingTitle, starts_at: inDays(-3), ends_at: inDays(-3, 1), invitee_ids: invitees });
  const item = async (m: string, t: string) => (await workRpc(manager, "add_agenda_item", { p_meeting: m, p_title: t })).data as string;
  const decision = async (i: string, t: string) => (await workRpc(manager, "add_meeting_decision", { p_item: i, p_text: t })).data as string;
  const budget = await item(oldMeeting, "Budget");
  const approve = await decision(budget, "Approve the budget");
  const plan = await item(meeting, "Iftar plan");
  const hall = await item(meeting, "Hall booking");
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
    direct: await t("meeting direct", { assignee_ids: [manager.id, colleague.id] }),
    old: await t("older meeting", { decision_id: approve, assignee_ids: [manager.id] }),
    event: await t("event flyers", { event_id: event.id, assignee_ids: [volunteer.id], due_date: londonDay(30) }),
    other: await t("noticeboard", { assignee_ids: [manager.id] }),
  };
  // Linked to the meeting but to no decision (test setup: the app links tasks to a meeting through its decisions).
  const linked = await adminClient().from("tasks").update({ meeting_id: meeting }).eq("id", tasks.direct);
  expect(linked.error).toBeNull();
  return { branch, manager, volunteer, colleague, meeting, oldMeeting, meetingTitle, plan, hall, budget, caterer, event, tasks };
}

test.describe("Tasks: grouping and compact rows", () => {
  test("Meeting grouping by default: meeting > agenda item > tasks with the decision line; Events and Other tasks; newest meeting open; names and Created column", { tag: "@smoke" }, async ({ freshUser, freshBranch, freshEvent, pageAs, isMobile }) => {
    test.setTimeout(150_000);
    const s = await setup(freshBranch, freshUser, freshEvent);
    const page = await pageAs(s.volunteer);
    await page.goto("/tasks");
    await expect(page.getByTestId("tasks-view-list")).toHaveAttribute("aria-pressed", "true", { timeout: APP_LOAD_TIMEOUT });
    // Phones keep Group by and Sort in the Filters sheet.
    await withTaskFilters(page, async () => {
      await expect(page.getByTestId("tasks-group-by")).toHaveValue("meeting");
      await expect(page.getByTestId("tasks-sort")).toHaveValue("status");
    });
    await expect(page.locator("main")).toHaveAttribute("data-width", "wide");

    // Nesting: the newest meeting (open) > its agenda items > the task rows.
    const meeting = section(page, `meeting:${s.meeting}`);
    const plan = meeting.locator(`[data-testid="tasks-section"][data-section-key="agenda:${s.plan}"]`);
    await expect(plan.locator(`[data-task-id="${s.tasks.mine}"]`)).toBeVisible({ timeout: APP_LOAD_TIMEOUT });
    await expect(meeting).toHaveAttribute("data-collapsed", "false");
    await expect(meeting).toHaveAttribute("data-depth", "0");
    await expect(plan).toHaveAttribute("data-depth", "1");
    await expect(meeting.getByTestId("tasks-section-label").first()).toContainText(s.meetingTitle);
    await expect(meeting.getByTestId("tasks-section-date").first()).toBeVisible();
    await expect(meeting.getByTestId("tasks-section-progress").first()).toHaveAttribute("data-total", "5");
    await expect(meeting.getByTestId("tasks-section-progress").first()).toHaveAttribute("data-done", "2");
    await expect(plan.getByTestId("tasks-section-label")).toHaveText("Iftar plan");
    await expect(plan.getByTestId("tasks-section-progress")).toHaveAttribute("data-total", "2");
    // Status, then due date: the overdue one first.
    expect(await rowIds(plan)).toEqual([s.tasks.mine, s.tasks.planOther]);
    // The decision as a muted second line, the full text in the tooltip.
    const mineItem = page.getByTestId("tasks-list-item").filter({ has: listRow(page, s.tasks.mine) });
    await expect(mineItem.getByTestId("tasks-list-row-decision")).toHaveText("Decision: Book a caterer");
    await expect(mineItem.getByTestId("tasks-list-row-decision")).toHaveAttribute("title", "Decision: Book a caterer");
    // A task linked to the meeting but no agenda item: directly under the meeting, after its agenda items.
    const directRow = listRow(page, s.tasks.direct);
    await expect(meeting.locator(':scope > div > ul').locator(`[data-task-id="${s.tasks.direct}"]`)).toBeVisible();
    await expect(page.getByTestId("tasks-list-item").filter({ has: directRow }).getByTestId("tasks-list-row-decision")).toHaveCount(0);
    const hall = section(page, `agenda:${s.hall}`);
    expect((await directRow.boundingBox())!.y).toBeGreaterThan((await hall.boundingBox())!.y);
    // Every task in "Hall booking" is done: it starts collapsed, with 2/2.
    await expect(hall).toHaveAttribute("data-collapsed", "true");
    await expect(hall.getByTestId("tasks-section-toggle")).toHaveAttribute("aria-expanded", "false");
    await expect(hall.getByTestId("tasks-section-progress")).toHaveAttribute("data-done", "2");
    await expect(hall.locator(`[data-task-id="${s.tasks.hallDone1}"]`)).toHaveCount(0);
    // Only the newest meeting is open: the older one starts collapsed.
    const older = section(page, `meeting:${s.oldMeeting}`);
    await expect(older).toHaveAttribute("data-collapsed", "true");
    await expect(older.locator(`[data-task-id="${s.tasks.old}"]`)).toHaveCount(0);
    // Not linked to a meeting: Events > the event, then Other tasks.
    const events = section(page, "events");
    await expect(events.locator(`[data-testid="tasks-section"][data-section-key="event:${s.event.id}"]`).locator(`[data-task-id="${s.tasks.event}"]`)).toBeVisible();
    await expect(section(page, `event:${s.event.id}`).getByTestId("tasks-section-label")).toContainText(s.event.title);
    await expect(section(page, "other").locator(`[data-task-id="${s.tasks.other}"]`)).toBeVisible();
    expect(await topKeys(page)).toEqual([`meeting:${s.meeting}`, `meeting:${s.oldMeeting}`, "events", "other"]);

    // Assignee names: "You", the full name (phones: "First L."), "+1" with every name in the tooltip.
    const names = (id: string) => page.getByTestId("tasks-list-item").filter({ has: listRow(page, id) }).getByTestId("tasks-list-row-assignees");
    await expect(names(s.tasks.mine)).toHaveAttribute("data-you", "true");
    await expect(names(s.tasks.mine).getByTestId(isMobile ? "tasks-list-row-assignees-short" : "tasks-list-row-assignees-full")).toHaveText("You");
    await expect(names(s.tasks.planOther)).toHaveAttribute("title", "Medway Manager");
    if (isMobile) {
      await expect(names(s.tasks.planOther).getByTestId("tasks-list-row-assignees-short")).toHaveText("Medway M.");
      await expect(names(s.tasks.planOther).getByTestId("tasks-list-row-assignees-full")).toBeHidden();
    } else {
      await expect(names(s.tasks.planOther).getByTestId("tasks-list-row-assignees-full")).toHaveText("Medway Manager");
      await expect(names(s.tasks.planOther).getByTestId("tasks-list-row-assignees-short")).toBeHidden();
    }
    await expect(names(s.tasks.direct).getByTestId("tasks-list-row-assignees-more")).toHaveText("+1");
    await expect(names(s.tasks.direct)).toHaveAttribute("title", /Medway Manager/);
    await expect(names(s.tasks.direct)).toHaveAttribute("title", /Kent Volunteer/);
    await expect(names(s.tasks.direct)).toContainText(/Assigned to: .*Kent Volunteer/);

    // The Created column: desktop rows only.
    const created = page.getByTestId("tasks-list-item").filter({ has: listRow(page, s.tasks.planOther) }).getByTestId("task-created");
    if (isMobile) await expect(created).toBeHidden();
    else await expect(created).toHaveText(`Created ${createdToday()}`);

    // Compact rows: one line plus the decision, the long title gets most of the row; mine: accent bar and bold.
    const row = listRow(page, s.tasks.mine);
    await expect(row).toHaveAttribute("data-mine", "true");
    const box = (await row.boundingBox())!;
    expect(box.height).toBeLessThanOrEqual(52);
    const titleBox = (await row.getByTestId("tasks-list-row-title").boundingBox())!;
    expect(titleBox.width / box.width).toBeGreaterThan(isMobile ? 0.3 : 0.5);
    expect(await row.getByTestId("tasks-list-row-title").evaluate((el) => Number(getComputedStyle(el).fontWeight))).toBeGreaterThanOrEqual(700);
    expect(await mineItem.evaluate((el) => getComputedStyle(el).borderLeftWidth)).toBe("4px");
    await expect(page.getByTestId("tasks-list-row-mine")).toHaveCount(0);
    // No horizontal page scroll (phones included).
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);

    // The status pill opens a menu.
    await setStatusByMenu(page, mineItem.getByTestId("tasks-list-row-status"), "in_progress");
    await expect.poll(() => status(s.tasks.mine)).toBe("in_progress");
    await expect(plan.getByTestId("tasks-section-progress")).toHaveAttribute("data-done", "0");

    // Due date grouping (remembered): Overdue, Next week, Later, No date; the names stay.
    await withTaskFilters(page, () => page.getByTestId("tasks-group-by").selectOption("due"));
    await expect(section(page, "due:nextWeek").locator(`[data-task-id="${s.tasks.planOther}"]`)).toBeVisible();
    await expect(section(page, "due:later").locator(`[data-task-id="${s.tasks.event}"]`)).toBeVisible();
    await expect(section(page, "due:none").locator(`[data-task-id="${s.tasks.other}"]`)).toBeVisible();
    await expect(names(s.tasks.mine)).toHaveAttribute("data-you", "true");
    await expect(row).toHaveAttribute("data-mine", "true");
    await page.reload();
    await expect(page.getByTestId("tasks-section").first()).toBeVisible({ timeout: APP_LOAD_TIMEOUT });
    await withTaskFilters(page, async () => {
      await expect(page.getByTestId("tasks-group-by")).toHaveValue("due");
      // None: one plain list without headers and no Expand/Collapse all.
      await page.getByTestId("tasks-group-by").selectOption("none");
      await expect(page.getByTestId("tasks-expand-all")).toHaveCount(0);
    });
    await expect(page.getByTestId("tasks-section")).toHaveCount(1);
    await expect(page.getByTestId("tasks-section-toggle")).toHaveCount(0);
    await withTaskFilters(page, () => page.getByTestId("tasks-group-by").selectOption("meeting"));

    // Other pages keep the reading width.
    await page.goto("/dashboard");
    await expect(page.locator("main")).toHaveAttribute("data-width", "default", { timeout: APP_LOAD_TIMEOUT });
    // The dashboard's My tasks names the assignee too: "You".
    const dashItem = page.locator(`[data-testid="dashboard-my-task-item"][data-task-id="${s.tasks.mine}"]`);
    await expect(dashItem.getByTestId("dashboard-my-task-assignees")).toHaveAttribute("data-you", "true", { timeout: APP_LOAD_TIMEOUT });
    await expect(dashItem.getByTestId("dashboard-my-task-assignees")).toHaveAttribute("title", "You");
  });

  test("Expand all / Collapse all and section toggles (keyboard) are remembered after a reload", async ({ freshUser, freshBranch, freshEvent, pageAs }) => {
    test.setTimeout(150_000);
    const s = await setup(freshBranch, freshUser, freshEvent);
    const page = await pageAs(s.volunteer);
    await page.goto("/tasks");
    const meeting = section(page, `meeting:${s.meeting}`);
    const older = section(page, `meeting:${s.oldMeeting}`);
    await expect(meeting.locator(`[data-task-id="${s.tasks.mine}"]`)).toBeVisible({ timeout: APP_LOAD_TIMEOUT });

    // On phones Expand/Collapse all are in the Filters sheet (it closes after either).
    await withTaskFilters(page, () => page.getByTestId("tasks-collapse-all").click());
    for (const key of [`meeting:${s.meeting}`, `meeting:${s.oldMeeting}`, "events", "other"])
      await expect(section(page, key)).toHaveAttribute("data-collapsed", "true");
    await expect(listRow(page, s.tasks.mine)).toHaveCount(0);

    await withTaskFilters(page, () => page.getByTestId("tasks-expand-all").click());
    await expect(older).toHaveAttribute("data-collapsed", "false");
    await expect(listRow(page, s.tasks.old)).toBeVisible();
    await expect(listRow(page, s.tasks.hallDone1)).toBeVisible();
    await expect(section(page, `agenda:${s.budget}`)).toHaveAttribute("data-collapsed", "false");

    // Keyboard: the header is a real button with aria-expanded and aria-controls.
    const toggle = older.getByTestId("tasks-section-toggle").first();
    const controls = await toggle.getAttribute("aria-controls");
    expect(controls).toBeTruthy();
    await expect(page.locator(`[id="${controls}"]`)).toBeVisible();
    await toggle.focus();
    await page.keyboard.press("Enter");
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(page.locator(`[id="${controls}"]`)).toBeHidden();

    await page.reload();
    await expect(section(page, `meeting:${s.meeting}`)).toHaveAttribute("data-collapsed", "false", { timeout: APP_LOAD_TIMEOUT });
    await expect(section(page, `meeting:${s.oldMeeting}`)).toHaveAttribute("data-collapsed", "true");
    await expect(section(page, `agenda:${s.hall}`)).toHaveAttribute("data-collapsed", "false");
    await expect(listRow(page, s.tasks.hallDone2)).toBeVisible();
  });

  test("Sort: Status, Due date, Newest first, Oldest first inside each section; the drawer shows Created … by …", async ({ freshUser, freshBranch, freshEvent, pageAs }) => {
    test.setTimeout(150_000);
    const s = await setup(freshBranch, freshUser, freshEvent);
    const page = await pageAs(s.volunteer);
    await page.goto("/tasks");
    const plan = section(page, `agenda:${s.plan}`);
    await expect(plan.locator(`[data-task-id="${s.tasks.mine}"]`)).toBeVisible({ timeout: APP_LOAD_TIMEOUT });
    // On phones the Sort select is in the Filters sheet.
    const sortBy = (value: string) => withTaskFilters(page, () => page.getByTestId("tasks-sort").selectOption(value));
    // "mine" was created before "plan other" and is due earlier.
    expect(await rowIds(plan)).toEqual([s.tasks.mine, s.tasks.planOther]);
    await sortBy("newest");
    await expect.poll(() => rowIds(plan)).toEqual([s.tasks.planOther, s.tasks.mine]);
    await sortBy("oldest");
    await expect.poll(() => rowIds(plan)).toEqual([s.tasks.mine, s.tasks.planOther]);
    // Status first: a done task moves below the open one, whatever its date.
    await sortBy("newest");
    await expect.poll(() => rowIds(plan)).toEqual([s.tasks.planOther, s.tasks.mine]);
    await sortBy("status");
    await setStatusByMenu(page, page.getByTestId("tasks-list-item").filter({ has: listRow(page, s.tasks.mine) }).getByTestId("tasks-list-row-status"), "done");
    await expect.poll(() => rowIds(plan)).toEqual([s.tasks.planOther, s.tasks.mine]);
    await sortBy("due");
    await expect.poll(() => rowIds(plan)).toEqual([s.tasks.mine, s.tasks.planOther]);
    // Remembered per user.
    await page.reload();
    await expect(plan.locator(`[data-task-id="${s.tasks.mine}"]`)).toBeVisible({ timeout: APP_LOAD_TIMEOUT });
    await withTaskFilters(page, () => expect(page.getByTestId("tasks-sort")).toHaveValue("due"));

    // The drawer: "Created <date> by <name>".
    await listRow(page, s.tasks.planOther).click();
    await expect(page.getByTestId("task-panel-created")).toHaveText(`Created ${createdToday()} by Medway Manager`, { timeout: APP_LOAD_TIMEOUT });
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

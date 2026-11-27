// Meetings in the UI: creating with a few fields and invitees (invite-only visibility), recurring meetings (calendar
// entries, series navigation, scoped edits and deletes, "from last meeting", series tasks), agenda and decisions turned
// into tasks, meeting requests approved into meetings, private files and long names at 390 px. Every meeting is created by fresh users in
// a temporary branch (cleaned up with its files by the fixtures) and every check looks at this test's own ids only.
import type { Locator, Page } from "@playwright/test";
import { decisionAction } from "../../pages/components/DecisionActions";
import { test, expect, runId, type TestUser } from "../../fixtures/roles";
import { adminClient } from "../../api/SupabaseClient";
import {
  MEETING_TITLE_PREFIX,
  TASK_TITLE_PREFIX,
  createMeetingAs,
  createMeetingSeriesAs,
  inDays,
  meetingOccurrences,
  workRpc,
} from "../../api/work";
import { APP_LOAD_TIMEOUT } from "../../pages/app";
import { pickOption } from "../../pages/components/select";

let n = 0;
const title = (label: string) => `${MEETING_TITLE_PREFIX}${runId} ui-${Date.now().toString(36)}-${++n} ${label}`;
/** London "YYYY-MM-DD" `days` from today. */
const londonDay = (days = 0) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(new Date(Date.now() + days * 86400000));

const meetingCard = (page: Page, id: string) => page.locator(`[data-testid="meeting-card"][data-meeting-id="${id}"]`);
const sideways = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

/** Chooses a person in a PeopleCombobox: `prefix`-open, the option, then the chip. */
async function pickPerson(page: Page, prefix: string, userId: string) {
  await page.getByTestId(`${prefix}-open`).click();
  await page.locator(`[data-testid="${prefix}-option"][data-user-id="${userId}"]`).click();
  await page.keyboard.press("Escape");
  await expect(page.locator(`[data-testid="${prefix}-chip"][data-user-id="${userId}"]`)).toBeVisible();
}
/** Opens a collapsible invitees section (page `meeting-invitees-toggle` or form `<prefix>-invitees-toggle`). */
async function expandInvitees(page: Page, toggleId: string) {
  const toggle = page.getByTestId(toggleId);
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
}
/** Expands one agenda item (collapsed by default) so its notes, decisions and controls are shown. */
async function expandItem(item: Locator) {
  const toggle = item.getByTestId("meeting-agenda-item-toggle");
  if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
}
/** Opens a decision's task list (collapsed by default) when it is closed. */
async function expandDecision(decision: Locator) {
  const toggle = decision.getByTestId("meeting-decision-tasks-toggle");
  if ((await toggle.getAttribute("aria-expanded", { timeout: APP_LOAD_TIMEOUT })) !== "true") await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
}
/** True when `first` comes before `second` in the page. */
const comesBefore = (page: Page, first: string, second: string) =>
  page.evaluate(([a, b]) => {
    const x = document.querySelector(`[data-testid="${a}"]`), y = document.querySelector(`[data-testid="${b}"]`);
    return !!x && !!y && !!(x.compareDocumentPosition(y) & Node.DOCUMENT_POSITION_FOLLOWING);
  }, [first, second] as const);

async function openMeetings(page: Page) {
  await page.goto("/meetings");
  await expect(page.getByTestId("meetings-timeline").or(page.getByTestId("meetings-empty"))).toBeVisible({ timeout: APP_LOAD_TIMEOUT });
}
async function openMeeting(page: Page, id: string) {
  await page.goto(`/meetings/${id}`);
  await expect(page.getByTestId("meeting-detail")).toBeVisible({ timeout: APP_LOAD_TIMEOUT });
}
async function branchTeam(freshBranch: (label: string) => Promise<string>, freshUser: (o: { role: "branch_manager" | "volunteer"; branch: string }) => Promise<TestUser>, label: string) {
  const branch = await freshBranch(label);
  const manager = await freshUser({ role: "branch_manager", branch });
  const volunteer = await freshUser({ role: "volunteer", branch });
  return { branch, manager, volunteer };
}
const meetingAt = (branch: string, label: string, extra: Partial<Parameters<typeof createMeetingAs>[1]> = {}) => ({
  scope: "branch" as const,
  branch_id: branch,
  title: title(label),
  starts_at: inDays(5),
  ends_at: inDays(5, 1),
  ...extra,
});

test.describe("Meetings", () => {
  test("a volunteer creates a meeting inviting a colleague; the invitee reads it; an uninvited member cannot see it", async ({ freshUser, freshBranch, pageAs }) => {
    const { volunteer: creator, branch } = await branchTeam(freshBranch, freshUser, "meetings-create");
    const invitee = await freshUser({ role: "volunteer", branch });
    const outsider = await freshUser({ role: "volunteer", branch });
    const name = title("create");
    const day = londonDay(6);

    const page = await pageAs(creator);
    await openMeetings(page);
    await page.getByTestId("meetings-new").click();
    const form = page.getByTestId("meeting-form");
    await expect(form).toBeVisible();
    // A volunteer creates in their branch only: no "Where" field.
    await expect(form.getByTestId("meeting-form-title")).toBeVisible();
    await expect(form.getByTestId("meeting-form-scope")).toHaveCount(0);
    await expect(form.getByTestId("meeting-form-scope-fixed")).toHaveCount(0);
    await form.getByTestId("meeting-form-title").fill(name);
    await form.getByTestId("meeting-form-start-date").fill(day);
    await pickOption(page, "meeting-form-start-time", "meeting-form-start-time-option", "18:00");
    // End follows Start + 1 hour.
    await expect(form.getByTestId("meeting-form-end-date")).toHaveValue(day);
    await expect(form.getByTestId("meeting-form-end-time")).toContainText("19:00");
    await expect(form.getByTestId("meeting-form-place-in-person")).toBeChecked();
    await form.getByTestId("meeting-form-location").fill("E2E Community Hall");
    // More options stay collapsed: title, date, time and place are enough.
    await expect(form.getByTestId("meeting-form-more")).toHaveAttribute("data-state", "closed");
    await expect(form.getByTestId("meeting-form-description")).toHaveCount(0);
    // Invitees are collapsed: the header counts them; the picker is inside.
    await expect(form.getByTestId("meeting-form-invitees-toggle")).toHaveAttribute("data-count", "0");
    await expect(form.getByTestId("meeting-form-invitees")).toHaveCount(0);
    await expandInvitees(page, "meeting-form-invitees-toggle");
    await pickPerson(page, "meeting-form-invitees", invitee.id);
    await expect(form.getByTestId("meeting-form-invitees")).toHaveAttribute("data-count", "1");
    await expect(form.getByTestId("meeting-form-invitees-toggle")).toHaveAttribute("data-count", "1");
    // A file chosen in More options is uploaded once the meeting exists.
    await form.getByTestId("meeting-form-more").click();
    await form.getByTestId("meeting-form-files-input").setInputFiles({
      name: "e2e-agenda.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n"),
    });
    await expect(form.getByTestId("meeting-form-file")).toHaveCount(1);
    await form.getByTestId("meeting-form-submit").click();
    await expect(page).toHaveURL(/\/meetings\/[0-9a-f-]{36}$/, { timeout: APP_LOAD_TIMEOUT });
    const id = new URL(page.url()).pathname.split("/").pop()!;
    await expect(page.getByTestId("meeting-detail")).toHaveAttribute("data-meeting-id", id, { timeout: APP_LOAD_TIMEOUT });
    await expect(page.getByTestId("meeting-edit")).toBeVisible();
    await expect(page.getByTestId("meeting-file-name")).toHaveText("e2e-agenda.pdf", { timeout: APP_LOAD_TIMEOUT });
    // Invitees are listed below the agenda.
    expect(await comesBefore(page, "meeting-agenda", "meeting-invitees")).toBe(true);
    await expect(page.getByTestId("meeting-series-info")).toHaveCount(0);
    await expect(page.getByTestId("meeting-from-last")).toHaveCount(0);
    // One possible scope: the page shows no scope label.
    await expect(page.getByTestId("meeting-creator")).toBeVisible();
    await expect(page.getByTestId("meeting-scope")).toHaveCount(0);
    const invited = await adminClient().from("meeting_invitees").select("user_id").eq("meeting_id", id);
    expect((invited.data ?? []).map((r) => r.user_id)).toEqual([invitee.id]);

    // The invitee sees it in the list and reads the detail page only.
    const asInvitee = await pageAs(invitee);
    await openMeetings(asInvitee);
    await expect(meetingCard(asInvitee, id)).toBeVisible();
    await expect(meetingCard(asInvitee, id).getByTestId("meeting-card-invited")).toBeVisible();
    await expect(meetingCard(asInvitee, id).getByTestId("meeting-card-scope")).toHaveCount(0);
    await meetingCard(asInvitee, id).click();
    await expect(asInvitee.getByTestId("meeting-detail")).toHaveAttribute("data-meeting-id", id, { timeout: APP_LOAD_TIMEOUT });
    await expect(asInvitee.getByTestId("meeting-title")).toHaveText(name);
    // Invitees are collapsed by default; the header counts them.
    await expect(asInvitee.getByTestId("meeting-invitees-toggle")).toHaveAttribute("data-count", "1");
    await expect(asInvitee.getByTestId("meeting-invitee")).toHaveCount(0);
    await expandInvitees(asInvitee, "meeting-invitees-toggle");
    await expect(asInvitee.locator(`[data-testid="meeting-invitee"][data-user-id="${invitee.id}"]`)).toBeVisible();
    await expect(asInvitee.getByTestId("meeting-agenda")).toBeVisible();
    await expect(asInvitee.getByTestId("meeting-edit")).toHaveCount(0);
    await expect(asInvitee.getByTestId("meeting-agenda-add")).toHaveCount(0);
    await expect(asInvitee.getByTestId("meeting-delete")).toHaveCount(0);

    // A member of the same branch who is not invited gets neither the card nor the page.
    const asOutsider = await pageAs(outsider);
    await openMeetings(asOutsider);
    await expect(meetingCard(asOutsider, id)).toHaveCount(0);
    await asOutsider.goto(`/meetings/${id}`);
    await expect(asOutsider.getByTestId("meeting-not-found")).toBeVisible({ timeout: APP_LOAD_TIMEOUT });
    await expect(asOutsider.getByTestId("meeting-detail")).toHaveCount(0);
  });

  test("recurring meeting: weekly × 3 from the form creates three meetings with calendar entries; Open in calendar shows the entry", { tag: "@smoke" }, async ({ freshUser, freshBranch, pageAs }) => {
    const { branch, manager, volunteer } = await branchTeam(freshBranch, freshUser, "meetings-recurring");
    const name = title("weekly");
    const page = await pageAs(manager);
    await openMeetings(page);
    await page.getByTestId("meetings-new").click();
    const form = page.getByTestId("meeting-form");
    await form.getByTestId("meeting-form-title").fill(name);
    await form.getByTestId("meeting-form-start-date").fill(londonDay(4));
    await pickOption(page, "meeting-form-start-time", "meeting-form-start-time-option", "18:00");
    await form.getByTestId("meeting-form-location").fill("E2E Community Hall");
    await expandInvitees(page, "meeting-form-invitees-toggle");
    await pickPerson(page, "meeting-form-invitees", volunteer.id);
    await form.getByTestId("meeting-form-more").click();
    await form.getByTestId("meeting-form-agenda-input").fill("Finance");
    await form.getByTestId("meeting-form-agenda-add").click();
    await expect(form.getByTestId("meeting-form-agenda-item")).toHaveCount(1);
    await form.getByTestId("meeting-form-repeat-weekly").check();
    await form.getByTestId("meeting-form-repeat-count").fill("3");
    await form.getByTestId("meeting-form-submit").click();
    await expect(page).toHaveURL(/\/meetings\/[0-9a-f-]{36}$/, { timeout: APP_LOAD_TIMEOUT });
    const first = new URL(page.url()).pathname.split("/").pop()!;
    const occurrences = await meetingOccurrences(first);
    expect(occurrences.map((o) => [o.series_position, o.title])).toEqual([[1, name], [2, name], [3, name]]);

    // The first meeting: "1 of 3", a next link, the standing agenda item, and the calendar link.
    await expect(page.getByTestId("meeting-detail")).toHaveAttribute("data-meeting-id", first, { timeout: APP_LOAD_TIMEOUT });
    const info = page.getByTestId("meeting-series-info");
    await expect(info).toHaveAttribute("data-position", "1");
    await expect(info).toHaveAttribute("data-count", "3");
    await expect(page.getByTestId("meeting-series-previous")).toHaveCount(0);
    await expect(page.getByTestId("meeting-agenda-item")).toHaveAttribute("data-standing", "true");
    await expect(page.getByTestId("meeting-agenda-standing")).toBeVisible();
    await page.getByTestId("meeting-series-next").click();
    await expect(page.getByTestId("meeting-detail")).toHaveAttribute("data-meeting-id", occurrences[1]!.id, { timeout: APP_LOAD_TIMEOUT });
    await expect(page.getByTestId("meeting-series-info")).toHaveAttribute("data-position", "2");
    await page.getByTestId("meeting-open-calendar").click();
    await expect(page).toHaveURL(new RegExp(`/events/${occurrences[1]!.event_id}$`), { timeout: APP_LOAD_TIMEOUT });

    // The invitee sees every occurrence in the list, each marked as recurring.
    const asInvitee = await pageAs(volunteer);
    await openMeetings(asInvitee);
    for (const o of occurrences) await expect(meetingCard(asInvitee, o.id).getByTestId("meeting-card-recurring")).toBeVisible();
    void branch;
  });

  test("recurring meeting: edit this and following, then delete one occurrence; both ask which meetings", async ({ freshUser, freshBranch, pageAs }) => {
    const { branch, manager, volunteer } = await branchTeam(freshBranch, freshUser, "meetings-series-edit");
    const name = title("series edit");
    const first = await createMeetingSeriesAs(manager, { ...meetingAt(branch, "series edit", { title: name, invitee_ids: [volunteer.id] }), recurrence: { freq: "weekly", interval: 1, count: 3 } });
    const [o1, o2, o3] = await meetingOccurrences(first);
    const page = await pageAs(manager);
    await openMeeting(page, o2!.id);
    await page.getByTestId("meeting-edit").click();
    const form = page.getByTestId("meeting-form");
    // Invitees are kept: counted in the collapsed header and shown as chips inside.
    await expect(form.getByTestId("meeting-form-invitees-toggle")).toHaveAttribute("data-count", "1");
    await expandInvitees(page, "meeting-form-invitees-toggle");
    await expect(form.locator(`[data-testid="meeting-form-invitees-chip"][data-user-id="${volunteer.id}"]`)).toBeVisible();
    await form.getByTestId("meeting-form-title").fill(`${name} moved`);
    await form.getByTestId("meeting-form-submit").click();
    const scope = page.getByTestId("meeting-scope-dialog");
    await expect(scope).toBeVisible();
    await expect(scope.getByTestId("meeting-scope-this")).toBeChecked();
    await scope.getByTestId("meeting-scope-following").check();
    await scope.getByTestId("meeting-scope-confirm").click();
    await expect(page.getByTestId("toast-success")).toBeVisible();
    await expect(scope).toBeHidden();
    await expect(page.getByTestId("meeting-title")).toHaveText(`${name} moved`, { timeout: APP_LOAD_TIMEOUT });
    await expect.poll(async () => (await meetingOccurrences(first)).map((o) => o.title)).toEqual([name, `${name} moved`, `${name} moved`]);

    // Delete only the third: the first two stay.
    await openMeeting(page, o3!.id);
    await page.getByTestId("meeting-delete").click();
    await expect(page.getByTestId("meeting-confirm-dialog")).toHaveCount(0);
    await page.getByTestId("meeting-scope-dialog").getByTestId("meeting-scope-confirm").click();
    await expect(page).toHaveURL(/\/meetings$/, { timeout: APP_LOAD_TIMEOUT });
    await expect.poll(async () => (await meetingOccurrences(first)).map((o) => o.id)).toEqual([o1!.id, o2!.id]);
  });

  test("from last meeting: the next occurrence lists the unresolved item and the open task; resolving removes it; series tasks filter", async ({ freshUser, freshBranch, pageAs }) => {
    const { branch, manager, volunteer } = await branchTeam(freshBranch, freshUser, "meetings-from-last");
    const first = await createMeetingSeriesAs(manager, { ...meetingAt(branch, "from last", { invitee_ids: [volunteer.id] }), recurrence: { freq: "weekly", interval: 1, count: 3 } });
    const [o1, o2] = await meetingOccurrences(first);
    const done = (await workRpc(manager, "add_agenda_item", { p_meeting: o1!.id, p_title: "Hall booking" })).data as string;
    const open = (await workRpc(manager, "add_agenda_item", { p_meeting: o1!.id, p_title: "Iftar budget" })).data as string;
    expect((await workRpc(manager, "set_agenda_item_resolved", { p_id: done, p_resolved: true })).error).toBeNull();
    const decision = (await workRpc(manager, "add_meeting_decision", { p_item: open, p_text: "Collect quotes" })).data as string;
    const task = (await workRpc(manager, "create_task", { p: { scope: "branch", branch_id: branch, title: `${TASK_TITLE_PREFIX}${runId} quotes`, decision_id: decision, assignee_ids: [volunteer.id] } })).data as string;

    // The invitee reads "From last meeting" on the second occurrence, above the agenda.
    const asInvitee = await pageAs(volunteer);
    await openMeeting(asInvitee, o2!.id);
    const fromLast = asInvitee.getByTestId("meeting-from-last");
    await expect(fromLast).toBeVisible();
    await expect(fromLast.getByTestId("meeting-from-last-item")).toHaveCount(1);
    await expect(fromLast.getByTestId("meeting-from-last-item")).toHaveAttribute("data-item-id", open);
    const openTask = fromLast.getByTestId("meeting-from-last-task");
    await expect(openTask).toHaveAttribute("data-task-id", task);
    await expect(openTask).toHaveAttribute("data-status", "todo");
    expect(await comesBefore(asInvitee, "meeting-from-last", "meeting-agenda")).toBe(true);
    await expect(fromLast.getByTestId("meeting-from-last-link")).toHaveAttribute("href", `/meetings/${o1!.id}`);
    // Series tasks: open by default; "done" shows none. Invitees cannot edit the standing agenda.
    const seriesTasks = asInvitee.getByTestId("meeting-series-tasks");
    await expect(seriesTasks.locator(`[data-testid="meeting-series-task"][data-task-id="${task}"]`)).toHaveAttribute("data-status", "todo");
    await seriesTasks.getByTestId("meeting-series-tasks-filter").selectOption("done");
    await expect(seriesTasks.getByTestId("meeting-series-task")).toHaveCount(0);
    await expect(asInvitee.getByTestId("meeting-series-agenda")).toHaveCount(0);
    await expect(asInvitee.getByTestId("meeting-agenda-resolved")).toHaveCount(0);

    // The manager marks the item resolved on the first meeting; it leaves "From last meeting" on the second.
    const page = await pageAs(manager);
    await openMeeting(page, o1!.id);
    const item = page.locator(`[data-testid="meeting-agenda-item"][data-item-id="${open}"]`);
    await expect(item).toHaveAttribute("data-resolved", "false");
    // Collapsed by default, with the counts in the row: one decision, one task.
    await expect(item.getByTestId("meeting-agenda-item-toggle")).toHaveAttribute("aria-expanded", "false");
    await expect(item.getByTestId("meeting-agenda-item-counts")).toHaveAttribute("data-decisions", "1");
    await expect(item.getByTestId("meeting-agenda-item-counts")).toHaveAttribute("data-tasks", "1");
    await expect(item.getByTestId("meeting-agenda-resolved")).toHaveCount(0);
    await expandItem(item);
    await expandDecision(item.getByTestId("meeting-decision"));
    await expect(item.locator(`[data-testid="meeting-decision-task"][data-task-id="${task}"]`)).toHaveAttribute("data-status", "todo");
    await item.getByTestId("meeting-agenda-resolved").check();
    await expect(item).toHaveAttribute("data-resolved", "true", { timeout: APP_LOAD_TIMEOUT });
    // The checkbox updates at once; wait until the database has it before opening the next occurrence.
    await expect
      .poll(async () => (await adminClient().from("meeting_agenda_items").select("resolved").eq("id", open).single()).data?.resolved, {
        timeout: APP_LOAD_TIMEOUT,
      })
      .toBe(true);
    await openMeeting(page, o2!.id);
    await expect(page.getByTestId("meeting-from-last-item")).toHaveCount(0);
    await expect(page.getByTestId("meeting-from-last-task")).toHaveCount(1);

    // Standing agenda items: a new one is added to the upcoming occurrences.
    await page.getByTestId("meeting-series-agenda-input").fill("Treasurer report");
    await page.getByTestId("meeting-series-agenda-save").click();
    await expect(page.getByTestId("toast-success")).toBeVisible();
    await expect(page.locator('[data-testid="meeting-agenda-item"][data-standing="true"]')).toHaveCount(1, { timeout: APP_LOAD_TIMEOUT });
  });

  test("agenda and decisions: the branch manager adds them and turns a decision into a task linked back to the meeting", async ({ freshUser, freshBranch, pageAs }) => {
    const { branch, manager, volunteer } = await branchTeam(freshBranch, freshUser, "meetings-agenda");
    const id = await createMeetingAs(manager, meetingAt(branch, "agenda", { invitee_ids: [volunteer.id] }));
    const page = await pageAs(manager);
    await openMeeting(page, id);
    await page.getByTestId("meeting-agenda-add").click();
    await page.getByTestId("meeting-agenda-title").fill("Ramadan iftar planning");
    await page.getByTestId("meeting-agenda-save").click();
    const item = page.getByTestId("meeting-agenda-item");
    await expect(item).toHaveCount(1);
    await expect(item.getByTestId("meeting-agenda-item-title")).toHaveText("Ramadan iftar planning");
    // A just-added item opens expanded, ready for decisions.
    await expect(item.getByTestId("meeting-agenda-item-toggle")).toHaveAttribute("aria-expanded", "true");

    const decisionText = `${TASK_TITLE_PREFIX}${runId} book the hall for the iftar`;
    await item.getByTestId("meeting-decision-add").click();
    // Shift+Enter is a new line; Enter saves the decision.
    const decisionInput = item.getByTestId("meeting-decision-text");
    await decisionInput.fill(decisionText);
    await decisionInput.press("Shift+Enter");
    await expect(decisionInput).toHaveValue(`${decisionText}\n`);
    await expect(item.getByTestId("meeting-decision-form")).toBeVisible();
    await decisionInput.fill(decisionText);
    await decisionInput.press("Enter");
    await expect(item.getByTestId("meeting-decision-form")).toHaveCount(0, { timeout: APP_LOAD_TIMEOUT });
    const decision = item.getByTestId("meeting-decision");
    await expect(decision.getByTestId("meeting-decision-text-value")).toHaveText(decisionText);

    // No "Create task" row under the decision: "+ Task" sits in the row of Edit/Delete (on phones all three are in
    // the decision's ⋯ menu), and the phone's top bar is opaque (content scrolling under it never shows through).
    const menu = decision.getByTestId("meeting-decision-menu");
    if (await menu.isVisible()) {
      await expect(decision.getByTestId("meeting-decision-create-task")).toHaveCount(0);
      const bg = await page.getByTestId("mobile-top-bar").evaluate((el) => getComputedStyle(el).backgroundColor);
      expect(bg).not.toMatch(/rgba\(.*,\s*0?\.\d+\)|\/\s*0?\.\d+\)/);
    } else {
      const task = await decision.getByTestId("meeting-decision-create-task").boundingBox();
      const edit = await decision.getByTestId("meeting-decision-edit").boundingBox();
      expect(Math.abs(task!.y + task!.height / 2 - (edit!.y + edit!.height / 2))).toBeLessThan(6);
    }
    await decisionAction(page, decision, "create-task");
    const form = page.getByTestId("task-form");
    await expect(form.getByTestId("task-form-from-decision")).toBeVisible();
    await expect(form.getByTestId("task-form-scope-fixed")).toHaveAttribute("data-scope", `branch:${branch}`);
    await expect(form.getByTestId("task-form-title")).toHaveValue(decisionText);
    await pickPerson(page, "task-form-assignees", volunteer.id);
    await form.getByTestId("task-form-submit").click();
    await expect(form).toBeHidden();
    const link = decision.getByTestId("meeting-decision-task");
    await expect(link).toHaveCount(1, { timeout: APP_LOAD_TIMEOUT });
    const taskId = (await link.getAttribute("data-task-id"))!;
    await expect(item.getByTestId("meeting-agenda-item-counts")).toHaveAttribute("data-decisions", "1");
    await expect(item.getByTestId("meeting-agenda-item-counts")).toHaveAttribute("data-tasks", "1");
    // The assignee by full name (the manager is looking, so not "You").
    await expect(decision.getByTestId("meeting-decision-task-assignees")).toHaveAttribute("title", volunteer.fullName);

    // The row toggles by click and keyboard; "Expand all / Collapse all" opens and closes every item.
    const toggle = item.getByTestId("meeting-agenda-item-toggle");
    const controls = (await toggle.getAttribute("aria-controls"))!;
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(decision).toHaveCount(0);
    await toggle.focus();
    await page.keyboard.press("Enter");
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(page.locator(`[id="${controls}"]`).getByTestId("meeting-decision")).toHaveCount(1);
    await page.keyboard.press("Space");
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    const expandAll = page.getByTestId("meeting-agenda-expand-all");
    await expect(expandAll).toHaveAttribute("aria-pressed", "false");
    await expandAll.click();
    await expect(expandAll).toHaveAttribute("aria-pressed", "true");
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    const task = (await workRpc(manager, "get_task", { p_id: taskId })).data as { title: string; meeting_id: string; assignees: { id: string }[] };
    expect([task.title, task.meeting_id, task.assignees.map((a) => a.id)]).toEqual([decisionText, id, [volunteer.id]]);

    // The task opens in the side panel on the meeting page; the URL keeps it, so a refresh reopens it.
    await link.click();
    await expect(page).toHaveURL(new RegExp(`/meetings/${id}\\?task=${taskId}$`), { timeout: APP_LOAD_TIMEOUT });
    const panel = page.getByTestId("task-panel");
    await expect(panel.getByTestId("task-panel-title")).toHaveText(decisionText, { timeout: APP_LOAD_TIMEOUT });
    await expect(panel.getByTestId("task-panel-meeting-link")).toHaveAttribute("href", `/meetings/${id}`);
    await expect(panel.getByTestId("task-panel-decision")).toBeVisible();
    await expect(page.getByTestId("meeting-detail")).toBeAttached();
    await page.reload();
    await expect(page.getByTestId("task-panel").getByTestId("task-panel-title")).toHaveText(decisionText, { timeout: APP_LOAD_TIMEOUT });
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("task-panel")).toHaveCount(0);
    await expect(page).toHaveURL(new RegExp(`/meetings/${id}$`));

    // Edit and Delete icons on the task row (the manager may edit the task). After the reload the decision is collapsed.
    await expandItem(item);
    await expandDecision(decision);
    const row = item.getByTestId("meeting-decision-task-row");
    await row.getByTestId("meeting-decision-task-edit").click({ timeout: APP_LOAD_TIMEOUT });
    const editForm = page.getByTestId("task-form");
    const renamed = `${decisionText} (renamed)`;
    await editForm.getByTestId("task-form-title").fill(renamed);
    await editForm.getByTestId("task-form-submit").click();
    await expect(editForm).toBeHidden();
    await expect(row.getByTestId("meeting-decision-task")).toContainText("(renamed)", { timeout: APP_LOAD_TIMEOUT });

    // The meeting's calendar entry lists the decision's task under Linked tasks; scope facts sit under "Details".
    const meetingRow = (await adminClient().from("meetings").select("event_id").eq("id", id).single()).data!;
    await page.goto(`/events/${meetingRow.event_id}`);
    await expect(page.locator(`[data-testid="event-linked-task"][data-task-id="${taskId}"]`)).toBeVisible({ timeout: APP_LOAD_TIMEOUT });
    const details = page.getByTestId("event-meeting-details-toggle");
    await expect(details).toHaveAttribute("aria-expanded", "false");
    await details.click();
    await expect(details).toHaveAttribute("aria-expanded", "true");
    await openMeeting(page, id);

    // Delete asks first; then the task leaves the decision.
    await expandItem(item);
    await expandDecision(decision);
    await row.getByTestId("meeting-decision-task-delete").click({ timeout: APP_LOAD_TIMEOUT });
    const dialog = page.getByTestId("meeting-decision-task-delete-dialog");
    await expect(dialog).toBeVisible();
    await dialog.getByTestId("meeting-decision-task-delete-cancel").click();
    await expect(link).toHaveCount(1);
    await row.getByTestId("meeting-decision-task-delete").click();
    await dialog.getByTestId("meeting-decision-task-delete-confirm").click();
    await expect(page.getByTestId("toast-success")).toBeVisible();
    await expect(link).toHaveCount(0, { timeout: APP_LOAD_TIMEOUT });
  });

  test("decisions expand like agenda items: a count and chevron for linked tasks, none without; + Task opens its decision; Expand all opens decisions too", async ({ freshUser, freshBranch, pageAs }) => {
    const { branch, manager, volunteer } = await branchTeam(freshBranch, freshUser, "meetings-decision-tasks");
    const id = await createMeetingAs(manager, meetingAt(branch, "decision tasks", { invitee_ids: [volunteer.id] }));
    const itemId = (await workRpc(manager, "add_agenda_item", { p_meeting: id, p_title: "Volunteer week" })).data as string;
    const withTasks = (await workRpc(manager, "add_meeting_decision", { p_item: itemId, p_text: "Print the flyers" })).data as string;
    const without = (await workRpc(manager, "add_meeting_decision", { p_item: itemId, p_text: "Ask the council" })).data as string;
    for (const title of ["flyers A5", "flyers A3"])
      expect((await workRpc(manager, "create_task", { p: { scope: "branch", branch_id: branch, title: `${TASK_TITLE_PREFIX}${runId} ${title}`, decision_id: withTasks, due_date: inDays(5).slice(0, 10), assignee_ids: [volunteer.id] } })).error).toBeNull();

    const page = await pageAs(manager);
    await openMeeting(page, id);
    const item = page.locator(`[data-testid="meeting-agenda-item"][data-item-id="${itemId}"]`);
    await expandItem(item);
    const first = item.locator(`[data-testid="meeting-decision"][data-decision-id="${withTasks}"]`);
    const second = item.locator(`[data-testid="meeting-decision"][data-decision-id="${without}"]`);

    // Collapsed by default, with the count in the row; the chevron (or the count) opens and closes the list.
    const toggle = first.getByTestId("meeting-decision-tasks-toggle");
    await expect(toggle).toHaveAttribute("data-tasks", "2");
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(first.getByTestId("meeting-decision-task")).toHaveCount(0);
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(first.getByTestId("meeting-decision-task")).toHaveCount(2);
    // Each row keeps the task's content: assignee by full name, status and due date.
    const row = first.getByTestId("meeting-decision-task").first();
    await expect(row.getByTestId("meeting-decision-task-assignees")).toHaveAttribute("title", volunteer.fullName, { timeout: APP_LOAD_TIMEOUT });
    await expect(row.getByTestId("task-due")).toBeVisible();
    await first.getByTestId("meeting-decision-tasks-count").click();
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(first.getByTestId("meeting-decision-tasks")).toHaveCount(0);
    // Closing and reopening the agenda item keeps the decision's state while on the page.
    await toggle.click();
    await item.getByTestId("meeting-agenda-item-toggle").click();
    await expandItem(item);
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await toggle.click();

    // A decision without tasks has no chevron.
    await expect(second.getByTestId("meeting-decision-tasks-toggle")).toHaveCount(0);

    // Expand all opens the decisions' task lists too; Collapse all closes everything.
    const expandAll = page.getByTestId("meeting-agenda-expand-all");
    await expandAll.click();
    await expect(expandAll).toHaveAttribute("aria-pressed", "true");
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(first.getByTestId("meeting-decision-task")).toHaveCount(2);
    await expandAll.click();
    await expect(item.getByTestId("meeting-agenda-item-toggle")).toHaveAttribute("aria-expanded", "false");
    await expandItem(item);
    await expect(toggle).toHaveAttribute("aria-expanded", "false");

    // "+ Task" on the decision without tasks: the new task shows under it, and its list is open.
    await decisionAction(page, second, "create-task");
    const form = page.getByTestId("task-form");
    await pickPerson(page, "task-form-assignees", volunteer.id);
    await form.getByTestId("task-form-submit").click();
    await expect(form).toBeHidden({ timeout: APP_LOAD_TIMEOUT });
    const secondToggle = second.getByTestId("meeting-decision-tasks-toggle");
    await expect(secondToggle).toHaveAttribute("data-tasks", "1", { timeout: APP_LOAD_TIMEOUT });
    await expect(secondToggle).toHaveAttribute("aria-expanded", "true");
    await expect(second.getByTestId("meeting-decision-task")).toHaveCount(1);
    await expect(item.getByTestId("meeting-agenda-item-counts")).toHaveAttribute("data-tasks", "3");
  });

  test("the meetings page is one timeline: earlier past meetings collapsed, the two latest past, the next three, later ones collapsed", async ({ freshUser, freshBranch, pageAs }) => {
    const { branch, manager } = await branchTeam(freshBranch, freshUser, "meetings-timeline");
    const past = [];
    for (const d of [-9, -7, -5, -3]) past.push(await createMeetingAs(manager, meetingAt(branch, `past ${d}`, { starts_at: inDays(d), ends_at: inDays(d, 1) })));
    const upcoming = [];
    for (const d of [2, 3, 4, 5, 6]) upcoming.push(await createMeetingAs(manager, meetingAt(branch, `next ${d}`, { starts_at: inDays(d), ends_at: inDays(d, 1) })));
    const page = await pageAs(manager);
    await openMeetings(page);
    const shown = async () =>
      page.locator('[data-testid="meeting-card"]').evaluateAll((cards) => cards.map((c) => c.getAttribute("data-meeting-id")));
    // Collapsed: the two latest past meetings, then the next three, oldest first.
    await expect.poll(shown, { timeout: APP_LOAD_TIMEOUT }).toEqual([past[2], past[3], upcoming[0], upcoming[1], upcoming[2]]);
    await expect(page.getByTestId("meetings-show-earlier")).toHaveAttribute("data-count", "2");
    await expect(page.getByTestId("meetings-show-later")).toHaveAttribute("data-count", "2");
    await page.getByTestId("meetings-show-earlier").click();
    await page.getByTestId("meetings-show-later").click();
    await expect.poll(shown).toEqual([...past, ...upcoming]);
    await expect(page.getByTestId("meetings-show-earlier")).toHaveAttribute("aria-expanded", "true");
  });

  test("meeting request: a volunteer asks the branch manager, who approves it into a meeting the volunteer is invited to", async ({ freshUser, freshBranch, pageAs }) => {
    const { manager, volunteer } = await branchTeam(freshBranch, freshUser, "meetings-request");
    const topic = title("request");
    const day = londonDay(8);
    const page = await pageAs(volunteer);
    await page.goto("/requests");
    await page.getByTestId("my-requests-new").click({ timeout: APP_LOAD_TIMEOUT });
    await page.getByTestId("request-type-card-meeting").click();
    const form = page.getByTestId("meeting-request-form");
    await expect(form).toBeVisible();
    // One possible scope: the request form has no "Where" field.
    await expect(form.locator('[data-testid*="scope"]')).toHaveCount(0);
    await form.getByTestId("meeting-request-target").click();
    await page.locator(`[data-testid="meeting-request-target-option"][data-user-id="${manager.id}"]`).click();
    await form.getByTestId("meeting-request-topic").fill(topic);
    await form.getByTestId("meeting-request-time-1-start-date").fill(day);
    await pickOption(page, "meeting-request-time-1-start-time", "meeting-request-time-1-start-time-option", "17:00");
    await expect(form.getByTestId("meeting-request-time-1-end-date")).toHaveValue(day);
    await expect(form.getByTestId("meeting-request-time-1-end-time")).toContainText("18:00");
    await form.getByTestId("meeting-request-submit").click();
    await expect(form).toBeHidden();
    const requestId = (await adminClient().from("meeting_requests").select("id").eq("topic", topic).single()).data!.id as string;
    const mine = page.locator(`[data-testid="work-request-row"][data-request-id="${requestId}"]`);
    await expect(mine).toHaveAttribute("data-status", "submitted");

    const reviewer = await pageAs(manager);
    await reviewer.goto("/requests?tab=review");
    const row = reviewer.locator(`[data-testid="work-review-row"][data-request-id="${requestId}"]`);
    await row.getByTestId("work-review-approve").click({ timeout: APP_LOAD_TIMEOUT });
    const approve = reviewer.getByTestId("work-review-meeting");
    await expect(approve.getByTestId("work-review-meeting-title")).toHaveValue(topic);
    await expect(approve.getByTestId("work-review-meeting-start-date")).toHaveValue(day);
    await expect(approve.getByTestId("work-review-meeting-start-time")).toContainText("17:00");
    await expect(approve.getByTestId("work-review-meeting-invitees")).toHaveCount(0);
    await approve.getByTestId("work-review-meeting-place-in-person").check();
    await approve.getByTestId("work-review-meeting-location").fill("E2E Branch Office");
    await approve.getByTestId("work-review-meeting-submit").click();
    await expect(approve).toBeHidden();
    await expect.poll(async () => (await adminClient().from("meeting_requests").select("status").eq("id", requestId).single()).data?.status).toBe("approved");
    const meetingId = (await adminClient().from("meeting_requests").select("meeting_id").eq("id", requestId).single()).data!.meeting_id as string;
    const invited = await adminClient().from("meeting_invitees").select("user_id").eq("meeting_id", meetingId);
    expect((invited.data ?? []).map((r) => r.user_id)).toContain(volunteer.id);

    await page.reload();
    await expect(mine).toHaveAttribute("data-status", "approved", { timeout: APP_LOAD_TIMEOUT });
    await mine.getByTestId("work-request-open-meeting").click();
    await expect(page).toHaveURL(new RegExp(`/meetings/${meetingId}$`), { timeout: APP_LOAD_TIMEOUT });
    await expect(page.getByTestId("meeting-detail")).toHaveAttribute("data-meeting-id", meetingId, { timeout: APP_LOAD_TIMEOUT });
    await expect(page.getByTestId("meeting-invited")).toBeVisible();
  });

  test("files: the creator uploads a PDF; the invitee downloads it through a signed link but cannot change files", async ({ freshUser, freshBranch, pageAs }) => {
    const { branch, manager, volunteer } = await branchTeam(freshBranch, freshUser, "meetings-files");
    const id = await createMeetingAs(manager, meetingAt(branch, "files", { invitee_ids: [volunteer.id] }));
    const page = await pageAs(manager);
    await openMeeting(page, id);
    await expect(page.getByTestId("meeting-files-empty")).toBeVisible();
    await page.getByTestId("meeting-file-input").setInputFiles({
      name: "e2e-minutes.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n"),
    });
    const file = page.getByTestId("meeting-file");
    await expect(file).toHaveCount(1, { timeout: APP_LOAD_TIMEOUT });
    await expect(file.getByTestId("meeting-file-name")).toHaveText("e2e-minutes.pdf");
    await expect(file.getByTestId("meeting-file-delete")).toBeVisible();
    const fileId = (await file.getAttribute("data-file-id"))!;

    const asInvitee = await pageAs(volunteer);
    await openMeeting(asInvitee, id);
    const shared = asInvitee.locator(`[data-testid="meeting-file"][data-file-id="${fileId}"]`);
    await expect(shared).toBeVisible();
    await expect(asInvitee.getByTestId("meeting-file-upload")).toHaveCount(0);
    await expect(asInvitee.getByTestId("meeting-file-input")).toHaveCount(0);
    await expect(shared.getByTestId("meeting-file-delete")).toHaveCount(0);
    const href = (await shared.getByTestId("meeting-file-download").getAttribute("href"))!;
    expect(href).toMatch(/\/storage\/v1\/object\/sign\/meeting-files\/.+\?token=/);
    const response = await asInvitee.request.get(href);
    expect(response.status()).toBe(200);
    expect((await response.body()).subarray(0, 8).toString()).toBe("%PDF-1.4");
  });

  test.describe("at 390 px", () => {
    test.use({ viewport: { width: 390, height: 844 } });

    test("a long unbroken title, location and invitee name do not make the list or the detail page scroll sideways", async ({ freshUser, freshBranch, pageAs }) => {
      const { branch, manager, volunteer } = await branchTeam(freshBranch, freshUser, "meetings-long");
      const prefix = `${MEETING_TITLE_PREFIX}${runId} `;
      const long = prefix + "M".repeat(150 - prefix.length);
      const longName = `E2E ${"N".repeat(120)}`;
      const updated = await adminClient().from("profiles").update({ full_name: longName }).eq("id", volunteer.id);
      expect(updated.error).toBeNull();
      const id = await createMeetingAs(manager, meetingAt(branch, "long", { title: long, location: "L".repeat(250), invitee_ids: [volunteer.id] }));
      const page = await pageAs(manager);
      await page.setViewportSize({ width: 390, height: 844 });
      await openMeetings(page);
      await expect(meetingCard(page, id)).toBeVisible();
      expect(await sideways(page), "list").toBeLessThanOrEqual(0);
      await openMeeting(page, id);
      await expandInvitees(page, "meeting-invitees-toggle");
      await expect(page.locator(`[data-testid="meeting-invitee"][data-user-id="${volunteer.id}"]`)).toBeVisible();
      expect(await sideways(page), "detail").toBeLessThanOrEqual(0);
    });
  });
});

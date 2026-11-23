// Meetings in the UI: creating with invitees (invite-only visibility), agenda and decisions turned into tasks, meeting
// requests approved into meetings, private files and long names at 390 px. Every meeting is created by fresh users in
// a temporary branch (cleaned up with its files by the fixtures) and every check looks at this test's own ids only.
import type { Page } from "@playwright/test";
import { test, expect, runId, type TestUser } from "../../fixtures/roles";
import { adminClient } from "../../api/SupabaseClient";
import { MEETING_TITLE_PREFIX, TASK_TITLE_PREFIX, createMeetingAs, inDays, workRpc } from "../../api/work";
import { APP_LOAD_TIMEOUT } from "../../pages/app";
import { pickOption } from "../../pages/components/select";

let n = 0;
const title = (label: string) => `${MEETING_TITLE_PREFIX}${runId} ui-${Date.now().toString(36)}-${++n} ${label}`;
/** London "YYYY-MM-DD" `days` from today. */
const londonDay = (days = 0) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(new Date(Date.now() + days * 86400000));

const meetingCard = (page: Page, id: string) => page.locator(`[data-testid="meeting-card"][data-meeting-id="${id}"]`);
const sideways = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

async function openMeetings(page: Page) {
  await page.goto("/meetings");
  await expect(page.getByTestId("meetings-tab-upcoming")).toBeVisible({ timeout: APP_LOAD_TIMEOUT });
  await expect(page.getByTestId("meetings-list").or(page.getByTestId("meetings-empty"))).toBeVisible({ timeout: APP_LOAD_TIMEOUT });
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
    await form.getByTestId("meeting-form-title").fill(name);
    await form.getByTestId("meeting-form-start-date").fill(day);
    await pickOption(page, "meeting-form-start-time", "meeting-form-start-time-option", "18:00");
    // End follows Start + 1 hour.
    await expect(form.getByTestId("meeting-form-end-date")).toHaveValue(day);
    await expect(form.getByTestId("meeting-form-end-time")).toContainText("19:00");
    await expect(form.getByTestId("meeting-form-place-in-person")).toBeChecked();
    await form.getByTestId("meeting-form-location").fill("E2E Community Hall");
    await form.locator(`[data-testid="meeting-form-invitees-option"][data-user-id="${invitee.id}"]`).getByTestId("meeting-form-invitees-checkbox").check();
    await form.getByTestId("meeting-form-submit").click();
    await expect(page).toHaveURL(/\/meetings\/[0-9a-f-]{36}$/, { timeout: APP_LOAD_TIMEOUT });
    const id = new URL(page.url()).pathname.split("/").pop()!;
    await expect(page.getByTestId("meeting-detail")).toHaveAttribute("data-meeting-id", id, { timeout: APP_LOAD_TIMEOUT });
    await expect(page.getByTestId("meeting-edit")).toBeVisible();
    const invited = await adminClient().from("meeting_invitees").select("user_id").eq("meeting_id", id);
    expect((invited.data ?? []).map((r) => r.user_id)).toEqual([invitee.id]);

    // The invitee sees it in the list and reads the detail page only.
    const asInvitee = await pageAs(invitee);
    await openMeetings(asInvitee);
    await expect(meetingCard(asInvitee, id)).toBeVisible();
    await expect(meetingCard(asInvitee, id).getByTestId("meeting-card-invited")).toBeVisible();
    await meetingCard(asInvitee, id).click();
    await expect(asInvitee.getByTestId("meeting-detail")).toHaveAttribute("data-meeting-id", id, { timeout: APP_LOAD_TIMEOUT });
    await expect(asInvitee.getByTestId("meeting-title")).toHaveText(name);
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

    const decisionText = `${TASK_TITLE_PREFIX}${runId} book the hall for the iftar`;
    await item.getByTestId("meeting-decision-add").click();
    await item.getByTestId("meeting-decision-text").fill(decisionText);
    await item.getByTestId("meeting-decision-save").click();
    const decision = item.getByTestId("meeting-decision");
    await expect(decision.getByTestId("meeting-decision-text-value")).toHaveText(decisionText);

    await decision.getByTestId("meeting-decision-create-task").click();
    const form = page.getByTestId("task-form");
    await expect(form.getByTestId("task-form-from-decision")).toBeVisible();
    await expect(form.getByTestId("task-form-scope-fixed")).toHaveAttribute("data-scope", `branch:${branch}`);
    await expect(form.getByTestId("task-form-title")).toHaveValue(decisionText);
    await form.locator(`[data-testid="task-form-assignees-option"][data-user-id="${volunteer.id}"]`).getByTestId("task-form-assignees-checkbox").check();
    await form.getByTestId("task-form-submit").click();
    await expect(form).toBeHidden();
    const link = decision.getByTestId("meeting-decision-task");
    await expect(link).toHaveCount(1, { timeout: APP_LOAD_TIMEOUT });
    const taskId = (await link.getAttribute("data-task-id"))!;
    const task = (await workRpc(manager, "get_task", { p_id: taskId })).data as { title: string; meeting_id: string; assignees: { id: string }[] };
    expect([task.title, task.meeting_id, task.assignees.map((a) => a.id)]).toEqual([decisionText, id, [volunteer.id]]);

    await link.click();
    await expect(page).toHaveURL(new RegExp(`/tasks\\?task=${taskId}$`), { timeout: APP_LOAD_TIMEOUT });
    const panel = page.getByTestId("task-panel");
    await expect(panel.getByTestId("task-panel-title")).toHaveText(decisionText, { timeout: APP_LOAD_TIMEOUT });
    await expect(panel.getByTestId("task-panel-meeting-link")).toHaveAttribute("href", `/meetings/${id}`);
    await expect(panel.getByTestId("task-panel-decision")).toBeVisible();
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
      await expect(page.locator(`[data-testid="meeting-invitee"][data-user-id="${volunteer.id}"]`)).toBeVisible();
      expect(await sideways(page), "detail").toBeLessThanOrEqual(0);
    });
  });
});

// Less notification noise: Profile > Notifications (per type on/off and Immediately / Daily summary, locked types),
// grouped lines and "Mark all as read" on the dashboard, and requests waiting for review ("Waiting for you" card,
// Requests badge, mobile More badge, the grouped notice marked read on To review). Every notice is created through the
// real RPCs by fresh users in a temporary branch (cleaned up by the fixtures); checks look at this test's users only.
import type { Page } from "@playwright/test";
import { test, expect, runId } from "../../fixtures/roles";
import { adminClient } from "../../api/SupabaseClient";
import { TASK_TITLE_PREFIX, createTaskAs, workRpc } from "../../api/work";
import { APP_LOAD_TIMEOUT } from "../../pages/app";
import { DashboardPage } from "../../pages/DashboardPage";
import { Sidebar } from "../../pages/components/Sidebar";

let n = 0;
const title = (label: string) => `${TASK_TITLE_PREFIX}${runId} notif-${Date.now().toString(36)}-${++n} ${label}`;
const typeRow = (page: Page, type: string) =>
  page.locator(`[data-testid="profile-notification-type"][data-type="${type}"]`);
const unreadNotices = async (userId: string) =>
  (await adminClient().from("notifications").select("id", { count: "exact", head: true }).eq("user_id", userId).is("read_at", null).eq("held", false)).count;

test.describe("Notifications", () => {
  test("a branch manager changes a notice type in Profile; the choice is kept and locked types cannot change", async ({ freshUser, freshBranch, pageAs }) => {
    const branch = await freshBranch("notif-settings");
    const manager = await freshUser({ role: "branch_manager", branch });
    const page = await pageAs(manager);
    await page.goto("/profile");
    const section = page.getByTestId("profile-notifications");
    await expect(section).toBeVisible({ timeout: APP_LOAD_TIMEOUT });

    // Locked: always on and immediate, controls disabled.
    const assigned = typeRow(page, "task_assigned");
    await expect(assigned).toHaveAttribute("data-locked", "true");
    await expect(assigned.getByTestId("profile-notification-enabled")).toBeDisabled();
    await expect(assigned.getByTestId("profile-notification-delivery-digest")).toBeDisabled();
    await expect(typeRow(page, "review")).toHaveAttribute("data-locked", "true");
    await expect(typeRow(page, "mention")).toHaveAttribute("data-locked", "true");

    // Managers get the daily summary by default; this one wants task status changes immediately and no note notices.
    const status = typeRow(page, "task_status");
    await expect(status).toHaveAttribute("data-locked", "false");
    await expect(status).toHaveAttribute("data-delivery", "digest");
    await status.getByTestId("profile-notification-delivery-immediate").click();
    await expect(page.getByTestId("toast-success").first()).toBeVisible();
    await expect(status).toHaveAttribute("data-delivery", "immediate");
    const notes = typeRow(page, "task_note");
    await notes.getByTestId("profile-notification-enabled").click();
    await expect(notes).toHaveAttribute("data-enabled", "false");
    await expect(notes.getByTestId("profile-notification-delivery-immediate")).toBeDisabled();
    await expect(section.getByTestId("profile-task-reminder-emails")).toBeVisible();

    await page.reload();
    await expect(typeRow(page, "task_status")).toHaveAttribute("data-delivery", "immediate", { timeout: APP_LOAD_TIMEOUT });
    await expect(typeRow(page, "task_note")).toHaveAttribute("data-enabled", "false");
    const saved = (await workRpc(manager, "get_notification_settings")).data as { types: { type: string; enabled: boolean; delivery: string }[] };
    expect(saved.types.find((s) => s.type === "task_status")).toMatchObject({ enabled: true, delivery: "immediate" });
    expect(saved.types.find((s) => s.type === "task_note")).toMatchObject({ enabled: false });
  });

  test("similar notices are one expandable line and Mark all as read clears every unread notice", async ({ freshUser, freshBranch, pageAs }) => {
    const branch = await freshBranch("notif-group");
    const manager = await freshUser({ role: "branch_manager", branch });
    const volunteer = await freshUser({ role: "volunteer", branch });
    const director = await freshUser({ role: "regional_director" });
    expect((await workRpc(manager, "set_notification_setting", { p_type: "task_status", p_enabled: true, p_delivery: "immediate" })).error).toBeNull();
    // Two of the manager's tasks are completed by the volunteer, and a Regional Director assigns the manager a task.
    const tasks = [
      await createTaskAs(manager, { scope: "branch", branch_id: branch, title: title("done 1"), assignee_ids: [volunteer.id] }),
      await createTaskAs(manager, { scope: "branch", branch_id: branch, title: title("done 2"), assignee_ids: [volunteer.id] }),
    ];
    for (const id of tasks) expect((await workRpc(volunteer, "set_task_status", { p_id: id, p_status: "done" })).error).toBeNull();
    await createTaskAs(director, { scope: "branch", branch_id: branch, title: title("assigned"), assignee_ids: [manager.id] });
    await expect.poll(() => unreadNotices(manager.id)).toBe(3);

    const page = await pageAs(manager);
    const dashboard = new DashboardPage(page);
    await dashboard.goto();
    const card = page.getByTestId("dashboard-notifications");
    const group = card.locator('[data-testid="dashboard-notification-group"][data-kind="task_status_changed"]');
    await expect(group).toHaveAttribute("data-count", "2", { timeout: APP_LOAD_TIMEOUT });
    const toggle = group.getByTestId("dashboard-notification-group-toggle");
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(group.getByTestId("dashboard-notification")).toHaveCount(0);
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(group.getByTestId("dashboard-notification")).toHaveCount(2);
    await expect(card.locator('[data-testid="dashboard-notification"][data-kind="task_assigned"]')).toHaveAttribute("data-unread", "true");

    await card.getByTestId("dashboard-notifications-mark-all").click();
    await expect(page.getByTestId("toast-success").first()).toBeVisible();
    await expect(card.getByTestId("dashboard-notifications-mark-all")).toHaveCount(0);
    await expect(card.locator('[data-unread="true"]')).toHaveCount(0);
    // Read notices are no longer grouped: each is its own line again.
    await expect(group).toHaveCount(0);
    await expect(card.locator('[data-testid="dashboard-notification"][data-kind="task_status_changed"]')).toHaveCount(2);
    expect(await unreadNotices(manager.id)).toBe(0);
  });

  test("a waiting task request shows in Waiting for you and the Requests badge; To review marks its notice read", { tag: "@smoke" }, async ({ freshUser, freshBranch, pageAs, isMobile }) => {
    const branch = await freshBranch("notif-waiting");
    const manager = await freshUser({ role: "branch_manager", branch });
    const volunteer = await freshUser({ role: "volunteer", branch });
    expect((await workRpc(volunteer, "submit_task_request", { p: { target_id: manager.id, title: title("waiting") } })).error).toBeNull();

    const page = await pageAs(manager);
    const dashboard = new DashboardPage(page);
    await dashboard.goto();
    await expect(dashboard.waitingCount()).toHaveAttribute("data-count", "1", { timeout: APP_LOAD_TIMEOUT });
    const notice = page.getByTestId("dashboard-notifications").locator('[data-testid="dashboard-notification"][data-kind="review_waiting"]');
    await expect(notice).toHaveAttribute("data-unread", "true");
    // Phones: Requests sits under More, whose badge sums its items.
    if (isMobile) await expect(page.getByTestId("mobile-nav-more-badge")).toHaveAttribute("data-count", "1");
    const sidebar = new Sidebar(page, isMobile);
    await expect(await sidebar.requestsBadge()).toHaveAttribute("data-count", "1");
    if (isMobile) await page.keyboard.press("Escape");

    await dashboard.waitingLink().click();
    await expect(page).toHaveURL(/\/requests\?tab=review/);
    await expect(page.getByTestId("requests-tab-review")).toHaveAttribute("data-state", "active", { timeout: APP_LOAD_TIMEOUT });
    await expect
      .poll(async () => (await adminClient().from("notifications").select("read_at").eq("user_id", manager.id).eq("kind", "review_waiting")).data?.map((r) => !!r.read_at))
      .toEqual([true]);
  });
});

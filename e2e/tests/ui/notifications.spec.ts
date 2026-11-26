// Less notification noise: Profile > Notifications (the simple Email choice, Advanced per-type in-app / email / push
// checkboxes, locked types, the collapsed view on one phone screen), in-app notices at
// once for every role, notice emails (at once for assignments, invitations and requests waiting; the rest in one daily
// summary) with a signed "stop these emails" link,
// the header bell (grouped lines, "Mark all as read", opening a notice, See all and Load more on /notifications), and
// requests waiting for review ("Waiting for you" card, Requests badge, mobile More badge, the grouped notice marked read
// on To review). Every notice is created through the real RPCs by fresh users in a temporary branch (cleaned up by the
// fixtures); checks look at this test's users only.
import { devices, type Page } from "@playwright/test";
import { test, expect, runId, type TestUser } from "../../fixtures/roles";
import { adminClient } from "../../api/SupabaseClient";
import { TASK_TITLE_PREFIX, createMeetingAs, createTaskAs, workRpc } from "../../api/work";
import { APP_LOAD_TIMEOUT } from "../../pages/app";
import { DashboardPage } from "../../pages/DashboardPage";
import { Sidebar } from "../../pages/components/Sidebar";
import { NotificationBell } from "../../pages/components/NotificationBell";
import { appPathFrom, linkFrom, triggerScheduledRun, waitForEmail } from "../../api/outbox";
import { fakePush } from "../../pages/components/FakePush";

let n = 0;
const title = (label: string) => `${TASK_TITLE_PREFIX}${runId} notif-${Date.now().toString(36)}-${++n} ${label}`;
const typeRow = (page: Page, type: string) =>
  page.locator(`[data-testid="profile-notification-row"][data-type="${type}"]`);
const emailMode = (page: Page) => page.getByTestId("profile-email-mode");
const openAdvanced = async (page: Page) => {
  const toggle = page.getByTestId("profile-notifications-advanced-toggle");
  await expect(toggle).toHaveAttribute("aria-expanded", "false", { timeout: APP_LOAD_TIMEOUT });
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
};
type Saved = { task_reminder_emails: boolean; types: { type: string; enabled: boolean; email: boolean }[] };
const TYPES = ["task_assigned", "mention", "review", "task_status", "task_note", "task_reminder", "meeting", "request_decided"];
/** The stored settings of the types Profile shows (the database may already know newer ones, e.g. 'media'). */
const savedSettings = async (who: TestUser) => {
  const saved = (await workRpc(who, "get_notification_settings")).data as Saved;
  return { ...saved, types: saved.types.filter((s) => TYPES.includes(s.type)) };
};
const IMPORTANT = ["task_assigned", "mention", "review", "meeting", "task_reminder"];
const ALL_OFF = Object.fromEntries(TYPES.map((t) => [t, false]));
const unreadNotices = async (userId: string) =>
  (await adminClient().from("notifications").select("id", { count: "exact", head: true }).eq("user_id", userId).is("read_at", null).eq("held", false)).count;

test.describe("Notifications", () => {
  test("Profile > Notifications: Advanced has In the app / Email / Push per type; locked types stay on in the app; choices are kept", async ({ freshUser, freshBranch, pageAs }) => {
    const branch = await freshBranch("notif-settings");
    const manager = await freshUser({ role: "branch_manager", branch });
    const page = await pageAs(manager);
    await page.goto("/profile");
    const section = page.getByTestId("profile-notifications");
    await expect(section).toBeVisible({ timeout: APP_LOAD_TIMEOUT });
    // Every email is on by default, for every role: the simple choice shows "important at once, the rest daily".
    await expect(emailMode(page)).toHaveAttribute("data-mode", "all", { timeout: APP_LOAD_TIMEOUT });
    await expect(page.getByTestId("profile-email-mode-all")).toBeChecked();
    // Advanced is collapsed by default.
    await expect(page.getByTestId("profile-notifications-advanced")).toHaveCount(0);
    await expect(typeRow(page, "task_assigned")).toHaveCount(0);
    await openAdvanced(page);
    await expect(section.locator('[data-testid="profile-notification-row"][data-email="false"]')).toHaveCount(0);
    await expect(typeRow(page, "task_assigned")).toHaveAttribute("data-email-timing", "immediate");
    await expect(typeRow(page, "meeting")).toHaveAttribute("data-email-timing", "mixed");
    await expect(typeRow(page, "task_status")).toHaveAttribute("data-email-timing", "digest");
    // Labelled per type and channel.
    await expect(page.getByRole("checkbox", { name: "Tasks assigned to me — Email" })).toBeVisible();

    // Locked: always on in the app (disabled, checked), but its email can be turned off.
    const assigned = typeRow(page, "task_assigned");
    await expect(assigned).toHaveAttribute("data-locked", "true");
    await expect(assigned.getByTestId("profile-notification-inapp")).toBeDisabled();
    await expect(assigned.getByTestId("profile-notification-inapp")).toBeChecked();
    await assigned.getByTestId("profile-notification-email").click();
    await expect(page.getByTestId("toast-success").first()).toBeVisible();
    await expect(assigned).toHaveAttribute("data-email", "false");
    await expect(assigned).toHaveAttribute("data-enabled", "true");
    // One change in Advanced: the simple choice shows Custom (no radio checked).
    await expect(emailMode(page)).toHaveAttribute("data-mode", "custom");
    await expect(page.getByTestId("profile-email-mode-custom")).toBeVisible();
    for (const m of ["all", "important", "none"]) await expect(page.getByTestId(`profile-email-mode-${m}`)).not.toBeChecked();
    for (const type of ["review", "mention"]) {
      await expect(typeRow(page, type)).toHaveAttribute("data-locked", "true");
      await expect(typeRow(page, type).getByTestId("profile-notification-inapp")).toBeDisabled();
    }

    // A changeable type turned off in the app: no notice, so its email and push checkboxes are disabled.
    const notes = typeRow(page, "task_note");
    await notes.getByTestId("profile-notification-inapp").click();
    await expect(notes).toHaveAttribute("data-enabled", "false");
    await expect(notes.getByTestId("profile-notification-email")).toBeDisabled();
    await expect(notes.getByTestId("profile-notification-push")).toBeDisabled();
    // Task reminders: the email checkbox is the task reminder emails setting.
    const reminders = typeRow(page, "task_reminder");
    await reminders.getByTestId("profile-notification-email").click();
    await expect(reminders).toHaveAttribute("data-email", "false");
    // Changes show at once (optimistic): wait until every one is saved before reloading.
    await expect.poll(async () => (await savedSettings(manager)).task_reminder_emails).toBe(false);
    await expect.poll(async () => (await savedSettings(manager)).types.find((s) => s.type === "task_note")?.enabled).toBe(false);

    await page.reload();
    await expect(emailMode(page)).toHaveAttribute("data-mode", "custom", { timeout: APP_LOAD_TIMEOUT });
    await openAdvanced(page);
    await expect(typeRow(page, "task_assigned")).toHaveAttribute("data-email", "false");
    await expect(typeRow(page, "task_note")).toHaveAttribute("data-enabled", "false");
    await expect(typeRow(page, "task_reminder")).toHaveAttribute("data-email", "false");
    const saved = await savedSettings(manager);
    expect(saved.task_reminder_emails).toBe(false);
    expect(saved.types.find((s) => s.type === "task_assigned")).toMatchObject({ enabled: true, email: false });
    expect(saved.types.find((s) => s.type === "task_note")).toMatchObject({ enabled: false });
  });

  test("Email choice: only important ones turns the others' email off, No email turns all off; an error rolls back", async ({ freshUser, freshBranch, pageAs }) => {
    const branch = await freshBranch("notif-email-mode");
    const volunteer = await freshUser({ role: "volunteer", branch });
    const page = await pageAs(volunteer);
    await page.goto("/profile");
    await expect(emailMode(page)).toHaveAttribute("data-mode", "all", { timeout: APP_LOAD_TIMEOUT });

    await page.getByTestId("profile-email-mode-important").click();
    await expect(emailMode(page)).toHaveAttribute("data-mode", "important");
    await expect(page.getByTestId("toast-success").first()).toBeVisible();
    await expect
      .poll(async () => Object.fromEntries((await savedSettings(volunteer)).types.map((s) => [s.type, s.email])))
      .toEqual({ ...ALL_OFF, ...Object.fromEntries(IMPORTANT.map((t) => [t, true])) });
    expect((await savedSettings(volunteer)).task_reminder_emails).toBe(true);
    // The in-app switches are untouched.
    expect((await savedSettings(volunteer)).types.every((s) => s.enabled)).toBe(true);

    await page.getByTestId("profile-email-mode-none").click();
    await expect(emailMode(page)).toHaveAttribute("data-mode", "none");
    await expect
      .poll(async () => (await savedSettings(volunteer)).types.filter((s) => s.email).map((s) => s.type))
      .toEqual([]);
    expect((await savedSettings(volunteer)).task_reminder_emails).toBe(false);
    await page.reload();
    await expect(emailMode(page)).toHaveAttribute("data-mode", "none", { timeout: APP_LOAD_TIMEOUT });
    await expect(page.getByTestId("profile-email-mode-none")).toBeChecked();

    // The save fails: the choice goes back to what is stored, with an error toast.
    await page.route("**/_serverFn/**", (route) => (route.request().method() === "POST" ? route.abort() : route.continue()));
    await page.getByTestId("profile-email-mode-all").click();
    await expect(page.getByTestId("toast-error").first()).toBeVisible();
    await expect(emailMode(page)).toHaveAttribute("data-mode", "none");
    await page.unroute("**/_serverFn/**");
    expect((await savedSettings(volunteer)).types.filter((s) => s.email)).toEqual([]);

    // Back to every email.
    await page.getByTestId("profile-email-mode-all").click();
    await expect(emailMode(page)).toHaveAttribute("data-mode", "all");
    await expect.poll(async () => (await savedSettings(volunteer)).types.every((s) => s.email)).toBe(true);
  });

  for (const lang of ["en", "tr"] as const)
    test(`Profile > Notifications (${lang}): the collapsed view fits on one Pixel 7 and iPhone SE screen`, async ({ freshUser, freshBranch, pageAs }, testInfo) => {
      test.skip(testInfo.project.name !== "mobile-pixel7", "phone layout (the mobile project's phone context)");
      const branch = await freshBranch(`notif-fit-${lang}`);
      const volunteer = await freshUser({ role: "volunteer", branch });
      const page = await pageAs(volunteer, { language: lang });
      // A browser that can push, permission not asked yet: the switch is shown (the usual state).
      await fakePush(page, { permission: "default" });
      for (const viewport of [devices["Pixel 7"].viewport, devices["iPhone SE"].viewport]) {
        await page.setViewportSize(viewport);
        await page.goto("/profile");
        const section = page.getByTestId("profile-notifications");
        await expect(emailMode(page)).toHaveAttribute("data-mode", "all", { timeout: APP_LOAD_TIMEOUT });
        await expect(page.getByTestId("profile-push")).toHaveAttribute("data-state", "off");
        await expect(page.getByTestId("profile-push-switch")).toBeVisible();
        await expect(page.getByTestId("profile-notifications-advanced-toggle")).toHaveAttribute("aria-expanded", "false");
        const box = (await section.boundingBox())!;
        expect(box.height, `${viewport.width}x${viewport.height}`).toBeLessThanOrEqual(viewport.height);
        expect(box.width).toBeLessThanOrEqual(viewport.width);
      }
    });

  test("a meeting invitation is emailed at once; the stop link turns off that type's emails without signing in", async ({ freshUser, freshBranch, pageAs, page }) => {
    const branch = await freshBranch("notif-unsub");
    const manager = await freshUser({ role: "branch_manager", branch });
    const volunteer = await freshUser({ role: "volunteer", branch });
    const meeting = (label: string, days: number) =>
      createMeetingAs(manager, {
        scope: "branch",
        branch_id: branch,
        title: title(label),
        starts_at: new Date(Date.now() + days * 86400000).toISOString(),
        ends_at: new Date(Date.now() + days * 86400000 + 3600000).toISOString(),
        invitee_ids: [volunteer.id],
      });
    const first = await meeting("invite", 10);
    await triggerScheduledRun();
    const email = await waitForEmail({ template: "notice", userId: volunteer.id, timeoutMs: 30000 });
    expect(email.payload).toMatchObject({ type: "meeting" });
    expect(email.captured.subject).toContain("Meeting invitation: ");
    expect(new URL(linkFrom(email, "/meetings/")).pathname).toBe(`/meetings/${first}`);
    expect(email.captured.list_unsubscribe).toContain("/api/public/notice-unsubscribe?t=");

    // Signed out: open the stop link, see which emails it stops, confirm with a click.
    await page.goto(appPathFrom(email, "/e/notices"));
    const linkPage = page.getByTestId("notice-email-link-page");
    await expect(linkPage).toBeVisible({ timeout: APP_LOAD_TIMEOUT });
    await linkPage.getByTestId("notice-email-unsubscribe-button").click();
    await expect(linkPage.getByTestId("notice-email-link-state")).toHaveAttribute("data-state", "unsubscribed");
    // A tampered link is refused.
    const tampered = appPathFrom(email, "/e/notices").replace(/.(?=$)/, (c) => (c === "A" ? "B" : "A"));
    await page.goto(tampered);
    await expect(page.getByTestId("notice-email-link-state")).toHaveAttribute("data-state", "invalid", { timeout: APP_LOAD_TIMEOUT });

    // Profile shows the meeting email off; the in-app notices stay on.
    const member = await pageAs(volunteer);
    await member.goto("/profile");
    await expect(emailMode(member)).toHaveAttribute("data-mode", "custom", { timeout: APP_LOAD_TIMEOUT });
    await openAdvanced(member);
    await expect(typeRow(member, "meeting")).toHaveAttribute("data-email", "false");
    await expect(typeRow(member, "meeting")).toHaveAttribute("data-enabled", "true");
    await expect(typeRow(member, "task_assigned")).toHaveAttribute("data-email", "true");

    // The next invitation is in the app, but no email is queued for it.
    const since = new Date();
    const second = await meeting("invite again", 12);
    await expect
      .poll(async () => (await adminClient().from("notifications").select("id").eq("user_id", volunteer.id).eq("entity_id", second)).data?.length)
      .toBe(1);
    await triggerScheduledRun();
    const later = await adminClient().from("email_outbox").select("id").eq("user_id", volunteer.id).eq("template", "notice").gte("created_at", since.toISOString());
    expect(later.data).toHaveLength(0);
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
    // The dashboard has no Notifications card any more: the notices sit behind the header bell.
    await expect(page.getByTestId("dashboard-notifications")).toHaveCount(0);
    const bell = new NotificationBell(page);
    await expect(bell.bell()).toHaveCount(1);
    await expect(bell.badge()).toHaveAttribute("data-count", "3", { timeout: APP_LOAD_TIMEOUT });
    await expect(bell.bell()).toHaveAttribute("aria-label", /3/);
    await bell.open();
    const group = bell.group("task_status_changed");
    await expect(group).toHaveAttribute("data-count", "2", { timeout: APP_LOAD_TIMEOUT });
    const toggle = group.getByTestId("dashboard-notification-group-toggle");
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(group.getByTestId("dashboard-notification")).toHaveCount(0);
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(group.getByTestId("dashboard-notification")).toHaveCount(2);
    await expect(bell.notice("task_assigned")).toHaveAttribute("data-unread", "true");
    // No horizontal scroll with the panel open (390 px phones included).
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

    await bell.markAll().click();
    await expect(page.getByTestId("toast-success").first()).toBeVisible();
    await expect(bell.markAll()).toHaveCount(0);
    await expect(bell.panel().locator('[data-unread="true"]')).toHaveCount(0);
    // Read notices are no longer grouped: each is its own line again; the badge is gone without a reload.
    await expect(group).toHaveCount(0);
    await expect(bell.notice("task_status_changed")).toHaveCount(2);
    await expect(bell.badge()).toHaveCount(0);
    await bell.close();
    expect(await unreadNotices(manager.id)).toBe(0);
  });

  test("a manager's notice is in the bell at once although they get the daily summary; the summary comes as one email", async ({ freshUser, freshBranch, pageAs }) => {
    const branch = await freshBranch("notif-digest");
    const manager = await freshUser({ role: "branch_manager", branch });
    const volunteer = await freshUser({ role: "volunteer", branch });
    // The manager keeps the default (daily summary email); the volunteer completes the manager's task.
    const task = await createTaskAs(manager, { scope: "branch", branch_id: branch, title: title("summary"), assignee_ids: [volunteer.id] });
    expect((await workRpc(volunteer, "set_task_status", { p_id: task, p_status: "done" })).error).toBeNull();
    await expect.poll(() => unreadNotices(manager.id)).toBe(1);

    const page = await pageAs(manager);
    await page.goto("/dashboard");
    const bell = new NotificationBell(page);
    await expect(bell.badge()).toHaveAttribute("data-count", "1", { timeout: APP_LOAD_TIMEOUT });
    await bell.open();
    await expect(bell.notice("task_status_changed")).toHaveAttribute("data-unread", "true");
    await bell.close();

    // The 08:00 run (here for tomorrow 10:00 UTC, always after 08:00 London) queues one summary email; the scheduled
    // run sends it (capture mode).
    const tomorrow = new Date(Date.now() + 24 * 3600 * 1000);
    tomorrow.setUTCHours(10, 0, 0, 0);
    const db = adminClient();
    expect((await db.rpc("run_notification_digest", { p_now: tomorrow.toISOString() })).error).toBeNull();
    await triggerScheduledRun();
    const email = await waitForEmail({ template: "daily_digest", userId: manager.id, timeoutMs: 30000 });
    expect(email.payload).toMatchObject({ count: 1, kinds: { task_status_changed: 1 } });
    expect(email.captured.subject).toBe("Your daily summary: 1 update");
    expect(email.captured.text).toContain("1 task you created was blocked or completed");
    expect(new URL(linkFrom(email, "/notifications")).pathname).toBe("/notifications");
    // Once a day: a second run the same day queues nothing more. The notice is still unread in the app.
    expect((await db.rpc("run_notification_digest", { p_now: tomorrow.toISOString() })).error).toBeNull();
    const rows = await db.from("email_outbox").select("id").eq("user_id", manager.id).eq("template", "daily_digest");
    expect(rows.data).toHaveLength(1);
    expect(await unreadNotices(manager.id)).toBe(1);
    // The volunteer (no email by default) gets no summary email.
    const none = await db.from("email_outbox").select("id").eq("user_id", volunteer.id).eq("template", "daily_digest");
    expect(none.data).toHaveLength(0);
  });

  test("opening a notice from the bell marks it read and goes to it; See all lists read and unread with Load more", async ({ freshUser, freshBranch, pageAs }) => {
    const branch = await freshBranch("notif-bell");
    const volunteer = await freshUser({ role: "volunteer", branch });
    const manager = await freshUser({ role: "branch_manager", branch });
    // 32 assignments: more than one page (30) on /notifications.
    for (let i = 0; i < 32; i++) await createTaskAs(manager, { scope: "branch", branch_id: branch, title: title(`bell ${i}`), assignee_ids: [volunteer.id] });
    await expect.poll(() => unreadNotices(volunteer.id)).toBe(32);

    const page = await pageAs(volunteer);
    await page.goto("/dashboard");
    const bell = new NotificationBell(page);
    await expect(bell.badge()).toHaveText("9+", { timeout: APP_LOAD_TIMEOUT });
    await expect(bell.badge()).toHaveAttribute("data-count", "32");
    await bell.open();
    // Unread assignments of one branch are one group; open it and the newest notice.
    const group = bell.group("task_assigned");
    await group.getByTestId("dashboard-notification-group-toggle").click();
    const first = group.getByTestId("dashboard-notification").first();
    const id = (await first.getAttribute("data-notification-id"))!;
    await first.click();
    await expect(bell.panel()).toBeHidden();
    await expect(page).toHaveURL(/\/tasks/);
    await expect(bell.badge()).toHaveAttribute("data-count", "31");
    await expect
      .poll(async () => (await adminClient().from("notifications").select("read_at").eq("id", id).single()).data?.read_at ?? null)
      .not.toBeNull();

    // The notice opened its task's panel: close it before using the bell again.
    await expect(page.getByTestId("task-panel")).toBeVisible({ timeout: APP_LOAD_TIMEOUT });
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("task-panel")).toBeHidden();
    await bell.open();
    await bell.seeAll().click();
    await expect(page).toHaveURL(/\/notifications$/);
    const list = page.getByTestId("notifications-page");
    await expect(list).toBeVisible({ timeout: APP_LOAD_TIMEOUT });
    await expect(list.locator(`[data-testid="dashboard-notification"][data-notification-id="${id}"]`)).toHaveAttribute("data-unread", "false");
    const loadMore = list.getByTestId("notifications-page-load-more");
    await expect(loadMore).toBeVisible();
    await loadMore.click();
    await expect(loadMore).toHaveCount(0);
    // Every notice is reachable: the read one stands alone, the 31 unread ones are one group.
    await expect(list.locator('[data-testid="dashboard-notification-group"][data-kind="task_assigned"]')).toHaveAttribute("data-count", "31");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
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
    const bell = new NotificationBell(page);
    await bell.open();
    await expect(bell.notice("review_waiting")).toHaveAttribute("data-unread", "true");
    await bell.close();
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

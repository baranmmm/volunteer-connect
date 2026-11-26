// Web Push opt-in (docs/push.md): the dashboard card in the installed app, Profile > Notifications (the one On/Off switch
// for this device, and the per-type Push column in Advanced settings). No real push service: the fakes in
// pages/components/FakePush.ts replace Notification, PushManager and navigator.serviceWorker and record what the app
// does (window.__push), and emulate the installed app by answering "(display-mode: standalone)". The subscription the app registers is real (register_push_subscription), so
// the database rows are checked with the service role. Fresh users in a temporary branch, cleaned up by the fixtures.
import type { Browser, Page } from "@playwright/test";
import { test, expect } from "../../fixtures/roles";
import type { TestUser } from "../../fixtures/roles";
import { adminClient, signIn, storageStateFor } from "../../api/SupabaseClient";
import { TASK_TITLE_PREFIX, createTaskAs } from "../../api/work";
import { APP_LOAD_TIMEOUT } from "../../pages/app";
import { baseUrl } from "../../setup/env";
import { PROD_REF } from "../../setup/guard";
import { fake, fakePush } from "../../pages/components/FakePush";

const IPHONE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const ANDROID_UA =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36";
const DAY = 24 * 3600 * 1000;

const devicesOf = async (userId: string) =>
  (await adminClient().from("push_subscriptions").select("endpoint, user_agent").eq("user_id", userId)).data ?? [];

/** Signed in with a chosen user agent (iPhone / Android variants). */
async function pageWithAgent(browser: Browser, user: TestUser, userAgent: string, prodHits: string[]) {
  const context = await browser.newContext({
    userAgent,
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    locale: "en-GB",
    timezoneId: "Europe/London",
    baseURL: baseUrl(),
    storageState: storageStateFor(await signIn(user.email), new URL(baseUrl()).origin, "en"),
  });
  await context.route(
    (url) => url.hostname.includes(PROD_REF),
    (route) => {
      prodHits.push(route.request().url());
      return route.abort("blockedbyclient");
    },
  );
  return { context, page: await context.newPage() };
}

const card = (page: Page) => page.getByTestId("push-prompt");
const typeRow = (page: Page, type: string) =>
  page.locator(`[data-testid="profile-notification-row"][data-type="${type}"]`);
const openAdvanced = async (page: Page) => {
  const toggle = page.getByTestId("profile-notifications-advanced-toggle");
  await expect(toggle).toHaveAttribute("aria-expanded", "false", { timeout: APP_LOAD_TIMEOUT });
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
};

test.describe("Push notifications", () => {
  test("installed app: the dashboard card asks from the click, registers this device and goes away", async ({ freshUser, freshBranch, pageAs }) => {
    const branch = await freshBranch("push-card");
    const volunteer = await freshUser({ role: "volunteer", branch });
    const page = await pageAs(volunteer);
    await fakePush(page, { permission: "default", answer: "granted", standalone: true });
    await page.goto("/dashboard");
    await expect(card(page)).toBeVisible({ timeout: APP_LOAD_TIMEOUT });
    await expect(card(page)).toHaveAttribute("data-mode", "ask");
    // Never asked on page load; the install banner never shows with it.
    expect((await fake(page)).requested).toBe(0);
    expect((await fake(page)).registered).toEqual([]);
    await expect(page.getByTestId("install-app-banner")).toHaveCount(0);

    await card(page).getByTestId("push-prompt-enable").click();
    await expect(card(page)).toBeHidden();
    await expect(page.getByTestId("toast-success").first()).toBeVisible();
    const state = await fake(page);
    expect(state.requested).toBe(1);
    expect(state.requestedWithGesture).toBe(true); // requestPermission() ran inside the click
    expect(state.registered).toEqual(["/sw.js"]);
    expect(state.subscribeCalls).toBe(1);
    await expect.poll(async () => (await devicesOf(volunteer.id)).map((d) => d.endpoint)).toEqual([state.endpoint]);
  });

  test("Not now hides the card; it returns after 7 days, and never after the second Not now", async ({ freshUser, freshBranch, pageAs }) => {
    const branch = await freshBranch("push-snooze");
    const volunteer = await freshUser({ role: "volunteer", branch });
    const page = await pageAs(volunteer);
    await fakePush(page, { permission: "default", standalone: true });
    await page.goto("/dashboard");
    await expect(card(page)).toBeVisible({ timeout: APP_LOAD_TIMEOUT });
    await card(page).getByTestId("push-prompt-not-now").click();
    await expect(card(page)).toBeHidden();
    expect((await fake(page)).requested).toBe(0);

    // The remembered "Not now" time is moved back (instead of the clock, which would also age the session).
    const age = (days: number) =>
      page.evaluate((ms) => {
        const memory = JSON.parse(localStorage.getItem("push-prompt-dismissals") ?? "{}") as { n: number; at: number };
        localStorage.setItem("push-prompt-dismissals", JSON.stringify({ ...memory, at: Date.now() - ms }));
      }, days * DAY);
    await age(6);
    await page.reload();
    await expect(page.getByTestId("dashboard-welcome")).toBeVisible({ timeout: APP_LOAD_TIMEOUT });
    await expect(card(page)).toHaveCount(0);
    await age(7.01);
    await page.reload();
    await expect(card(page)).toBeVisible({ timeout: APP_LOAD_TIMEOUT });
    await card(page).getByTestId("push-prompt-not-now").click();
    await expect(card(page)).toBeHidden();
    await age(400);
    await page.reload();
    await expect(page.getByTestId("dashboard-welcome")).toBeVisible({ timeout: APP_LOAD_TIMEOUT });
    await expect(card(page)).toHaveCount(0);
    // Profile stays the place to turn it on.
    await page.goto("/profile");
    await expect(page.getByTestId("profile-push-switch")).toBeVisible({ timeout: APP_LOAD_TIMEOUT });
  });

  test("refused permission: the card explains the phone's settings (iPhone and Android wording)", async ({ freshUser, freshBranch, browser, prodHits }) => {
    const branch = await freshBranch("push-denied");
    const volunteer = await freshUser({ role: "volunteer", branch });
    for (const [agent, platform] of [
      [IPHONE_UA, "ios"],
      [ANDROID_UA, "android"],
    ] as const) {
      const { context, page } = await pageWithAgent(browser, volunteer, agent, prodHits);
      try {
        await fakePush(page, { permission: "default", answer: "denied", standalone: true });
        await page.goto("/dashboard");
        await expect(card(page)).toHaveAttribute("data-mode", "ask", { timeout: APP_LOAD_TIMEOUT });
        await card(page).getByTestId("push-prompt-enable").click();
        await expect(card(page)).toHaveAttribute("data-mode", "denied");
        await expect(card(page).getByTestId("push-prompt-help")).toHaveAttribute("data-platform", platform);
        await expect(card(page).getByTestId("push-prompt-enable")).toHaveCount(0);
        expect(await devicesOf(volunteer.id)).toEqual([]);
        // Already blocked when the page opens: the same help, and it can be dismissed.
        await page.close();
        const again = await context.newPage();
        await fakePush(again, { permission: "denied", standalone: true });
        await again.goto("/dashboard");
        await expect(card(again)).toHaveAttribute("data-mode", "denied", { timeout: APP_LOAD_TIMEOUT });
        await card(again).getByTestId("push-prompt-not-now").click();
        await expect(card(again)).toBeHidden();
      } finally {
        await context.close();
      }
    }
  });

  test("a normal browser tab shows no card; iPhone outside the installed app explains it needs the app", async ({ freshUser, freshBranch, pageAs, browser, prodHits }) => {
    const branch = await freshBranch("push-tab");
    const volunteer = await freshUser({ role: "volunteer", branch });
    const page = await pageAs(volunteer);
    await fakePush(page, { permission: "default" });
    await page.goto("/dashboard");
    await expect(page.getByTestId("dashboard-welcome")).toBeVisible({ timeout: APP_LOAD_TIMEOUT });
    await expect(card(page)).toHaveCount(0);

    const { context, page: iphone } = await pageWithAgent(browser, volunteer, IPHONE_UA, prodHits);
    try {
      await fakePush(iphone, { permission: "default" });
      await iphone.goto("/profile");
      await expect(iphone.getByTestId("profile-push")).toHaveAttribute("data-state", "ios-install", { timeout: APP_LOAD_TIMEOUT });
      await expect(iphone.getByTestId("profile-push-ios-install")).toBeVisible();
      await expect(iphone.getByTestId("profile-push-switch")).toHaveCount(0);
      expect((await fake(iphone)).requested).toBe(0);
    } finally {
      await context.close();
    }
  });

  test("Profile: the push switch turns this device on and off; denied help; per-type Push checkboxes with their defaults", async ({ freshUser, freshBranch, pageAs }) => {
    const branch = await freshBranch("push-profile");
    const volunteer = await freshUser({ role: "volunteer", branch });
    const manager = await freshUser({ role: "branch_manager", branch });
    const page = await pageAs(volunteer);
    await fakePush(page, { permission: "default", answer: "granted" });
    await page.goto("/profile");
    const panel = page.getByTestId("profile-push");
    await expect(panel).toHaveAttribute("data-state", "off", { timeout: APP_LOAD_TIMEOUT });
    expect((await fake(page)).requested).toBe(0);

    const toggle = page.getByTestId("profile-push-switch");
    await expect(toggle).not.toBeChecked();
    await toggle.click();
    await expect(panel).toHaveAttribute("data-state", "on");
    await expect(toggle).toBeChecked();
    expect((await fake(page)).requestedWithGesture).toBe(true);
    await expect.poll(async () => (await devicesOf(volunteer.id)).length).toBe(1);

    // Defaults: push on for assignments, requests waiting and meetings; off for the rest.
    await openAdvanced(page);
    for (const [type, on] of [
      ["task_assigned", "true"],
      ["review", "true"],
      ["meeting", "true"],
      ["mention", "false"],
      ["task_status", "false"],
      ["task_note", "false"],
      ["task_reminder", "false"],
      ["request_decided", "false"],
    ] as const)
      await expect(typeRow(page, type)).toHaveAttribute("data-push", on);

    // An assignment is queued for this device's push; with push off for the type, the next one is not.
    const title = (label: string) => `${TASK_TITLE_PREFIX}push-${Date.now().toString(36)} ${label}`;
    const queued = async () =>
      (await adminClient().from("push_outbox").select("id", { count: "exact", head: true }).eq("user_id", volunteer.id)).count;
    await createTaskAs(manager, { scope: "branch", branch_id: branch, title: title("on"), assignee_ids: [volunteer.id] });
    await expect.poll(queued).toBe(1);
    await typeRow(page, "task_assigned").getByTestId("profile-notification-push").click();
    await expect(typeRow(page, "task_assigned")).toHaveAttribute("data-push", "false");
    await createTaskAs(manager, { scope: "branch", branch_id: branch, title: title("off"), assignee_ids: [volunteer.id] });
    expect(await queued()).toBe(1); // notify() queues within the RPC: nothing new

    // Disable: the browser and the server forget this device.
    await toggle.click();
    await expect(panel).toHaveAttribute("data-state", "off");
    await expect(toggle).not.toBeChecked();
    await expect.poll(async () => (await devicesOf(volunteer.id)).length).toBe(0);
    // The per-type switch is kept.
    await page.reload();
    await openAdvanced(page);
    await expect(typeRow(page, "task_assigned")).toHaveAttribute("data-push", "false");
    await expect(typeRow(page, "task_assigned").getByTestId("profile-notification-push")).not.toBeChecked();

    // Blocked in the browser: how to allow it again, no button.
    const blocked = await pageAs(volunteer);
    await fakePush(blocked, { permission: "denied" });
    await blocked.goto("/profile");
    await expect(blocked.getByTestId("profile-push")).toHaveAttribute("data-state", "denied", { timeout: APP_LOAD_TIMEOUT });
    await expect(blocked.getByTestId("profile-push-denied-help")).toBeVisible();
    await expect(blocked.getByTestId("profile-push-switch")).toHaveCount(0);
  });
});

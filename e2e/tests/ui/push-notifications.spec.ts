// Web Push opt-in (docs/push.md): the dashboard card in the installed app, Profile > Notifications (this device and the
// per-type Push switch). No real push service: an init script replaces Notification, PushManager and
// navigator.serviceWorker with fakes that record what the app does (window.__push), and emulates the installed app by
// answering "(display-mode: standalone)". The subscription the app registers is real (register_push_subscription), so
// the database rows are checked with the service role. Fresh users in a temporary branch, cleaned up by the fixtures.
import type { Browser, Page } from "@playwright/test";
import { test, expect } from "../../fixtures/roles";
import type { TestUser } from "../../fixtures/roles";
import { adminClient, signIn, storageStateFor } from "../../api/SupabaseClient";
import { TASK_TITLE_PREFIX, createTaskAs } from "../../api/work";
import { APP_LOAD_TIMEOUT } from "../../pages/app";
import { baseUrl } from "../../setup/env";
import { PROD_REF } from "../../setup/guard";

type FakePush = {
  /** Notification.permission before any request. */
  permission: NotificationPermission;
  /** What requestPermission() answers. */
  answer?: NotificationPermission;
  standalone?: boolean;
};

const IPHONE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const ANDROID_UA =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36";
const DAY = 24 * 3600 * 1000;

/** Installs the fakes before any app code runs (every navigation of the page). */
async function fakePush(page: Page, cfg: FakePush) {
  await page.addInitScript((cfg: FakePush) => {
    type Sub = {
      endpoint: string;
      options: { applicationServerKey: ArrayBuffer | null };
      toJSON: () => unknown;
      unsubscribe: () => Promise<boolean>;
    };
    const w = window as unknown as Window & {
      __push: {
        permission: NotificationPermission;
        requested: number;
        requestedWithGesture: boolean | null;
        registered: string[];
        subscribed: Sub | null;
        subscribeCalls: number;
        unsubscribed: number;
      };
    };
    w.__push = {
      permission: cfg.permission,
      requested: 0,
      requestedWithGesture: null,
      registered: [],
      subscribed: null,
      subscribeCalls: 0,
      unsubscribed: 0,
    };
    if (cfg.standalone) {
      const original = window.matchMedia.bind(window);
      window.matchMedia = (query: string) =>
        query.includes("display-mode: standalone")
          ? ({
              matches: true,
              media: query,
              onchange: null,
              addListener: () => undefined,
              removeListener: () => undefined,
              addEventListener: () => undefined,
              removeEventListener: () => undefined,
              dispatchEvent: () => false,
            } as MediaQueryList)
          : original(query);
    }
    const b64 = (bytes: Uint8Array) =>
      btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    const random = (n: number) => crypto.getRandomValues(new Uint8Array(n));
    class FakeNotification {
      static get permission() {
        return w.__push.permission;
      }
      static requestPermission() {
        w.__push.requested++;
        w.__push.requestedWithGesture =
          (navigator as Navigator & { userActivation?: { isActive: boolean } }).userActivation?.isActive ?? null;
        w.__push.permission = cfg.answer ?? "granted";
        return Promise.resolve(w.__push.permission);
      }
    }
    Object.defineProperty(window, "Notification", { value: FakeNotification, configurable: true, writable: true });
    Object.defineProperty(window, "PushManager", { value: function PushManager() {}, configurable: true, writable: true });
    const pushManager = {
      getSubscription: () => Promise.resolve(w.__push.subscribed),
      subscribe: () => {
        w.__push.subscribeCalls++;
        const endpoint = `https://push.example.test/e2e/${b64(random(12))}`;
        const keys = { p256dh: b64(new Uint8Array([4, ...random(64)])), auth: b64(random(16)) };
        const sub: Sub = {
          endpoint,
          options: { applicationServerKey: null },
          toJSON: () => ({ endpoint, keys }),
          unsubscribe: () => {
            w.__push.subscribed = null;
            w.__push.unsubscribed++;
            return Promise.resolve(true);
          },
        };
        w.__push.subscribed = sub;
        return Promise.resolve(sub);
      },
    };
    const registration = { scope: `${location.origin}/`, pushManager };
    const container = {
      register: (url: string) => {
        w.__push.registered.push(url);
        return Promise.resolve(registration);
      },
      getRegistration: () => Promise.resolve(w.__push.registered.length ? registration : undefined),
      ready: Promise.resolve(registration),
      controller: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    };
    Object.defineProperty(navigator, "serviceWorker", { value: container, configurable: true });
  }, cfg);
}

const fake = (page: Page) =>
  page.evaluate(() => {
    const p = (window as unknown as { __push: Record<string, unknown> }).__push;
    return {
      requested: p["requested"] as number,
      requestedWithGesture: p["requestedWithGesture"] as boolean | null,
      registered: p["registered"] as string[],
      subscribeCalls: p["subscribeCalls"] as number,
      endpoint: (p["subscribed"] as { endpoint: string } | null)?.endpoint ?? null,
    };
  });

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
  page.locator(`[data-testid="profile-notification-type"][data-type="${type}"]`);

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
    await expect(page.getByTestId("profile-push-enable")).toBeVisible({ timeout: APP_LOAD_TIMEOUT });
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
      await expect(iphone.getByTestId("profile-push-enable")).toHaveCount(0);
      expect((await fake(iphone)).requested).toBe(0);
    } finally {
      await context.close();
    }
  });

  test("Profile: enable and disable push on this device; denied help; per-type Push switches with their defaults", async ({ freshUser, freshBranch, pageAs }) => {
    const branch = await freshBranch("push-profile");
    const volunteer = await freshUser({ role: "volunteer", branch });
    const manager = await freshUser({ role: "branch_manager", branch });
    const page = await pageAs(volunteer);
    await fakePush(page, { permission: "default", answer: "granted" });
    await page.goto("/profile");
    const panel = page.getByTestId("profile-push");
    await expect(panel).toHaveAttribute("data-state", "off", { timeout: APP_LOAD_TIMEOUT });
    expect((await fake(page)).requested).toBe(0);

    await page.getByTestId("profile-push-enable").click();
    await expect(panel).toHaveAttribute("data-state", "on");
    expect((await fake(page)).requestedWithGesture).toBe(true);
    await expect.poll(async () => (await devicesOf(volunteer.id)).length).toBe(1);

    // Defaults: push on for assignments, requests waiting and meetings; off for the rest.
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
    await page.getByTestId("profile-push-disable").click();
    await expect(panel).toHaveAttribute("data-state", "off");
    await expect.poll(async () => (await devicesOf(volunteer.id)).length).toBe(0);
    // The per-type switch is kept.
    await page.reload();
    await expect(typeRow(page, "task_assigned")).toHaveAttribute("data-push", "false", { timeout: APP_LOAD_TIMEOUT });

    // Blocked in the browser: how to allow it again, no button.
    const blocked = await pageAs(volunteer);
    await fakePush(blocked, { permission: "denied" });
    await blocked.goto("/profile");
    await expect(blocked.getByTestId("profile-push")).toHaveAttribute("data-state", "denied", { timeout: APP_LOAD_TIMEOUT });
    await expect(blocked.getByTestId("profile-push-denied-help")).toBeVisible();
    await expect(blocked.getByTestId("profile-push-enable")).toHaveCount(0);
  });
});

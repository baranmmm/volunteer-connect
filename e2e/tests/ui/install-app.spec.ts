// "Install app": the dashboard banner and the menu item (desktop sidebar, mobile "More" sheet). Chromium's real
// `beforeinstallprompt` cannot be forced in a test, so the tests dispatch a synthetic one whose prompt() is recorded.
// iPhone / iPad are told apart by their user agent (a context with the iPhone 13 device settings).
import { devices, type BrowserContext, type Page } from "@playwright/test";
import { test, expect } from "../../fixtures/roles";
import { DashboardPage } from "../../pages/DashboardPage";
import { signIn, storageStateFor } from "../../api/SupabaseClient";
import { baseUrl } from "../../setup/env";
import { PROD_REF } from "../../setup/guard";
import { APP_LOAD_TIMEOUT } from "../../pages/app";

const banner = (page: Page) => page.getByTestId("install-app-banner");
const sheet = (page: Page) => page.getByTestId("install-app-sheet");
/**
 * Waits until the open sheet holds the focus. Radix registers the dialog's Escape layer in an effect, before it moves
 * the focus in: an Escape sent earlier would reach the "More" sheet underneath and close both.
 */
const sheetFocused = (page: Page) =>
  expect
    .poll(() => page.evaluate(() => !!document.activeElement?.closest('[data-testid="install-app-sheet"]')))
    .toBe(true);

/** Dispatches a synthetic install prompt; its prompt() calls are counted in window.__installPrompts. */
async function offerInstallPrompt(page: Page, outcome: "accepted" | "dismissed" = "dismissed") {
  await page.evaluate((outcome) => {
    const w = window as unknown as { __installPrompts?: number };
    w.__installPrompts ??= 0;
    const event = new Event("beforeinstallprompt", { cancelable: true }) as Event & Record<string, unknown>;
    event["prompt"] = () => {
      w.__installPrompts = (w.__installPrompts ?? 0) + 1;
      return Promise.resolve();
    };
    event["userChoice"] = Promise.resolve({ outcome, platform: "web" });
    window.dispatchEvent(event);
  }, outcome);
}
const promptCalls = (page: Page) => page.evaluate(() => (window as unknown as { __installPrompts?: number }).__installPrompts ?? 0);

/** The menu item: in the desktop sidebar, or in the mobile "More" sheet (opened first). */
async function navInstall(page: Page, isMobile: boolean) {
  if (isMobile) {
    await page.getByTestId("mobile-nav-more").click();
    await expect(page.getByTestId("mobile-nav-more-sheet")).toBeVisible();
    return page.getByTestId("mobile-nav-more-sheet").getByTestId("nav-install-app");
  }
  await expect(page.getByTestId("app-sidebar")).toBeVisible({ timeout: APP_LOAD_TIMEOUT });
  return page.getByTestId("app-sidebar").getByTestId("nav-install-app");
}

/** Signed in as the Medway volunteer on an iPhone (iPhone 13 settings), optionally with another user agent. */
async function iphonePage(
  browser: import("@playwright/test").Browser,
  email: string,
  prodHits: string[],
  userAgent?: string,
): Promise<{ context: BrowserContext; page: Page }> {
  const { defaultBrowserType: _ignored, ...iphone } = devices["iPhone 13"];
  const context = await browser.newContext({
    ...iphone,
    ...(userAgent ? { userAgent } : {}),
    locale: "en-GB",
    timezoneId: "Europe/London",
    baseURL: baseUrl(),
    storageState: storageStateFor(await signIn(email), new URL(baseUrl()).origin, "en"),
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

test.describe("Install app", () => {
  test("banner and menu item with an install prompt; prompt() is called and the banner stays away once installed", async ({ pageAs, isMobile }) => {
    const page = await pageAs("volunteerMedway");
    const dashboard = new DashboardPage(page);
    await dashboard.goto();
    await offerInstallPrompt(page, "accepted");
    await expect(banner(page)).toBeVisible();
    await expect(banner(page)).toHaveAttribute("data-mode", "prompt");

    await banner(page).getByTestId("install-app-button").click();
    await expect.poll(() => promptCalls(page)).toBe(1);
    // Installed (accepted): no banner, and no menu item until the browser offers a prompt again.
    await expect(banner(page)).toBeHidden();
    await expect(await navInstall(page, isMobile)).toHaveCount(0);
    if (isMobile) await page.keyboard.press("Escape");

    // After an uninstall Chrome fires the prompt again: the menu item returns, the banner does not.
    await page.reload();
    await dashboard.expectLoaded();
    await offerInstallPrompt(page);
    await expect(await navInstall(page, isMobile)).toBeVisible();
    await expect(banner(page)).toBeHidden();
  });

  test("the menu item calls prompt()", async ({ pageAs, isMobile }) => {
    const page = await pageAs("volunteerMedway");
    await new DashboardPage(page).goto();
    await offerInstallPrompt(page);
    const item = await navInstall(page, isMobile);
    await expect(item).toBeVisible();
    await item.click();
    await expect.poll(() => promptCalls(page)).toBe(1);
  });

  test("a dismissed banner stays hidden after a reload; the menu item stays", async ({ pageAs, isMobile }) => {
    const page = await pageAs("volunteerMedway");
    const dashboard = new DashboardPage(page);
    await dashboard.goto();
    await offerInstallPrompt(page);
    await expect(banner(page)).toBeVisible();
    await banner(page).getByTestId("install-app-banner-dismiss").click();
    await expect(banner(page)).toBeHidden();

    await page.reload();
    await dashboard.expectLoaded();
    await offerInstallPrompt(page);
    await expect(await navInstall(page, isMobile)).toBeVisible();
    await expect(banner(page)).toBeHidden();
  });

  test("running installed (standalone): no install UI, remembered on the device", async ({ pageAs, isMobile }) => {
    const page = await pageAs("volunteerMedway");
    await page.addInitScript(() => {
      const original = window.matchMedia.bind(window);
      window.matchMedia = (query: string) =>
        query === "(display-mode: standalone)"
          ? (Object.create(original(query), { matches: { value: true } }) as MediaQueryList)
          : original(query);
    });
    await new DashboardPage(page).goto();
    await offerInstallPrompt(page);
    await expect(await navInstall(page, isMobile)).toHaveCount(0);
    await expect(banner(page)).toHaveCount(0);
    expect(await page.evaluate(() => window.localStorage.getItem("install-app-installed"))).toBe("1");
  });

  test("iPhone Safari: the sheet shows the Share steps; Escape closes it and focus returns", async ({ browser, seed, prodHits, isMobile }) => {
    test.skip(isMobile, "the iPhone context is set explicitly; one project is enough");
    const { context, page } = await iphonePage(browser, seed.users.volunteerMedway.email, prodHits);
    try {
      await new DashboardPage(page).goto();
      await expect(banner(page)).toHaveAttribute("data-mode", "ios-safari");
      const button = banner(page).getByTestId("install-app-button");
      await button.click();
      await expect(sheet(page)).toBeVisible();
      await expect(sheet(page)).toHaveAttribute("data-variant", "ios-safari");
      await expect(sheet(page)).toHaveAttribute("role", "dialog");
      await expect(sheet(page).getByRole("img", { name: "Share icon" })).toBeVisible();
      await expect(sheet(page).getByTestId("install-app-steps").getByRole("listitem")).toHaveCount(3);
      await sheetFocused(page);
      await page.keyboard.press("Escape");
      await expect(sheet(page)).toBeHidden();
      await expect(button).toBeFocused();

      // The menu item (in the "More" sheet) opens the same steps; focus returns to it.
      const item = await navInstall(page, true);
      await item.click();
      await expect(sheet(page)).toHaveAttribute("data-variant", "ios-safari");
      await sheetFocused(page);
      await page.keyboard.press("Escape");
      await expect(sheet(page)).toBeHidden();
      await expect(item).toBeFocused();
    } finally {
      await context.close();
    }
  });

  test("iPhone in another browser: the sheet says to open the page in Safari", async ({ browser, seed, prodHits, isMobile }) => {
    test.skip(isMobile, "the iPhone context is set explicitly; one project is enough");
    const chromeOnIos =
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/124.0.6367.88 Mobile/15E148 Safari/604.1";
    const { context, page } = await iphonePage(browser, seed.users.volunteerMedway.email, prodHits, chromeOnIos);
    try {
      await new DashboardPage(page).goto();
      await banner(page).getByTestId("install-app-button").click();
      await expect(sheet(page)).toHaveAttribute("data-variant", "ios-other");
      await expect(sheet(page).getByRole("heading", { name: "Open in Safari" })).toBeVisible();
      await expect(sheet(page).getByTestId("install-app-copy-link")).toBeVisible();
      await sheet(page).getByTestId("install-app-sheet-close").click();
      await expect(sheet(page)).toBeHidden();
    } finally {
      await context.close();
    }
  });

  test("public pages have no install UI and do not load its code", async ({ browser }) => {
    const context = await browser.newContext({ baseURL: baseUrl() }); // no session
    try {
      const page = await context.newPage();
      for (const path of ["/", "/events"]) {
        await page.goto(path);
        await offerInstallPrompt(page);
        await expect(page.getByTestId("install-app-banner")).toHaveCount(0);
        await expect(page.getByTestId("nav-install-app")).toHaveCount(0);
        const loaded = await page.evaluate(() => performance.getEntriesByType("resource").map((e) => e.name));
        expect(loaded.filter((name) => /install-app|InstallApp/.test(name)), path).toEqual([]);
      }
    } finally {
      await context.close();
    }
  });
});

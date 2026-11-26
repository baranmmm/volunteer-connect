// The one public top bar of every signed-out page: logo (home), Events, Sign in, Join and the language switch. The
// item of the page you are on is hidden (Join on the join page, Sign in on the sign-in page) or marked (Events,
// aria-current="page"). Runs on desktop and on the Pixel 7 project (two rows, no sideways scroll at phone width).
import type { Locator, Page } from "@playwright/test";
import { test, expect } from "../../fixtures/roles";
import { APP_LOAD_TIMEOUT } from "../../pages/app";

type Current = "join" | "sign-in" | "events" | null;
type Route = { path: string; current: Current; ready: string };

const ROUTES: Route[] = [
  { path: "/", current: "join", ready: "auth-sign-up-form" },
  { path: "/join", current: "join", ready: "auth-sign-up-form" },
  { path: "/sign-in", current: "sign-in", ready: "auth-sign-in-form" },
  { path: "/auth", current: "sign-in", ready: "auth-sign-in-form" },
  { path: "/auth?mode=signup", current: "join", ready: "auth-sign-up-form" },
  { path: "/reset-password", current: null, ready: "auth-submit-button" },
  { path: "/events", current: "events", ready: "public-events-page" },
  { path: "/privacy", current: null, ready: "privacy-page" },
  { path: "/privacy/attendees", current: null, ready: "attendee-privacy-page" },
  // An email link with a token that is not valid: the page still opens in the public layout.
  { path: "/e/confirm?t=not-a-real-token", current: null, ready: "guest-link-page" },
  { path: "/updates/unsubscribe?t=not-a-real-token", current: null, ready: "public-privacy-link" },
];

/** The bar is there once, with the right items for `current`, and the page does not scroll sideways. */
async function expectBar(page: Page, current: Current): Promise<Locator> {
  const bar = page.getByTestId("public-topbar");
  await expect(bar).toHaveCount(1);
  await expect(bar).toBeVisible();
  const events = bar.getByTestId("public-topbar-events");
  await expect(events).toHaveAttribute("href", "/events");
  if (current === "events") await expect(events).toHaveAttribute("aria-current", "page");
  else await expect(events).not.toHaveAttribute("aria-current", /.*/);
  if (current === "sign-in") await expect(bar.getByTestId("public-topbar-sign-in")).toHaveCount(0);
  else await expect(bar.getByTestId("public-topbar-sign-in")).toHaveAttribute("href", "/sign-in");
  if (current === "join") await expect(bar.getByTestId("public-topbar-join")).toHaveCount(0);
  else await expect(bar.getByTestId("public-topbar-join")).toHaveAttribute("href", "/");
  await expect(bar.getByTestId("public-topbar-dashboard")).toHaveCount(0);
  // The logo is the home link (the join page for visitors).
  await expect(bar.getByTestId("logo-home-link")).toHaveAttribute("data-target", "/");
  await expect(bar.getByTestId("auth-language-toggle-en")).toBeVisible();
  await expect(bar.getByTestId("auth-language-toggle-tr")).toBeVisible();
  // Exactly one language switch on the page (it moved into the bar).
  await expect(page.getByTestId("auth-language-toggle-tr")).toHaveCount(1);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, "no horizontal scroll").toBeLessThanOrEqual(0);
  return bar;
}

test.describe("Public top bar (signed out)", () => {
  for (const route of ROUTES) {
    test(`${route.path}: one top bar, the current item ${route.current ? `(${route.current}) marked or hidden` : "none"}`, async ({ page }) => {
      await page.goto(route.path);
      await expect(page.getByTestId(route.ready).first()).toBeVisible({ timeout: APP_LOAD_TIMEOUT });
      await expectBar(page, route.current);
    });
  }

  test("an event page: the bar above the public event, Events leads back to the list", async ({ page, freshUser, freshEvent }) => {
    const manager = await freshUser({ role: "branch_manager" });
    const event = await freshEvent(manager, { label: "topbar", status: "published", startInMinutes: 120, audience: "public" });
    await page.goto(`/events/${event.id}`);
    await expect(page.getByTestId("public-privacy-link")).toBeVisible({ timeout: APP_LOAD_TIMEOUT });
    const bar = await expectBar(page, null);
    await bar.getByTestId("public-topbar-events").click();
    await expect(page).toHaveURL(/\/events$/);
    await expect(page.getByTestId("public-events-page")).toBeVisible({ timeout: APP_LOAD_TIMEOUT });
    await expectBar(page, "events");
  });

  test("the forms of the sign-in page switch the bar: sign up hides Join, forgot password shows both", async ({ page }) => {
    await page.goto("/sign-in");
    await expect(page.getByTestId("auth-sign-in-form")).toBeVisible({ timeout: APP_LOAD_TIMEOUT });
    await expectBar(page, "sign-in");
    await page.getByTestId("auth-forgot-password-link").click();
    await expect(page.getByTestId("auth-forgot-form")).toBeVisible();
    await expectBar(page, null);
    await page.getByTestId("auth-back-to-sign-in-button").click();
    await page.getByTestId("auth-toggle-mode-link").click();
    await expect(page.getByTestId("auth-sign-up-form")).toBeVisible();
    await expectBar(page, "join");
  });

  test("the links: logo → join page, Sign in → sign-in page, Join → join page, Events → events", async ({ page }) => {
    await page.goto("/privacy");
    await expect(page.getByTestId("privacy-page")).toBeVisible({ timeout: APP_LOAD_TIMEOUT });
    const bar = page.getByTestId("public-topbar");
    await bar.getByTestId("public-topbar-sign-in").click();
    await expect(page).toHaveURL(/\/sign-in$/);
    await expect(page.getByTestId("auth-sign-in-form")).toBeVisible({ timeout: APP_LOAD_TIMEOUT });
    await bar.getByTestId("public-topbar-join").click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByTestId("auth-sign-up-form")).toBeVisible({ timeout: APP_LOAD_TIMEOUT });
    await bar.getByTestId("public-topbar-events").click();
    await expect(page).toHaveURL(/\/events$/);
    await expect(page.getByTestId("public-events-page")).toBeVisible({ timeout: APP_LOAD_TIMEOUT });
    // Keyboard: the logo is a focusable link with a name.
    const logo = bar.getByTestId("logo-home-link");
    await expect(logo).toHaveAccessibleName(/.+/);
    await logo.focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByTestId("auth-sign-up-form")).toBeVisible({ timeout: APP_LOAD_TIMEOUT });
  });

  test("the language switch in the bar translates the bar and the page (EN ↔ TR)", async ({ page }) => {
    await page.goto("/events");
    await expect(page.getByTestId("public-events-page")).toBeVisible({ timeout: APP_LOAD_TIMEOUT });
    const bar = page.getByTestId("public-topbar");
    const events = bar.getByTestId("public-topbar-events");
    await expect(events).toHaveText("Events");
    await bar.getByTestId("auth-language-toggle-tr").click();
    await expect(bar.getByTestId("auth-language-toggle-tr")).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("html")).toHaveAttribute("lang", "tr");
    await expect(events).toHaveText("Etkinlikler");
    await expect(bar.getByTestId("public-topbar-sign-in")).toHaveText("Giriş yap");
    await expect(bar.getByTestId("public-topbar-join")).toHaveText("Katıl");
    // Still one row of links that fits the phone in Turkish (the longest labels).
    await expectBar(page, "events");
    await bar.getByTestId("auth-language-toggle-en").click();
    await expect(page.locator("html")).toHaveAttribute("lang", "en-GB");
    await expect(events).toHaveText("Events");
  });
});

test.describe("Public top bar (signed in)", () => {
  test("members get Dashboard instead of Sign in and Join on /events and /privacy; an event page keeps the app shell", async ({ freshUser, freshEvent, pageAs }) => {
    const manager = await freshUser({ role: "branch_manager" });
    const event = await freshEvent(manager, { label: "topbar-member", status: "published", startInMinutes: 120, audience: "public" });
    const page = await pageAs(await freshUser());
    for (const [path, ready] of [["/events", "public-events-page"], ["/privacy", "privacy-page"]] as const) {
      await page.goto(path);
      await expect(page.getByTestId(ready)).toBeVisible({ timeout: APP_LOAD_TIMEOUT });
      const bar = page.getByTestId("public-topbar");
      await expect(bar.getByTestId("public-topbar-dashboard")).toHaveAttribute("href", "/dashboard", { timeout: APP_LOAD_TIMEOUT });
      await expect(bar.getByTestId("public-topbar-sign-in")).toHaveCount(0);
      await expect(bar.getByTestId("public-topbar-join")).toHaveCount(0);
      await expect(bar.getByTestId("logo-home-link")).toHaveAttribute("data-target", "/dashboard");
    }
    await page.getByTestId("public-topbar-dashboard").click();
    await expect(page).toHaveURL(/\/dashboard$/);
    // The member view of an event page is inside the app shell, without the public bar.
    await page.goto(`/events/${event.id}`);
    await expect(page.getByTestId("logo-home-link").filter({ visible: true })).toHaveAttribute("data-target", "/dashboard", { timeout: APP_LOAD_TIMEOUT });
    await expect(page.getByTestId("public-topbar")).toHaveCount(0);
  });
});

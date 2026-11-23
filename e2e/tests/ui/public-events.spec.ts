// Public events without signing in (/events, /events/:id) and the event audience in the form.
import { test, expect } from "../../fixtures/roles";
import { AuthPage } from "../../pages/AuthPage";
import { APP_LOAD_TIMEOUT } from "../../pages/app";
import { userPassword } from "../../setup/env";
import { EventFormDialog } from "../../pages/components/EventFormDialog";
import { EVENT_TITLE_PREFIX, deleteEvents } from "../../api/events";

const londonDay = (days: number) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(new Date(Date.now() + days * 86400000));

test.describe("Public events (signed out)", () => {
  test("the list shows public events only; branch filter in the URL; detail without the online link; Register leads to sign-in and back", { tag: "@smoke" }, async ({ browser, freshUser, freshEvent, freshBranch, seed }) => {
    // A long flow (list, filter, subscribe, detail, sign-in and back): 45 s was too short on phones under CI load.
    test.setTimeout(120_000);
    // A very long branch name (like the temporary branches parallel tests create on QA) must not widen the page:
    // on phones the page then scrolls sideways and taps land on the wrong branch button.
    const longBranch = await freshBranch("a-very-long-branch-name-that-must-not-widen-the-public-events-page-on-phones");
    const manager = await freshUser({ role: "branch_manager" });
    const online = await freshEvent(manager, { label: "public online", status: "published", startInMinutes: 4 * 24 * 60, audience: "public", onlineUrl: "https://meet.example.org/e2e-public-room" });
    const members = await freshEvent(manager, { label: "public members", status: "published", startInMinutes: 4 * 24 * 60 });
    const context = await browser.newContext(); // no session
    const page = await context.newPage();
    await page.goto("/events");
    await expect(page.getByTestId("public-events-page")).toBeVisible({ timeout: APP_LOAD_TIMEOUT });
    const card = page.locator(`[data-testid="public-event-card"][data-event-id="${online.id}"]`);
    await expect(card).toBeVisible();
    await expect(page.locator(`[data-testid="public-event-card"][data-event-id="${members.id}"]`)).toHaveCount(0);
    await expect(page.locator(`[data-testid="public-events-branch-option"][data-branch-id="${longBranch}"]`)).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), "no sideways scrolling").toBeLessThanOrEqual(0);
    // Branch filter: Brighton only hides the Medway event; the choice is in the URL.
    await page.locator('[data-testid="public-events-branch-option"][data-slug="brighton"]').click();
    await expect(page).toHaveURL(/[?&]branch=brighton/);
    await expect(card).toHaveCount(0);
    await page.getByTestId("public-events-branch-all").click();
    await expect(card).toBeVisible();
    // Subscribe: webcal link with the same filter.
    await page.getByTestId("public-events-subscribe").click();
    await expect(page.getByTestId("public-events-subscribe-webcal")).toHaveAttribute("href", /^webcal:\/\/.+\/api\/ics/);
    // Detail: only public fields; the online link never appears.
    await card.getByRole("link").click();
    const detail = page.getByTestId("public-event-detail");
    await expect(detail).toBeVisible({ timeout: APP_LOAD_TIMEOUT });
    await expect(page.getByTestId("public-event-online")).toBeVisible();
    await expect(page.locator("body")).not.toContainText("e2e-public-room");
    await page.getByTestId("public-event-register").click();
    await expect(page).toHaveURL(new RegExp(`/auth\\?redirect=%2Fevents%2F${online.id}`));
    await new AuthPage(page).signIn(seed.users.volunteerMedway.email, userPassword());
    await expect(page).toHaveURL(new RegExp(`/events/${online.id}$`), { timeout: APP_LOAD_TIMEOUT });
    await expect(page.getByTestId("event-public-badge")).toBeVisible({ timeout: APP_LOAD_TIMEOUT });
    await context.close();
  });

  test("a members-only event is not shown publicly by id", async ({ browser, freshUser, freshEvent }) => {
    const manager = await freshUser({ role: "branch_manager" });
    const members = await freshEvent(manager, { label: "hidden", status: "published", startInMinutes: 4 * 24 * 60 });
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(`/events/${members.id}`);
    await expect(page.getByTestId("public-event-not-found")).toBeVisible({ timeout: APP_LOAD_TIMEOUT });
    await context.close();
  });
});

test.describe("Event audience", () => {
  test("a manager publishes a public event from the form: Public badge for members, listed on the public page", async ({ browser, freshUser, pageAs }) => {
    const manager = await freshUser({ role: "branch_manager" });
    const page = await pageAs(manager);
    await page.goto("/calendar?view=list");
    await page.getByTestId("calendar-create-event-button").click({ timeout: APP_LOAD_TIMEOUT });
    const form = new EventFormDialog(page);
    const title = `${EVENT_TITLE_PREFIX}public-form-${Date.now()}`;
    await form.title().fill(title);
    await form.location().fill("E2E Public Hall");
    await form.setStart(`${londonDay(5)}T18:00`);
    await page.getByTestId("event-form-audience").click();
    await page.getByTestId("event-form-audience-option-public").click();
    await form.publish();
    await expect(page).toHaveURL(/\/events\/[0-9a-f-]{36}$/);
    const id = new URL(page.url()).pathname.split("/").pop()!;
    try {
      // The detail header (the calendar list behind the closing form can briefly show the event's card too).
      await expect(page.getByTestId("event-detail-title")).toBeVisible({ timeout: APP_LOAD_TIMEOUT });
      await expect(page.getByTestId("event-public-badge").first()).toBeVisible();
      const context = await browser.newContext();
      const anon = await context.newPage();
      await anon.goto(`/events/${id}`);
      await expect(anon.getByTestId("public-event-detail")).toHaveAttribute("data-event-id", id, { timeout: APP_LOAD_TIMEOUT });
      await context.close();
    } finally {
      await deleteEvents([id]);
    }
  });
});

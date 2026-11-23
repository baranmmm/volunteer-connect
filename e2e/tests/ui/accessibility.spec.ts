// Automated accessibility scan (axe-core, WCAG 2.x A/AA rules): the calendar, an event page, the request form and
// the Requests pages, the public events pages, the follower dashboard and the regions page must have no serious or
// critical violations.
import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { test, expect } from "../../fixtures/roles";
import { RequestsPage } from "../../pages/RequestsPage";
import { EventRequestFormDialog } from "../../pages/components/EventRequestFormDialog";

async function expectNoSeriousViolations(page: Page, label: string, include?: string) {
  let builder = new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]);
  if (include) builder = builder.include(include);
  const { violations } = await builder.analyze();
  const serious = violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(serious.map((v) => `${v.id} (${v.impact}): ${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(", ")}`), label).toEqual([]);
}

test.describe("Accessibility (axe)", () => {
  test("calendar list and month, event detail", async ({ freshUser, freshEvent, pageAs }) => {
    const manager = await freshUser({ role: "branch_manager" });
    const event = await freshEvent(manager, { label: "axe", status: "published", startInMinutes: 3 * 24 * 60, capacity: 20 });
    const page = await pageAs(manager);
    for (const view of ["list", "month"]) {
      await page.goto(`/calendar?view=${view}`);
      await expect(page.getByTestId(view === "list" ? "calendar-list-view" : "calendar-month-view")).toBeVisible();
      await expectNoSeriousViolations(page, `calendar ${view}`);
    }
    await page.goto(`/events/${event.id}`);
    await expect(page.getByTestId("event-detail-title")).toBeVisible();
    await expect(page.getByTestId("event-registration")).toBeVisible();
    await expectNoSeriousViolations(page, "event detail");
  });

  test("request form (both types), My Requests and the reviewers' page", async ({ freshUser, pageAs }) => {
    const volunteer = await freshUser();
    const page = await pageAs(volunteer);
    const mine = new RequestsPage(page);
    await mine.gotoMine();
    await expectNoSeriousViolations(page, "my requests");
    await mine.newEventRequest();
    await expect(page.getByTestId("event-request-type-choice")).toBeVisible();
    await expectNoSeriousViolations(page, "request type choice", '[role="dialog"]');
    const form = new EventRequestFormDialog(page);
    await form.chooseType("external");
    await expectNoSeriousViolations(page, "external request form", '[role="dialog"]');
    await page.keyboard.press("Escape");
    await mine.newEventRequest();
    await form.chooseType("proposal");
    await expectNoSeriousViolations(page, "proposal request form", '[role="dialog"]');

    const managerPage = await pageAs(await freshUser({ role: "branch_manager" }));
    await new RequestsPage(managerPage).goto();
    await expectNoSeriousViolations(managerPage, "requests (reviewers)");
  });

  test("public events (signed out), the follower dashboard and the regions page", async ({ browser, freshUser, freshEvent, pageAs }) => {
    const manager = await freshUser({ role: "branch_manager" });
    const event = await freshEvent(manager, { label: "axe public", status: "published", startInMinutes: 3 * 24 * 60, audience: "public" });
    const context = await browser.newContext();
    const anon = await context.newPage();
    for (const view of ["list", "month"]) {
      await anon.goto(`/events${view === "month" ? "?view=month" : ""}`);
      await expect(anon.getByTestId(view === "list" ? "public-events-list" : "public-events-month")).toBeVisible({ timeout: 30_000 });
      await expectNoSeriousViolations(anon, `public events ${view}`);
    }
    await anon.goto(`/events/${event.id}`);
    await expect(anon.getByTestId("public-event-detail")).toBeVisible({ timeout: 30_000 });
    await expectNoSeriousViolations(anon, "public event detail");
    await context.close();
    const follower = await pageAs(await freshUser({ role: "follower" }));
    await follower.goto("/dashboard");
    await expect(follower.getByTestId("follower-dashboard")).toBeVisible({ timeout: 30_000 });
    await expectNoSeriousViolations(follower, "follower dashboard");
    const nc = await pageAs(await freshUser({ role: "national_coordinator" }));
    await nc.goto("/regions");
    await expect(nc.getByTestId("regions-tree")).toBeVisible({ timeout: 30_000 });
    await expectNoSeriousViolations(nc, "regions and branches");
  });
});

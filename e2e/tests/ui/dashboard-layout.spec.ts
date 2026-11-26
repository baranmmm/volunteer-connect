// Dashboard grid: one column on phones and tablets (the "Upcoming events" card uses the full width), two columns
// from the desktop breakpoint (1024 px, where the sidebar appears). Checked at 390, 768 and 1280 px.
import { test, expect } from "../../fixtures/roles";
import { DashboardPage } from "../../pages/DashboardPage";

test.describe("Dashboard layout", () => {
  test("Upcoming events fills the row on phone and tablet, half of it on desktop", async ({ pageAs, isMobile }) => {
    test.skip(isMobile, "viewport sizes are set explicitly; one project is enough");
    const page = await pageAs("volunteerMedway");
    const dashboard = new DashboardPage(page);
    for (const [width, ratio] of [[390, 1], [768, 1], [1280, 0.5]] as const) {
      await page.setViewportSize({ width, height: 900 });
      await dashboard.goto();
      await expect(dashboard.upcomingEvents()).toBeVisible();
      await expect.poll(async () => {
        const grid = await page.getByTestId("dashboard-grid").boundingBox();
        const card = await dashboard.upcomingEvents().boundingBox();
        return grid && card ? Math.round((card.width / grid.width) * 10) / 10 : 0;
      }, { message: `${width}px` }).toBeCloseTo(ratio, 1);
    }
  });

  test("cards read top to bottom: Upcoming meetings, Upcoming events, My tasks, My registrations", async ({ pageAs }) => {
    const page = await pageAs("volunteerMedway");
    await new DashboardPage(page).goto();
    const order = ["dashboard-upcoming-meetings", "dashboard-upcoming-events", "dashboard-my-tasks", "dashboard-my-registrations"];
    for (const id of order) await expect(page.getByTestId(id)).toBeVisible();
    // Document order of the grid's cards: the reading order, also for screen readers.
    const ids = await page.getByTestId("dashboard-grid").evaluate(
      (grid, wanted) => Array.from(grid.querySelectorAll("[data-testid]")).map((el) => el.getAttribute("data-testid") ?? "").filter((id) => wanted.includes(id)),
      order,
    );
    expect(ids).toEqual(order);
  });
});

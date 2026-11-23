// Event status styles (calendar) and the dashboard's Upcoming events / Your drafts cards.
// Data: fresh managers create events through the app's RPCs (create_event / cancel_event); everything is
// deleted after each test. Brighton is used only by the cancelled-events test, so the dashboard's top 5 there
// is not crowded by events from the other tests running in parallel.
import { test, expect } from "../../fixtures/roles";
import { APP_LOAD_TIMEOUT } from "../../pages/app";
import { CalendarPage, type CalendarView } from "../../pages/CalendarPage";
import { DashboardPage } from "../../pages/DashboardPage";

const HOUR = 60;
const DAY = 24 * HOUR;

test.describe("Event status and dashboard cards", () => {
  test("a volunteer sees no drafts on the dashboard or in the calendar, and no Your drafts card", async ({ freshUser, freshEvent, pageAs }) => {
    const manager = await freshUser({ role: "branch_manager" });
    const volunteer = await freshUser();
    const draft = await freshEvent(manager, { label: "hidden draft", status: "draft", startInMinutes: DAY + HOUR });
    const published = await freshEvent(manager, { label: "visible", status: "published", startInMinutes: DAY });

    const page = await pageAs(volunteer);
    const dashboard = new DashboardPage(page);
    await dashboard.goto();
    await dashboard.expectEventsLoaded();
    await expect(dashboard.drafts()).toHaveCount(0);
    await expect(dashboard.upcomingItem(draft.id)).toHaveCount(0);
    await expect(dashboard.createEvent()).toHaveCount(0);

    const calendar = new CalendarPage(page);
    await calendar.goto("list");
    await expect(calendar.card("list", published.id)).toBeVisible();
    await expect(calendar.card("list", draft.id)).toHaveCount(0);
    await expect(calendar.legend()).toBeVisible();
    await expect(calendar.legendItem("draft")).toHaveCount(0);

    await calendar.goto("month");
    await calendar.showInMonth(published.id);
    await expect(calendar.card("month", draft.id)).toHaveCount(0);
  });

  test("a branch manager sees their own drafts (not another manager's) and Edit opens the form", async ({ freshUser, freshEvent, pageAs }) => {
    const manager = await freshUser({ role: "branch_manager" });
    const otherManager = await freshUser({ role: "branch_manager" });
    const mine = await freshEvent(manager, { label: "my draft", status: "draft" });
    const theirs = await freshEvent(otherManager, { label: "their draft", status: "draft" });

    const page = await pageAs(manager);
    const dashboard = new DashboardPage(page);
    await dashboard.goto();
    await expect(dashboard.draftItem(mine.id)).toBeVisible();
    await expect(dashboard.draftItem(mine.id).getByTestId("event-status-badge")).toHaveAttribute("data-status", "draft");
    await expect(dashboard.draftItem(theirs.id)).toHaveCount(0);
    await expect(dashboard.upcomingItem(mine.id)).toHaveCount(0);

    await dashboard.draftEdit(mine.id).click();
    // The form opens once the event and the manage permission have loaded; the page then drops ?edit=true.
    await expect(page.getByTestId("event-form")).toBeVisible({ timeout: APP_LOAD_TIMEOUT });
    await expect(page).toHaveURL(new RegExp(`/events/${mine.id}$`));
  });

  test("?edit=true never opens the form for users who cannot manage the event", async ({ freshUser, freshEvent, pageAs }) => {
    const manager = await freshUser({ role: "branch_manager" });
    const volunteer = await freshUser();
    const otherBranchManager = await freshUser({ role: "branch_manager", branch: "Brighton" });
    const event = await freshEvent(manager, { label: "edit guard", status: "published", startInMinutes: DAY });

    // Volunteer of the same branch: can view the event, cannot manage it.
    const volunteerPage = await pageAs(volunteer);
    await volunteerPage.goto(`/events/${event.id}?edit=true`);
    await expect(volunteerPage.getByTestId("event-detail-title")).toBeVisible();
    await expect(volunteerPage.getByTestId("event-edit-button")).toHaveCount(0);
    await expect(volunteerPage.getByTestId("event-form")).toHaveCount(0);

    // Manager of another branch: RLS hides the event entirely.
    const otherPage = await pageAs(otherBranchManager);
    await otherPage.goto(`/events/${event.id}?edit=true`);
    await expect(otherPage.getByTestId("event-detail-not-found")).toBeVisible();
    await expect(otherPage.getByTestId("event-form")).toHaveCount(0);

    // Control: the owning manager does get the form from the same link.
    const managerPage = await pageAs(manager);
    await managerPage.goto(`/events/${event.id}?edit=true`);
    await expect(managerPage.getByTestId("event-form")).toBeVisible();
  });

  test("cancelled events are not listed under Upcoming on the dashboard (the calendar still shows them)", async ({ freshUser, freshEvent, pageAs }) => {
    const manager = await freshUser({ role: "branch_manager", branch: "Brighton" });
    const volunteer = await freshUser({ branch: "Brighton" });
    const soon = await freshEvent(manager, { label: "cancelled soon", status: "published", startInMinutes: HOUR, cancelled: true });
    const later = await freshEvent(manager, { label: "cancelled later", status: "published", startInMinutes: 10 * DAY, cancelled: true });
    const open = await freshEvent(manager, { label: "still on", status: "published", startInMinutes: 2 * HOUR });

    const page = await pageAs(volunteer);
    const dashboard = new DashboardPage(page);
    await dashboard.goto();
    await expect(dashboard.upcomingItem(open.id)).toBeVisible();
    await expect(dashboard.upcomingItem(soon.id)).toHaveCount(0);
    await expect(dashboard.upcomingItem(later.id)).toHaveCount(0);

    await dashboard.viewAllEvents().click();
    await expect(page).toHaveURL(/\/calendar\?view=list$/);
    await expect(new CalendarPage(page).listView()).toBeVisible();
  });

  test("the calendar labels each status in the list and month views", async ({ freshUser, freshEvent, pageAs }) => {
    const manager = await freshUser({ role: "branch_manager" });
    const draft = await freshEvent(manager, { label: "status draft", status: "draft", startInMinutes: 3 * HOUR });
    const published = await freshEvent(manager, { label: "status published", status: "published", startInMinutes: 4 * HOUR });
    const live = await freshEvent(manager, { label: "status live", status: "published", startInMinutes: -30, durationMinutes: 2 * HOUR });
    const cancelled = await freshEvent(manager, { label: "status cancelled", status: "published", startInMinutes: 5 * HOUR, cancelled: true });
    const expected: [{ id: string }, string][] = [[draft, "draft"], [published, "published"], [live, "published"], [cancelled, "cancelled"]];

    const page = await pageAs(manager);
    const calendar = new CalendarPage(page);
    for (const view of ["list", "month"] as CalendarView[]) {
      await calendar.goto(view);
      for (const [event, status] of expected) {
        if (view === "month") await calendar.showInMonth(event.id);
        await expect(calendar.card(view, event.id)).toHaveAttribute("data-status", status);
        await expect(calendar.statusBadge(view, event.id)).toHaveAttribute("data-status", status);
        // A written label (or the icon's screen-reader label), never colour alone.
        await expect(calendar.statusBadge(view, event.id)).not.toHaveText("");
      }
      await expect(calendar.happeningNowBadge(view, live.id)).toBeVisible();
      await expect(calendar.happeningNowBadge(view, published.id)).toHaveCount(0);
      await expect(calendar.happeningNowBadge(view, cancelled.id)).toHaveCount(0);
    }
    for (const status of ["published", "live", "cancelled", "draft"]) await expect(calendar.legendItem(status)).toBeVisible();
  });
});

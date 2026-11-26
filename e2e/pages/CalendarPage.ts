import { expect, type Locator, type Page } from "@playwright/test";
import { APP_LOAD_TIMEOUT } from "./app";

export type CalendarView = "list" | "month";

export class CalendarPage {
  constructor(readonly page: Page) {}

  readonly listView = () => this.page.getByTestId("calendar-list-view");
  readonly monthView = () => this.page.getByTestId("calendar-month-view");
  readonly legend = () => this.page.getByTestId("calendar-legend");
  readonly legendItem = (status: string) => this.legend().locator(`[data-testid="calendar-legend-item"][data-status="${status}"]`);

  /** `?view=` makes the view independent of the device's default. */
  async goto(view: CalendarView) {
    await this.page.goto(`/calendar?view=${view}`);
    await expect(view === "list" ? this.listView() : this.monthView()).toBeVisible({ timeout: APP_LOAD_TIMEOUT });
  }

  /**
   * An event entry in the current view (list card or month-grid entry). An event that crosses midnight has an
   * entry in every day cell it covers (e.g. one created at 20:00 for "in 4 hours"), so month view uses its first.
   */
  card(view: CalendarView, eventId: string): Locator {
    const entries = (view === "list" ? this.listView() : this.monthView()).locator(`[data-testid="event-card"][data-event-id="${eventId}"]`);
    return view === "list" ? entries : entries.first();
  }

  statusBadge(view: CalendarView, eventId: string): Locator {
    return this.card(view, eventId).getByTestId("event-status-badge");
  }

  /** The viewer's own "Registered" / "Waitlisted" badge on an entry. */
  registrationBadge(view: CalendarView, eventId: string, kind: "registered" | "waitlisted"): Locator {
    return this.card(view, eventId).getByTestId(`calendar-event-badge-${kind}`);
  }

  happeningNowBadge(view: CalendarView, eventId: string): Locator {
    return this.card(view, eventId).getByTestId("event-badge-happening-now");
  }

  /** Month view: moves forward (at most once) when the event falls in the next month's grid. */
  async showInMonth(eventId: string) {
    if ((await this.card("month", eventId).count()) === 0) {
      await this.page.getByTestId("calendar-month-next").click();
    }
    await expect(this.card("month", eventId)).toBeVisible();
  }
}

/**
 * Clicks a Calendar header action (`event-request-open-button`, `calendar-add-past-event-button`,
 * `calendar-my-requests-link`): on phones (< 640px) these sit in the "More actions" (⋯) menu, opened first.
 */
export async function clickCalendarAction(page: Page, testId: string, options: { timeout?: number } = {}) {
  if ((page.viewportSize()?.width ?? 1280) < 640) {
    await page.getByTestId("calendar-more-actions").click(options);
    await expect(page.getByTestId("calendar-more-actions-menu")).toBeVisible();
  }
  await page.getByTestId(testId).click(options);
}

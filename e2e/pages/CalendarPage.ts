import { expect, type Locator, type Page } from "@playwright/test";

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
    await expect(view === "list" ? this.listView() : this.monthView()).toBeVisible();
  }

  /** An event entry in the current view (list card or month-grid entry). */
  card(view: CalendarView, eventId: string): Locator {
    return (view === "list" ? this.listView() : this.monthView()).locator(`[data-testid="event-card"][data-event-id="${eventId}"]`);
  }

  statusBadge(view: CalendarView, eventId: string): Locator {
    return this.card(view, eventId).getByTestId("event-status-badge");
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

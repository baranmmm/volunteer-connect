import { expect, type Page } from "@playwright/test";
import { EventFormDialog } from "./components/EventFormDialog";

export type SeriesScope = "this" | "following" | "all";

/** /events/:id, including the recurring scope dialog ("This event" / "This and following" / "All events"). */
export class EventPage {
  constructor(readonly page: Page) {}

  readonly title = () => this.page.getByTestId("event-detail-title");
  readonly notFound = () => this.page.getByTestId("event-detail-not-found");
  readonly recurringIcon = () => this.page.getByTestId("event-recurring-icon");
  readonly repeatSummary = () => this.page.getByTestId("event-repeat-summary");
  readonly editButton = () => this.page.getByTestId("event-edit-button");
  readonly deleteButton = () => this.page.getByTestId("event-delete-button");
  readonly scopeDialog = () => this.page.getByTestId("recurring-scope-dialog");
  readonly form = () => new EventFormDialog(this.page);

  async goto(eventId: string) {
    await this.page.goto(`/events/${eventId}`);
    await expect(this.title().or(this.notFound())).toBeVisible();
  }

  async chooseScope(scope: SeriesScope) {
    await expect(this.scopeDialog()).toBeVisible();
    await this.scopeDialog().getByTestId(`recurring-scope-${scope}`).click();
  }

  /** Edit an occurrence of a series for the given scope; returns the open form. */
  async editSeries(scope: SeriesScope) {
    await this.editButton().click();
    await this.chooseScope(scope);
    await expect(this.form().root).toBeVisible();
    return this.form();
  }

  /** Delete an occurrence for the given scope; the app returns to the calendar. */
  async deleteSeries(scope: SeriesScope) {
    await this.deleteButton().click();
    await this.chooseScope(scope);
    await expect(this.page).toHaveURL(/\/calendar/);
  }
}

import { expect, type Page } from "@playwright/test";
import { APP_LOAD_TIMEOUT } from "./app";
import { EventFormDialog } from "./components/EventFormDialog";

export type SeriesScope = "this" | "following" | "all";

/** /events/:id, including the recurring scope dialog ("This event" / "This and following" / "All events"). */
export class EventPage {
  constructor(readonly page: Page) {}

  readonly title = () => this.page.getByTestId("event-detail-title");
  readonly notFound = () => this.page.getByTestId("event-detail-not-found");
  readonly root = () => this.page.getByTestId("event-detail");
  // Scoped to the detail page: while the router swaps pages, the previous calendar list (cards with the same icon)
  // can still be in the DOM for a moment.
  readonly recurringIcon = () => this.root().getByTestId("event-recurring-icon");
  readonly repeatSummary = () => this.page.getByTestId("event-repeat-summary");
  readonly editButton = () => this.page.getByTestId("event-edit-button");
  readonly deleteButton = () => this.page.getByTestId("event-delete-button");
  readonly scopeDialog = () => this.page.getByTestId("recurring-scope-dialog");
  readonly form = () => new EventFormDialog(this.page);

  // Registration (A2b)
  readonly registration = () => this.page.getByTestId("event-registration");
  readonly registrationCount = () => this.page.getByTestId("event-registration-count");
  readonly registrationStatus = () => this.page.getByTestId("event-registration-status");
  readonly registrationUnavailable = () => this.page.getByTestId("event-registration-unavailable");
  readonly registerButton = () => this.page.getByTestId("event-register-button");
  readonly joinWaitlistButton = () => this.page.getByTestId("event-join-waitlist-button");
  readonly cancelRegistrationButton = () => this.page.getByTestId("event-cancel-registration-button");
  readonly waitlistPosition = () => this.page.getByTestId("event-waitlist-position");
  /** "Don't show my name" (names are opt-out); only while registered or waitlisted. */
  readonly hideNameCheckbox = () => this.page.getByTestId("event-hide-name-checkbox");
  readonly attendeeList = () => this.page.getByTestId("event-attendee-list");
  // Manager section
  readonly managerRegistrations = () => this.page.getByTestId("event-manager-registrations");
  readonly registrationRow = (registrationId: string) => this.page.getByTestId(`event-registration-row-${registrationId}`);
  readonly attendanceButton = (registrationId: string, status: "attended" | "no_show") => this.page.getByTestId(`event-attendance-${registrationId}-${status}`);
  readonly registrationsFilter = (filter: "registered" | "waitlisted" | "cancelled") => this.page.getByTestId(`event-registrations-filter-${filter}`);
  readonly exportCsvButton = () => this.page.getByTestId("event-registrations-export-csv");
  readonly capacityWarning = () => this.page.getByTestId("event-capacity-warning");

  async goto(eventId: string) {
    await this.page.goto(`/events/${eventId}`);
    await expect(this.title().or(this.notFound())).toBeVisible({ timeout: APP_LOAD_TIMEOUT });
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

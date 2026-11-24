import { expect, type Page } from "@playwright/test";
import { APP_LOAD_TIMEOUT } from "./app";

export class DashboardPage {
  constructor(readonly page: Page) {}

  readonly welcome = () => this.page.getByTestId("dashboard-welcome");
  readonly role = () => this.page.getByTestId("dashboard-user-role");
  readonly branch = () => this.page.getByTestId("dashboard-user-branch");
  readonly pendingScreen = () => this.page.getByTestId("pending-approval-screen");
  readonly pendingSignOut = () => this.page.getByTestId("pending-sign-out-button");
  readonly appLoading = () => this.page.getByTestId("app-loading");

  readonly upcomingEvents = () => this.page.getByTestId("dashboard-upcoming-events");
  readonly upcomingItems = () => this.upcomingEvents().getByTestId("dashboard-upcoming-event-item");
  readonly upcomingItem = (eventId: string) => this.upcomingEvents().locator(`[data-testid="dashboard-upcoming-event-item"][data-event-id="${eventId}"]`);
  readonly upcomingStatusBadge = (eventId: string) => this.upcomingItem(eventId).getByTestId("event-status-badge");
  readonly viewAllEvents = () => this.page.getByTestId("dashboard-view-all-events");
  readonly createEvent = () => this.page.getByTestId("dashboard-create-event");
  readonly drafts = () => this.page.getByTestId("dashboard-your-drafts");
  readonly draftItem = (eventId: string) => this.drafts().locator(`[data-testid="dashboard-draft-item"][data-event-id="${eventId}"]`);
  readonly draftEdit = (eventId: string) => this.draftItem(eventId).getByTestId("dashboard-draft-edit");
  readonly myRegistrations = () => this.page.getByTestId("dashboard-my-registrations");
  readonly myRegistrationItem = (eventId: string) => this.myRegistrations().locator(`[data-testid="dashboard-my-registration-item"][data-event-id="${eventId}"]`);
  readonly registrationNotice = (registrationId: string) => this.page.getByTestId(`dashboard-registration-notice-${registrationId}`);
  readonly dismissRegistrationNotice = (registrationId: string) => this.page.getByTestId(`dashboard-registration-notice-dismiss-${registrationId}`);
  /** "Waiting for you" (absent when nothing waits for the viewer's review); its count carries data-count. */
  readonly waiting = () => this.page.getByTestId("dashboard-waiting");
  readonly waitingCount = () => this.waiting().getByTestId("dashboard-waiting-count");
  readonly waitingLink = () => this.waiting().getByTestId("dashboard-waiting-link");
  readonly requestNotice = (requestId: string) => this.page.getByTestId(`dashboard-request-notice-${requestId}`);
  readonly dismissRequestNotice = (requestId: string) => this.page.getByTestId(`dashboard-request-notice-dismiss-${requestId}`);

  async goto() {
    await this.page.goto("/dashboard");
    await this.expectLoaded();
  }

  async expectLoaded() {
    await expect(this.page).toHaveURL(/\/dashboard$/, { timeout: APP_LOAD_TIMEOUT });
    await expect(this.welcome()).toBeVisible({ timeout: APP_LOAD_TIMEOUT });
  }

  /** Waits until the upcoming-events card has finished loading (rows or the empty state). */
  async expectEventsLoaded() {
    await expect(this.upcomingItems().first().or(this.page.getByTestId("dashboard-upcoming-events-empty"))).toBeVisible();
  }
}

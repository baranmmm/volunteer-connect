import { expect, type Page } from "@playwright/test";

export class DashboardPage {
  constructor(readonly page: Page) {}

  readonly welcome = () => this.page.getByTestId("dashboard-welcome");
  readonly role = () => this.page.getByTestId("dashboard-user-role");
  readonly branch = () => this.page.getByTestId("dashboard-user-branch");
  readonly pendingScreen = () => this.page.getByTestId("pending-approval-screen");
  readonly pendingSignOut = () => this.page.getByTestId("pending-sign-out-button");
  readonly appLoading = () => this.page.getByTestId("app-loading");

  async goto() {
    await this.page.goto("/dashboard");
    await this.expectLoaded();
  }

  async expectLoaded() {
    await expect(this.page).toHaveURL(/\/dashboard$/);
    await expect(this.welcome()).toBeVisible();
  }
}

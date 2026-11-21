import { expect, type Page } from "@playwright/test";

export class UsersPage {
  constructor(readonly page: Page) {}

  readonly search = () => this.page.getByTestId("users-search-input");
  readonly rows = () => this.page.getByTestId("users-row");
  readonly emptyState = () => this.page.getByTestId("users-empty-state");
  readonly loadError = () => this.page.getByTestId("users-load-error");
  readonly branchFilter = () => this.page.getByTestId("users-filter-branch");

  /** Row of a specific user, located by record id (never by text). */
  row(userId: string) {
    return this.page.locator(`[data-testid="users-row"][data-user-id="${userId}"]`);
  }

  async goto() {
    await this.page.goto("/users");
    await this.waitForList();
  }

  /** The list has finished loading when either rows or the empty state is shown. */
  async waitForList() {
    await expect(this.search()).toBeVisible();
    await expect(this.page.getByTestId("users-loading")).toHaveCount(0);
    await expect(this.loadError()).toHaveCount(0);
    await expect(this.rows().first().or(this.emptyState())).toBeVisible();
  }

  async filterBy(text: string) {
    await this.search().fill(text);
  }

  async openDetails(userId: string) {
    await this.row(userId).getByTestId("users-row-view-details").click();
    await expect(this.page).toHaveURL(new RegExp(`/users/${userId}$`));
  }
}

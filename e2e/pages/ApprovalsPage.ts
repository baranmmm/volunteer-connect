import { expect, type Page } from "@playwright/test";
import { DeleteUserDialog } from "./components/ConfirmDialog";

export class ApprovalsPage {
  constructor(readonly page: Page) {}

  readonly newTab = () => this.page.getByTestId("approvals-tab-new");
  readonly deletionsTab = () => this.page.getByTestId("approvals-tab-deletions");
  readonly rows = () => this.page.getByTestId("approvals-row");

  row(userId: string) {
    return this.page.locator(`[data-testid="approvals-row"][data-user-id="${userId}"]`);
  }
  deletionRow(requestId: string) {
    return this.page.locator(`[data-testid="deletion-request-row"][data-request-id="${requestId}"]`);
  }

  async goto() {
    await this.page.goto("/approvals");
    await expect(this.newTab()).toBeVisible();
  }

  async approve(userId: string) {
    await this.row(userId).getByTestId("approvals-approve-button").click();
  }
  async reject(userId: string) {
    await this.row(userId).getByTestId("approvals-reject-button").click();
  }

  async openDeletionRequests() {
    await this.deletionsTab().click();
    await expect(this.deletionsTab()).toHaveAttribute("data-state", "active");
  }

  async processDeletion(requestId: string, fullName: string) {
    await this.deletionRow(requestId).getByTestId("deletion-request-process-button").click();
    await new DeleteUserDialog(this.page).deleteTyping(fullName);
  }
}

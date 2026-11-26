import { expect, type Page } from "@playwright/test";
import { APP_LOAD_TIMEOUT } from "./app";
import { DeleteUserDialog } from "./components/ConfirmDialog";

/**
 * The former Approvals page, now in Requests → "Waiting for my approval" (/approvals redirects there): pending
 * sign-ups ("New volunteers") and account deletion requests, each section shown only while it has rows.
 */
export class ApprovalsPage {
  constructor(readonly page: Page) {}

  readonly approvalTab = () => this.page.getByTestId("requests-tab-review");
  readonly newVolunteers = () => this.page.getByTestId("approvals-new-volunteers");
  readonly deletionRequests = () => this.page.getByTestId("approvals-deletion-requests");
  readonly rows = () => this.page.getByTestId("approvals-row");
  readonly deletionsError = () => this.page.getByTestId("deletion-requests-error");

  row(userId: string) {
    return this.page.locator(`[data-testid="approvals-row"][data-user-id="${userId}"]`);
  }
  /** Pending deletion request of a user (data-user-id on the row). */
  deletionRowForUser(userId: string) {
    return this.page.locator(`[data-testid="deletion-request-row"][data-user-id="${userId}"]`);
  }
  deletionRow(requestId: string) {
    return this.page.locator(`[data-testid="deletion-request-row"][data-request-id="${requestId}"]`);
  }

  /** The old address: redirected to Requests with "Waiting for my approval" open. */
  async goto() {
    await this.page.goto("/approvals");
    await expect(this.page).toHaveURL(/\/requests\?tab=review$/, { timeout: APP_LOAD_TIMEOUT });
    await expect(this.approvalTab()).toHaveAttribute("data-state", "active", { timeout: APP_LOAD_TIMEOUT });
  }

  async approve(userId: string) {
    await this.row(userId).getByTestId("approvals-approve-button").click();
  }
  async reject(userId: string) {
    await this.row(userId).getByTestId("approvals-reject-button").click();
  }

  /** Deletion requests sit in the same tab, below the other items. */
  async openDeletionRequests() {
    await expect(this.deletionRequests()).toBeVisible({ timeout: APP_LOAD_TIMEOUT });
  }

  /** Opens the erasure dialog for a request without confirming (the full name must be typed first). */
  async openProcessDialog(requestId: string): Promise<DeleteUserDialog> {
    await this.deletionRow(requestId).getByTestId("deletion-request-process-button").click();
    const dialog = new DeleteUserDialog(this.page);
    await expect(dialog.root).toBeVisible();
    return dialog;
  }

  async processDeletion(requestId: string, fullName: string) {
    await this.deletionRow(requestId).getByTestId("deletion-request-process-button").click();
    await new DeleteUserDialog(this.page).deleteTyping(fullName);
  }
}

import { expect, type Locator, type Page } from "@playwright/test";

/** Any dialog using the shared confirm-dialog-* buttons, scoped to its container. */
export class ConfirmDialog {
  constructor(readonly root: Locator) {}

  /** Scope by container test id, or the open dialog role when the container has none yet. */
  static in(page: Page, containerTestId?: string) {
    return new ConfirmDialog(containerTestId ? page.getByTestId(containerTestId) : page.getByRole("dialog"));
  }

  get confirmButton() {
    return this.root.getByTestId("confirm-dialog-confirm-button");
  }
  get cancelButton() {
    return this.root.getByTestId("confirm-dialog-cancel-button");
  }

  async confirm() {
    await expect(this.confirmButton).toBeEnabled();
    await this.confirmButton.click();
  }
  async cancel() {
    await this.cancelButton.click();
    await expect(this.root).toBeHidden();
  }
}

/** Type-the-full-name delete dialog (DeleteUserDialog). */
export class DeleteUserDialog extends ConfirmDialog {
  constructor(page: Page) {
    super(page.getByTestId("delete-user-dialog"));
  }
  get nameInput() {
    return this.root.getByTestId("delete-user-name-input");
  }
  /** Types the full name (replacing any previous input) and confirms. */
  async deleteTyping(fullName: string) {
    await expect(this.root).toBeVisible();
    await this.nameInput.fill(fullName);
    await this.confirm();
  }
}

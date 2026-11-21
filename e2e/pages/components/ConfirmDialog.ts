import { expect, type Locator, type Page } from "@playwright/test";

/** Any dialog using the shared confirm-dialog-* buttons, scoped to its container. */
export class ConfirmDialog {
  constructor(readonly root: Locator) {}

  /** Scope by the dialog container's test id. */
  static in(page: Page, containerTestId: string) {
    return new ConfirmDialog(page.getByTestId(containerTestId));
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

/** User deletion dialog; only self-requested erasure requires typing the full name. */
export class DeleteUserDialog extends ConfirmDialog {
  constructor(page: Page) {
    super(page.getByTestId("delete-user-dialog"));
  }
  get error() {
    return this.root.getByTestId("delete-user-error");
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

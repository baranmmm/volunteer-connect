import { expect, type Page } from "@playwright/test";
import { ConfirmDialog } from "./components/ConfirmDialog";
import { LanguageSwitcher } from "./components/LanguageSwitcher";

export class ProfilePage {
  constructor(readonly page: Page) {}

  readonly fullName = () => this.page.getByTestId("profile-full-name-input");
  readonly phone = () => this.page.getByTestId("profile-phone-input");
  readonly saveButton = () => this.page.getByTestId("profile-save-button");
  readonly languageSelect = () => this.page.getByTestId("profile-language-select");
  readonly deleteAccountButton = () => this.page.getByTestId("profile-delete-account-button");
  readonly cancelDeletionButton = () => this.page.getByTestId("profile-cancel-deletion-button");
  readonly deletionPendingNotice = () => this.page.getByTestId("profile-deletion-pending-notice");
  get language() {
    return new LanguageSwitcher(this.page);
  }

  async goto() {
    await this.page.goto("/profile");
    await expect(this.fullName()).toBeVisible();
  }

  async requestAccountDeletion() {
    await this.deleteAccountButton().click();
    // Container test id requested from Lovable: profile-delete-confirm-dialog.
    await ConfirmDialog.in(this.page).confirm();
    await expect(this.deletionPendingNotice()).toBeVisible();
  }

  async cancelAccountDeletion() {
    await this.cancelDeletionButton().click();
    await expect(this.deleteAccountButton()).toBeVisible();
  }
}

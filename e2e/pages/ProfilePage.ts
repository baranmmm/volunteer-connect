import { expect, type Page } from "@playwright/test";
import { APP_LOAD_TIMEOUT } from "./app";
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
  readonly directorDeleteNote = () => this.page.getByTestId("profile-director-delete-note");
  readonly email = () => this.page.getByTestId("profile-email");
  get language() {
    return new LanguageSwitcher(this.page);
  }

  async goto() {
    await this.page.goto("/profile");
    await expect(this.fullName()).toBeVisible({ timeout: APP_LOAD_TIMEOUT });
  }

  async requestAccountDeletion() {
    await this.deleteAccountButton().click();
    await ConfirmDialog.in(this.page, "profile-delete-confirm-dialog").confirm();
    await expect(this.deletionPendingNotice()).toBeVisible();
  }

  async cancelAccountDeletion() {
    await this.cancelDeletionButton().click();
    await expect(this.deleteAccountButton()).toBeVisible();
  }
}

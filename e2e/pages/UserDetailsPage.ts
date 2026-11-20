import { expect, type Page } from "@playwright/test";
import { ConfirmDialog, DeleteUserDialog } from "./components/ConfirmDialog";
import { pickOption } from "./components/select";

export type EditableRole = "volunteer" | "branch_manager";
const ROLE_OPTION_ORDER: EditableRole[] = ["volunteer", "branch_manager"];

export class UserDetailsPage {
  constructor(readonly page: Page) {}

  readonly name = () => this.page.getByTestId("user-details-name");
  readonly email = () => this.page.getByTestId("user-details-email");
  readonly branch = () => this.page.getByTestId("user-details-branch");
  readonly role = () => this.page.getByTestId("user-details-role");
  readonly status = () => this.page.getByTestId("user-details-status");
  readonly notAllowed = () => this.page.getByTestId("user-details-not-allowed");

  readonly approveButton = () => this.page.getByTestId("user-details-approve-button");
  readonly rejectButton = () => this.page.getByTestId("user-details-reject-button");
  readonly changeRoleButton = () => this.page.getByTestId("user-details-change-role-button");
  readonly moveBranchButton = () => this.page.getByTestId("user-details-move-branch-button");
  readonly deactivateButton = () => this.page.getByTestId("user-details-deactivate-button");
  readonly reactivateButton = () => this.page.getByTestId("user-details-reactivate-button");
  readonly deleteButton = () => this.page.getByTestId("user-details-delete-button");
  readonly historyButton = () => this.page.getByTestId("user-details-history-button");

  readonly lastManagerWarning = () => this.page.getByTestId("last-manager-warning");
  readonly historyPanel = () => this.page.getByTestId("history-panel");
  readonly historyEntries = () => this.page.getByTestId("history-entry");
  readonly deleteDialog = () => new DeleteUserDialog(this.page);

  async goto(userId: string) {
    await this.page.goto(`/users/${userId}`);
    await expect(this.name().or(this.notAllowed())).toBeVisible();
  }

  roleDialog() {
    return ConfirmDialog.in(this.page, "change-role-dialog");
  }
  branchDialog() {
    return ConfirmDialog.in(this.page, "move-branch-dialog");
  }

  /** Opens the change-role dialog and selects a role; does not confirm. */
  async chooseRole(role: EditableRole) {
    await this.changeRoleButton().click();
    await expect(this.roleDialog().root).toBeVisible();
    await pickOption(this.page, "change-role-select", "change-role-option", role, ROLE_OPTION_ORDER.indexOf(role));
  }

  /** Opens the move-branch dialog and selects a branch; `index` is its position in the region's name-ordered list. */
  async chooseBranch(branchId: string, index: number) {
    await this.moveBranchButton().click();
    await expect(this.branchDialog().root).toBeVisible();
    await pickOption(this.page, "move-branch-select", "move-branch-option", branchId, index);
  }

  async openHistory() {
    await this.historyButton().click();
    await expect(this.historyPanel()).toBeVisible();
  }
}

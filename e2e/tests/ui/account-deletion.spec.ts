import { test, expect, storageFor, toastSuccess } from "../../fixtures/roles";
import { ProfilePage } from "../../pages/ProfilePage";
import { ApprovalsPage } from "../../pages/ApprovalsPage";
import { getDeletionRequest, pendingDeletionRequest } from "../../api/SupabaseClient";
import { deletionState, trySignIn } from "../../api/recycleBin";
import { RecycleBinPage } from "../../pages/RecycleBinPage";

test.describe("Delete my account", () => {
  test("a volunteer requests account deletion and cancels it", async ({ pageAs, freshUser }) => {
    const user = await freshUser();
    const page = await pageAs(user);
    const profile = new ProfilePage(page);
    await profile.goto();

    await profile.requestAccountDeletion();
    await expect(toastSuccess(page)).toBeVisible();
    await expect.poll(async () => (await pendingDeletionRequest(user.id))?.status).toBe("pending");

    await page.reload();
    await expect(profile.deletionPendingNotice()).toBeVisible(); // survives a reload

    await profile.cancelAccountDeletion();
    await expect.poll(() => pendingDeletionRequest(user.id)).toBeNull();
  });

  // Agreed GDPR behaviour: processing a self-requested erasure needs the user's exact full name; the user then
  // appears in the Recycle Bin as "Scheduled for erasure" with no Restore (the API refuses too, see
  // tests/api/recycle-bin.spec.ts) until the 30-day cleanup erases the account.
  test("a branch manager processes a volunteer's erasure request: full name required, then Scheduled for erasure without Restore", async ({ pageAs, freshUser }) => {
    const user = await freshUser({ branch: "Medway" });
    const volunteerPage = await pageAs(user);
    const profile = new ProfilePage(volunteerPage);
    await profile.goto();
    await profile.requestAccountDeletion();
    await expect.poll(() => pendingDeletionRequest(user.id)).not.toBeNull();
    const request = (await pendingDeletionRequest(user.id))!;

    const managerPage = await pageAs("managerMedway");
    const approvals = new ApprovalsPage(managerPage);
    await approvals.goto();
    await approvals.openDeletionRequests();
    await expect(approvals.deletionRow(request.id)).toBeVisible();
    await expect(approvals.deletionRowForUser(user.id)).toHaveAttribute("data-request-id", request.id);
    await expect(approvals.deletionRow(request.id).getByTestId("deletion-request-days-left")).toBeVisible();

    const dialog = await approvals.openProcessDialog(request.id);
    await expect(dialog.nameInput).toBeVisible();
    await expect(dialog.confirmButton).toBeDisabled();
    await dialog.nameInput.fill(`${user.fullName} x`);
    await expect(dialog.confirmButton).toBeDisabled();
    await dialog.nameInput.fill(user.fullName);
    await dialog.confirm();

    await expect(toastSuccess(managerPage)).toBeVisible();
    await expect(approvals.deletionRow(request.id)).toHaveCount(0);
    await expect.poll(async () => (await getDeletionRequest(request.id))?.status).toBe("completed");
    await expect.poll(async () => (await deletionState(user.id)).selfRequested).toBe(true);
    await expect.poll(() => trySignIn(user.email), { message: "an erased user cannot sign in" }).not.toBeNull();

    const bin = new RecycleBinPage(managerPage);
    await bin.goto();
    await bin.find(user.id, user.fullName);
    await expect(bin.row(user.id)).toHaveAttribute("data-self-requested", "true");
    await expect(bin.scheduledErasure(user.id)).toBeVisible();
    await expect(bin.restoreButton(user.id)).toHaveCount(0);
  });
});

test.describe("Delete my account — regional director", () => {
  test.use({ storageState: storageFor("director") });

  test("directors cannot request deletion in-app", async ({ page }) => {
    const profile = new ProfilePage(page);
    await profile.goto();
    await expect(profile.directorDeleteNote()).toBeVisible();
    await expect(profile.deleteAccountButton()).toHaveCount(0);
    await expect(profile.cancelDeletionButton()).toHaveCount(0);
  });
});

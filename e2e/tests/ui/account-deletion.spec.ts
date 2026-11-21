import { test, expect, storageFor, toastSuccess } from "../../fixtures/roles";
import { ProfilePage } from "../../pages/ProfilePage";
import { ApprovalsPage } from "../../pages/ApprovalsPage";
import { getDeletionRequest, pendingDeletionRequest, userExists } from "../../api/SupabaseClient";

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

  test("a branch manager processes a volunteer's deletion request", async ({ pageAs, freshUser }) => {
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

    await approvals.processDeletion(request.id, user.fullName);
    await expect(toastSuccess(managerPage)).toBeVisible();
    await expect(approvals.deletionRow(request.id)).toHaveCount(0);
    await expect.poll(() => userExists(user.id)).toBe(false);
    await expect.poll(async () => (await getDeletionRequest(request.id))?.status).toBe("completed");
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

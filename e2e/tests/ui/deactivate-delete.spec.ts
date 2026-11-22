import { test, expect, storageFor, toastSuccess } from "../../fixtures/roles";
import { UserDetailsPage } from "../../pages/UserDetailsPage";
import { UsersPage } from "../../pages/UsersPage";
import { RecycleBinPage } from "../../pages/RecycleBinPage";
import { getProfile, userExists } from "../../api/SupabaseClient";
import { deletionState, trySignIn } from "../../api/recycleBin";

test.describe("Deactivate and delete (branch manager)", () => {
  test.use({ storageState: storageFor("managerMedway") });

  test("deactivates, reactivates and deactivates again", async ({ page, freshUser }) => {
    const user = await freshUser();
    const details = new UserDetailsPage(page);
    await details.goto(user.id);

    await details.deactivateButton().click();
    await expect(toastSuccess(page).first()).toBeVisible();
    await expect(details.reactivateButton()).toBeVisible();
    await expect.poll(async () => (await getProfile(user.id))?.status).toBe("inactive");

    await details.reactivateButton().click();
    await expect(details.deactivateButton()).toBeVisible();
    await expect.poll(async () => (await getProfile(user.id))?.status).toBe("active");
  });

  // Agreed behaviour: simple confirmation (no name typing); the user goes to the Recycle Bin (soft delete, Auth
  // account banned, not erased) and can be restored within 30 days; while deleted they cannot sign in and their
  // personal data is shown on no screen.
  test("deletes a deactivated user with simple confirmation; the user is in the Recycle Bin and can be restored", async ({ page, freshUser }) => {
    const user = await freshUser();
    expect(await trySignIn(user.email), "a fresh user can sign in before deletion").toBeNull();
    const details = new UserDetailsPage(page);
    await details.goto(user.id);

    await expect(details.deleteButton()).toBeDisabled();
    await expect(details.deleteHint()).toBeVisible();
    await details.deactivateButton().click();
    await expect(details.reactivateButton()).toBeVisible();
    await expect(details.deleteButton()).toBeEnabled();

    await details.deleteButton().click();
    const dialog = details.deleteDialog();
    await expect(dialog.nameInput).toHaveCount(0);
    await expect(dialog.confirmButton).toBeEnabled();
    await dialog.confirm();
    await expect(toastSuccess(page).last()).toBeVisible();
    await expect(page).toHaveURL(/\/users$/);

    // Soft-deleted, not erased: the Auth account stays (banned) until restore or the 30-day purge.
    await expect.poll(async () => (await deletionState(user.id)).operation).toBe("deleted");
    expect(await userExists(user.id)).toBe(true);
    await expect.poll(() => trySignIn(user.email), { message: "a deleted user cannot sign in" }).not.toBeNull();

    // Personal data is gone from the manager's screens.
    const users = new UsersPage(page);
    await users.goto();
    await expect(users.row(user.id)).toHaveCount(0);
    await details.goto(user.id);
    await expect(details.notAllowed()).toBeVisible();
    await expect(details.name()).toHaveCount(0);

    // Recycle Bin: an ordinary deletion, restorable.
    const bin = new RecycleBinPage(page);
    await bin.goto();
    await bin.find(user.id, user.fullName);
    await expect(bin.row(user.id)).toHaveAttribute("data-self-requested", "false");
    await expect(bin.scheduledErasure(user.id)).toHaveCount(0);
    await bin.restore(user.id);
    await expect(toastSuccess(page).last()).toBeVisible();

    // The user is back: not deleted (status as before deletion: inactive), can sign in, listed again.
    await expect.poll(async () => (await deletionState(user.id)).deletedAt).toBeNull();
    expect((await deletionState(user.id)).operation).toBeNull();
    expect((await getProfile(user.id))?.status).toBe("inactive");
    await expect.poll(() => trySignIn(user.email), { message: "a restored user can sign in again" }).toBeNull();
    await users.goto();
    await expect(users.row(user.id)).toBeVisible();
  });
});

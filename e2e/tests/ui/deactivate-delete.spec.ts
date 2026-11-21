import { test, expect, storageFor, toastSuccess } from "../../fixtures/roles";
import { UserDetailsPage } from "../../pages/UserDetailsPage";
import { getProfile, userExists } from "../../api/SupabaseClient";

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

  test("deletes a user only after deactivation, confirming with the full name", async ({ page, freshUser }) => {
    const user = await freshUser();
    const details = new UserDetailsPage(page);
    await details.goto(user.id);

    await expect(details.deleteButton()).toBeDisabled();
    await expect(details.deleteHint()).toBeVisible();
    await details.deactivateButton().click();
    await expect(details.reactivateButton()).toBeVisible();
    await expect(details.deleteButton()).toBeEnabled();

    await details.deleteButton().click();
    const dialog = details.deleteDialog();
    await expect(dialog.confirmButton).toBeDisabled();
    await dialog.nameInput.fill(`${user.fullName} typo`);
    await expect(dialog.confirmButton).toBeDisabled();
    await dialog.deleteTyping(user.fullName);

    await expect(toastSuccess(page).last()).toBeVisible();
    await expect(page).toHaveURL(/\/users$/);
    await expect.poll(() => userExists(user.id)).toBe(false);
  });
});

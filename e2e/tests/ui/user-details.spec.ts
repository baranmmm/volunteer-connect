import { test, expect, storageFor } from "../../fixtures/roles";
import { UsersPage } from "../../pages/UsersPage";
import { UserDetailsPage } from "../../pages/UserDetailsPage";

test.describe("User details — regional director", () => {
  test.use({ storageState: storageFor("director") });

  test("opens a member from the list and shows their seeded data and director actions", async ({ page, seed }) => {
    const target = seed.users.volunteerMedway;
    const users = new UsersPage(page);
    await users.goto();
    await users.filterBy(target.email);
    await users.openDetails(target.id);

    const details = new UserDetailsPage(page);
    // Seeded data is not translated, so asserting it is safe in both languages.
    await expect(details.name()).toHaveText(target.fullName);
    await expect(details.email()).toHaveText(target.email);
    await expect(details.changeRoleButton()).toBeVisible();
    await expect(details.moveBranchButton()).toBeVisible();
    await expect(details.deactivateButton()).toBeVisible();
    await expect(details.deleteButton()).toBeDisabled(); // active users must be deactivated first
  });
});

test.describe("User details — branch manager", () => {
  test.use({ storageState: storageFor("managerMedway") });

  test("shows status actions but no role or branch actions", async ({ page, seed }) => {
    const details = new UserDetailsPage(page);
    await details.goto(seed.users.volunteerMedway.id);
    await expect(details.name()).toHaveText(seed.users.volunteerMedway.fullName);
    await expect(details.deactivateButton()).toBeVisible();
    await expect(details.historyButton()).toBeVisible();
    await expect(details.changeRoleButton()).toHaveCount(0);
    await expect(details.moveBranchButton()).toHaveCount(0);
  });

  test("shows approve and reject for a pending user", async ({ page, freshUser }) => {
    const user = await freshUser({ status: "pending" });
    const details = new UserDetailsPage(page);
    await details.goto(user.id);
    await expect(details.approveButton()).toBeVisible();
    await expect(details.rejectButton()).toBeVisible();
  });

  test("cannot manage their own account or the regional director", async ({ page, seed }) => {
    const details = new UserDetailsPage(page);
    for (const target of [seed.users.managerMedway, seed.users.director]) {
      await details.goto(target.id);
      await expect(details.notAllowed(), `${target.key} must not be manageable`).toBeVisible();
    }
  });
});

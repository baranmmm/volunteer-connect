import { test, expect, storageFor } from "../../fixtures/roles";
import { UsersPage } from "../../pages/UsersPage";
import { UserDetailsPage } from "../../pages/UserDetailsPage";
import { DashboardPage } from "../../pages/DashboardPage";

test.describe("Users page isolation — Medway manager", () => {
  test.use({ storageState: storageFor("managerMedway") });

  test("sees only Medway volunteers", async ({ page, seed }) => {
    const users = new UsersPage(page);
    await users.goto();
    await expect(users.row(seed.users.volunteerMedway.id)).toBeVisible();
    await expect(users.row(seed.users.pendingMedway.id)).toBeVisible();
    for (const hidden of [seed.users.volunteerBrighton, seed.users.pendingBrighton, seed.users.managerBrighton, seed.users.director, seed.users.managerMedway]) {
      await expect(users.row(hidden.id), `${hidden.key} must not be listed`).toHaveCount(0);
    }
  });

  test("cannot open a Brighton user's details by URL", async ({ page, seed }) => {
    const details = new UserDetailsPage(page);
    await details.goto(seed.users.volunteerBrighton.id);
    await expect(details.notAllowed()).toBeVisible();
    await expect(details.deleteButton()).toHaveCount(0);
  });
});

test.describe("Users page isolation — Brighton manager", () => {
  test.use({ storageState: storageFor("managerBrighton") });

  test("sees only Brighton volunteers", async ({ page, seed }) => {
    const users = new UsersPage(page);
    await users.goto();
    await expect(users.row(seed.users.volunteerBrighton.id)).toBeVisible();
    for (const hidden of [seed.users.volunteerMedway, seed.users.pendingMedway, seed.users.managerMedway, seed.users.director]) {
      await expect(users.row(hidden.id), `${hidden.key} must not be listed`).toHaveCount(0);
    }
  });
});

test.describe("Users page — regional director", () => {
  test.use({ storageState: storageFor("director") });

  test("sees members of every branch in the region, including managers", async ({ page, seed }) => {
    const users = new UsersPage(page);
    await users.goto();
    for (const key of ["volunteerMedway", "managerMedway", "volunteerBrighton", "managerBrighton"] as const) {
      await expect(users.row(seed.users[key].id), `${key} should be listed`).toBeVisible();
    }
    await expect(users.branchFilter()).toBeVisible();
  });
});

test.describe("Users page — volunteer", () => {
  test.use({ storageState: storageFor("volunteerMedway") });

  test("has no Users entry and is redirected away from /users", async ({ page, sidebar }) => {
    const dashboard = new DashboardPage(page);
    await dashboard.goto();
    expect(await sidebar.hasItem("users")).toBe(false);
    expect(await sidebar.hasItem("approvals")).toBe(false);
    await page.goto("/users");
    await expect(page).toHaveURL(/\/dashboard$/);
  });
});

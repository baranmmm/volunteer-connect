import { test, expect, storageFor } from "../../fixtures/roles";
import { DashboardPage } from "../../pages/DashboardPage";

test.describe("Pending approval screen", () => {
  test.use({ storageState: storageFor("pendingMedway") });

  test("a pending volunteer only sees the pending screen and can sign out", async ({ page }) => {
    const dashboard = new DashboardPage(page);
    await page.goto("/dashboard");
    await expect(dashboard.pendingScreen()).toBeVisible();
    await expect(dashboard.welcome()).toHaveCount(0);
    await expect(page.getByTestId("nav-dashboard")).toHaveCount(0);

    for (const path of ["/users", "/approvals", "/profile"]) {
      await page.goto(path);
      await expect(dashboard.pendingScreen()).toBeVisible();
    }

    await dashboard.pendingSignOut().click();
    await expect(page).toHaveURL(/\/auth$/);
  });

  test("a deactivated user sees the same blocking screen", async ({ pageAs, freshUser }) => {
    const user = await freshUser({ status: "inactive" });
    const page = await pageAs(user);
    await page.goto("/dashboard");
    await expect(page.getByTestId("pending-approval-screen")).toBeVisible();
    // Once Lovable adds data-status on this screen: expect(...).toHaveAttribute("data-status", "inactive")
  });
});

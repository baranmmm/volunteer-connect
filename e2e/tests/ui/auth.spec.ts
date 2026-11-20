// The only spec that signs in through the UI. Everything else uses per-role storageState.
import { test, expect, toastError } from "../../fixtures/roles";
import { AuthPage } from "../../pages/AuthPage";
import { DashboardPage } from "../../pages/DashboardPage";
import { QA_HOST } from "../../setup/guard";
import { userPassword } from "../../setup/env";

test.describe("Sign in and sign out", () => {
  test("a volunteer signs in through the UI against the QA project and signs out", async ({ page, seed, sidebar }) => {
    const auth = new AuthPage(page);
    await auth.goto();

    const qaRequest = page.waitForRequest((r) => new URL(r.url()).hostname === QA_HOST);
    await auth.signIn(seed.users.volunteerMedway.email, userPassword());
    await qaRequest; // proves the app reads the QA URL from the environment, not the committed .env

    const dashboard = new DashboardPage(page);
    await dashboard.expectLoaded();
    await expect(dashboard.branch()).toBeVisible();

    await sidebar.signOut();
    await expect(auth.signInForm()).toBeVisible();
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/auth$/);
  });

  test("wrong password shows an error toast and stays on the sign-in page", async ({ page, seed }) => {
    const auth = new AuthPage(page);
    await auth.goto();
    await auth.signIn(seed.users.volunteerMedway.email, `${userPassword()}-wrong`);
    await expect(toastError(page)).toBeVisible();
    await expect(page).toHaveURL(/\/auth$/);
  });

  test("signed-out visitors are redirected from protected pages to sign in", async ({ page }) => {
    for (const path of ["/dashboard", "/users", "/approvals", "/profile"]) {
      await page.goto(path);
      await expect(page).toHaveURL(/\/auth$/);
    }
  });
});

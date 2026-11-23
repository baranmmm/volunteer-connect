// The only spec that signs in through the UI. Everything else uses per-role storageState.
import { test, expect, toastError } from "../../fixtures/roles";
import { AuthPage } from "../../pages/AuthPage";
import { DashboardPage } from "../../pages/DashboardPage";
import { requireEnv, userPassword } from "../../setup/env";

test.describe("Sign in and sign out", () => {
  test("a volunteer signs in through the UI against the test project and signs out", { tag: "@smoke" }, async ({ page, seed, sidebar }) => {
    const auth = new AuthPage(page);
    await auth.goto();

    // QA, or the local stack: the guard has already checked SUPABASE_URL is one of them.
    const apiHost = new URL(requireEnv("SUPABASE_URL")).hostname;
    const apiRequest = page.waitForRequest((r) => new URL(r.url()).hostname === apiHost);
    await auth.signIn(seed.users.volunteerMedway.email, userPassword());
    await apiRequest; // proves the app reads the test project's URL from the environment, not the committed .env

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

  test("signed-out visitors are redirected from protected pages to sign in", { tag: "@smoke" }, async ({ page }) => {
    for (const path of ["/dashboard", "/users", "/approvals", "/profile"]) {
      await page.goto(path);
      await expect(page).toHaveURL(/\/auth$/);
    }
  });
});

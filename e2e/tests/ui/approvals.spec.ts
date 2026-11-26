import { test, expect, storageFor, toastSuccess } from "../../fixtures/roles";
import { ApprovalsPage } from "../../pages/ApprovalsPage";
import { getProfile } from "../../api/SupabaseClient";
import { APP_LOAD_TIMEOUT } from "../../pages/app";

// Pending sign-ups are approved in Requests → "Waiting for my approval" (the old /approvals address redirects there).
test.describe("Approvals", () => {
  test.use({ storageState: storageFor("managerMedway") });

  test("a branch manager approves a pending volunteer", async ({ page, freshUser }) => {
    const user = await freshUser({ status: "pending" });
    const approvals = new ApprovalsPage(page);
    await approvals.goto();

    await expect(approvals.row(user.id)).toBeVisible();
    await approvals.approve(user.id);
    await expect(toastSuccess(page)).toBeVisible();
    await expect(approvals.row(user.id)).toHaveCount(0);
    await expect.poll(async () => (await getProfile(user.id))?.status).toBe("active");
  });

  test("a branch manager rejects a pending volunteer", async ({ page, freshUser }) => {
    const user = await freshUser({ status: "pending" });
    const approvals = new ApprovalsPage(page);
    await approvals.goto();

    await approvals.reject(user.id);
    await expect(toastSuccess(page)).toBeVisible();
    await expect(approvals.row(user.id)).toHaveCount(0);
    await expect.poll(async () => (await getProfile(user.id))?.status).toBe("inactive");
  });

  test("only pending volunteers from the manager's own branch are listed", async ({ page, seed, freshUser }) => {
    const brightonPending = await freshUser({ status: "pending", branch: "Brighton" });
    const approvals = new ApprovalsPage(page);
    await approvals.goto();

    await expect(approvals.row(seed.users.pendingMedway.id)).toBeVisible();
    await expect(approvals.row(seed.users.pendingBrighton.id)).toHaveCount(0);
    await expect(approvals.row(brightonPending.id)).toHaveCount(0);
  });
});

test.describe("Approvals access", () => {
  test.use({ storageState: storageFor("volunteerMedway") });

  test("volunteers following an old Approvals link see only their own requests", async ({ page }) => {
    await page.goto("/approvals");
    await expect(page).toHaveURL(/\/requests\?tab=review$/, { timeout: APP_LOAD_TIMEOUT });
    await expect(page.getByTestId("my-requests-page")).toBeVisible({ timeout: APP_LOAD_TIMEOUT });
    await expect(page.getByTestId("requests-tab-review")).toHaveCount(0);
    await expect(page.getByTestId("approvals-row")).toHaveCount(0);
  });
});

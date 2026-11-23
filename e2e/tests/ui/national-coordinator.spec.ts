// National Coordinator in the UI: MFA at sign-in (aal1 sees only the MFA screen), the national dashboard, regions and
// branches, and the Users page (RD/BM only, volunteers as numbers).
import { test, expect } from "../../fixtures/roles";
import { adminClient, storageStateFor, signIn } from "../../api/SupabaseClient";
import { totp } from "../../api/totp";
import { APP_LOAD_TIMEOUT } from "../../pages/app";
import { baseUrl } from "../../setup/env";

test.describe("National Coordinators", () => {
  test("a password session sees only the MFA screen; the authenticator code opens the national dashboard", { tag: "@smoke" }, async ({ browser, freshUser }) => {
    const nc = await freshUser({ role: "national_coordinator" });
    const context = await browser.newContext({ storageState: storageStateFor(await signIn(nc.email), new URL(baseUrl()).origin) });
    const page = await context.newPage();
    await page.goto("/dashboard");
    await expect(page.getByTestId("mfa-verify")).toBeVisible({ timeout: APP_LOAD_TIMEOUT });
    await expect(page.getByTestId("app-sidebar")).toHaveCount(0);
    await page.goto("/users");
    await expect(page.getByTestId("mfa-verify")).toBeVisible({ timeout: APP_LOAD_TIMEOUT });
    await page.getByTestId("mfa-code-input").fill(totp(nc.totpSecret!));
    await page.getByTestId("mfa-submit").click();
    // Verified: the app opens (the Users page, where the code was asked), then the dashboard after a reload too.
    await expect(page.getByTestId("mfa-gate")).toHaveCount(0, { timeout: APP_LOAD_TIMEOUT });
    await expect(page.getByTestId("users-branch-counts")).toBeVisible({ timeout: APP_LOAD_TIMEOUT });
    await page.goto("/dashboard");
    await expect(page.getByTestId("nc-dashboard")).toBeVisible({ timeout: APP_LOAD_TIMEOUT });
    await expect(page.getByTestId("nc-stat-volunteers")).toHaveAttribute("data-value", /^\d+$/);
    await context.close();
  });

  test("regions and branches: create a region and a branch, delete them (Recycle Bin), the tree updates", async ({ freshUser, pageAs }) => {
    const nc = await freshUser({ role: "national_coordinator" });
    const page = await pageAs(nc);
    const name = `E2E Region ${Date.now()}`;
    let regionId: string | undefined;
    try {
      await page.goto("/regions");
      await page.getByTestId("region-create").click({ timeout: APP_LOAD_TIMEOUT });
      await page.getByTestId("regions-name-input").fill(name);
      await page.getByTestId("regions-save").click();
      const region = page.getByTestId("regions-tree-region").filter({ hasText: name });
      await expect(region).toBeVisible();
      regionId = (await region.getAttribute("data-region-id")) ?? undefined;
      await region.getByTestId("branch-create").click();
      await page.getByTestId("regions-name-input").fill(`${name} Branch`);
      await page.getByTestId("regions-save").click();
      await expect(region.getByTestId("regions-tree-branch")).toHaveCount(1);
      page.once("dialog", (d) => void d.accept());
      await region.getByTestId("region-delete").click();
      await expect(region).toHaveCount(0);
      const { data } = await adminClient().from("branches").select("deleted_at, deleted_with_region").eq("region_id", regionId!);
      expect(data).toEqual([expect.objectContaining({ deleted_with_region: true })]);
    } finally {
      if (regionId) {
        await adminClient().from("branches").delete().eq("region_id", regionId);
        await adminClient().from("regions").delete().eq("id", regionId);
      }
    }
  });

  test("Users lists Regional Directors and Branch Managers only; volunteers appear as numbers per branch", async ({ freshUser, pageAs }) => {
    const nc = await freshUser({ role: "national_coordinator" });
    const manager = await freshUser({ role: "branch_manager" });
    const volunteer = await freshUser();
    const page = await pageAs(nc);
    await page.goto("/users");
    await expect(page.getByTestId("users-branch-counts")).toBeVisible({ timeout: APP_LOAD_TIMEOUT });
    await expect(page.locator(`[data-testid="users-row"][data-user-id="${manager.id}"]`)).toBeVisible();
    await expect(page.locator(`[data-testid="users-row"][data-user-id="${volunteer.id}"]`)).toHaveCount(0);
  });
});

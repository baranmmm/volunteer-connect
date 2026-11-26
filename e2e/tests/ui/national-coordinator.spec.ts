// National Coordinator in the UI: MFA at sign-in (aal1 sees only the MFA screen), the national dashboard, regions and
// branches, and the Users page (RD/BM only, volunteers as numbers).
import { test, expect, runId } from "../../fixtures/roles";
import { deleteTestRegion, TEMP_REGION_PREFIX } from "../../api/eventRequests";
import { adminClient, storageStateFor, signIn } from "../../api/SupabaseClient";
import { totp } from "../../api/totp";
import { APP_LOAD_TIMEOUT } from "../../pages/app";
import { RegionsPage } from "../../pages/RegionsPage";
import { baseUrl } from "../../setup/env";

test.describe("National Coordinators", () => {
  test("a password session sees only the MFA screen; the authenticator code opens the national dashboard", { tag: "@smoke" }, async ({ browser, freshUser }) => {
    const nc = await freshUser({ role: "national_coordinator" });
    const context = await browser.newContext({ storageState: storageStateFor(await signIn(nc.email), new URL(baseUrl()).origin) });
    const page = await context.newPage();
    await page.goto("/dashboard");
    await expect(page.getByTestId("mfa-verify")).toBeVisible({ timeout: APP_LOAD_TIMEOUT });
    await expect(page.getByTestId("app-sidebar")).toHaveCount(0);
    // The public top bar (logo, Events, language) without account links: no Sign in or Join, no Dashboard yet.
    const bar = page.getByTestId("public-topbar");
    await expect(bar.getByTestId("public-topbar-events")).toBeVisible();
    await expect(bar.getByTestId("public-topbar-sign-in")).toHaveCount(0);
    await expect(bar.getByTestId("public-topbar-join")).toHaveCount(0);
    await expect(bar.getByTestId("public-topbar-dashboard")).toHaveCount(0);
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
    // Run id and time in the name: teardown removes it if this test is cut off before its own cleanup.
    const name = `${TEMP_REGION_PREFIX}${runId}-${Date.now()}`;
    let regionId: string | undefined;
    try {
      // The map is the default view; the tree (create, rename, delete) is the List view.
      const regions = new RegionsPage(page);
      await regions.goto();
      await regions.showList();
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
      // The region may exist even when the test failed before reading its id.
      regionId ??= (await adminClient().from("regions").select("id").eq("name", name).maybeSingle()).data?.id;
      if (regionId) await deleteTestRegion(regionId);
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

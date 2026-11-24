// The branch map on Regions & branches: the default view for National Coordinators (every branch) and Regional
// Directors (their region only). A marker opens a panel with Branch Managers and counts, never volunteer names.
// OpenStreetMap tiles are served as an empty image (RegionsPage.blockMapTiles).
import { test, expect } from "../../fixtures/roles";
import { adminClient } from "../../api/SupabaseClient";
import { APP_LOAD_TIMEOUT } from "../../pages/app";
import { RegionsPage } from "../../pages/RegionsPage";

/** A spot in the empty north-west Highlands, different for every test run, so parallel runs' markers never overlap. */
const lonelySpot = () => [57 + Math.random() * 1.4, -7 + Math.random() * 2.2] as const;

async function placeBranch(id: string, latitude: number, longitude: number) {
  const { error } = await adminClient().from("branches").update({ latitude, longitude }).eq("id", id);
  if (error) throw new Error(`place branch: ${error.message}`);
}

test.describe("Branch map", () => {
  test("NC: the dashboard card opens the map; a marker shows managers and counts, no volunteer names; List keeps the tree", async ({ freshUser, freshBranch, pageAs }) => {
    const branch = await freshBranch("map-nc");
    // Far from the seeded town centres, so the marker is not covered by another one.
    await placeBranch(branch, ...lonelySpot());
    const manager = await freshUser({ role: "branch_manager", branch });
    const volunteer = await freshUser({ role: "volunteer", branch });
    const page = await pageAs(await freshUser({ role: "national_coordinator" }));
    const regions = new RegionsPage(page);
    await RegionsPage.blockMapTiles(page);

    await page.goto("/dashboard");
    await page.getByTestId("dashboard-branch-map-card").click({ timeout: APP_LOAD_TIMEOUT });
    await expect(page).toHaveURL(/\/regions$/);
    // The map is the default view.
    await expect(regions.map()).toBeVisible({ timeout: APP_LOAD_TIMEOUT });
    await expect(page.getByTestId("regions-view-switch-map")).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("regions-map-legend")).toBeVisible();
    // Opens fitted to every located branch (padding, town-level zoom cap), not the fixed UK view.
    await expect(regions.marker(branch)).toBeVisible({ timeout: APP_LOAD_TIMEOUT });
    await regions.expectFittedToBranches();

    // Keyboard: the marker is focusable and Enter opens the panel.
    const marker = regions.marker(branch);
    await expect(marker).toHaveAttribute("role", "button");
    // A plain dot (no count inside); a branch with volunteers gets the larger dot; focus shows the name.
    await expect(marker).toHaveText("");
    await expect(marker).toHaveClass(/has-volunteers/);
    await marker.focus();
    // The tooltip shows the branch name only (the marker's title), no counts.
    await expect(page.locator(".branch-map-tooltip")).toHaveText((await marker.getAttribute("title"))!);
    await page.keyboard.press("Enter");
    const panel = regions.panel();
    await expect(panel).toHaveAttribute("data-branch-id", branch);
    await expect(panel.getByTestId("regions-map-panel-count-volunteers")).toHaveAttribute("data-value", "1");
    for (const key of ["followers", "events", "tasks"]) {
      await expect(panel.getByTestId(`regions-map-panel-count-${key}`)).toHaveAttribute("data-value", /^\d+$/);
    }
    await expect(panel.getByTestId("regions-map-panel-manager")).toHaveText(manager.fullName);
    await expect(panel).not.toContainText(volunteer.fullName);

    // "Open branch": the List view at that branch; the choice is remembered after a reload.
    await panel.getByTestId("regions-map-panel-open").click();
    const card = page.locator(`[data-testid="regions-tree-branch"][data-branch-id="${branch}"]`);
    await expect(card).toBeFocused();
    await expect(page.getByTestId("regions-view-switch-list")).toHaveAttribute("aria-pressed", "true");
    await page.reload();
    await expect(card).toBeVisible({ timeout: APP_LOAD_TIMEOUT });
    await expect(regions.map()).toHaveCount(0);
    await page.getByTestId("regions-view-switch-map").click();
    await expect(regions.marker(branch)).toBeVisible({ timeout: APP_LOAD_TIMEOUT });
  });

  test("RD: the map shows only their region's branches; the postcode field checks the UK format", async ({ freshUser, freshBranch, pageAs, seed }) => {
    const branch = await freshBranch("map-rd");
    await placeBranch(branch, ...lonelySpot());
    const page = await pageAs(await freshUser({ role: "regional_director" }));
    const regions = new RegionsPage(page);
    await regions.goto();
    await expect(regions.map()).toBeVisible({ timeout: APP_LOAD_TIMEOUT });
    await expect(regions.marker(branch)).toBeVisible({ timeout: APP_LOAD_TIMEOUT });
    await expect(page.getByTestId("region-create")).toHaveCount(0);
    await regions.expectFittedToBranches();

    const ids = await regions.markers().evaluateAll((els) => els.map((el) => el.getAttribute("data-branch-id")));
    const { data } = await adminClient().from("branches").select("id, region_id").in("id", ids as string[]);
    // Other parallel tests may remove their temporary branches meanwhile: check the branches that still exist.
    expect(data?.map((b) => b.id)).toContain(branch);
    expect(new Set(data?.map((b) => b.region_id))).toEqual(new Set([seed.regionId]));
    // A placed branch of another region (if the stack has one) has no marker.
    const other = await adminClient().from("branches").select("id").neq("region_id", seed.regionId).not("latitude", "is", null).is("deleted_at", null).limit(1);
    for (const b of other.data ?? []) await expect(regions.marker(b.id)).toHaveCount(0);

    // Keyboard (focus + Enter): parallel runs' markers may lie on top of this one, so a pointer click could hit another.
    await regions.marker(branch).focus();
    await page.keyboard.press("Enter");
    await expect(regions.panel()).toHaveAttribute("data-branch-id", branch);

    // List view: the RD may set a branch's postcode; a malformed one cannot be saved (no geocoding request).
    await regions.showList();
    const card = page.locator(`[data-testid="regions-tree-branch"][data-branch-id="${branch}"]`);
    await card.getByTestId("branch-edit-location").click();
    await page.getByTestId("branch-form-postcode").fill("12345");
    await expect(page.getByTestId("regions-save")).toBeDisabled();
    await page.getByTestId("branch-form-postcode").fill("");
    await expect(page.getByTestId("regions-save")).toBeEnabled();
  });
});

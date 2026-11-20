import { test, expect, storageFor, toastSuccess } from "../../fixtures/roles";
import { UserDetailsPage } from "../../pages/UserDetailsPage";
import { getProfile, getRoles } from "../../api/SupabaseClient";

test.describe("Role and branch changes (regional director)", () => {
  test.use({ storageState: storageFor("director") });

  test("promotes a volunteer to branch manager", async ({ page, freshUser }) => {
    const user = await freshUser();
    const details = new UserDetailsPage(page);
    await details.goto(user.id);

    await details.chooseRole("branch_manager");
    await details.roleDialog().confirm();
    await expect(toastSuccess(page)).toBeVisible();
    await expect(details.roleDialog().root).toBeHidden();
    await expect.poll(() => getRoles(user.id)).toEqual(["branch_manager"]);
  });

  test("moves a volunteer from Medway to Brighton", async ({ page, seed, freshUser }) => {
    const user = await freshUser({ branch: "Medway" });
    const details = new UserDetailsPage(page);
    await details.goto(user.id);

    await details.chooseBranch(seed.branches.Brighton);
    await details.branchDialog().confirm();
    await expect(toastSuccess(page)).toBeVisible();
    await expect.poll(async () => (await getProfile(user.id))?.branch_id).toBe(seed.branches.Brighton);
  });

  test("warns before demoting the last branch manager of a branch", async ({ page, seed, freshUser }, testInfo) => {
    // A branch with no seeded manager; each project uses its own so parallel runs never share it.
    const candidates = seed.regionBranches.filter((b) => b.id !== seed.branches.Medway && b.id !== seed.branches.Brighton);
    test.skip(candidates.length === 0, "Region needs a third branch for this test");
    const branch = candidates[testInfo.project.name === "mobile-pixel7" && candidates.length > 1 ? 1 : 0]!;
    const manager = await freshUser({ branch: branch.id, role: "branch_manager" });

    const details = new UserDetailsPage(page);
    await details.goto(manager.id);
    await details.chooseRole("volunteer");
    await expect(details.lastManagerWarning()).toBeVisible();

    await details.roleDialog().cancel();
    expect(await getRoles(manager.id)).toEqual(["branch_manager"]);
  });

  test("no warning when the branch still has another manager", async ({ page, freshUser }) => {
    // Medway keeps the seeded manager, so demoting a second Medway manager is not "last manager".
    const manager = await freshUser({ branch: "Medway", role: "branch_manager" });
    const details = new UserDetailsPage(page);
    await details.goto(manager.id);
    await details.chooseRole("volunteer");
    await expect(details.lastManagerWarning()).toHaveCount(0);
    await details.roleDialog().cancel();
    expect(await getRoles(manager.id)).toEqual(["branch_manager"]);
  });
});

import { test, expect, storageFor } from "../../fixtures/roles";
import { UserDetailsPage } from "../../pages/UserDetailsPage";
import { clientAs } from "../../api/SupabaseClient";

test.describe("Member history", () => {
  test.use({ storageState: storageFor("director") });

  test("lists role, branch and status changes from the audit log", async ({ page, seed, freshUser }) => {
    const user = await freshUser({ branch: "Medway" });

    // Make the changes through the real permission-checked RPCs so audit rows carry a real actor.
    const director = await clientAs(seed.users.director.email);
    for (const [fn, args] of [
      ["set_user_role", { _target: user.id, _role: "branch_manager" }],
      ["set_user_branch", { _target: user.id, _branch: seed.branches.Brighton }],
      ["set_user_status", { _target: user.id, _status: "inactive" }],
    ] as const) {
      const { error } = await director.rpc(fn, args);
      expect(error, `${fn} should succeed for the director`).toBeNull();
    }

    const details = new UserDetailsPage(page);
    await details.goto(user.id);
    await details.openHistory();

    const panel = details.historyPanel();
    for (const action of ["role_change", "branch_change", "status_change"]) {
      await expect(panel.locator(`[data-testid="history-entry"][data-action="${action}"]`), `${action} entry`).toHaveCount(1);
    }
  });

  test("a new member has an empty history", async ({ page, freshUser }) => {
    const user = await freshUser();
    const details = new UserDetailsPage(page);
    await details.goto(user.id);
    await details.openHistory();
    await expect(details.historyEmpty()).toBeVisible();
    await expect(details.historyEntries()).toHaveCount(0);
  });
});

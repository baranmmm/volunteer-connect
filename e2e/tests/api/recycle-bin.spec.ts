// Recycle Bin permissions, called directly through the RPCs with each user's own token. RLS/RPC checks are the
// real enforcement; the UI only hides buttons. Every user here is a fresh-* user, deleted after the test.
// Targets are soft-deleted with the same steps as the app's deleteUser server function (api/recycleBin.ts).
import { test, expect, type TestUser } from "../../fixtures/roles";
import { clientAs, pendingDeletionRequest } from "../../api/SupabaseClient";
import { deletionState, listRecycleBinAs, restoreItemAs, softDeleteUser, type RecycleRow } from "../../api/recycleBin";

/** A Medway volunteer, deactivated and then deleted by `manager` (an ordinary, restorable deletion). */
async function deletedVolunteer(freshUser: (o?: object) => Promise<TestUser>, manager: TestUser) {
  const target = await freshUser({ status: "inactive" });
  await softDeleteUser(manager.id, target.id);
  expect((await deletionState(target.id)).operation).toBe("deleted");
  return target;
}

const rowsOf = (res: { data: unknown }) => (Array.isArray(res.data) ? (res.data as RecycleRow[]) : []);

test.describe("Recycle Bin API permissions", () => {
  test("a volunteer cannot call list_recycle_bin or restore_item", { tag: "@smoke" }, async ({ freshUser }) => {
    const manager = await freshUser({ role: "branch_manager" });
    const volunteer = await freshUser();
    const target = await deletedVolunteer(freshUser, manager);

    const list = await listRecycleBinAs(volunteer.email, target.fullName);
    expect(list.error, "volunteer list_recycle_bin should be rejected").not.toBeNull();
    expect(rowsOf(list)).toHaveLength(0);

    const restore = await restoreItemAs(volunteer.email, target.id);
    expect(restore.error, "volunteer restore_item should be rejected").not.toBeNull();
    expect(await deletionState(target.id)).toMatchObject({ operation: "deleted", deletedAt: expect.any(String) });
  });

  test("a branch manager cannot see or restore another branch's deleted users", async ({ freshUser }) => {
    const medwayManager = await freshUser({ role: "branch_manager" });
    const brightonManager = await freshUser({ role: "branch_manager", branch: "Brighton" });
    const target = await deletedVolunteer(freshUser, medwayManager);

    // Control: the user's own branch manager sees the item and may restore it.
    const own = await listRecycleBinAs(medwayManager.email, target.fullName);
    expect(own.error).toBeNull();
    expect(rowsOf(own).find((r) => r.id === target.id)).toMatchObject({ type: "user", can_restore: true, self_requested: false });

    const other = await listRecycleBinAs(brightonManager.email, target.fullName);
    expect(other.error).toBeNull();
    expect(rowsOf(other).map((r) => r.id)).not.toContain(target.id);

    const restore = await restoreItemAs(brightonManager.email, target.id);
    expect(restore.error, "another branch's manager restore_item should be rejected").not.toBeNull();
    expect(await deletionState(target.id)).toMatchObject({ operation: "deleted", deletedAt: expect.any(String) });
  });

  test("a user deleted through an erasure request cannot be restored through the API, not even by a regional director", async ({ freshUser }) => {
    const manager = await freshUser({ role: "branch_manager" });
    const director = await freshUser({ role: "regional_director", branch: "Medway" });
    const target = await freshUser();
    const requested = await (await clientAs(target.email)).rpc("request_account_deletion");
    expect(requested.error).toBeNull();
    const request = await pendingDeletionRequest(target.id);
    expect(request).not.toBeNull();
    await softDeleteUser(manager.id, target.id, request!.id);
    expect(await deletionState(target.id)).toMatchObject({ operation: "deleted", selfRequested: true });

    const listed = await listRecycleBinAs(manager.email, target.fullName);
    expect(listed.error).toBeNull();
    expect(rowsOf(listed).find((r) => r.id === target.id)).toMatchObject({ self_requested: true, can_restore: false });

    for (const actor of [manager, director]) {
      const restore = await restoreItemAs(actor.email, target.id);
      expect(restore.error, `${actor.role} restore_item of an erasure should be rejected`).not.toBeNull();
    }
    expect(await deletionState(target.id)).toMatchObject({ operation: "deleted", selfRequested: true, deletedAt: expect.any(String) });
  });
});

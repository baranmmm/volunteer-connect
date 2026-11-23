// Tasks through PostgREST and the RPCs (the database is the enforcement): assignment rules per role, visibility,
// status-only edits by assignees, upward task requests, notices, the Recycle Bin and followers. Every item is created
// by fresh users (cleaned up by the fixtures) and every check looks at this test's own ids only.
import { test, expect, runId } from "../../fixtures/roles";
import { adminClient, clientAs } from "../../api/SupabaseClient";
import { TASK_TITLE_PREFIX, createTaskAs, workRpc } from "../../api/work";

const title = (label: string) => `${TASK_TITLE_PREFIX}${runId} ${label}`;
const visible = async (who: { email: string; totpSecret?: string }, ids: string[]) => {
  const { data, error } = await workRpc(who, "list_tasks");
  expect(error).toBeNull();
  return ((data ?? []) as { id: string }[]).map((t) => t.id).filter((id) => ids.includes(id)).sort();
};
const kinds = async (userId: string, entityId: string) =>
  ((await adminClient().from("notifications").select("kind").eq("user_id", userId).eq("entity_id", entityId)).data ?? []).map((n) => n.kind).sort();

test.describe("Tasks (database rules)", () => {
  test("assignment: BM within the branch, RD anyone in the region, NC only RDs/BMs/NCs, a volunteer only themselves", { tag: "@smoke" }, async ({ freshUser, seed }) => {
    const manager = await freshUser({ role: "branch_manager" });
    const volunteer = await freshUser({ role: "volunteer" });
    const brighton = await freshUser({ role: "volunteer", branch: seed.branches.Brighton });
    const director = await freshUser({ role: "regional_director" });
    const nc = await freshUser({ role: "national_coordinator" });
    const medway = { scope: "branch" as const, branch_id: seed.branches.Medway };

    const task = await createTaskAs(manager, { ...medway, title: title("bm"), assignee_ids: [volunteer.id] });
    expect(await kinds(volunteer.id, task)).toEqual(["task_assigned"]);
    expect(await kinds(manager.id, task)).toEqual([]);
    expect((await workRpc(manager, "create_task", { p: { ...medway, title: title("x"), assignee_ids: [brighton.id] } })).error?.message).toBe("This person cannot be assigned");
    expect((await workRpc(manager, "create_task", { p: { scope: "region", region_id: seed.regionId, title: title("x") } })).error?.message).toBe("Not allowed");

    await createTaskAs(director, { ...medway, title: title("rd"), assignee_ids: [brighton.id] });
    await createTaskAs(director, { scope: "region", region_id: seed.regionId, title: title("rd region"), assignee_ids: [volunteer.id, manager.id] });

    await createTaskAs(nc, { scope: "national", title: title("nc"), assignee_ids: [manager.id, director.id] });
    expect((await workRpc(nc, "create_task", { p: { scope: "national", title: title("x"), assignee_ids: [volunteer.id] } })).error?.message).toBe("This person cannot be assigned");
    const people = (await workRpc(nc, "list_task_people", { p_scope: "national" })).data as { id: string; role: string }[];
    expect(people.some((p) => p.id === volunteer.id || p.role === "volunteer")).toBe(false);
    // Without MFA a National Coordinator gets nothing.
    expect((await workRpc({ email: nc.email }, "create_task", { p: { scope: "national", title: title("x") } })).error?.message).toBe("Not allowed");

    const self = await createTaskAs(volunteer, { ...medway, title: title("self"), assignee_ids: [manager.id] });
    const detail = (await workRpc(volunteer, "get_task", { p_id: self })).data as { self_task: boolean; assignees: { id: string }[] };
    expect(detail.self_task).toBe(true);
    expect(detail.assignees.map((a) => a.id)).toEqual([volunteer.id]);
    expect((await workRpc(volunteer, "create_task", { p: { scope: "branch", branch_id: seed.branches.Brighton, title: title("x") } })).error?.message).toBe("Not allowed");
  });

  test("visibility: branch members, the RD, region BMs, assignees and NCs (national) only; followers nothing", async ({ freshUser, seed }) => {
    const manager = await freshUser({ role: "branch_manager" });
    const member = await freshUser({ role: "volunteer" });
    const assignee = await freshUser({ role: "volunteer" });
    const brightonVolunteer = await freshUser({ role: "volunteer", branch: seed.branches.Brighton });
    const brightonManager = await freshUser({ role: "branch_manager", branch: seed.branches.Brighton });
    const director = await freshUser({ role: "regional_director" });
    const nc = await freshUser({ role: "national_coordinator" });
    const follower = await freshUser({ role: "follower" });
    const branchTask = await createTaskAs(manager, { scope: "branch", branch_id: seed.branches.Medway, title: title("branch") });
    const regionTask = await createTaskAs(director, { scope: "region", region_id: seed.regionId, title: title("region"), assignee_ids: [assignee.id] });
    const nationalTask = await createTaskAs(nc, { scope: "national", title: title("national"), assignee_ids: [brightonManager.id] });
    const ids = [branchTask, regionTask, nationalTask];
    expect(await visible(member, ids)).toEqual([branchTask]);
    expect(await visible(assignee, ids)).toEqual([branchTask, regionTask].sort());
    expect(await visible(brightonVolunteer, ids)).toEqual([]);
    expect(await visible(brightonManager, ids)).toEqual([regionTask, nationalTask].sort());
    expect(await visible(director, ids)).toEqual([branchTask, regionTask].sort());
    expect(await visible(nc, ids)).toEqual([nationalTask]);
    expect(await visible(follower, ids)).toEqual([]);
    // Table reads follow the same rules; nobody writes the tables directly.
    const asMember = await clientAs(member.email);
    expect(((await asMember.from("tasks").select("id").in("id", ids)).data ?? []).map((t) => t.id)).toEqual([branchTask]);
    expect((await asMember.from("tasks").update({ title: "x" }).eq("id", branchTask).select()).error?.message).toMatch(/permission denied/);
    expect((await (await clientAs(follower.email)).from("tasks").select("id").in("id", ids)).data).toEqual([]);
    expect((await workRpc(follower, "create_task", { p: { scope: "branch", branch_id: seed.branches.Medway, title: title("x") } })).error?.message).toBe("Not allowed");
  });

  test("an assignee changes only the status (the creator is notified); others cannot; deleted tasks are restored from the Recycle Bin", async ({ freshUser, seed }) => {
    const manager = await freshUser({ role: "branch_manager" });
    const assignee = await freshUser({ role: "volunteer" });
    const other = await freshUser({ role: "volunteer" });
    const task = await createTaskAs(manager, { scope: "branch", branch_id: seed.branches.Medway, title: title("status"), assignee_ids: [assignee.id] });
    expect((await workRpc(assignee, "set_task_status", { p_id: task, p_status: "in_progress" })).error).toBeNull();
    expect(await kinds(manager.id, task)).toEqual(["task_status_changed"]);
    expect((await workRpc(assignee, "update_task", { p_id: task, p: { title: title("renamed") } })).error?.message).toBe("Not allowed");
    expect((await workRpc(assignee, "delete_task", { p_id: task })).error?.message).toBe("Not allowed");
    expect((await workRpc(other, "set_task_status", { p_id: task, p_status: "done" })).error?.message).toBe("Not allowed");
    expect((await workRpc(manager, "delete_task", { p_id: task })).error).toBeNull();
    expect(await visible(assignee, [task])).toEqual([]);
    const bin = (await workRpc(manager, "list_recycle_bin", { _type: "task", _search: runId, _offset: 0 })).data as { id: string }[];
    expect(bin.map((b) => b.id)).toContain(task);
    expect((await workRpc(manager, "restore_item", { _type: "task", _id: task })).error).toBeNull();
    expect(await visible(assignee, [task])).toEqual([task]);
  });

  test("upward task request: accepted → a task for the target; declined → the note reaches the requester", { tag: "@smoke" }, async ({ freshUser, freshBranch }) => {
    const branch = await freshBranch("task-request");
    const manager = await freshUser({ role: "branch_manager", branch });
    const volunteer = await freshUser({ role: "volunteer", branch });
    const targets = (await workRpc(volunteer, "list_request_targets")).data as { id: string }[];
    expect(targets.map((t) => t.id)).toContain(manager.id);
    const accepted = (await workRpc(volunteer, "submit_task_request", { p: { target_id: manager.id, title: title("please"), priority: "high" } })).data as string;
    const declined = (await workRpc(volunteer, "submit_task_request", { p: { target_id: manager.id, title: title("another") } })).data as string;
    expect(await kinds(manager.id, accepted)).toEqual(["task_request_received"]);
    expect((await workRpc(volunteer, "accept_task_request", { p_id: accepted })).error?.message).toBe("Not allowed");
    const task = (await workRpc(manager, "accept_task_request", { p_id: accepted })).data as string;
    const detail = (await workRpc(manager, "get_task", { p_id: task })).data as { scope: string; branch_id: string; assignees: { id: string }[]; priority: string };
    expect([detail.scope, detail.branch_id, detail.assignees.map((a) => a.id), detail.priority]).toEqual(["branch", branch, [manager.id], "high"]);
    expect((await workRpc(manager, "decline_task_request", { p_id: declined, p_reason: "short" })).error?.message).toBe("Decline reason is too short");
    expect((await workRpc(manager, "decline_task_request", { p_id: declined, p_reason: "We are covering this next month." })).error).toBeNull();
    const mine = (await workRpc(volunteer, "list_my_task_requests")).data as { id: string; status: string; decline_reason: string | null }[];
    expect(mine.find((r) => r.id === declined)).toMatchObject({ status: "declined", decline_reason: "We are covering this next month." });
    expect(mine.find((r) => r.id === accepted)).toMatchObject({ status: "accepted" });
    expect(await kinds(volunteer.id, declined)).toEqual(["task_request_declined"]);
  });
});

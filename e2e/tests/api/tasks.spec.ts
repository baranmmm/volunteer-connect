// Tasks through PostgREST and the RPCs (the database is the enforcement): assignment rules per role, visibility,
// status-only edits by assignees, reminders off by default, archiving, notes with @mentions, event tasks, upward task
// requests, notices, the Recycle Bin and followers. Every item is created
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
  test("assignment: BM within the branch, RD anyone in the region, NC only RDs/BMs/NCs, a volunteer themselves and branch volunteers", { tag: "@smoke" }, async ({ freshUser, seed }) => {
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

    // A volunteer: themselves when nobody is chosen, other volunteers of their branch, never upward or another branch.
    const self = await createTaskAs(volunteer, { ...medway, title: title("self") });
    const detail = (await workRpc(volunteer, "get_task", { p_id: self })).data as { self_task: boolean; assignees: { id: string }[] };
    expect(detail.self_task).toBe(true);
    expect(detail.assignees.map((a) => a.id)).toEqual([volunteer.id]);
    const colleague = await freshUser({ role: "volunteer" });
    const shared = await createTaskAs(volunteer, { ...medway, title: title("colleague"), assignee_ids: [colleague.id] });
    expect(((await workRpc(volunteer, "get_task", { p_id: shared })).data as { assignees: { id: string }[] }).assignees.map((a) => a.id)).toEqual([colleague.id]);
    expect(await kinds(colleague.id, shared)).toEqual(["task_assigned"]);
    const offered = ((await workRpc(volunteer, "list_task_people", { p_scope: "branch", p_branch: seed.branches.Medway })).data as { id: string }[]).map((p) => p.id);
    expect(offered).toEqual(expect.arrayContaining([volunteer.id, colleague.id]));
    expect(offered).not.toContain(manager.id);
    expect((await workRpc(volunteer, "create_task", { p: { ...medway, title: title("x"), assignee_ids: [manager.id] } })).error?.message).toBe("This person cannot be assigned");
    expect((await workRpc(volunteer, "create_task", { p: { ...medway, title: title("x"), assignee_ids: [brighton.id] } })).error?.message).toBe("This person cannot be assigned");
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

  test("an assignee changes only the status (the creator hears only of Blocked or Done); others cannot; deleted tasks are restored from the Recycle Bin", async ({ freshUser, seed }) => {
    const manager = await freshUser({ role: "branch_manager" });
    const assignee = await freshUser({ role: "volunteer" });
    const other = await freshUser({ role: "volunteer" });
    const task = await createTaskAs(manager, { scope: "branch", branch_id: seed.branches.Medway, title: title("status"), assignee_ids: [assignee.id] });
    expect((await workRpc(assignee, "set_task_status", { p_id: task, p_status: "in_progress" })).error).toBeNull();
    expect(await kinds(manager.id, task)).toEqual([]);
    expect((await workRpc(assignee, "set_task_status", { p_id: task, p_status: "blocked" })).error).toBeNull();
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
    // The target gets one grouped "waiting for you" notice instead of one per request.
    expect(await kinds(manager.id, accepted)).toEqual([]);
    expect(((await adminClient().from("notifications").select("kind").eq("user_id", manager.id).eq("kind", "review_waiting")).data ?? []).length).toBe(1);
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

  test("reminders are off for a new task unless sent; existing settings are kept on edits without reminders", async ({ freshUser, seed }) => {
    const manager = await freshUser({ role: "branch_manager" });
    const medway = { scope: "branch" as const, branch_id: seed.branches.Medway };
    const reminders = async (id: string) => ((await workRpc(manager, "get_task", { p_id: id })).data as { reminders: Record<string, unknown> }).reminders;
    const plain = await createTaskAs(manager, { ...medway, title: title("no reminders"), due_date: "2030-01-10" });
    expect(await reminders(plain)).toEqual({ before_days: [], repeat_kind: "none", repeat_every_days: null, repeat_start: null, overdue_every_days: null });
    const on = (await workRpc(manager, "create_task", { p: { ...medway, title: title("reminders"), due_date: "2030-01-10", reminders: { before_days: [3], repeat_kind: "none", repeat_every_days: null, repeat_start: null, overdue_every_days: null } } })).data as string;
    expect(await reminders(on)).toMatchObject({ before_days: [3] });
    expect((await workRpc(manager, "update_task", { p_id: on, p: { title: title("renamed") } })).error).toBeNull();
    expect(await reminders(on)).toMatchObject({ before_days: [3] });
  });

  test("self-reminders: only an assignee sets their own (not the task's); invalid settings and non-assignees are refused; null clears", async ({ freshUser, seed }) => {
    const manager = await freshUser({ role: "branch_manager" });
    const volunteer = await freshUser({ role: "volunteer" });
    const colleague = await freshUser({ role: "volunteer" });
    const medway = { scope: "branch" as const, branch_id: seed.branches.Medway };
    const id = await createTaskAs(manager, { ...medway, title: title("self reminders"), due_date: "2030-01-10", assignee_ids: [volunteer.id] });
    const mine = { before_days: [2], repeat_kind: "none", repeat_every_days: null, repeat_start: null, overdue_every_days: 1 };
    const stored = async (userId: string) => (await adminClient().from("task_assignees").select("my_reminders").eq("task_id", id).eq("user_id", userId).maybeSingle()).data?.my_reminders ?? null;

    // Off by default; the assignee sets theirs; the task's own reminders stay off; only they see theirs.
    expect(await stored(volunteer.id)).toBeNull();
    expect((await workRpc(volunteer, "set_my_task_reminders", { p_id: id, p_reminders: mine })).error).toBeNull();
    expect(await stored(volunteer.id)).toMatchObject({ before_days: [2], overdue_every_days: 1 });
    const own = (await workRpc(volunteer, "get_task", { p_id: id })).data as { my_reminders: unknown; reminders: { before_days: number[] } };
    expect(own.my_reminders).toMatchObject({ before_days: [2] });
    expect(own.reminders.before_days).toEqual([]);
    expect(((await workRpc(manager, "get_task", { p_id: id })).data as { my_reminders: unknown }).my_reminders ?? null).toBeNull();

    // A colleague who can see the task but is not assigned, and the manager who is not assigned either, are refused.
    expect((await workRpc(colleague, "set_my_task_reminders", { p_id: id, p_reminders: mine })).error?.message).toBe("Not allowed");
    expect((await workRpc(manager, "set_my_task_reminders", { p_id: id, p_reminders: mine })).error?.message).toBe("Not allowed");
    // Invalid settings are refused and leave the stored ones.
    expect((await workRpc(volunteer, "set_my_task_reminders", { p_id: id, p_reminders: { ...mine, overdue_every_days: 0 } })).error?.message).toBe("Reminder settings are not valid");
    expect(await stored(volunteer.id)).toMatchObject({ before_days: [2] });
    // Null clears them.
    expect((await workRpc(volunteer, "set_my_task_reminders", { p_id: id, p_reminders: null })).error).toBeNull();
    expect(await stored(volunteer.id)).toBeNull();
  });

  test("archive: only done tasks, by assignees and editors; leaving done unarchives; Archive all done counts", async ({ freshUser, seed }) => {
    const manager = await freshUser({ role: "branch_manager" });
    const assignee = await freshUser({ role: "volunteer" });
    const other = await freshUser({ role: "volunteer" });
    const medway = { scope: "branch" as const, branch_id: seed.branches.Medway };
    const task = await createTaskAs(manager, { ...medway, title: title("archive"), assignee_ids: [assignee.id] });
    const archivedAt = async (id: string) => ((await workRpc(manager, "list_tasks")).data as { id: string; archived_at: string | null }[]).find((t) => t.id === id)?.archived_at ?? null;
    expect((await workRpc(assignee, "archive_task", { p_id: task, p_archived: true })).error?.message).toBe("Only done tasks can be archived");
    expect((await workRpc(assignee, "set_task_status", { p_id: task, p_status: "done" })).error).toBeNull();
    expect((await workRpc(other, "archive_task", { p_id: task, p_archived: true })).error?.message).toBe("Not allowed");
    expect((await workRpc(assignee, "archive_task", { p_id: task, p_archived: true })).error).toBeNull();
    expect(await archivedAt(task)).not.toBeNull();
    // Archive is not delete: the task is still listed (with archived_at) and readable.
    expect((await workRpc(other, "get_task", { p_id: task })).data).not.toBeNull();
    expect((await workRpc(assignee, "set_task_status", { p_id: task, p_status: "in_progress" })).error).toBeNull();
    expect(await archivedAt(task)).toBeNull();

    const done1 = await createTaskAs(manager, { ...medway, title: title("done 1"), status: "done" });
    const done2 = await createTaskAs(manager, { ...medway, title: title("done 2"), status: "done" });
    expect((await workRpc(other, "archive_done_tasks", { p_ids: [done1, done2, task] })).data).toBe(0);
    expect((await workRpc(manager, "archive_done_tasks", { p_ids: [done1, done2, task] })).data).toBe(2);
    expect(await archivedAt(done1)).not.toBeNull();
    expect((await workRpc(manager, "archive_task", { p_id: done1, p_archived: false })).error).toBeNull();
    expect(await archivedAt(done1)).toBeNull();
  });

  test("notes: who writes, @mentions only of people who can see the task, notices, author-only edits", async ({ freshUser, seed }) => {
    const manager = await freshUser({ role: "branch_manager" });
    const assignee = await freshUser({ role: "volunteer" });
    const member = await freshUser({ role: "volunteer" });
    const brighton = await freshUser({ role: "volunteer", branch: seed.branches.Brighton });
    const task = await createTaskAs(manager, { scope: "branch", branch_id: seed.branches.Medway, title: title("notes"), assignee_ids: [assignee.id] });
    const people = ((await workRpc(assignee, "list_task_mention_people", { p_task: task })).data as { id: string }[]).map((p) => p.id);
    expect(people).toEqual(expect.arrayContaining([manager.id, member.id]));
    expect(people).not.toContain(brighton.id);
    expect(people).not.toContain(assignee.id);
    expect((await workRpc(assignee, "add_task_note", { p_task: task, p_body: "x", p_mentions: [brighton.id] })).error?.message).toBe("This person cannot see the task");
    // A branch member who is not assigned cannot write.
    expect((await workRpc(member, "add_task_note", { p_task: task, p_body: "x", p_mentions: [] })).error?.message).toBe("Not allowed");
    const note = (await workRpc(assignee, "add_task_note", { p_task: task, p_body: "Booked the hall", p_mentions: [member.id] })).data as string;
    expect(await kinds(member.id, task)).toEqual(["task_note_mention"]);
    expect(await kinds(manager.id, task)).toEqual(["task_note_added"]);
    const notes = (await workRpc(member, "list_task_notes", { p_task: task })).data as { id: string; mine: boolean; mentions: { id: string }[] }[];
    expect(notes.map((n) => [n.id, n.mine, n.mentions.map((m) => m.id)])).toEqual([[note, false, [member.id]]]);
    expect((await workRpc(manager, "update_task_note", { p_id: note, p_body: "changed", p_mentions: [] })).error?.message).toBe("Not allowed");
    expect((await workRpc(manager, "delete_task_note", { p_id: note })).error?.message).toBe("Not allowed");
    expect((await workRpc(assignee, "update_task_note", { p_id: note, p_body: "Booked the hall for Friday", p_mentions: [member.id] })).error).toBeNull();
    const listed = ((await workRpc(manager, "list_tasks")).data as { id: string; note_count: number }[]).find((t) => t.id === task);
    expect(listed?.note_count).toBe(1);
    expect((await workRpc(assignee, "delete_task_note", { p_id: note })).error).toBeNull();
    expect((await workRpc(assignee, "list_task_notes", { p_task: task })).data).toEqual([]);
  });
});

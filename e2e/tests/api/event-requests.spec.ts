// A3 event requests through the RPCs with each user's own token: RLS and the SECURITY DEFINER checks are the
// real enforcement. Fresh users only; their requests (and drafts created from them) are removed after each test.
import { test, expect } from "../../fixtures/roles";
import { adminClient, anonClient, clientAs } from "../../api/SupabaseClient";
import { softDeleteUser } from "../../api/recycleBin";
import { deleteRequests, REQUEST_TITLE_PREFIX, requestInput, requestRow, rpcAs, submitRequestAs } from "../../api/eventRequests";

const title = (label: string) => `${REQUEST_TITLE_PREFIX}${Date.now()}-${Math.random().toString(36).slice(2, 6)} ${label}`;
const draftEvent = (t: string, scope: "branch" | "region", branchId: string | null) => ({
  _data: { title: t, description: "", location: "", scope, branch_id: branchId, status: "draft", all_day: false, start_at: null, end_at: null },
});

test.describe("Event requests API", () => {
  test("volunteers request branch events only; branch managers request region events and cannot create them", async ({ freshUser, seed }) => {
    const volunteer = await freshUser();
    const manager = await freshUser({ role: "branch_manager" });
    const branchRequest = await submitRequestAs(volunteer.email, title("branch"));
    expect(await requestRow(branchRequest)).toMatchObject({ scope: "branch", branch_id: seed.branches.Medway, region_id: seed.regionId, status: "submitted", requester_id: volunteer.id });
    expect((await rpcAs(volunteer.email, "submit_event_request", { p: requestInput(title("vol region"), { scope: "region" }) })).error).toBe("Not allowed");

    const regionRequest = await submitRequestAs(manager.email, title("region"));
    expect(await requestRow(regionRequest)).toMatchObject({ scope: "region", branch_id: null, region_id: seed.regionId });
    expect((await rpcAs(manager.email, "submit_event_request", { p: requestInput(title("bm branch"), { scope: "branch" }) })).error).toBe("Branch managers create branch events directly");
    // Server side: create_event refuses a region event from a branch manager, and allows their own branch.
    expect((await rpcAs(manager.email, "create_event", draftEvent(title("bm region event"), "region", null))).error).toBe("Not allowed");
    const own = await rpcAs<string>(manager.email, "create_event", draftEvent(title("bm branch event"), "branch", seed.branches.Medway));
    expect(own.error).toBeNull();
    await adminClient().from("events").delete().eq("id", own.data);
  });

  test("regional directors cannot request events but create them directly", async ({ freshUser }) => {
    const director = await freshUser({ role: "regional_director" });
    expect((await rpcAs(director.email, "submit_event_request", { p: requestInput(title("rd")) })).error).toBe("Regional directors create events directly");
    const created = await rpcAs<string>(director.email, "create_event", draftEvent(title("rd event"), "region", null));
    expect(created.error).toBeNull();
    await adminClient().from("events").delete().eq("id", created.data);
  });

  test("review scope: own-branch manager and the region's director; never another branch or one's own request", async ({ freshUser }) => {
    const volunteer = await freshUser();
    const manager = await freshUser({ role: "branch_manager" });
    const otherManager = await freshUser({ role: "branch_manager", branch: "Brighton" });
    const director = await freshUser({ role: "regional_director" });
    const id = await submitRequestAs(volunteer.email, title("scope"));
    for (const reviewer of [manager, director]) {
      expect((await rpcAs<{ id: string }>(reviewer.email, "get_event_request", { p_id: id })).data).toMatchObject({ id, can_review: true });
      const listed = await rpcAs<{ rows: { id: string }[] }>(reviewer.email, "list_managed_event_requests", { p_status: "submitted", p_offset: 0 });
      expect(listed.data.rows.map((r) => r.id)).toContain(id);
    }
    expect((await rpcAs(otherManager.email, "get_event_request", { p_id: id })).error).toBe("Request not found");
    expect((await rpcAs(otherManager.email, "approve_event_request", { p_id: id })).error).toBe("Request not found");
    expect(((await (await clientAs(otherManager.email)).from("event_requests").select("id").eq("id", id)).data ?? [])).toEqual([]);
    expect((await rpcAs(volunteer.email, "approve_event_request", { p_id: id })).error).toBe("You cannot review your own request");

    // Region requests: only the region's director reviews; the requesting branch manager cannot.
    const region = await submitRequestAs(manager.email, title("region scope"));
    expect((await rpcAs(otherManager.email, "start_review_event_request", { p_id: region })).error).toBe("Request not found");
    expect((await rpcAs(manager.email, "start_review_event_request", { p_id: region })).error).toBe("You cannot review your own request");
    expect((await rpcAs(director.email, "start_review_event_request", { p_id: region })).error).toBeNull();
    expect(await requestRow(region)).toMatchObject({ status: "under_review", notice: "under_review", reviewer_id: director.id });
  });

  test("approval creates one draft owned by the approver; a second or concurrent approval fails", async ({ freshUser }) => {
    const volunteer = await freshUser();
    const manager = await freshUser({ role: "branch_manager" });
    const director = await freshUser({ role: "regional_director" });
    const id = await submitRequestAs(volunteer.email, title("approve"));
    const approved = await rpcAs<{ event_id: string }>(manager.email, "approve_event_request", { p_id: id });
    expect(approved.error).toBeNull();
    const { data: event } = await adminClient().from("events").select("status, scope, branch_id, created_by, capacity").eq("id", approved.data.event_id).single();
    expect(event).toEqual({ status: "draft", scope: "branch", branch_id: volunteer.branchId, created_by: manager.id, capacity: null });
    expect(await requestRow(id)).toMatchObject({ status: "approved", event_id: approved.data.event_id, notice: "approved", reviewer_id: manager.id });
    expect((await rpcAs(director.email, "approve_event_request", { p_id: id })).error).toBe("Request already decided");

    // Two reviewers at the same moment: the row lock lets exactly one create a draft.
    const race = await submitRequestAs(volunteer.email, title("race"));
    await Promise.all([clientAs(manager.email), clientAs(director.email)]);
    const results = await Promise.all([manager, director].map((u) => rpcAs<{ event_id: string }>(u.email, "approve_event_request", { p_id: race })));
    expect(results.filter((r) => r.error === null)).toHaveLength(1);
    expect(results.filter((r) => r.error === "Request already decided")).toHaveLength(1);
    const { count } = await adminClient().from("events").select("id", { count: "exact", head: true }).eq("title", (await requestRow(race))!.title);
    expect(count).toBe(1);
  });

  test("decline needs a reason; update and withdraw only while submitted; at most 5 open requests", async ({ freshUser }) => {
    const volunteer = await freshUser();
    const manager = await freshUser({ role: "branch_manager" });
    const declined = await submitRequestAs(volunteer.email, title("decline"));
    expect((await rpcAs(manager.email, "decline_event_request", { p_id: declined, p_reason: "" })).error).toBe("Decline reason is required");
    expect((await rpcAs(manager.email, "decline_event_request", { p_id: declined, p_reason: "too short" })).error).toBe("Decline reason is required");
    expect((await rpcAs(manager.email, "decline_event_request", { p_id: declined, p_reason: "The hall is booked that week." })).error).toBeNull();
    expect(await requestRow(declined)).toMatchObject({ status: "declined", notice: "declined", decline_reason: "The hall is booked that week." });

    const editable = await submitRequestAs(volunteer.email, title("edit"));
    expect((await rpcAs(volunteer.email, "update_event_request", { p_id: editable, p: requestInput(`${REQUEST_TITLE_PREFIX}renamed`) })).error).toBeNull();
    expect((await requestRow(editable))?.title).toBe(`${REQUEST_TITLE_PREFIX}renamed`);
    expect((await rpcAs(manager.email, "start_review_event_request", { p_id: editable })).error).toBeNull();
    expect((await rpcAs(volunteer.email, "update_event_request", { p_id: editable, p: requestInput(title("late edit")) })).error).toBe("Request can no longer be changed");
    expect((await rpcAs(volunteer.email, "withdraw_event_request", { p_id: editable })).error).toBe("Request can no longer be changed");
    expect((await rpcAs(volunteer.email, "withdraw_event_request", { p_id: declined })).error).toBe("Request can no longer be changed");

    // Open = submitted or under review: 1 under review + 4 more reaches the limit; withdrawing frees a slot.
    const more = [];
    for (let i = 0; i < 4; i++) more.push(await submitRequestAs(volunteer.email, title(`open ${i}`)));
    expect((await rpcAs(volunteer.email, "submit_event_request", { p: requestInput(title("sixth")) })).error).toBe("Too many open requests");
    expect((await rpcAs(volunteer.email, "withdraw_event_request", { p_id: more[0] })).error).toBeNull();
    expect((await rpcAs(volunteer.email, "submit_event_request", { p: requestInput(title("after withdraw")) })).error).toBeNull();
  });

  test("validation: past dates, end before start and non-https links are refused", async ({ freshUser }) => {
    const volunteer = await freshUser();
    const reject = async (extra: Record<string, unknown>) => (await rpcAs(volunteer.email, "submit_event_request", { p: requestInput(title("invalid"), extra) })).error;
    const past = new Date(Date.now() - 86400000).toISOString();
    expect(await reject({ proposed_start: past, proposed_end: new Date(Date.now() - 82800000).toISOString() })).toBe("Proposed date must be in the future");
    const start = requestInput("x").proposed_start;
    expect(await reject({ proposed_end: new Date(Date.parse(start) - 3600000).toISOString() })).toBe("Event end must be after start");
    expect(await reject({ is_online: true, online_url: "http://meet.example.org/abc" })).toBe("Online meeting link must use https");
    expect(await reject({ all_day: true, proposed_start_date: "2020-01-01" })).toBe("Proposed date must be in the future");
    expect(await reject({ title: "" })).toBe("Request title is required");
    expect(await reject({ title: "x".repeat(121) })).toBe("Invalid request values");
    expect(await reject({ alt_start: start })).toBe("Invalid request values");
  });

  test("RLS: no direct writes, no reading others' requests, no internal helpers, nothing for anon", async ({ freshUser }) => {
    const volunteer = await freshUser();
    const other = await freshUser();
    const id = await submitRequestAs(volunteer.email, title("rls"));
    const own = await clientAs(volunteer.email);
    const insert = await own.from("event_requests").insert({ scope: "branch", branch_id: volunteer.branchId, region_id: (await requestRow(id))!.region_id, title: "direct" });
    expect(insert.error?.message).toMatch(/permission denied/);
    const update = await own.from("event_requests").update({ status: "approved" }).eq("id", id).select("id");
    expect(update.error?.message ?? (update.data?.length === 0 ? "no rows" : "updated")).toMatch(/permission denied|no rows/);
    const del = await own.from("event_requests").delete().eq("id", id).select("id");
    expect(del.error?.message ?? (del.data?.length === 0 ? "no rows" : "deleted")).toMatch(/permission denied|no rows/);
    expect((await requestRow(id))?.status).toBe("submitted");
    expect(((await (await clientAs(other.email)).from("event_requests").select("id").eq("id", id)).data ?? [])).toEqual([]);
    expect((await rpcAs(other.email, "get_event_request", { p_id: id })).error).toBe("Request not found");
    for (const [fn, args] of [
      ["event_request_fields", { p: {} }], ["event_request_actor", {}], ["restore_event_request", { _id: id }],
      ["event_request_countable", { _scope: "branch", _branch: volunteer.branchId, _region: volunteer.branchId }],
      ["purge_expired_event_requests", {}], ["event_request_locked", { _id: id }],
    ] as const) {
      expect((await rpcAs(volunteer.email, fn, args)).error, fn).toMatch(/permission denied|Could not find the function/);
    }
    const anon = anonClient();
    for (const [fn, args] of [
      ["submit_event_request", { p: requestInput("anon") }], ["list_my_event_requests", {}], ["get_pending_event_request_count", {}],
      ["get_event_request", { p_id: id }], ["approve_event_request", { p_id: id }], ["list_managed_event_requests", {}],
    ] as const) {
      expect((await anon.rpc(fn, args)).error?.message, `anon ${fn}`).toMatch(/permission denied|Could not find the function/);
    }
    expect(((await anon.from("event_requests").select("id")).data ?? [])).toEqual([]);
  });

  test("Recycle Bin: requester deletes an open request, a manager restores and permanently deletes it", async ({ freshUser }) => {
    const volunteer = await freshUser();
    const manager = await freshUser({ role: "branch_manager" });
    const id = await submitRequestAs(volunteer.email, title("recycle"));
    expect((await rpcAs(volunteer.email, "delete_event_request", { p_id: id })).error).toBeNull();
    expect((await rpcAs<unknown[]>(volunteer.email, "list_my_event_requests")).data).toEqual([]);
    const bin = await rpcAs<{ id: string; type: string; can_restore: boolean }[]>(manager.email, "list_recycle_bin", { _type: "event_request", _search: REQUEST_TITLE_PREFIX, _offset: 0 });
    expect(bin.data.find((r) => r.id === id)).toMatchObject({ type: "event_request", can_restore: true });
    expect((await rpcAs(manager.email, "restore_item", { _type: "event_request", _id: id })).error).toBeNull();
    // Deleting the open request withdrew it; the restore brings it back withdrawn, never open.
    expect(await requestRow(id)).toMatchObject({ status: "withdrawn", deleted_at: null });
    expect((await rpcAs(manager.email, "delete_event_request", { p_id: id })).error).toBeNull();
    const purged = await rpcAs<{ deleted: boolean }>(manager.email, "permanent_delete_item", { _type: "event_request", _id: id, _confirmation: "DELETE" });
    expect(purged.data).toMatchObject({ deleted: true });
    expect(await requestRow(id)).toBeNull();
    // An approved request stays with the managers: its requester cannot delete it.
    const approved = await submitRequestAs(volunteer.email, title("approved keep"));
    expect((await rpcAs(manager.email, "approve_event_request", { p_id: approved })).error).toBeNull();
    expect((await rpcAs(volunteer.email, "delete_event_request", { p_id: approved })).error).toBe("Not allowed");
  });

  test("delete, new requests, restore: open requests come back withdrawn and the limit of 5 holds", async ({ freshUser }) => {
    const volunteer = await freshUser();
    const manager = await freshUser({ role: "branch_manager" });
    const old: string[] = [];
    for (let i = 0; i < 5; i++) old.push(await submitRequestAs(volunteer.email, title(`old ${i}`)));
    expect((await rpcAs(manager.email, "start_review_event_request", { p_id: old[0] })).error).toBeNull();
    for (const id of old) expect((await rpcAs(volunteer.email, "delete_event_request", { p_id: id })).error).toBeNull();
    for (const id of old) expect(await requestRow(id)).toMatchObject({ status: "withdrawn", notice: null });
    for (let i = 0; i < 5; i++) await submitRequestAs(volunteer.email, title(`new ${i}`));
    for (const id of old) expect((await rpcAs(manager.email, "restore_item", { _type: "event_request", _id: id })).error).toBeNull();
    for (const id of old) expect(await requestRow(id)).toMatchObject({ status: "withdrawn", deleted_at: null });
    const mine = (await rpcAs<{ status: string }[]>(volunteer.email, "list_my_event_requests")).data;
    expect(mine.filter((r) => r.status === "submitted" || r.status === "under_review")).toHaveLength(5);
    expect((await rpcAs(volunteer.email, "submit_event_request", { p: requestInput(title("sixth")) })).error).toBe("Too many open requests");
    // The formerly under-review request does not reappear in the reviewer's queue.
    const queue = await rpcAs<{ rows: { id: string }[] }>(manager.email, "list_managed_event_requests", { p_status: "under_review", p_offset: 0 });
    expect(queue.data.rows.map((r) => r.id)).not.toContain(old[0]);
  });

  test("user deletion withdraws open requests; the real purge chain keeps them with requester_id NULL", async ({ freshUser }) => {
    const volunteer = await freshUser();
    const manager = await freshUser({ role: "branch_manager" });
    const open = await submitRequestAs(volunteer.email, title("gdpr open"));
    const approved = await submitRequestAs(volunteer.email, title("gdpr approved"));
    expect((await rpcAs(manager.email, "approve_event_request", { p_id: approved })).error).toBeNull();
    try {
      expect((await rpcAs(manager.email, "set_user_status", { _target: volunteer.id, _status: "inactive" })).error).toBeNull();
      await softDeleteUser(manager.id, volunteer.id);
      expect(await requestRow(open)).toMatchObject({ status: "withdrawn", requester_id: volunteer.id });
      expect((await requestRow(approved))?.status).toBe("approved");
      // Recycle Bin purge, exactly as the server does it: prepare (manager RPC), Auth erasure, finish.
      expect((await rpcAs(manager.email, "permanent_delete_item", { _type: "user", _id: volunteer.id, _confirmation: "DELETE" })).error).toBeNull();
      expect((await adminClient().auth.admin.deleteUser(volunteer.id)).error).toBeNull();
      expect((await adminClient().rpc("finish_user_recycle_operation", { _id: volunteer.id, _operation: "purge" })).error).toBeNull();
      expect((await adminClient().from("profiles").select("id").eq("id", volunteer.id)).data).toEqual([]);
      expect(await requestRow(open)).toMatchObject({ status: "withdrawn", requester_id: null, notice: null });
      expect(await requestRow(approved)).toMatchObject({ status: "approved", requester_id: null });
      const managed = await rpcAs<{ rows: { id: string; requester_name: string | null }[] }>(manager.email, "list_managed_event_requests", { p_status: "decided", p_offset: 0 });
      expect(managed.data.rows.filter((r) => r.id === open || r.id === approved).map((r) => r.requester_name)).toEqual([null, null]);
    } finally {
      await deleteRequests([open, approved]);
    }
  });
});

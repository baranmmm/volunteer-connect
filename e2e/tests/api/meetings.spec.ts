// Meetings through PostgREST, the RPCs and Storage: only the creator, invitees and the scope's managers see a meeting
// (a non-invitee gets nothing, counts included); invitees read only; meeting requests; decision → task link; private
// files with signed URLs; followers nothing. Fresh users only; every check looks at this test's own ids.
import { test, expect, runId } from "../../fixtures/roles";
import { adminClient, clientAs } from "../../api/SupabaseClient";
import { MEETING_BUCKET, MEETING_TITLE_PREFIX, createMeetingAs, inDays, workRpc } from "../../api/work";

const title = (label: string) => `${MEETING_TITLE_PREFIX}${runId} ${label}`;
const PDF = Buffer.from("%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n");

test.describe("Meetings (database rules)", () => {
  test("only the creator, invitees and the scope's managers see a meeting; a non-invitee gets nothing, counts included", { tag: "@smoke" }, async ({ freshUser, freshBranch }) => {
    const branch = await freshBranch("meeting-visibility");
    const creator = await freshUser({ role: "volunteer", branch });
    const invitee = await freshUser({ role: "volunteer", branch });
    const colleague = await freshUser({ role: "volunteer", branch });
    const manager = await freshUser({ role: "branch_manager", branch });
    const director = await freshUser({ role: "regional_director" });
    const nc = await freshUser({ role: "national_coordinator" });
    const follower = await freshUser({ role: "follower", branch });
    const meeting = await createMeetingAs(creator, {
      scope: "branch", branch_id: branch, title: title("private"), starts_at: inDays(5), ends_at: inDays(5, 1), invitee_ids: [invitee.id],
    });
    const sees = async (who: { email: string; totpSecret?: string }) => {
      const list = ((await workRpc(who, "list_meetings", { p_when: "upcoming", p_limit: 500 })).data ?? []) as { id: string }[];
      const detail = (await workRpc(who, "get_meeting", { p_id: meeting })).data;
      const rows = who.totpSecret ? null : (await (await clientAs(who.email)).from("meetings").select("id").eq("id", meeting)).data;
      return { listed: list.some((m) => m.id === meeting), detail: detail !== null, rows: rows?.length ?? null };
    };
    expect(await sees(creator)).toEqual({ listed: true, detail: true, rows: 1 });
    expect(await sees(invitee)).toEqual({ listed: true, detail: true, rows: 1 });
    expect(await sees(manager)).toEqual({ listed: true, detail: true, rows: 1 });
    expect(await sees(director)).toEqual({ listed: true, detail: true, rows: 1 });
    expect(await sees(colleague)).toEqual({ listed: false, detail: false, rows: 0 });
    expect(await sees(follower)).toEqual({ listed: false, detail: false, rows: 0 });
    expect(await sees(nc)).toEqual({ listed: false, detail: false, rows: null });
    // Nothing leaks through the child tables or counts either.
    const asColleague = await clientAs(colleague.email);
    for (const table of ["meeting_invitees", "meeting_agenda_items", "meeting_decisions", "meeting_files"] as const)
      expect((await asColleague.from(table).select("meeting_id").eq("meeting_id", meeting)).data, table).toEqual([]);
    expect((await asColleague.from("meetings").select("id", { count: "exact", head: true }).eq("id", meeting)).count).toBe(0);
    // Invitees read only.
    expect((await workRpc(invitee, "add_agenda_item", { p_meeting: meeting, p_title: "Item" })).error?.message).toBe("Not allowed");
    expect((await workRpc(invitee, "update_meeting", { p_id: meeting, p: { title: title("x") } })).error?.message).toBe("Not allowed");
    expect((await workRpc(follower, "create_meeting", { p: { scope: "branch", branch_id: branch, title: title("x"), starts_at: inDays(5), ends_at: inDays(5, 1), location_type: "in_person", location: "Hall" } })).error?.message).toBe("Not allowed");
  });

  test("National Coordinators invite only RDs, BMs and NCs; invitees hear about time changes and cancellation", async ({ freshUser, seed }) => {
    const nc = await freshUser({ role: "national_coordinator" });
    const manager = await freshUser({ role: "branch_manager" });
    const volunteer = await freshUser({ role: "volunteer" });
    const spec = { scope: "national" as const, title: title("national"), starts_at: inDays(6), ends_at: inDays(6, 1) };
    expect((await workRpc(nc, "create_meeting", { p: { ...spec, location_type: "in_person", location: "Hall", invitee_ids: [volunteer.id] } })).error?.message).toBe("Invitee is not in this scope");
    const people = (await workRpc(nc, "list_meeting_people", { p_scope: "national" })).data as { id: string; role: string }[];
    expect(people.some((p) => p.id === volunteer.id || p.role === "volunteer")).toBe(false);
    const meeting = await createMeetingAs(nc, { ...spec, invitee_ids: [manager.id] });
    expect((await workRpc(nc, "update_meeting", { p_id: meeting, p: { location_type: "online", online_url: "http://insecure.example.org" } })).error?.message).toBe("Online link must start with https://");
    expect((await workRpc(nc, "update_meeting", { p_id: meeting, p: { starts_at: inDays(7), ends_at: inDays(7, 1) } })).error).toBeNull();
    expect((await workRpc(nc, "set_meeting_status", { p_id: meeting, p_status: "cancelled" })).error).toBeNull();
    const kinds = ((await adminClient().from("notifications").select("kind").eq("user_id", manager.id).eq("entity_id", meeting).order("created_at")).data ?? []).map((n) => n.kind);
    expect(kinds).toEqual(["meeting_invited", "meeting_changed", "meeting_cancelled"]);
    void seed;
  });

  test("a meeting request approved becomes a meeting owned by the target with the requester invited; a decision becomes a linked task", async ({ freshUser, freshBranch }) => {
    const branch = await freshBranch("meeting-request");
    const manager = await freshUser({ role: "branch_manager", branch });
    const volunteer = await freshUser({ role: "volunteer", branch });
    const request = (await workRpc(volunteer, "submit_meeting_request", {
      p: { target_id: manager.id, topic: title("talk"), note: "About the iftar", proposed_times: [{ starts_at: inDays(8), ends_at: inDays(8, 1) }] },
    })).data as string;
    const declinedRequest = (await workRpc(volunteer, "submit_meeting_request", { p: { target_id: manager.id, topic: title("another"), proposed_times: [] } })).data as string;
    const meeting = (await workRpc(manager, "approve_meeting_request", {
      p_id: request, p_meeting: { title: title("talk"), starts_at: inDays(8), ends_at: inDays(8, 1), location_type: "online", online_url: "https://meet.example.org/e2e" },
    })).data as string;
    const detail = (await workRpc(volunteer, "get_meeting", { p_id: meeting })).data as { created_by: string; invitees: { id: string }[]; scope: string };
    expect([detail.created_by, detail.invitees.map((i) => i.id), detail.scope]).toEqual([manager.id, [volunteer.id], "branch"]);
    expect((await workRpc(manager, "decline_meeting_request", { p_id: declinedRequest, p_reason: "Let us talk at the next team meeting." })).error).toBeNull();
    const mine = (await workRpc(volunteer, "list_my_meeting_requests")).data as { id: string; status: string; meeting_id: string | null }[];
    expect(mine.find((r) => r.id === request)).toMatchObject({ status: "approved", meeting_id: meeting });
    expect(mine.find((r) => r.id === declinedRequest)).toMatchObject({ status: "declined" });

    const item = (await workRpc(manager, "add_agenda_item", { p_meeting: meeting, p_title: "Iftar" })).data as string;
    const decision = (await workRpc(manager, "add_meeting_decision", { p_item: item, p_text: "Book the hall" })).data as string;
    const task = (await workRpc(manager, "create_task", { p: { scope: "branch", branch_id: branch, title: `E2E Task ${runId} hall`, decision_id: decision, assignee_ids: [volunteer.id] } })).data as string;
    const withTask = (await workRpc(volunteer, "get_meeting", { p_id: meeting })).data as { agenda: { decisions: { tasks: { id: string; status: string }[] }[] }[] };
    expect(withTask.agenda[0]!.decisions[0]!.tasks).toEqual([expect.objectContaining({ id: task, status: "todo" })]);
    expect(((await workRpc(volunteer, "get_task", { p_id: task })).data as { meeting_id: string }).meeting_id).toBe(meeting);
  });

  test("files: editors upload to a reserved slot; invitees download through a signed URL; others cannot", async ({ freshUser, freshBranch }) => {
    const branch = await freshBranch("meeting-files");
    const manager = await freshUser({ role: "branch_manager", branch });
    const invitee = await freshUser({ role: "volunteer", branch });
    const outsider = await freshUser({ role: "volunteer", branch });
    const meeting = await createMeetingAs(manager, { scope: "branch", branch_id: branch, title: title("files"), starts_at: inDays(9), ends_at: inDays(9, 1), invitee_ids: [invitee.id] });
    expect((await workRpc(invitee, "add_meeting_file", { p_meeting: meeting, p_extension: "pdf", p_original_name: "x.pdf" })).error?.message).toBe("Not allowed");
    const slot = (await workRpc(manager, "add_meeting_file", { p_meeting: meeting, p_extension: "pdf", p_original_name: "Minutes.pdf" })).data as { id: string; storage_path: string };
    const asManager = await clientAs(manager.email);
    // Only reserved paths can be written.
    expect((await asManager.storage.from(MEETING_BUCKET).upload(`${meeting}/not-reserved.pdf`, PDF, { contentType: "application/pdf" })).error).not.toBeNull();
    expect((await asManager.storage.from(MEETING_BUCKET).upload(slot.storage_path, PDF, { contentType: "application/pdf" })).error).toBeNull();
    const asInvitee = await clientAs(invitee.email);
    const signed = await asInvitee.storage.from(MEETING_BUCKET).createSignedUrl(slot.storage_path, 300);
    expect(signed.error).toBeNull();
    const response = await fetch(signed.data!.signedUrl);
    expect(response.status).toBe(200);
    expect(Buffer.from(await response.arrayBuffer()).subarray(0, 8).toString()).toBe("%PDF-1.4");
    const asOutsider = await clientAs(outsider.email);
    expect((await asOutsider.storage.from(MEETING_BUCKET).createSignedUrl(slot.storage_path, 300)).error).not.toBeNull();
    expect((await asOutsider.storage.from(MEETING_BUCKET).download(slot.storage_path)).error).not.toBeNull();
    // Removing: the row only after the stored object is gone.
    expect((await workRpc(manager, "delete_meeting_file", { p_id: slot.id })).error?.message).toBe("Remove stored file first");
    expect((await asManager.storage.from(MEETING_BUCKET).remove([slot.storage_path])).error).toBeNull();
    expect((await workRpc(manager, "delete_meeting_file", { p_id: slot.id })).error).toBeNull();
  });
});

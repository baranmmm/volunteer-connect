// Meetings through PostgREST, the RPCs and Storage: only the creator, invitees and the scope's managers see a meeting
// (a non-invitee gets nothing, counts included); invitees read only; meeting requests; decision → task link; private
// files with signed URLs; followers nothing; every meeting's calendar entry; recurring meetings (series edits, "from last
// meeting", series tasks). Fresh users only; every check looks at this test's own ids.
import { test, expect, runId } from "../../fixtures/roles";
import { adminClient, anonClient, clientAs } from "../../api/SupabaseClient";
import { MEETING_BUCKET, MEETING_TITLE_PREFIX, createMeetingAs, createMeetingSeriesAs, inDays, meetingOccurrences, workRpc } from "../../api/work";

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

  test("recurring weekly × 3: three meetings, each with its own members-only calendar entry seen by invitees only, never public", async ({ freshUser, freshBranch }) => {
    const branch = await freshBranch("meeting-series");
    const manager = await freshUser({ role: "branch_manager", branch });
    const invitee = await freshUser({ role: "volunteer", branch });
    const colleague = await freshUser({ role: "volunteer", branch });
    const first = await createMeetingSeriesAs(manager, {
      scope: "branch", branch_id: branch, title: title("weekly"), starts_at: inDays(5), ends_at: inDays(5, 1), invitee_ids: [invitee.id],
      recurrence: { freq: "weekly", interval: 1, count: 3 }, agenda: ["Finance"],
    });
    const occurrences = await meetingOccurrences(first);
    expect(occurrences.map((o) => o.series_position)).toEqual([1, 2, 3]);
    expect(occurrences[0]!.id).toBe(first);
    expect(Date.parse(occurrences[2]!.starts_at) - Date.parse(occurrences[0]!.starts_at)).toBeGreaterThanOrEqual(14 * 86400000 - 3600000);
    const eventIds = occurrences.map((o) => o.event_id);
    expect(new Set(eventIds).size).toBe(3);
    const events = await adminClient().from("events").select("id, category, audience, registration_enabled").in("id", eventIds);
    expect(events.data!.map((e) => [e.category, e.audience, e.registration_enabled])).toEqual(Array(3).fill(["meeting", "members", false]));
    // Invitees see every occurrence's calendar entry; a colleague who is not invited sees none.
    const visible = async (email: string) => ((await (await clientAs(email)).from("events").select("id").in("id", eventIds)).data ?? []).length;
    expect(await visible(invitee.email)).toBe(3);
    expect(await visible(colleague.email)).toBe(0);
    const detail = (await workRpc(invitee, "get_meeting", { p_id: occurrences[1]!.id })).data as {
      event_id: string; series_position: number; series_count: number; agenda: { title: string; standing: boolean }[];
      series: { previous_id: string; next_id: string; agenda_template: string[] }; invitees: { id: string }[];
    };
    expect(detail).toMatchObject({ event_id: eventIds[1], series_position: 2, series_count: 3 });
    expect(detail.series).toMatchObject({ previous_id: occurrences[0]!.id, next_id: occurrences[2]!.id, agenda_template: ["Finance"] });
    expect(detail.agenda.map((a) => [a.title, a.standing])).toEqual([["Finance", true]]);
    expect(detail.invitees.map((i) => i.id)).toEqual([invitee.id]);
    // Invitees were told once, about the first meeting.
    const notices = await adminClient().from("notifications").select("entity_id").eq("user_id", invitee.id).eq("kind", "meeting_invited");
    expect((notices.data ?? []).map((n) => n.entity_id)).toEqual([first]);
    // Never public: not listed, not readable by id.
    const anon = anonClient();
    const listed = ((await anon.rpc("get_public_events")).data ?? []) as { id: string }[];
    expect(listed.some((e) => eventIds.includes(e.id))).toBe(false);
    for (const id of eventIds) expect((await anon.rpc("get_public_event", { p_id: id })).data).toBeNull();
    // Out of range repeat settings are refused.
    expect((await workRpc(manager, "create_meeting", { p: { scope: "branch", branch_id: branch, title: title("too long"), starts_at: inDays(5), ends_at: inDays(5, 1), location_type: "in_person", location: "Hall", recurrence: { freq: "monthly", interval: 1, count: 14 } } })).error?.message).toBe("A recurring meeting can span at most 12 months");
  });

  test("series: edit this and following, from last meeting (unresolved items, open tasks), series tasks, delete following", async ({ freshUser, freshBranch }) => {
    const branch = await freshBranch("meeting-series-edit");
    const manager = await freshUser({ role: "branch_manager", branch });
    const volunteer = await freshUser({ role: "volunteer", branch });
    const first = await createMeetingSeriesAs(manager, {
      scope: "branch", branch_id: branch, title: title("series"), starts_at: inDays(5), ends_at: inDays(5, 1), invitee_ids: [volunteer.id],
      recurrence: { freq: "weekly", interval: 1, count: 4 },
    });
    const [o1, o2, o3, o4] = await meetingOccurrences(first);
    // Agenda of the first meeting: one item resolved, one left open with a decision → open task.
    const done = (await workRpc(manager, "add_agenda_item", { p_meeting: o1!.id, p_title: "Done item" })).data as string;
    const open = (await workRpc(manager, "add_agenda_item", { p_meeting: o1!.id, p_title: "Open item" })).data as string;
    expect((await workRpc(manager, "set_agenda_item_resolved", { p_id: done, p_resolved: true })).error).toBeNull();
    expect((await workRpc(volunteer, "set_agenda_item_resolved", { p_id: open, p_resolved: true })).error?.message).toBe("Not allowed");
    const decision = (await workRpc(manager, "add_meeting_decision", { p_item: open, p_text: "Ask the council" })).data as string;
    const task = (await workRpc(manager, "create_task", { p: { scope: "branch", branch_id: branch, title: `E2E Task ${runId} council`, decision_id: decision, assignee_ids: [volunteer.id] } })).data as string;
    type Detail = { from_last: { meeting_id: string; items: { id: string }[]; tasks: { id: string; status: string }[] } | null };
    const second = (await workRpc(volunteer, "get_meeting", { p_id: o2!.id })).data as Detail;
    expect(second.from_last).toMatchObject({ meeting_id: o1!.id, items: [{ id: open }], tasks: [{ id: task, status: "todo" }] });
    expect(((await workRpc(volunteer, "get_meeting", { p_id: o1!.id })).data as Detail).from_last).toBeNull();
    const seriesTasks = (await workRpc(volunteer, "get_meeting_series_tasks", { p_id: o3!.id })).data as { id: string; meeting_id: string }[];
    expect(seriesTasks).toEqual([expect.objectContaining({ id: task, meeting_id: o1!.id })]);

    // Edit "this and following" from the third: the third and fourth change and move by the same amount.
    const moved = await workRpc(manager, "update_meeting_series", {
      p_id: o3!.id, p_mode: "following",
      p: { title: title("series moved"), starts_at: new Date(Date.parse(o3!.starts_at) + 3600000).toISOString(), ends_at: new Date(Date.parse(o3!.starts_at) + 7200000).toISOString(), location_type: "online", online_url: "https://meet.example.org/e2e-series", invitee_ids: [volunteer.id] },
    });
    expect([moved.error, moved.data]).toEqual([null, 2]);
    const after = await meetingOccurrences(first);
    expect(after.map((o) => o.title)).toEqual([title("series"), title("series"), title("series moved"), title("series moved")]);
    expect(Date.parse(after[3]!.starts_at) - Date.parse(o4!.starts_at)).toBe(3600000);
    expect(after[1]!.starts_at).toBe(o2!.starts_at);
    // The calendar entries follow their meetings.
    const entries = await adminClient().from("events").select("id, title, location_type").in("id", [o2!.event_id, o4!.event_id]);
    expect(Object.fromEntries(entries.data!.map((e) => [e.id, [e.title, e.location_type]]))).toEqual({
      [o2!.event_id]: [title("series"), "in_person"],
      [o4!.event_id]: [title("series moved"), "online"],
    });

    // Delete "this and following" from the third: two go to the Recycle Bin, the first two stay.
    expect((await workRpc(volunteer, "delete_meeting_series", { p_id: o3!.id, p_mode: "following" })).error?.message).toBe("Not allowed");
    const removed = await workRpc(manager, "delete_meeting_series", { p_id: o3!.id, p_mode: "following" });
    expect([removed.error, removed.data]).toEqual([null, 2]);
    expect((await meetingOccurrences(first)).map((o) => o.id)).toEqual([o1!.id, o2!.id]);
    expect((await (await clientAs(volunteer.email)).from("events").select("id").in("id", [o3!.event_id, o4!.event_id])).data).toEqual([]);
  });
});

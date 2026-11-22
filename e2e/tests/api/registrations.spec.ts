// A2b event registrations through the RPCs with each user's own token: RLS and the SECURITY DEFINER checks are
// the real enforcement. Fresh users and events only; everything is removed after each test.
import { test, expect } from "../../fixtures/roles";
import { adminClient, anonClient, clientAs } from "../../api/SupabaseClient";
import { londonIso, occurrencesOf } from "../../api/events";
import { cancelRegistrationAs, registerAs, registrationOf, registrationsOf, summaryAs } from "../../api/registrations";

/** update_event as `email` with the event's current values plus `patch` (e.g. a new capacity). */
async function updateEventAs(email: string, eventId: string, patch: Record<string, unknown>) {
  const { data: e, error } = await adminClient().from("events").select("*").eq("id", eventId).single();
  if (error) throw new Error(error.message);
  const data = { title: e.title, description: e.description, location: e.location, location_type: e.location_type, online_url: e.online_url, organizer: e.organizer, category: e.category, all_day: e.all_day, start_date: e.start_date, end_date: e.end_date, start_at: e.start_at, end_at: e.end_at, capacity: e.capacity, registration_enabled: e.registration_enabled, scope: e.scope, branch_id: e.branch_id, status: e.status, ...patch };
  const result = await (await clientAs(email)).rpc("update_event", { _event: eventId, _data: data });
  if (result.error) throw new Error(`update_event: ${result.error.message}`);
}
const errorOf = async (p: PromiseLike<{ error: { message: string } | null }>) => (await p).error?.message ?? null;

test.describe("Event registrations API", () => {
  test("register is idempotent; cancel and register again reuse the same row", async ({ freshUser, freshEvent }) => {
    const manager = await freshUser({ role: "branch_manager" });
    const volunteer = await freshUser();
    const event = await freshEvent(manager, { label: "reg basic", status: "published", startInMinutes: 3 * 24 * 60 });
    const first = await registerAs(volunteer.email, event.id);
    expect(first).toMatchObject({ status: "registered", waitlist_position: null });
    expect((await registerAs(volunteer.email, event.id)).registration_id).toBe(first.registration_id);
    expect((await cancelRegistrationAs(volunteer.email, event.id)).status).toBe("cancelled");
    const again = await registerAs(volunteer.email, event.id);
    expect(again).toMatchObject({ registration_id: first.registration_id, status: "registered" });
    expect(await registrationsOf(event.id)).toHaveLength(1);
  });

  test("full event: waitlist, then FIFO promotion with a 'promoted' notice when a seat frees up", async ({ freshUser, freshEvent }) => {
    const manager = await freshUser({ role: "branch_manager" });
    const [a, b, c] = [await freshUser(), await freshUser(), await freshUser()];
    const event = await freshEvent(manager, { label: "reg waitlist", status: "published", startInMinutes: 3 * 24 * 60, capacity: 1 });
    await registerAs(a!.email, event.id);
    expect(await registerAs(b!.email, event.id)).toMatchObject({ status: "waitlisted", waitlist_position: 1 });
    expect(await registerAs(c!.email, event.id)).toMatchObject({ status: "waitlisted", waitlist_position: 2 });
    expect(await summaryAs(b!.email, event.id)).toMatchObject({ registered_count: 1, waitlisted_count: 2, spots_left: 0, my_waitlist_position: 1 });
    await cancelRegistrationAs(a!.email, event.id);
    expect(await registrationOf(event.id, b!.id)).toMatchObject({ status: "registered", notice: "promoted" });
    expect(await registrationOf(event.id, c!.id)).toMatchObject({ status: "waitlisted", notice: null });
    expect((await summaryAs(c!.email, event.id)).my_waitlist_position).toBe(1);
  });

  test("two volunteers racing for the last seat: exactly one is registered", async ({ freshUser, freshEvent }) => {
    const manager = await freshUser({ role: "branch_manager" });
    const [a, b] = [await freshUser(), await freshUser()];
    const event = await freshEvent(manager, { label: "reg race", status: "published", startInMinutes: 3 * 24 * 60, capacity: 1 });
    // Sign both in first so the two RPCs leave at the same moment.
    await Promise.all([clientAs(a!.email), clientAs(b!.email)]);
    const results = await Promise.all([registerAs(a!.email, event.id), registerAs(b!.email, event.id)]);
    expect(results.map((r) => r.status).sort()).toEqual(["registered", "waitlisted"]);
    expect((await registrationsOf(event.id)).filter((r) => r.status === "registered")).toHaveLength(1);
  });

  test("more capacity promotes the waitlist; less capacity removes nobody and new registrations wait", async ({ freshUser, freshEvent }) => {
    const manager = await freshUser({ role: "branch_manager" });
    const [a, b, c, d] = [await freshUser(), await freshUser(), await freshUser(), await freshUser()];
    const event = await freshEvent(manager, { label: "reg capacity", status: "published", startInMinutes: 3 * 24 * 60, capacity: 1 });
    for (const u of [a, b, c]) await registerAs(u!.email, event.id);
    await updateEventAs(manager.email, event.id, { capacity: 3 });
    expect((await registrationsOf(event.id)).map((r) => r.status)).toEqual(["registered", "registered", "registered"]);
    await updateEventAs(manager.email, event.id, { capacity: 1 });
    expect((await registrationsOf(event.id)).filter((r) => r.status === "registered")).toHaveLength(3);
    expect((await registerAs(d!.email, event.id)).status).toBe("waitlisted");
    expect((await summaryAs(manager.email, event.id)).over_capacity).toBe(true);
  });

  test("RLS: no direct writes, own rows only, manager list and attendance for own branch only, nothing for anon", async ({ freshUser, freshEvent }) => {
    const manager = await freshUser({ role: "branch_manager" });
    const otherManager = await freshUser({ role: "branch_manager", branch: "Brighton" });
    const [a, b] = [await freshUser(), await freshUser()];
    const event = await freshEvent(manager, { label: "reg rls", status: "published", startInMinutes: -10, durationMinutes: 120 });
    const mine = await registerAs(a!.email, event.id);
    await registerAs(b!.email, event.id);

    const asA = await clientAs(a!.email);
    const own = await asA.from("event_registrations").select("user_id").eq("event_id", event.id);
    expect(own.data).toEqual([{ user_id: a!.id }]);
    expect(await errorOf(asA.from("event_registrations").insert({ event_id: event.id, user_id: a!.id, status: "registered" }))).toMatch(/permission denied/);
    const upd = await asA.from("event_registrations").update({ status: "attended" }).eq("event_id", event.id).select();
    expect(upd.error?.message ?? (upd.data?.length === 0 ? "no rows" : "updated")).toMatch(/permission denied|no rows/);
    const del = await asA.from("event_registrations").delete().eq("event_id", event.id).select();
    expect(del.error?.message ?? (del.data?.length === 0 ? "no rows" : "deleted")).toMatch(/permission denied|no rows/);
    expect(await errorOf(asA.rpc("get_event_registrations", { p_event_id: event.id }))).toMatch(/Not allowed/);
    expect(await errorOf(asA.rpc("mark_attendance", { p_registration_id: mine.registration_id, p_status: "attended" }))).toMatch(/Not allowed/);

    const asOther = await clientAs(otherManager.email);
    expect(await errorOf(asOther.rpc("get_event_registrations", { p_event_id: event.id }))).toMatch(/Not allowed/);
    expect((await asOther.from("event_registrations").select("id").eq("event_id", event.id)).data).toEqual([]);
    expect(await errorOf(asOther.rpc("mark_attendance", { p_registration_id: mine.registration_id, p_status: "attended" }))).toMatch(/Not allowed/);

    const asManager = await clientAs(manager.email);
    const list = await asManager.rpc("get_event_registrations", { p_event_id: event.id });
    expect(list.error).toBeNull();
    expect((list.data as { email: string }[]).map((r) => r.email).sort()).toEqual([a!.email, b!.email].sort());
    expect(Object.keys((list.data as Record<string, unknown>[])[0]!)).not.toContain("phone");
    expect(await errorOf(asManager.rpc("mark_attendance", { p_registration_id: mine.registration_id, p_status: "attended" }))).toBeNull();
    expect(await registrationOf(event.id, a!.id)).toMatchObject({ status: "attended" });

    const anon = anonClient();
    for (const [fn, args] of [
      ["register_for_event", { p_event_id: event.id }], ["cancel_registration", { p_event_id: event.id }], ["get_event_registration_summary", { p_event_id: event.id }],
      ["get_event_registrations", { p_event_id: event.id }], ["mark_attendance", { p_registration_id: mine.registration_id, p_status: "attended" }],
      ["set_registration_show_name", { p_event_id: event.id, p_show_name: true }], ["dismiss_registration_notice", { p_registration_id: mine.registration_id }], ["get_my_registrations", {}],
    ] as const) expect(await errorOf(anon.rpc(fn, args)), fn).not.toBeNull();
    expect(((await anon.from("event_registrations").select("id")).data ?? [])).toEqual([]);
  });

  test("registration is refused for draft, cancelled, closed, deleted and ended events", async ({ freshUser, freshEvent }) => {
    test.setTimeout(120_000); // waits for a published event to end (published events cannot be created in the past)
    const manager = await freshUser({ role: "branch_manager" });
    const volunteer = await freshUser();
    const day = 3 * 24 * 60;
    const draft = await freshEvent(manager, { label: "reg draft", status: "draft", startInMinutes: day });
    const cancelled = await freshEvent(manager, { label: "reg cancelled", status: "published", startInMinutes: day, cancelled: true });
    const closed = await freshEvent(manager, { label: "reg closed", status: "published", startInMinutes: day, registrationEnabled: false });
    const deleted = await freshEvent(manager, { label: "reg deleted", status: "published", startInMinutes: day });
    const ending = await freshEvent(manager, { label: "reg ending", status: "published", startInMinutes: -60, durationMinutes: 61 });
    const asManager = await clientAs(manager.email);
    expect(await errorOf(asManager.rpc("delete_event", { _event: deleted.id }))).toBeNull();
    const as = await clientAs(volunteer.email);
    const reason = (id: string) => errorOf(as.rpc("register_for_event", { p_event_id: id }));
    expect(await reason(draft.id)).toMatch(/Not allowed/); // volunteers cannot see drafts at all
    expect(await reason(cancelled.id)).toMatch(/Registration is closed/);
    expect(await reason(closed.id)).toMatch(/Registration is closed/);
    expect(await reason(deleted.id)).toMatch(/Not allowed/);
    // Registration stays open until the end, so only try once the end has passed (an earlier try would register).
    const { data: timing } = await adminClient().from("events").select("end_at").eq("id", ending.id).single();
    const endsAt = Date.parse(timing!.end_at!);
    await expect.poll(() => Date.now(), { timeout: 90_000, intervals: [2_000] }).toBeGreaterThan(endsAt + 2_000);
    expect(await reason(ending.id)).toMatch(/Event has ended/);
    expect(await registrationsOf(ending.id)).toEqual([]);
    expect(await registrationsOf(cancelled.id)).toEqual([]);
  });

  test("cancel, Recycle Bin and restore: rows kept, notices set and cleared, hidden while deleted", async ({ freshUser, freshEvent }) => {
    const manager = await freshUser({ role: "branch_manager" });
    const volunteer = await freshUser();
    const event = await freshEvent(manager, { label: "reg lifecycle", status: "published", startInMinutes: 3 * 24 * 60 });
    const toCancel = await freshEvent(manager, { label: "reg to cancel", status: "published", startInMinutes: 3 * 24 * 60 });
    await registerAs(volunteer.email, event.id);
    await registerAs(volunteer.email, toCancel.id);
    const asManager = await clientAs(manager.email);
    expect(await errorOf(asManager.rpc("cancel_event", { _event: toCancel.id }))).toBeNull();
    expect(await registrationOf(toCancel.id, volunteer.id)).toMatchObject({ status: "registered", notice: "event_cancelled" });

    expect(await errorOf(asManager.rpc("delete_event", { _event: event.id }))).toBeNull();
    expect(await errorOf(asManager.rpc("delete_event", { _event: event.id, _complete: true }))).toBeNull();
    expect(await registrationOf(event.id, volunteer.id)).toMatchObject({ status: "registered", notice: "event_removed" });
    const as = await clientAs(volunteer.email);
    expect((await as.from("event_registrations").select("id").eq("event_id", event.id)).data).toEqual([]);
    const mine = (await as.rpc("get_my_registrations")).data as { event_id: string; notice: string | null; event_removed: boolean }[];
    expect(mine.find((m) => m.event_id === event.id)).toMatchObject({ notice: "event_removed", event_removed: true });

    expect(await errorOf(asManager.rpc("restore_event", { _event: event.id }))).toBeNull();
    expect(await errorOf(asManager.rpc("restore_event", { _event: event.id, _finalize: true }))).toBeNull();
    expect(await registrationOf(event.id, volunteer.id)).toMatchObject({ status: "registered", notice: null });
    expect((await as.from("event_registrations").select("id").eq("event_id", event.id)).data).toHaveLength(1);
  });

  test("deleting a user frees their seat and promotes the waitlist; restoring them does not re-register", async ({ freshUser, freshEvent }) => {
    const manager = await freshUser({ role: "branch_manager" });
    const [leaving, waiting] = [await freshUser(), await freshUser()];
    const event = await freshEvent(manager, { label: "reg user delete", status: "published", startInMinutes: 3 * 24 * 60, capacity: 1 });
    await registerAs(leaving!.email, event.id);
    await registerAs(waiting!.email, event.id);
    const asManager = await clientAs(manager.email);
    expect(await errorOf(asManager.rpc("set_user_status", { _target: leaving!.id, _status: "inactive" }))).toBeNull();
    // The deleteUser server function authorises with the service role; same RPC here.
    const audit = await adminClient().rpc("authorize_user_deletion", { _actor: manager.id, _target: leaving!.id });
    expect(audit.error).toBeNull();
    expect(await registrationOf(event.id, leaving!.id)).toMatchObject({ status: "cancelled" });
    expect(await registrationOf(event.id, waiting!.id)).toMatchObject({ status: "registered", notice: "promoted" });
    // Leave the deletion state clean for the fixture teardown.
    await adminClient().from("user_deletion_state").delete().eq("target_id", leaving!.id);
    await adminClient().from("profiles").update({ deleted_at: null, deleted_by: null }).eq("id", leaving!.id);
    expect(await registrationOf(event.id, leaving!.id)).toMatchObject({ status: "cancelled" });
  });

  test("recurring: a registered occurrence survives 'all' and 'following' edits with the same id, as an exception", async ({ freshUser, freshSeries }) => {
    const manager = await freshUser({ role: "branch_manager" });
    const [a, b] = [await freshUser(), await freshUser()];
    const series = await freshSeries(manager, { label: "reg series", startLocal: "2027-02-02T18:00", rule: "FREQ=WEEKLY;BYDAY=TU;COUNT=6" });
    const before = await occurrencesOf(series.mediaEventId);
    await registerAs(a!.email, before[1]!.id);
    const asManager = await clientAs(manager.email);
    const data = (local: string, title = series.title) => ({ title, description: "", location: "E2E Community Hall", location_type: "in_person", online_url: null, organizer: "E2E", category: "dialogue", all_day: false, start_date: null, end_date: null, start_at: londonIso(local), end_at: new Date(Date.parse(londonIso(local)) + 90 * 60_000).toISOString(), capacity: null, registration_enabled: true, scope: "branch", branch_id: manager.branchId, status: "published" });

    expect(await errorOf(asManager.rpc("update_series_event", { _event: before[0]!.id, _mode: "all", _data: data("2027-02-02T19:00") }))).toBeNull();
    const afterAll = await occurrencesOf(series.mediaEventId);
    const kept = afterAll.find((o) => o.id === before[1]!.id);
    expect(kept, "registered occurrence keeps its id").toMatchObject({ exception: true, londonStart: "Tue, 2027-02-09, 19:00" });
    expect(afterAll.filter((o) => o.id !== before[1]!.id).every((o) => !before.some((x) => x.id === o.id) && !o.exception && o.londonStart.endsWith("19:00"))).toBe(true);
    expect(await registrationOf(before[1]!.id, a!.id)).toMatchObject({ status: "registered", notice: "event_changed" });

    // A regenerated (non-exception) occurrence with a registration, then 'following' from the week before it.
    const week5 = afterAll.find((o) => o.londonStart.startsWith("Tue, 2027-03-02"))!;
    await registerAs(b!.email, week5.id);
    const fromWeek4 = afterAll.find((o) => o.londonStart.startsWith("Tue, 2027-02-23"))!;
    expect(await errorOf(asManager.rpc("update_series_event", { _event: fromWeek4.id, _mode: "following", _data: data("2027-02-23T20:00", `${series.title} later`) }))).toBeNull();
    const afterFollowing = await occurrencesOf(series.mediaEventId);
    expect(afterFollowing.find((o) => o.id === week5.id), "registered week 5 keeps its id").toMatchObject({ exception: true, londonStart: "Tue, 2027-03-02, 20:00" });
    expect(afterFollowing.filter((o) => o.londonStart >= "Tue, 2027-02-23").map((o) => o.londonStart)).toEqual(["Tue, 2027-02-23, 20:00", "Tue, 2027-03-02, 20:00", "Tue, 2027-03-09, 20:00"]);
    expect(afterFollowing.find((o) => o.id === before[1]!.id)).toMatchObject({ exception: true, londonStart: "Tue, 2027-02-09, 19:00" });
    expect(await registrationOf(week5.id, b!.id)).toMatchObject({ status: "registered", notice: "event_changed" });
  });
});

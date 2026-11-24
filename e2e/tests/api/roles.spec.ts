// Roles through PostgREST and the RPCs (the database is the enforcement): followers, anonymous visitors, volunteer
// applications, National Coordinators (aal1 vs aal2, counts only, last-NC protection) and the privacy notice 1.1.
import { test, expect, runId } from "../../fixtures/roles";
import { adminClient, anonClient, clientAs, clientAsAal2, getRoles } from "../../api/SupabaseClient";
import { createNationalEventAdmin, deleteEvents } from "../../api/events";
import { requestInput, rpcAs } from "../../api/eventRequests";

const PUBLIC_FIELDS = ["all_day", "branch", "branch_id", "category", "description", "end_at", "end_date", "has_image", "id", "is_online",
  "location", "location_tba", "map", "max_places", "organizer", "past_record", "region", "region_id", "registration", "scope", "spots_left",
  "start_at", "start_date", "status", "title"];

test.describe("Followers", () => {
  test("see only public published events, register only for those, never names or other people's data", { tag: "@smoke" }, async ({ freshUser, freshEvent }) => {
    const manager = await freshUser({ role: "branch_manager" });
    const follower = await freshUser({ role: "follower" });
    const members = await freshEvent(manager, { label: "members", status: "published", startInMinutes: 3 * 24 * 60 });
    const open = await freshEvent(manager, { label: "public", status: "published", startInMinutes: 3 * 24 * 60, audience: "public" });
    const draft = await freshEvent(manager, { label: "public draft", status: "draft", audience: "public" });
    const asFollower = await clientAs(follower.email);
    const { data: visible } = await asFollower.from("events").select("id").in("id", [members.id, open.id, draft.id]);
    expect(visible).toEqual([{ id: open.id }]);
    expect((await rpcAs(follower.email, "register_for_event", { p_event_id: members.id })).error).toMatch(/Not allowed/);
    expect((await rpcAs(follower.email, "register_for_event", { p_event_id: open.id })).error).toBeNull();
    expect((await rpcAs(follower.email, "get_event_registration_summary", { p_event_id: open.id })).data).toMatchObject({ names_visible: false, names: [] });
    expect((await asFollower.from("profiles").select("id")).data).toEqual([{ id: follower.id }]);
    expect((await asFollower.from("event_registrations").select("user_id").eq("event_id", open.id)).data).toEqual([{ user_id: follower.id }]);
    expect((await rpcAs(follower.email, "submit_event_request", { p: requestInput("E2E Request follower") })).error).toBe("Only members can request events");
    expect((await rpcAs(follower.email, "get_event_registrations", { p_event_id: open.id })).error).toMatch(/Not allowed/);
    expect((await rpcAs(follower.email, "list_recycle_bin", { _type: "all", _search: "", _offset: 0 })).error).toMatch(/Not allowed/);
  });

  test("a volunteer application: one open at a time; approval makes the follower a volunteer of that branch", async ({ freshUser, freshBranch, seed }) => {
    const branch = await freshBranch("apply");
    const manager = await freshUser({ role: "branch_manager", branch });
    const other = await freshUser({ role: "branch_manager", branch: seed.branches.Brighton });
    const follower = await freshUser({ role: "follower", branch });
    const input = {
      branch_id: branch,
      motivation: "I would like to help organise dialogue dinners and welcome guests.",
      time_commitment: "few_hours_month",
      commitment: true,
    };
    const { data: appId, error } = await rpcAs<string>(follower.email, "submit_volunteer_application", { p: input });
    expect(error).toBeNull();
    expect((await rpcAs(follower.email, "submit_volunteer_application", { p: input })).error).toBe("You already have an open application");
    // Reviewers: the branch's manager yes, another branch's manager no; nobody can write the table directly.
    expect((await (await clientAs(manager.email)).from("volunteer_applications").select("id")).data).toEqual([{ id: appId }]);
    expect((await (await clientAs(other.email)).from("volunteer_applications").select("id")).data).toEqual([]);
    expect((await (await clientAs(follower.email)).from("volunteer_applications").update({ status: "approved" }).eq("id", appId!).select()).error?.message).toMatch(/permission denied/);
    expect((await rpcAs(other.email, "approve_volunteer_application", { p_id: appId })).error).toMatch(/Not allowed/);
    expect((await rpcAs(manager.email, "approve_volunteer_application", { p_id: appId })).error).toBeNull();
    expect(await getRoles(follower.id)).toEqual(["volunteer"]);
    const { data: profile } = await adminClient().from("profiles").select("branch_id").eq("id", follower.id).single();
    expect(profile).toEqual({ branch_id: branch });
    const { data: audit } = await adminClient().from("user_audit_log").select("action, old_value, new_value").eq("target_id", follower.id).eq("action", "role_change");
    expect(audit).toEqual([{ action: "role_change", old_value: "follower", new_value: "volunteer" }]);
  });
});

test.describe("Anonymous visitors", () => {
  test("no table access; the public functions return only public events and only the allowed fields (never online links)", { tag: "@smoke" }, async ({ freshUser, freshEvent }) => {
    const manager = await freshUser({ role: "branch_manager" });
    const online = await freshEvent(manager, { label: "public online", status: "published", startInMinutes: 3 * 24 * 60, audience: "public", onlineUrl: "https://meet.example.org/e2e-secret-room" });
    const members = await freshEvent(manager, { label: "members only", status: "published", startInMinutes: 3 * 24 * 60 });
    const anon = anonClient();
    for (const table of ["events", "profiles", "event_registrations", "volunteer_applications", "user_followed_branches", "user_roles", "event_media"]) {
      const { data, error } = await anon.from(table).select("*").limit(1);
      expect(error?.message ?? JSON.stringify(data), table).toMatch(/permission denied|^\[\]$/);
    }
    const { data: list, error } = await anon.rpc("get_public_events");
    expect(error).toBeNull();
    const rows = list as Record<string, unknown>[];
    const mine = rows.find((r) => r["id"] === online.id)!;
    expect(Object.keys(mine).sort()).toEqual(PUBLIC_FIELDS);
    expect(mine).toMatchObject({ is_online: true, location: null, registration: "open" });
    expect(rows.some((r) => r["id"] === members.id)).toBe(false);
    expect(JSON.stringify(rows)).not.toContain("e2e-secret-room");
    expect((await anon.rpc("get_public_event", { p_id: members.id })).data).toBeNull();
    expect(JSON.stringify((await anon.rpc("get_public_event", { p_id: online.id })).data)).not.toContain("meet.example.org");
    const tooLong = await anon.rpc("get_public_events", { p_from: new Date().toISOString(), p_to: new Date(Date.now() + 400 * 86400000).toISOString() });
    expect(tooLong.error?.message).toBe("Date range must be at most 12 months");
    // Writes stay closed to anon (no grants), including the internal tables that used to have them.
    for (const table of ["event_audit_log", "recycle_bin_audit_log", "event_deletion_jobs"]) {
      expect((await anon.from(table).insert({}).select()).error?.message, table).toMatch(/permission denied/);
    }
  });

  test("the ICS feed: text/calendar, public events with UID = id, cancelled as CANCELLED, no online links, cached 15 minutes", async ({ freshUser, freshEvent, request }) => {
    const manager = await freshUser({ role: "branch_manager" });
    const online = await freshEvent(manager, { label: "ics online", status: "published", startInMinutes: 5 * 24 * 60, audience: "public", onlineUrl: "https://meet.example.org/e2e-ics-room" });
    const cancelled = await freshEvent(manager, { label: "ics cancelled", status: "published", startInMinutes: 6 * 24 * 60, audience: "public", cancelled: true });
    const members = await freshEvent(manager, { label: "ics members", status: "published", startInMinutes: 5 * 24 * 60 });
    const response = await request.get("/api/ics");
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toContain("text/calendar");
    expect(response.headers()["cache-control"]).toContain("max-age=900");
    const body = await response.text();
    expect(body.startsWith("BEGIN:VCALENDAR")).toBe(true);
    expect(body).toContain(`UID:${online.id}@dialoguesociety.org`);
    expect(body).toMatch(new RegExp(`UID:${cancelled.id}@dialoguesociety\\.org[\\s\\S]*?STATUS:CANCELLED`));
    expect(body).not.toContain(members.id);
    expect(body).not.toContain("e2e-ics-room");
    expect(body).toContain(`/events/${online.id}`);
  });
});

test.describe("National Coordinators", () => {
  test("without MFA (aal1) the database gives an NC nothing; with aal2 counts, RD/BM details, never volunteers", { tag: "@smoke" }, async ({ freshUser }) => {
    const nc = await freshUser({ role: "national_coordinator" });
    const volunteer = await freshUser();
    const manager = await freshUser({ role: "branch_manager" });
    const aal1 = await clientAs(nc.email);
    expect((await aal1.rpc("get_nc_dashboard")).error?.message).toMatch(/Not allowed/);
    expect((await aal1.rpc("is_nc")).data).toBe(false);
    const aal2 = await clientAsAal2(nc.email, nc.totpSecret!);
    expect((await aal2.rpc("is_nc")).data).toBe(true);
    const { data: dashboard } = await aal2.rpc("get_nc_dashboard");
    expect(Object.keys(dashboard as object).sort()).toEqual(["attended_30d", "branches", "followers", "open_applications", "pending_requests", "regions", "registrations_30d", "upcoming_events", "volunteers"]);
    const { data: seen } = await aal2.from("profiles").select("id").in("id", [volunteer.id, manager.id]);
    expect(seen).toEqual([{ id: manager.id }]);
    const tree = JSON.stringify((await aal2.rpc("get_regions_tree")).data);
    expect(tree).toContain(manager.email);
    expect(tree).not.toContain(volunteer.email);
    expect((await aal2.from("volunteer_applications").select("id")).data).toEqual([]);
  });

  test("national events: NCs only; registrations are counts only for them; RD/BM cannot create them", async ({ freshUser, seed }) => {
    const nc = await freshUser({ role: "national_coordinator" });
    const volunteer = await freshUser();
    const payload = { title: "E2E Event national", scope: "national", status: "draft", category: "dialogue", audience: "members" };
    expect((await rpcAs(seed.users.director.email, "create_event", { _data: payload })).error).toMatch(/Not allowed/);
    const created = await (await clientAsAal2(nc.email, nc.totpSecret!)).rpc("create_event", { _data: payload });
    expect(created.error).toBeNull();
    const event = await createNationalEventAdmin(nc.id, { title: "E2E Event national published", status: "published", startInMinutes: 3 * 24 * 60 });
    try {
      expect((await rpcAs(volunteer.email, "register_for_event", { p_event_id: event })).error).toBeNull();
      const aal2 = await clientAsAal2(nc.email, nc.totpSecret!);
      expect((await aal2.rpc("get_event_registrations", { p_event_id: event })).error?.message).toBe("Registrant details are not available");
      expect((await aal2.from("event_registrations").select("user_id").eq("event_id", event)).data).toEqual([]);
      expect((await aal2.rpc("get_event_registration_summary", { p_event_id: event })).data).toMatchObject({ registered_count: 1, names_visible: false, names: [] });
    } finally {
      await deleteEvents([event, String(created.data)]);
    }
  });

  test("nobody can assign, change or delete a National Coordinator in the app", async ({ freshUser, seed }) => {
    const nc = await freshUser({ role: "national_coordinator" });
    const other = await freshUser({ role: "national_coordinator" });
    const manager = await freshUser({ role: "branch_manager" });
    const aal2 = await clientAsAal2(nc.email, nc.totpSecret!);
    expect((await aal2.rpc("set_user_role", { _target: manager.id, _role: "national_coordinator" })).error?.message).toBe("This role cannot be assigned in the app");
    expect((await aal2.rpc("set_user_role", { _target: other.id, _role: "branch_manager" })).error?.message).toMatch(/cannot manage/);
    expect((await aal2.rpc("set_user_status", { _target: other.id, _status: "inactive" })).error?.message).toMatch(/cannot manage|Not allowed/);
    expect((await rpcAs(seed.users.director.email, "set_user_status", { _target: nc.id, _status: "inactive" })).error).toMatch(/cannot manage|Not allowed/);
    expect((await rpcAs(nc.email, "request_account_deletion")).error).toMatch(/cannot be deleted|Two-factor|Not allowed/);
    // A Regional Director may be assigned by an NC (with a region), never by a Regional Director.
    expect((await aal2.rpc("set_user_role", { _target: manager.id, _role: "regional_director", _region: seed.regionId })).error).toBeNull();
    expect(await getRoles(manager.id)).toEqual(["regional_director"]);
  });
});

test.describe("Privacy notice 1.3", () => {
  test("a member who confirmed 1.2 must confirm 1.3 before writing (events and tasks)", async ({ freshUser, freshEvent, seed }) => {
    const manager = await freshUser({ role: "branch_manager" });
    const volunteer = await freshUser();
    const event = await freshEvent(manager, { label: "privacy 1.3", status: "published", startInMinutes: 3 * 24 * 60 });
    await adminClient().from("privacy_notice_acceptances").update({ notice_version: "1.2" }).eq("user_id", volunteer.id);
    expect((await rpcAs(volunteer.email, "get_privacy_status")).data).toMatchObject({ current_version: "1.3", accepted_version: "1.2", current_accepted: false });
    expect((await rpcAs(volunteer.email, "register_for_event", { p_event_id: event.id })).error).toBe("Privacy notice not accepted");
    const selfTask = { scope: "branch", branch_id: seed.branches.Medway, title: `E2E Task ${runId} privacy` };
    expect((await rpcAs(volunteer.email, "create_task", { p: selfTask })).error).toBe("Privacy notice not accepted");
    expect((await rpcAs(volunteer.email, "accept_privacy_notice", { p_version: "1.2" })).error).toBe("Privacy notice version is out of date");
    expect((await rpcAs(volunteer.email, "accept_privacy_notice", { p_version: "1.3" })).error).toBeNull();
    expect((await rpcAs(volunteer.email, "register_for_event", { p_event_id: event.id })).error).toBeNull();
    expect((await rpcAs(volunteer.email, "create_task", { p: selfTask })).error).toBeNull();
  });
});

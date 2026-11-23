// Privacy notice confirmation and optional consents through Auth and the RPCs (RLS and the sign-up trigger are the
// enforcement). Fresh users only; removed after each test.
import { randomUUID } from "node:crypto";
import { test, expect } from "../../fixtures/roles";
import { adminClient, anonClient, clientAs } from "../../api/SupabaseClient";
import { softDeleteUser } from "../../api/recycleBin";
import { REQUEST_TITLE_PREFIX, requestInput, requestRow, rpcAs, submitRequestAs } from "../../api/eventRequests";
import { FRESH_PREFIX } from "../../data/users";
import { emailDomain, userPassword } from "../../setup/env";

const email = () => `${FRESH_PREFIX}${process.env["E2E_RUN_ID"] ?? "local"}-privacy-${randomUUID().slice(0, 8)}@${emailDomain()}`;
const status = async (who: string) => (await rpcAs<Record<string, unknown>>(who, "get_privacy_status")).data;

test.describe("Privacy notice API", () => {
  test("accounts cannot be created without confirming the current notice version (and a branch to follow)", async ({ seed }) => {
    // Every account creation goes through the handle_new_user trigger (the admin API too, which skips the
    // email-domain checks QA's public sign-up applies to test addresses).
    const { data: current } = await adminClient().rpc("privacy_notice_version");
    for (const data of [{ full_name: "No notice", branch_id: seed.branches.Medway }, { full_name: "Old notice", privacy_notice_version: "0.9", branch_id: seed.branches.Medway },
      { full_name: "No branch", privacy_notice_version: current }]) {
      const viaAdmin = await adminClient().auth.admin.createUser({ email: email(), password: userPassword(), email_confirm: true, user_metadata: data });
      expect(viaAdmin.error, JSON.stringify(data)).not.toBeNull();
    }
    const { data: version } = await adminClient().rpc("privacy_notice_version");
    const created = await adminClient().auth.admin.createUser({ email: email(), password: userPassword(), email_confirm: true, user_metadata: { full_name: "Has notice", privacy_notice_version: version, photo_consent: true, branch_id: seed.branches.Medway } });
    expect(created.error).toBeNull();
    try {
      const { data: rows } = await adminClient().from("privacy_notice_acceptances").select("notice_version").eq("user_id", created.data.user!.id);
      expect(rows).toEqual([{ notice_version: version }]);
      const { data: prefs } = await adminClient().from("consent_preferences").select("photo_consent, updates_email_consent").eq("user_id", created.data.user!.id).single();
      expect(prefs).toEqual({ photo_consent: true, updates_email_consent: false });
    } finally {
      await adminClient().auth.admin.deleteUser(created.data.user!.id);
    }
  });

  test("a changed notice asks again: an outdated version is refused and data is hidden until confirmed", async ({ freshUser, freshEvent }) => {
    const manager = await freshUser({ role: "branch_manager" });
    const event = await freshEvent(manager, { label: "privacy", status: "published", startInMinutes: 3 * 24 * 60 });
    const asManager = await clientAs(manager.email);
    expect((await asManager.from("events").select("id").eq("id", event.id)).data).toHaveLength(1);
    // As if the notice had moved on: the member's confirmation is for an older version.
    await adminClient().from("privacy_notice_acceptances").update({ notice_version: "0.9" }).eq("user_id", manager.id);
    expect(await status(manager.email)).toMatchObject({ current_accepted: false, accepted_version: "0.9" });
    expect((await asManager.from("events").select("id").eq("id", event.id)).data).toEqual([]);
    expect((await rpcAs(manager.email, "accept_privacy_notice", { p_version: "0.9" })).error).toBe("Privacy notice version is out of date");
    const current = (await status(manager.email))["current_version"] as string;
    expect((await rpcAs(manager.email, "accept_privacy_notice", { p_version: current })).error).toBeNull();
    expect((await asManager.from("events").select("id").eq("id", event.id)).data).toHaveLength(1);
  });

  test("optional consents are off by default and change only through the RPC; own rows only", async ({ freshUser }) => {
    const volunteer = await freshUser();
    const other = await freshUser();
    expect(await status(volunteer.email)).toMatchObject({ photo_consent: false, updates_email_consent: false });
    expect((await rpcAs(volunteer.email, "set_consent_preferences", { p_photo_consent: true, p_updates_email_consent: false })).error).toBeNull();
    expect(await status(volunteer.email)).toMatchObject({ photo_consent: true, updates_email_consent: false });
    const asVolunteer = await clientAs(volunteer.email);
    expect((await asVolunteer.from("consent_preferences").update({ updates_email_consent: true }).eq("user_id", volunteer.id).select()).error?.message).toMatch(/permission denied/);
    expect((await asVolunteer.from("privacy_notice_acceptances").insert({ user_id: volunteer.id, notice_version: "9.9" })).error?.message).toMatch(/permission denied/);
    expect((await asVolunteer.from("consent_preferences").select("user_id").eq("user_id", other.id)).data).toEqual([]);
    expect((await asVolunteer.from("privacy_notice_acceptances").select("user_id").eq("user_id", other.id)).data).toEqual([]);
    expect((await rpcAs(volunteer.email, "record_privacy_choices", { _user: other.id, _photo: true, _updates: true })).error).toMatch(/permission denied|Could not find the function/);
    expect((await anonClient().rpc("get_privacy_status")).error?.message).toMatch(/permission denied/);
  });

  test("write RPCs refuse a member who has not confirmed the notice (PostgREST); account deletion stays open", { tag: "@smoke" }, async ({ freshUser, freshEvent }) => {
    const manager = await freshUser({ role: "branch_manager" });
    const volunteer = await freshUser();
    const event = await freshEvent(manager, { label: "privacy-rpc", status: "published", startInMinutes: 3 * 24 * 60 });
    const requestId = await submitRequestAs(volunteer.email, `${REQUEST_TITLE_PREFIX}privacy-rpc ${randomUUID().slice(0, 8)}`);
    expect((await rpcAs(volunteer.email, "register_for_event", { p_event_id: event.id })).error).toBeNull();
    // Neither has confirmed the current notice any more (as if it had just changed).
    await adminClient().from("privacy_notice_acceptances").delete().in("user_id", [manager.id, volunteer.id]);
    const refused = "Privacy notice not accepted";
    const volunteerCalls: [string, Record<string, unknown>][] = [
      ["register_for_event", { p_event_id: event.id }],
      ["set_registration_show_name", { p_event_id: event.id, p_show_name: false }],
      ["cancel_registration", { p_event_id: event.id }],
      ["submit_event_request", { p: requestInput(`${REQUEST_TITLE_PREFIX}privacy-rpc-2`) }],
      ["update_event_request", { p_id: requestId, p: requestInput(`${REQUEST_TITLE_PREFIX}privacy-rpc-3`) }],
      ["withdraw_event_request", { p_id: requestId }],
      ["delete_event_request", { p_id: requestId }],
      ["set_consent_preferences", { p_photo_consent: true, p_updates_email_consent: true }],
    ];
    for (const [fn, args] of volunteerCalls) expect((await rpcAs(volunteer.email, fn, args)).error, fn).toBe(refused);
    const managerCalls: [string, Record<string, unknown>][] = [
      ["set_user_status", { _target: volunteer.id, _status: "inactive" }],
      ["start_review_event_request", { p_id: requestId }],
      ["decline_event_request", { p_id: requestId, p_reason: "No" }],
      ["cancel_event", { _event: event.id }],
    ];
    for (const [fn, args] of managerCalls) expect((await rpcAs(manager.email, fn, args)).error, fn).toBe(refused);
    // Nothing changed.
    expect((await requestRow(requestId))?.status).toBe("submitted");
    const { data: reg } = await adminClient().from("event_registrations").select("status, show_name").eq("event_id", event.id).eq("user_id", volunteer.id).single();
    expect(reg).toMatchObject({ status: "registered", show_name: true });
    // Erasure does not depend on the notice.
    expect((await rpcAs(volunteer.email, "request_account_deletion")).error).toBeNull();
    expect((await rpcAs(volunteer.email, "cancel_account_deletion")).error).toBeNull();
    // Confirming opens the RPCs again.
    const current = (await status(volunteer.email))["current_version"] as string;
    expect((await rpcAs(volunteer.email, "accept_privacy_notice", { p_version: current })).error).toBeNull();
    expect((await rpcAs(volunteer.email, "set_registration_show_name", { p_event_id: event.id, p_show_name: false })).error).toBeNull();
  });

  test("erasure (real purge chain): the confirmation stays anonymous, the consents are removed", async ({ freshUser }) => {
    const manager = await freshUser({ role: "branch_manager" });
    const volunteer = await freshUser();
    expect((await rpcAs(volunteer.email, "set_consent_preferences", { p_photo_consent: true, p_updates_email_consent: true })).error).toBeNull();
    const { data: before } = await adminClient().from("privacy_notice_acceptances").select("id").eq("user_id", volunteer.id).single();
    expect((await rpcAs(manager.email, "set_user_status", { _target: volunteer.id, _status: "inactive" })).error).toBeNull();
    await softDeleteUser(manager.id, volunteer.id);
    expect((await rpcAs(manager.email, "permanent_delete_item", { _type: "user", _id: volunteer.id, _confirmation: "DELETE" })).error).toBeNull();
    expect((await adminClient().auth.admin.deleteUser(volunteer.id)).error).toBeNull();
    expect((await adminClient().rpc("finish_user_recycle_operation", { _id: volunteer.id, _operation: "purge" })).error).toBeNull();
    const { data: after } = await adminClient().from("privacy_notice_acceptances").select("user_id").eq("id", before!.id).single();
    expect(after).toEqual({ user_id: null });
    expect((await adminClient().from("consent_preferences").select("user_id").eq("user_id", volunteer.id)).data).toEqual([]);
    await adminClient().from("privacy_notice_acceptances").delete().eq("id", before!.id);
  });
});

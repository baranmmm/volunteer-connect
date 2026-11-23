// Calls Supabase REST/RPC directly with each role's token and asserts forbidden actions are rejected
// AND that the data is unchanged afterwards (RLS can silently filter an update to zero rows).
import { test, expect } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { anonClient, clientAs, getProfile, getRoles, adminClient } from "../../api/SupabaseClient";
import { readSeedState, type RoleKey } from "../../data/users";

const seed = readSeedState();
const u = seed.users;
const as = (key: RoleKey) => clientAs(u[key].email);

type Result = { error: unknown; data?: unknown };
function expectRejected(res: Result, what: string) {
  expect(res.error, `${what} should be rejected`).not.toBeNull();
}
/** Either an error, or nothing came back (RLS filtered the rows). */
function expectNoRows(res: Result, what: string) {
  if (res.error) return;
  expect(Array.isArray(res.data) ? res.data : [], `${what} should return no rows`).toHaveLength(0);
}

async function snapshot(id: string) {
  return { profile: await getProfile(id), roles: (await getRoles(id)).sort() };
}

test.describe("Anonymous access", () => {
  test("cannot read members, roles, history or deletion requests", async () => {
    const anon = anonClient();
    for (const table of ["profiles", "user_roles", "user_audit_log", "account_deletion_requests"]) {
      expectNoRows(await anon.from(table).select("*").limit(5), `anon select ${table}`);
    }
  });

  test("cannot call any management RPC", { tag: "@smoke" }, async () => {
    const anon = anonClient();
    const before = await snapshot(u.volunteerMedway.id);
    expectRejected(await anon.rpc("set_user_status", { _target: u.volunteerMedway.id, _status: "inactive" }), "anon set_user_status");
    expectRejected(await anon.rpc("set_user_role", { _target: u.volunteerMedway.id, _role: "branch_manager" }), "anon set_user_role");
    expectRejected(await anon.rpc("set_user_branch", { _target: u.volunteerMedway.id, _branch: seed.branches.Brighton }), "anon set_user_branch");
    expectRejected(await anon.rpc("request_account_deletion"), "anon request_account_deletion");
    expectRejected(await anon.rpc("get_user_audit_history", { _target: u.volunteerMedway.id }), "anon get_user_audit_history");
    expectRejected(await anon.rpc("authorize_user_deletion", { _actor: u.director.id, _target: u.volunteerMedway.id }), "anon authorize_user_deletion");
    expect(await snapshot(u.volunteerMedway.id)).toEqual(before);
  });

  test("cannot write to protected tables", async () => {
    const anon = anonClient();
    expectRejected(await anon.from("user_roles").insert({ user_id: u.volunteerMedway.id, role: "regional_director" }), "anon insert user_roles");
    expectRejected(await anon.from("user_audit_log").insert({ actor_id: u.director.id, target_id: u.volunteerMedway.id, action: "status_change" }), "anon insert audit");
  });
});

test.describe("Volunteer cannot change their own status, branch or role", () => {
  let client: SupabaseClient;
  test.beforeAll(async () => {
    client = await as("volunteerMedway");
  });

  test("via RPCs", { tag: "@smoke" }, async () => {
    const me = u.volunteerMedway.id;
    const before = await snapshot(me);
    expectRejected(await client.rpc("set_user_status", { _target: me, _status: "inactive" }), "self set_user_status");
    expectRejected(await client.rpc("set_user_branch", { _target: me, _branch: seed.branches.Brighton }), "self set_user_branch");
    expectRejected(await client.rpc("set_user_role", { _target: me, _role: "branch_manager" }), "self set_user_role");
    expect(await snapshot(me)).toEqual(before);
  });

  test("via direct table writes", async () => {
    const me = u.volunteerMedway.id;
    const before = await snapshot(me);
    expectRejected(await client.from("profiles").update({ status: "inactive" }).eq("id", me), "update own status column");
    expectRejected(await client.from("profiles").update({ branch_id: seed.branches.Brighton }).eq("id", me), "update own branch column");
    expectRejected(await client.from("user_roles").insert({ user_id: me, role: "branch_manager" }), "insert own role");
    expectRejected(await client.from("user_roles").update({ role: "regional_director" }).eq("user_id", me), "update own role");
    expectRejected(await client.from("user_roles").delete().eq("user_id", me), "delete own role");
    expectRejected(await client.from("user_audit_log").insert({ actor_id: me, target_id: me, action: "role_change" }), "insert audit row");
    expectRejected(await client.from("user_audit_log").delete().eq("target_id", me), "delete audit rows");
    expectRejected(await client.from("account_deletion_requests").insert({ user_id: me }), "insert deletion request directly");
    expect(await snapshot(me)).toEqual(before);
  });

  test("cannot read other members", async () => {
    expectNoRows(await client.from("profiles").select("id").neq("id", u.volunteerMedway.id), "volunteer reads other profiles");
    expectNoRows(await client.from("user_roles").select("user_id").neq("user_id", u.volunteerMedway.id), "volunteer reads other roles");
  });

  test("cannot call service-role-only deletion functions", async () => {
    expectRejected(await client.rpc("authorize_user_deletion", { _actor: u.volunteerMedway.id, _target: u.volunteerMedway.id }), "authorize_user_deletion");
    expectRejected(await client.rpc("record_user_deletion", { _actor: u.volunteerMedway.id, _target: u.volunteerMedway.id, _audit: u.volunteerMedway.id }), "record_user_deletion");
  });
});

test.describe("Branch managers are limited to their own branch", () => {
  let medway: SupabaseClient;
  test.beforeAll(async () => {
    medway = await as("managerMedway");
  });

  test("cannot manage a Brighton volunteer", { tag: "@smoke" }, async () => {
    const target = u.volunteerBrighton.id;
    const before = await snapshot(target);
    expectRejected(await medway.rpc("set_user_status", { _target: target, _status: "inactive" }), "cross-branch set_user_status");
    expectNoRows(await medway.from("profiles").update({ full_name: "hacked" }).eq("id", target).select("id"), "cross-branch profile update");
    expectNoRows(await medway.from("profiles").select("id").eq("id", target), "cross-branch profile read");
    expectNoRows(await medway.rpc("get_user_audit_history", { _target: target }), "cross-branch history");
    expect(await snapshot(target)).toEqual(before);
  });

  test("cannot change roles or move branches (director only)", async () => {
    const target = u.volunteerMedway.id;
    const before = await snapshot(target);
    expectRejected(await medway.rpc("set_user_role", { _target: target, _role: "branch_manager" }), "manager set_user_role");
    expectRejected(await medway.rpc("set_user_branch", { _target: target, _branch: seed.branches.Brighton }), "manager set_user_branch");
    expect(await snapshot(target)).toEqual(before);
  });

  test("cannot change their own status or another manager", async () => {
    const before = await snapshot(u.managerMedway.id);
    expectRejected(await medway.rpc("set_user_status", { _target: u.managerMedway.id, _status: "inactive" }), "manager self status");
    expectRejected(await medway.rpc("set_user_status", { _target: u.managerBrighton.id, _status: "inactive" }), "manager vs manager");
    expect(await snapshot(u.managerMedway.id)).toEqual(before);
  });

  test("cannot write roles or audit rows directly", async () => {
    expectRejected(await medway.from("user_roles").insert({ user_id: u.volunteerMedway.id, role: "branch_manager" }), "manager insert user_roles");
    expectRejected(await medway.from("user_audit_log").insert({ actor_id: u.managerMedway.id, target_id: u.volunteerMedway.id, action: "status_change" }), "manager insert audit");
  });
});

test.describe("Regional director limits", () => {
  let director: SupabaseClient;
  test.beforeAll(async () => {
    director = await as("director");
  });

  test("cannot assign the regional director role or change their own", async () => {
    const before = await snapshot(u.volunteerMedway.id);
    expectRejected(await director.rpc("set_user_role", { _target: u.volunteerMedway.id, _role: "regional_director" }), "assign regional_director");
    expectRejected(await director.rpc("set_user_role", { _target: u.director.id, _role: "volunteer" }), "director self role");
    expectRejected(await director.rpc("set_user_status", { _target: u.director.id, _status: "inactive" }), "director self status");
    expect(await snapshot(u.volunteerMedway.id)).toEqual(before);
  });

  test("cannot move a user to a branch outside the region", async () => {
    const outside = await adminClient().from("branches").select("id").neq("region_id", seed.regionId).limit(1).maybeSingle();
    test.skip(!outside.data, "No branch outside the region");
    const before = await snapshot(u.volunteerMedway.id);
    expectRejected(await director.rpc("set_user_branch", { _target: u.volunteerMedway.id, _branch: (outside.data as { id: string }).id }), "move outside region");
    expect(await snapshot(u.volunteerMedway.id)).toEqual(before);
  });
});

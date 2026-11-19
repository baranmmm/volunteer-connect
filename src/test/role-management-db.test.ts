import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { beforeAll, afterAll, describe, expect, it } from "vitest";

const db = new PGlite();
const actor = "11111111-1111-4111-8111-111111111111";
const target = "22222222-2222-4222-8222-222222222222";
const b1 = "33333333-3333-4333-8333-333333333333";
const b2 = "44444444-4444-4444-8444-444444444444";
const b3 = "66666666-6666-4666-8666-666666666666";
const region = "55555555-5555-4555-8555-555555555555";

beforeAll(async () => {
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE SCHEMA auth;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    CREATE TYPE public.app_role AS ENUM ('volunteer','branch_manager','regional_director');
    CREATE TYPE public.profile_status AS ENUM ('pending','active','inactive');
    CREATE TABLE profiles(id uuid PRIMARY KEY, full_name text, status profile_status, branch_id uuid);
    CREATE TABLE user_roles(id uuid DEFAULT gen_random_uuid(), user_id uuid, role app_role, region_id uuid);
    CREATE TABLE branches(id uuid PRIMARY KEY, region_id uuid);
    CREATE FUNCTION public.has_role(_user_id uuid, _role app_role) RETURNS boolean LANGUAGE sql AS $$ SELECT EXISTS(SELECT 1 FROM user_roles WHERE user_id=_user_id AND role=_role) $$;
    CREATE FUNCTION public.get_user_branch(_user_id uuid) RETURNS uuid LANGUAGE sql AS $$ SELECT branch_id FROM profiles WHERE id=_user_id $$;
    INSERT INTO branches VALUES ('${b1}','${region}'),('${b2}','${region}'),('${b3}','77777777-7777-4777-8777-777777777777');
    INSERT INTO profiles VALUES ('${actor}','Test Director','active','${b1}'),('${target}','Test Member','pending','${b1}');
    INSERT INTO user_roles(user_id,role,region_id) VALUES ('${actor}','regional_director','${region}'),('${target}','volunteer',NULL);
    SELECT set_config('request.jwt.claim.sub','${actor}',false);`);
  const previous = readFileSync("supabase/migrations/20261119171822_1a18757c-cae2-41a6-8cad-653ceb664a5e.sql", "utf8");
  const start = previous.indexOf("CREATE OR REPLACE FUNCTION public.can_manage_user");
  const end = previous.indexOf("-- 5. Function execution");
  await db.exec(previous.slice(start, end));
  await db.exec(readFileSync("supabase/migrations/20261119183332_9bf1ec9d-5236-4163-80bd-92130515e750.sql", "utf8"));
}, 20000);
afterAll(async () => { await db.close(); });

async function rollbackTest(action: () => Promise<void>) {
  await db.exec("BEGIN");
  try { await action(); } finally { await db.exec("ROLLBACK"); }
}

describe("Role management database permissions", () => {
  it("replaces role atomically and logs old and new values", async () => rollbackTest(async () => {
    await db.query("SELECT set_user_role($1,'branch_manager')", [target]);
    expect((await db.query("SELECT role FROM user_roles WHERE user_id=$1", [target])).rows).toEqual([{ role: "branch_manager" }]);
    expect((await db.query("SELECT action,old_value,new_value FROM user_audit_log")).rows).toEqual([{ action: "role_change", old_value: "volunteer", new_value: "branch_manager" }]);
  }));
  it("rejects director assignment", async () => rollbackTest(async () => {
    await expect(db.query("SELECT set_user_role($1,'regional_director')", [target])).rejects.toThrow("Regional Director cannot be assigned");
  }));
  it("rejects self-role changes", async () => rollbackTest(async () => {
    await expect(db.query("SELECT set_user_role($1,'volunteer')", [actor])).rejects.toThrow("own role");
  }));
  it("rejects inactive directors", async () => rollbackTest(async () => {
    await db.query("UPDATE profiles SET status='inactive' WHERE id=$1", [actor]);
    await expect(db.query("SELECT set_user_role($1,'branch_manager')", [target])).rejects.toThrow("Only active Regional Directors");
  }));
  it("rejects branch managers changing roles", async () => rollbackTest(async () => {
    await db.query("UPDATE user_roles SET role='branch_manager' WHERE user_id=$1", [actor]);
    await expect(db.query("SELECT set_user_role($1,'branch_manager')", [target])).rejects.toThrow("Only active Regional Directors");
  }));
  it("rejects users outside the region", async () => rollbackTest(async () => {
    await db.query("UPDATE profiles SET branch_id=$1 WHERE id=$2", [b3, target]);
    await expect(db.query("SELECT set_user_role($1,'branch_manager')", [target])).rejects.toThrow("cannot manage");
  }));
  it("allows demoting the last manager", async () => rollbackTest(async () => {
    await db.query("UPDATE user_roles SET role='branch_manager' WHERE user_id=$1", [target]);
    await db.query("SELECT set_user_role($1,'volunteer')", [target]);
    expect((await db.query("SELECT role FROM user_roles WHERE user_id=$1", [target])).rows).toEqual([{ role: "volunteer" }]);
  }));
  it("moves within the region and logs branch IDs", async () => rollbackTest(async () => {
    await db.query("SELECT set_user_branch($1,$2)", [target, b2]);
    expect((await db.query("SELECT branch_id FROM profiles WHERE id=$1", [target])).rows).toEqual([{ branch_id: b2 }]);
    expect((await db.query("SELECT action,old_value,new_value FROM user_audit_log")).rows).toEqual([{ action: "branch_change", old_value: b1, new_value: b2 }]);
  }));
  it("rejects branch moves outside the region", async () => rollbackTest(async () => {
    await expect(db.query("SELECT set_user_branch($1,$2)", [target, b3])).rejects.toThrow("must belong to your region");
  }));
  it("status changes record actor, target, and old/new status", async () => rollbackTest(async () => {
    await db.query("SELECT set_user_status($1,'active')", [target]);
    expect((await db.query("SELECT actor_id,target_id,action,old_value,new_value FROM user_audit_log")).rows).toEqual([{ actor_id: actor, target_id: target, action: "status_change", old_value: "pending", new_value: "active" }]);
  }));
  it("history returns actor names and permits owner reads", async () => rollbackTest(async () => {
    await db.query("SELECT set_user_status($1,'active')", [target]);
    await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)", [target]);
    expect((await db.query<{ actor_name: string }>("SELECT actor_name FROM get_user_audit_history($1)", [target])).rows[0]?.actor_name).toBe("Test Director");
  }));
  it("history rejects unrelated callers", async () => rollbackTest(async () => {
    await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)", [b3]);
    await expect(db.query("SELECT * FROM get_user_audit_history($1)", [target])).rejects.toThrow("Not allowed");
  }));
  it("authenticated can read but cannot write history and anon cannot read", async () => {
    const r = await db.query("SELECT has_table_privilege('authenticated','user_audit_log','SELECT') AS read, has_table_privilege('authenticated','user_audit_log','INSERT') AS write, has_table_privilege('authenticated','user_audit_log','UPDATE') AS edit, has_table_privilege('authenticated','user_audit_log','DELETE') AS remove, has_table_privilege('anon','user_audit_log','SELECT') AS anon_read");
    expect(r.rows).toEqual([{ read: true, write: false, edit: false, remove: false, anon_read: false }]);
  });
});
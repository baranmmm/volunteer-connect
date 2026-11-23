import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { initializeRecycleDatabase } from "./recycle-db-fixture";

// Privacy notice confirmation and optional consents against every migration in PGlite. Rolled back per test.
const db = new PGlite();
const id = (n: number) =>
  `${String(n).repeat(8)}-${String(n).repeat(4)}-4${String(n).repeat(3)}-8${String(n).repeat(3)}-${String(n).repeat(12)}`;
const ids = { region: id(1), branch: id(2), bm: id(3), vol: id(4), other: id(5), fresh: id(6) };
async function as(user: string | null) {
  await db.exec("RESET ROLE");
  await db.query("SELECT set_config('request.jwt.claim.sub',$1,true)", [user ?? ""]);
  if (user) await db.exec("SET LOCAL ROLE authenticated");
}
async function fails(sql: string, params: unknown[], message: string) {
  await db.exec("SAVEPOINT sp");
  try {
    await expect(db.query(sql, params)).rejects.toThrow(message);
  } finally {
    await db.exec("ROLLBACK TO SAVEPOINT sp");
  }
}
async function tx(action: () => Promise<void>) {
  await db.exec("BEGIN");
  try {
    await action();
  } finally {
    await db.exec("ROLLBACK");
  }
}
const status = async (user: string) => {
  await as(user);
  return (await db.query<{ s: Record<string, unknown> }>("SELECT public.get_privacy_status() s"))
    .rows[0]!.s;
};

beforeAll(async () => {
  await initializeRecycleDatabase(db);
  await db.exec(`INSERT INTO regions(id,name) VALUES ('${ids.region}','Region');
    INSERT INTO branches(id,name,region_id) VALUES ('${ids.branch}','Branch','${ids.region}');
    INSERT INTO auth.users(id, raw_user_meta_data) SELECT x, jsonb_build_object('full_name','User','privacy_notice_version','1.1','photo_consent',true)
      FROM unnest(ARRAY['${ids.bm}','${ids.vol}','${ids.other}']::uuid[]) x;
    UPDATE profiles SET status='active', branch_id='${ids.branch}';
    UPDATE user_roles SET role='branch_manager' WHERE user_id='${ids.bm}';`);
}, 30000);
afterAll(async () => db.close());

describe("privacy notice (database)", () => {
  it("the version in src/content/privacy-notice.md is the one the database requires", async () => {
    const md = readFileSync("src/content/privacy-notice.md", "utf8");
    const version = (await db.query<{ v: string }>("SELECT public.privacy_notice_version() v"))
      .rows[0]!.v;
    expect(md).toContain(`Version ${version} ·`);
  });

  it("sign-up is refused without the current version; choices are recorded with it", () =>
    tx(async () => {
      await fails(
        'INSERT INTO auth.users(id, raw_user_meta_data) VALUES ($1, \'{"full_name":"X"}\'::jsonb)',
        [ids.fresh],
        "Privacy notice must be accepted",
      );
      await fails(
        'INSERT INTO auth.users(id, raw_user_meta_data) VALUES ($1, \'{"privacy_notice_version":"0.9"}\'::jsonb)',
        [ids.fresh],
        "Privacy notice must be accepted",
      );
      await db.query(
        'INSERT INTO auth.users(id, raw_user_meta_data) VALUES ($1, \'{"privacy_notice_version":"1.1","updates_email_consent":true}\'::jsonb)',
        [ids.fresh],
      );
      expect(await status(ids.fresh)).toMatchObject({
        current_version: "1.1",
        accepted_version: "1.1",
        current_accepted: true,
        photo_consent: false,
        updates_email_consent: true,
      });
      expect(await status(ids.vol)).toMatchObject({
        photo_consent: true,
        updates_email_consent: false,
      });
    }));

  it("confirmation: only the current version; preferences change with their own timestamps", () =>
    tx(async () => {
      await as(ids.vol);
      await fails(
        "SELECT public.accept_privacy_notice('0.9')",
        [],
        "Privacy notice version is out of date",
      );
      await db.query("SELECT public.accept_privacy_notice('1.1')"); // idempotent
      const before = await status(ids.vol);
      await as(ids.vol);
      await db.query("SELECT public.set_consent_preferences(true, true)");
      const after = await status(ids.vol);
      expect(after).toMatchObject({ photo_consent: true, updates_email_consent: true });
      expect(after["photo_consent_changed_at"]).toBe(before["photo_consent_changed_at"]); // unchanged value, same time
      expect(after["updates_email_consent_changed_at"]).not.toBeNull();
      await as(ids.vol);
      await fails(
        "SELECT public.set_consent_preferences(NULL, true)",
        [],
        "Invalid consent values",
      );
    }));

  it("RLS: own rows only, no direct writes, internal helper not callable", () =>
    tx(async () => {
      await as(ids.vol);
      expect(
        (await db.query("SELECT user_id FROM public.privacy_notice_acceptances")).rows,
      ).toEqual([{ user_id: ids.vol }]);
      expect((await db.query("SELECT user_id FROM public.consent_preferences")).rows).toEqual([
        { user_id: ids.vol },
      ]);
      await fails(
        "INSERT INTO public.privacy_notice_acceptances(user_id, notice_version) VALUES ($1,'1.1')",
        [ids.other],
        "permission denied",
      );
      await fails(
        "UPDATE public.consent_preferences SET photo_consent=false",
        [],
        "permission denied",
      );
      await fails(
        "SELECT public.record_privacy_choices($1,true,true)",
        [ids.vol],
        "permission denied",
      );
    }));

  it("without the current confirmation, event data is hidden (restrictive policy)", () =>
    tx(async () => {
      await as(ids.bm);
      await db.query("SELECT public.create_event($1::jsonb)", [
        JSON.stringify({ title: "Event", scope: "branch", branch_id: ids.branch, status: "draft" }),
      ]);
      expect((await db.query("SELECT id FROM public.events")).rows).toHaveLength(1);
      await as(null);
      await db.query(
        "UPDATE public.privacy_notice_acceptances SET notice_version='0.9' WHERE user_id=$1",
        [ids.bm],
      ); // as if the notice changed
      await as(ids.bm);
      expect((await db.query("SELECT id FROM public.events")).rows).toHaveLength(0);
      expect((await status(ids.bm))["current_accepted"]).toBe(false);
      await as(ids.bm);
      await db.query("SELECT public.accept_privacy_notice('1.1')");
      expect((await db.query("SELECT id FROM public.events")).rows).toHaveLength(1);
    }));

  it("every client write RPC checks the confirmation first (only the confirmation and erasure are exempt)", async () => {
    // Client-callable SECURITY DEFINER functions that are not plain reads. A new write RPC must start with
    // PERFORM public.require_privacy_accepted(); or be added to EXEMPT with a reason.
    const EXEMPT = ["accept_privacy_notice", "request_account_deletion", "cancel_account_deletion"];
    const rows = (
      await db.query<{ name: string; checked: boolean }>(`SELECT p.proname name,
          p.prosrc ~ 'PERFORM public\\.require_privacy_accepted\\(\\);' checked
        FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.prosecdef
          AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
          AND p.proname !~ '^(get_|list_|can_|has_|is_)' AND p.proname NOT IN ('open_series', 'session_ok')`)
    ).rows;
    expect(rows.length).toBeGreaterThanOrEqual(38);
    expect(rows.filter((r) => !r.checked && !EXEMPT.includes(r.name)).map((r) => r.name)).toEqual(
      [],
    );
    expect(rows.filter((r) => r.checked && EXEMPT.includes(r.name)).map((r) => r.name)).toEqual([]);
  });

  it("without the current confirmation, write RPCs are refused; account deletion still works", () =>
    tx(async () => {
      await as(null);
      await db.query("DELETE FROM public.privacy_notice_acceptances WHERE user_id = ANY($1)", [
        [ids.vol, ids.bm],
      ]);
      await as(ids.vol);
      await fails(
        "SELECT public.set_consent_preferences(true, true)",
        [],
        "Privacy notice not accepted",
      );
      await fails(
        "SELECT public.register_for_event($1)",
        [ids.region],
        "Privacy notice not accepted",
      );
      await fails(
        "SELECT public.submit_event_request('{}'::jsonb)",
        [],
        "Privacy notice not accepted",
      );
      await db.query("SELECT public.request_account_deletion()");
      await db.query("SELECT public.cancel_account_deletion()");
      await fails("SELECT public.require_privacy_accepted()", [], "permission denied");
      await as(ids.bm);
      await fails(
        "SELECT public.set_user_status($1, 'inactive')",
        [ids.vol],
        "Privacy notice not accepted",
      );
      await db.query("SELECT public.accept_privacy_notice('1.1')");
      await db.query("SELECT public.set_user_status($1, 'active')", [ids.vol]);
    }));

  it("erasure: the confirmation stays as an anonymous record, the preferences go", () =>
    tx(async () => {
      await as(null);
      await db.query("DELETE FROM auth.users WHERE id=$1", [ids.other]);
      expect(
        (
          await db.query(
            "SELECT user_id FROM public.privacy_notice_acceptances WHERE user_id IS NULL",
          )
        ).rows,
      ).toHaveLength(1);
      expect(
        (await db.query("SELECT 1 FROM public.consent_preferences WHERE user_id=$1", [ids.other]))
          .rows,
      ).toEqual([]);
    }));
});

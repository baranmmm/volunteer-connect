import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { initializeRecycleDatabase } from "./recycle-db-fixture";

// Web Push (20261212090000) against every migration in PGlite: push_subscriptions are reached only through the own-row
// RPCs (no table access for anon or authenticated, NCs included), push settings per type with their defaults, and
// notify() / the grouped review notice queueing one push per device when the type's push is on. Rolled back per test.
const db = new PGlite();
const id = (n: number) => {
  const h = n.toString(16).padStart(2, "0");
  return `${h.repeat(4)}-${h.repeat(2)}-4${h}${h[0]}-8${h}${h[0]}-${h.repeat(6)}`;
};
const ids = {
  region: id(1),
  b1: id(2),
  bm: id(10),
  vol: id(11),
  vol2: id(12),
  nc: id(13),
  fol: id(14),
};
const KEY = "B" + "a".repeat(86); // 87 base64url characters (a 65-byte point)
const AUTH = "c".repeat(22); // 16 bytes

async function as(user: string | null, aal: "aal1" | "aal2" = "aal1") {
  await db.exec("RESET ROLE");
  await db.query(
    "SELECT set_config('request.jwt.claim.sub',$1,true), set_config('request.jwt.claim.aal',$2,true)",
    [user ?? "", aal],
  );
  if (user) await db.exec("SET LOCAL ROLE authenticated");
}
async function anon() {
  await db.exec("RESET ROLE");
  await db.query("SELECT set_config('request.jwt.claim.sub','',true)");
  await db.exec("SET LOCAL ROLE anon");
}
/** As the database itself (service role / internal), with an optional acting user for auth.uid(). */
async function system(actor: string | null = null) {
  await db.exec("RESET ROLE");
  await db.query("SELECT set_config('request.jwt.claim.sub',$1,true)", [actor ?? ""]);
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
async function one<T>(sql: string, params: unknown[] = []) {
  return (await db.query<{ v: T }>(sql, params)).rows[0]!.v;
}
const register = (endpoint: string, label = "Chrome on Android") =>
  db.query("SELECT public.register_push_subscription($1, $2, $3, $4)", [
    endpoint,
    KEY,
    AUTH,
    label,
  ]);
type Device = { id: string; user_agent: string | null; current: boolean };
const listMine = async (endpoint: string | null = null) =>
  one<Device[]>("SELECT public.list_my_push_subscriptions($1) v", [endpoint]);
const pending = async (user: string) => {
  await system();
  return (
    await db.query<{ type: string; endpoint: string; kind: string }>(
      `SELECT o.type, s.endpoint, n.kind FROM push_outbox o JOIN push_subscriptions s ON s.id = o.subscription_id
       JOIN notifications n ON n.id = o.notification_id WHERE o.user_id = $1 AND o.status = 'pending' ORDER BY s.endpoint`,
      [user],
    )
  ).rows;
};
const notify = async (actor: string, user: string, kind: string, entity = "task") => {
  await system(actor);
  return one<string | null>(
    `SELECT public.notify($1, $2, $3, gen_random_uuid(), 'Private title', '/tasks', '{}'::jsonb) v`,
    [user, kind, entity],
  );
};

beforeAll(async () => {
  await initializeRecycleDatabase(db);
  await db.exec(`INSERT INTO regions(id,name) VALUES ('${ids.region}','Region');
    INSERT INTO branches(id,name,region_id) VALUES ('${ids.b1}','Riverside','${ids.region}');
    INSERT INTO auth.users(id, raw_user_meta_data) SELECT x, jsonb_build_object('full_name','Person '||left(x::text,2),'privacy_notice_version','1.4')
      FROM unnest(ARRAY['${ids.bm}','${ids.vol}','${ids.vol2}','${ids.nc}']::uuid[]) x;
    INSERT INTO auth.users(id, raw_user_meta_data) VALUES ('${ids.fol}', jsonb_build_object('full_name','Follower',
      'privacy_notice_version','1.4','branch_id','${ids.b1}','follower',true));
    UPDATE profiles SET status='active', branch_id='${ids.b1}' WHERE id <> '${ids.fol}';
    UPDATE profiles SET branch_id=NULL WHERE id='${ids.nc}';
    UPDATE user_roles SET role='branch_manager' WHERE user_id='${ids.bm}';
    UPDATE user_roles SET role='national_coordinator' WHERE user_id='${ids.nc}';`);
}, 60000);
afterAll(async () => db.close());

describe("push_subscriptions access", () => {
  it("no direct table access for anon or authenticated (NCs included); RLS is on", () =>
    tx(async () => {
      await as(ids.vol);
      await register("https://push.example.test/vol");
      for (const table of ["push_subscriptions", "push_outbox"]) {
        await fails(`SELECT * FROM public.${table}`, [], "permission denied");
        await fails(
          `INSERT INTO public.${table}(user_id) VALUES ('${ids.vol}')`,
          [],
          "permission denied",
        );
        await fails(`DELETE FROM public.${table}`, [], "permission denied");
      }
      await as(ids.nc, "aal2");
      await fails("SELECT * FROM public.push_subscriptions", [], "permission denied");
      await anon();
      await fails("SELECT * FROM public.push_subscriptions", [], "permission denied");
      await system();
      const rls = await one<boolean[]>(
        "SELECT array_agg(relrowsecurity ORDER BY relname) v FROM pg_class WHERE relname IN ('push_subscriptions','push_outbox') AND relnamespace='public'::regnamespace",
      );
      expect(rls).toEqual([true, true]);
    }));

  it("a member registers, lists and removes only their own devices; labels only, never endpoints or keys", () =>
    tx(async () => {
      await as(ids.vol);
      await register("https://push.example.test/vol-phone");
      await register("https://push.example.test/vol-laptop", "Firefox on Windows");
      const mine = await listMine("https://push.example.test/vol-phone");
      expect(mine.map((d) => [d.user_agent, d.current]).sort()).toEqual([
        ["Chrome on Android", true],
        ["Firefox on Windows", false],
      ]);
      expect(JSON.stringify(mine)).not.toMatch(/push\.example|aaaa|cccc/);

      // Another volunteer and an NC see nothing of them and cannot remove them.
      await as(ids.vol2);
      expect(await listMine()).toEqual([]);
      expect(
        await one<boolean>("SELECT public.unregister_push_subscription(NULL, $1) v", [mine[0]!.id]),
      ).toBe(false);
      expect(
        await one<boolean>("SELECT public.unregister_push_subscription($1) v", [
          "https://push.example.test/vol-phone",
        ]),
      ).toBe(false);
      await as(ids.nc, "aal2");
      expect(await listMine()).toEqual([]);
      await as(ids.nc, "aal1");
      await fails(
        "SELECT public.register_push_subscription($1,$2,$3,$4)",
        ["https://push.example.test/nc", KEY, AUTH, null],
        "Not allowed",
      );
      await as(ids.nc, "aal2");
      await register("https://push.example.test/nc", "Safari on Mac");
      expect((await listMine()).map((d) => d.user_agent)).toEqual(["Safari on Mac"]);

      // The owner removes one by endpoint (this device) and one by id (another device).
      await as(ids.vol);
      expect(
        await one<boolean>("SELECT public.unregister_push_subscription($1) v", [
          "https://push.example.test/vol-phone",
        ]),
      ).toBe(true);
      const left = await listMine();
      expect(left).toHaveLength(1);
      expect(
        await one<boolean>("SELECT public.unregister_push_subscription(NULL, $1) v", [left[0]!.id]),
      ).toBe(true);
      expect(await listMine()).toEqual([]);
    }));

  it("anon cannot call the RPCs; followers and invalid subscriptions are refused; server functions are service-only", () =>
    tx(async () => {
      await anon();
      for (const sql of [
        "SELECT public.register_push_subscription('https://x.test/a', 'k', 'a', NULL)",
        "SELECT public.unregister_push_subscription('https://x.test/a')",
        "SELECT public.list_my_push_subscriptions()",
        "SELECT public.set_notification_push('meeting', false)",
        "SELECT public.claim_push_batch(10)",
      ])
        await fails(sql, [], "permission denied");
      await as(ids.fol);
      await fails(
        "SELECT public.register_push_subscription($1,$2,$3,$4)",
        ["https://push.example.test/fol", KEY, AUTH, null],
        "Not allowed",
      );
      await as(ids.vol);
      for (const [endpoint, key, auth] of [
        ["http://push.example.test/insecure", KEY, AUTH],
        ["https://push.example.test/x", "short", AUTH],
        ["https://push.example.test/x", KEY, "bad auth secret!!!!!!!"],
      ])
        await fails(
          "SELECT public.register_push_subscription($1,$2,$3,NULL)",
          [endpoint, key, auth],
          "Invalid push subscription",
        );
      for (const sql of [
        "SELECT public.claim_push_batch(10)",
        `SELECT public.finish_push('${id(99)}', 'sent')`,
        `SELECT public.queue_push('${ids.vol}', '${id(99)}', 'meeting')`,
      ])
        await fails(sql, [], "permission denied");
    }));

  it("the same browser used by another member moves to them and drops the previous owner's waiting pushes", () =>
    tx(async () => {
      await as(ids.vol);
      await register("https://push.example.test/shared");
      await notify(ids.bm, ids.vol, "task_assigned");
      expect(await pending(ids.vol)).toHaveLength(1);
      await as(ids.vol2);
      await register("https://push.example.test/shared", "Chrome on Windows");
      expect(await pending(ids.vol)).toEqual([]);
      await as(ids.vol);
      expect(await listMine()).toEqual([]);
      await as(ids.vol2);
      expect((await listMine()).map((d) => d.user_agent)).toEqual(["Chrome on Windows"]);
    }));

  it("at most 10 devices per person (the least recently used goes); a soft delete removes them all", () =>
    tx(async () => {
      await as(ids.vol);
      for (let i = 0; i < 11; i++) await register(`https://push.example.test/d${i}`, `Device ${i}`);
      const mine = await listMine();
      expect(mine).toHaveLength(10);
      await system();
      await db.query("UPDATE profiles SET deleted_at = now() WHERE id = $1", [ids.vol]);
      expect(
        await one<number>("SELECT count(*)::int v FROM push_subscriptions WHERE user_id=$1", [
          ids.vol,
        ]),
      ).toBe(0);
    }));
});

describe("push settings and queueing", () => {
  it("defaults: push on for assignments, requests waiting for review and meetings; off for the rest", () =>
    tx(async () => {
      await as(ids.vol);
      const settings = await one<{ types: { type: string; push: boolean }[] }>(
        "SELECT public.get_notification_settings() v",
      );
      expect(Object.fromEntries(settings.types.map((s) => [s.type, s.push]))).toEqual({
        task_assigned: true,
        mention: false,
        review: true,
        task_status: false,
        task_note: false,
        task_reminder: false,
        meeting: true,
        request_decided: false,
      });
      // Any type can be switched, locked ones included; the other keys stay.
      expect(await one("SELECT public.set_notification_push('task_assigned', false) v")).toEqual({
        type: "task_assigned",
        enabled: true,
        email: true,
        push: false,
      });
      expect(await one("SELECT public.set_notification_push('mention', true) v")).toMatchObject({
        push: true,
      });
      await fails("SELECT public.set_notification_push('other', true)", [], "Not allowed");
      await fails("SELECT public.set_notification_push('meeting', NULL)", [], "Not allowed");
    }));

  it("notify() queues one push per device for types whose push is on, never for the actor, off types or off in-app types", () =>
    tx(async () => {
      await as(ids.vol);
      await register("https://push.example.test/a");
      await register("https://push.example.test/b");
      // On by default: an assignment, a task group, a meeting change -> one push per device.
      await notify(ids.bm, ids.vol, "task_assigned");
      expect((await pending(ids.vol)).map((r) => r.endpoint)).toEqual([
        "https://push.example.test/a",
        "https://push.example.test/b",
      ]);
      await notify(ids.bm, ids.vol, "task_group_created");
      await notify(ids.bm, ids.vol, "meeting_changed", "meeting");
      expect((await pending(ids.vol)).map((r) => r.kind).sort()).toEqual([
        "meeting_changed",
        "meeting_changed",
        "task_assigned",
        "task_assigned",
        "task_group_created",
        "task_group_created",
      ]);
      // Off by default (mention, task status): a notice and maybe an email, but no push.
      await system();
      await db.exec("DELETE FROM push_outbox");
      expect(await notify(ids.bm, ids.vol, "task_note_mention")).not.toBeNull();
      expect(await notify(ids.bm, ids.vol, "task_status_changed")).not.toBeNull();
      expect(await pending(ids.vol)).toEqual([]);
      // The actor is never notified.
      await notify(ids.vol, ids.vol, "task_assigned");
      expect(await pending(ids.vol)).toEqual([]);
      // Push turned off: nothing queued, and waiting pushes of that type are skipped.
      await notify(ids.bm, ids.vol, "meeting_invited", "meeting");
      expect(await pending(ids.vol)).toHaveLength(2);
      await as(ids.vol);
      await db.query("SELECT public.set_notification_push('meeting', false)");
      expect(await pending(ids.vol)).toEqual([]);
      await notify(ids.bm, ids.vol, "meeting_invited", "meeting");
      expect(await pending(ids.vol)).toEqual([]);
      // In the app off: no notice, so no push either (even with push on).
      await as(ids.vol);
      await db.query("SELECT public.set_notification_push('meeting', true)");
      await db.query("SELECT public.set_notification_setting('meeting', false, 'immediate')");
      expect(await notify(ids.bm, ids.vol, "meeting_invited", "meeting")).toBeNull();
      expect(await pending(ids.vol)).toEqual([]);
      // Without devices nothing is queued and the notice is created as before.
      expect(await notify(ids.bm, ids.vol2, "task_assigned")).not.toBeNull();
      expect(await pending(ids.vol2)).toEqual([]);
    }));

  it("the grouped review notice pushes when it is created and when its count goes up (one waiting push reused)", () =>
    tx(async () => {
      await as(ids.bm);
      await register("https://push.example.test/bm");
      const ask = async (title: string) => {
        await system(ids.vol);
        await db.query(
          `INSERT INTO task_requests(scope, title, requester_id, target_id, branch_id, region_id)
           VALUES ('branch', $1, $2, $3, $4, $5)`,
          [title, ids.vol, ids.bm, ids.b1, ids.region],
        );
      };
      await ask("First");
      expect(await pending(ids.bm)).toEqual([
        { type: "review", endpoint: "https://push.example.test/bm", kind: "review_waiting" },
      ]);
      await ask("Second");
      expect(await pending(ids.bm)).toHaveLength(1);
      await system();
      await db.exec("UPDATE push_outbox SET status='sent'");
      await ask("Third");
      expect(await pending(ids.bm)).toHaveLength(1);
    }));

  it("the sender claims what applies, skips read notices, retries with back-off and deletes gone subscriptions", () =>
    tx(async () => {
      await as(ids.vol);
      await register("https://push.example.test/a");
      await register("https://push.example.test/b");
      const first = await notify(ids.bm, ids.vol, "task_assigned");
      const read = await notify(ids.bm, ids.vol, "meeting_invited", "meeting");
      await system();
      await db.query("UPDATE notifications SET read_at = now() WHERE id = $1", [read]);
      type Claimed = {
        id: string;
        endpoint: string;
        p256dh: string;
        auth: string;
        kind: string;
        link: string;
        notification_id: string;
        language: string;
      };
      const claimed = (await db.query<Claimed>("SELECT * FROM public.claim_push_batch(10)")).rows;
      expect(claimed.map((c) => [c.endpoint, c.kind, c.notification_id, c.p256dh, c.auth])).toEqual(
        [
          ["https://push.example.test/a", "task_assigned", first, KEY, AUTH],
          ["https://push.example.test/b", "task_assigned", first, KEY, AUTH],
        ],
      );
      expect(claimed[0]).toMatchObject({ link: "/tasks", language: "en" });
      expect(
        await one<string[]>(
          "SELECT array_agg(last_error) v FROM push_outbox WHERE status='skipped'",
        ),
      ).toEqual(["no_longer_applies", "no_longer_applies"]);
      // Nothing is claimed twice.
      expect((await db.query("SELECT * FROM public.claim_push_batch(10)")).rows).toEqual([]);

      await db.query("SELECT public.finish_push($1, 'sent')", [claimed[0]!.id]);
      await db.query("SELECT public.finish_push($1, 'retry', 'http_503')", [claimed[1]!.id]);
      const rows = (
        await db.query<{ status: string; not_before: string | null; last_used: string | null }>(
          `SELECT o.status, o.not_before, s.last_used_at last_used FROM push_outbox o
           JOIN push_subscriptions s ON s.id = o.subscription_id WHERE o.id = ANY($1::uuid[]) ORDER BY s.endpoint`,
          [[claimed[0]!.id, claimed[1]!.id]],
        )
      ).rows;
      expect(rows[0]).toMatchObject({ status: "sent" });
      expect(rows[0]!.last_used).not.toBeNull();
      expect(rows[1]!.status).toBe("pending");
      expect(new Date(rows[1]!.not_before!).getTime()).toBeGreaterThan(Date.now());
      // Not yet due: not claimed.
      expect((await db.query("SELECT * FROM public.claim_push_batch(10)")).rows).toEqual([]);

      // 404/410 from the push service: the device is removed with its waiting pushes.
      await db.exec("UPDATE push_outbox SET not_before = NULL");
      const again = (await db.query<Claimed>("SELECT * FROM public.claim_push_batch(10)")).rows;
      expect(again).toHaveLength(1);
      await db.query("SELECT public.finish_push($1, 'gone')", [again[0]!.id]);
      expect(
        await one<string[]>(
          "SELECT array_agg(endpoint) v FROM push_subscriptions WHERE user_id=$1",
          [ids.vol],
        ),
      ).toEqual(["https://push.example.test/a"]);
    }));

  it("pending pushes expire after a day; a deactivated member's pushes are skipped", () =>
    tx(async () => {
      await as(ids.vol);
      await register("https://push.example.test/a");
      await notify(ids.bm, ids.vol, "task_assigned");
      await system();
      await db.exec("UPDATE push_outbox SET created_at = now() - interval '25 hours'");
      expect((await db.query("SELECT * FROM public.claim_push_batch(10)")).rows).toEqual([]);
      expect(await one<string>("SELECT last_error v FROM push_outbox")).toBe("expired");
      await db.exec("DELETE FROM push_outbox");
      await notify(ids.bm, ids.vol, "task_assigned");
      await system();
      await db.query("UPDATE profiles SET status='inactive' WHERE id=$1", [ids.vol]);
      expect((await db.query("SELECT * FROM public.claim_push_batch(10)")).rows).toEqual([]);
    }));
});

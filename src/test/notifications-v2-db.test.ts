import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { initializeRecycleDatabase } from "./recycle-db-fixture";

// Less notification noise: who gets which notice, settings and the daily summary, the grouped "waiting for you"
// notice, and assignees' own reminders. Every migration in PGlite; each test is rolled back.
const db = new PGlite();
const id = (n: number) => {
  const h = n.toString(16).padStart(2, "0");
  return `${h.repeat(4)}-${h.repeat(2)}-4${h}${h[0]}-8${h}${h[0]}-${h.repeat(6)}`;
};
const ids = {
  region: id(1),
  b1: id(2),
  rd: id(10),
  bm1: id(11),
  vol1: id(12),
  vol1b: id(13),
  follower: id(17),
};
type Row = Record<string, unknown>;

async function as(user: string | null, aal = "aal1") {
  await db.exec("RESET ROLE");
  await db.query(
    "SELECT set_config('request.jwt.claim.sub',$1,true), set_config('request.jwt.claim.aal',$2,true)",
    [user ?? "", aal],
  );
  if (user) await db.exec("SET LOCAL ROLE authenticated");
}
async function q<T = Row>(sql: string, params: unknown[] = []) {
  return (await db.query<T>(sql, params)).rows;
}
async function one<T = unknown>(sql: string, params: unknown[] = []) {
  const row = (await db.query<{ v: T }>(sql, params)).rows[0];
  return row?.v as T;
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
const createTask = (p: Row) =>
  one<string>("SELECT public.create_task($1::jsonb) v", [JSON.stringify(p)]);
/** Notices as stored (service view), held or not. */
const stored = async (user: string, kind?: string) => {
  await as(null);
  return q<{
    id: string;
    kind: string;
    held: boolean;
    read_at: string | null;
    digest_id: string | null;
    payload: Row;
  }>(
    "SELECT id, kind, held, read_at, digest_id, payload FROM notifications WHERE user_id=$1 AND ($2::text IS NULL OR kind=$2) ORDER BY created_at, id",
    [user, kind ?? null],
  );
};
const listed = async (user: string) => {
  await as(user);
  return ((await one<{ kind: string }[]>("SELECT public.list_my_notifications(50) v")) ?? []).map(
    (n) => n.kind,
  );
};

beforeAll(async () => {
  await initializeRecycleDatabase(db);
  const members = [ids.rd, ids.bm1, ids.vol1, ids.vol1b];
  await db.exec(`INSERT INTO regions(id,name) VALUES ('${ids.region}','Region');
    INSERT INTO branches(id,name,region_id) VALUES ('${ids.b1}','Riverside','${ids.region}');
    INSERT INTO auth.users(id, raw_user_meta_data) SELECT x, jsonb_build_object('full_name','Person '||left(x::text,2),'privacy_notice_version','1.3')
      FROM unnest(ARRAY['${members.join("','")}']::uuid[]) x;
    INSERT INTO auth.users(id, raw_user_meta_data) VALUES ('${ids.follower}', jsonb_build_object('full_name','Follower','privacy_notice_version','1.3','follower',true,'branch_id','${ids.b1}'));
    UPDATE profiles SET status='active';
    UPDATE profiles SET branch_id='${ids.b1}' WHERE id IN ('${ids.bm1}','${ids.vol1}','${ids.vol1b}');
    UPDATE profiles SET branch_id=NULL WHERE id = '${ids.rd}';
    UPDATE user_roles SET role='branch_manager' WHERE user_id='${ids.bm1}';
    UPDATE user_roles SET role='regional_director', region_id='${ids.region}' WHERE user_id='${ids.rd}';`);
}, 60000);
afterAll(async () => db.close());

describe("who is notified", () => {
  it("the creator hears only Blocked and Done; never about their own change; assignments always", () =>
    tx(async () => {
      await as(ids.bm1);
      const t = await createTask({
        scope: "branch",
        branch_id: ids.b1,
        title: "Chairs",
        assignee_ids: [ids.vol1],
      });
      expect((await stored(ids.vol1, "task_assigned")).map((n) => n.held)).toEqual([false]);
      await as(ids.vol1);
      await one("SELECT public.set_task_status($1,'in_progress') v", [t]);
      expect(await stored(ids.bm1, "task_status_changed")).toEqual([]);
      await as(ids.vol1);
      await one("SELECT public.set_task_status($1,'done') v", [t]);
      const done = await stored(ids.bm1, "task_status_changed");
      expect(done).toHaveLength(1);
      expect(done[0]!.payload).toMatchObject({ status: "done", branch: "Riverside" });
      // The creator's own change: nothing.
      await as(ids.bm1);
      await one("SELECT public.set_task_status($1,'blocked') v", [t]);
      expect(await stored(ids.bm1, "task_status_changed")).toHaveLength(1);
    }));
});

describe("settings and the daily summary", () => {
  it("Branch Managers get the daily summary by default; volunteers immediately; locked types cannot change", () =>
    tx(async () => {
      await as(ids.bm1);
      const s = await one<{
        default_delivery: string;
        types: { type: string; locked: boolean; delivery: string }[];
      }>("SELECT public.get_notification_settings() v");
      expect(s.default_delivery).toBe("digest");
      expect(s.types.find((x) => x.type === "task_assigned")).toMatchObject({
        locked: true,
        delivery: "immediate",
      });
      expect(s.types.find((x) => x.type === "task_status")).toMatchObject({
        locked: false,
        delivery: "digest",
      });
      await fails(
        "SELECT public.set_notification_setting('task_assigned', false, 'immediate')",
        [],
        "This notice cannot be changed",
      );
      await as(ids.vol1);
      expect(
        (await one<{ default_delivery: string }>("SELECT public.get_notification_settings() v"))
          .default_delivery,
      ).toBe("immediate");
    }));

  it("summary notices are held (not listed or counted) until 08:00 London, then come under one daily notice, once a day", () =>
    tx(async () => {
      await as(ids.bm1);
      const t = await createTask({
        scope: "branch",
        branch_id: ids.b1,
        title: "Posters",
        assignee_ids: [ids.vol1],
      });
      await as(ids.vol1);
      await one("SELECT public.set_task_status($1,'done') v", [t]);
      expect((await stored(ids.bm1, "task_status_changed")).map((n) => n.held)).toEqual([true]);
      expect(await listed(ids.bm1)).not.toContain("task_status_changed");
      await as(ids.bm1);
      expect(
        (await one<{ total: number }>("SELECT public.get_unread_notification_counts() v")).total,
      ).toBe(0);
      await as(null);
      expect(await one("SELECT public.run_notification_digest('2027-01-15 07:30+00') v")).toBe(0);
      expect(await one("SELECT public.run_notification_digest('2027-01-15 08:05+00') v")).toBe(1);
      expect(await one("SELECT public.run_notification_digest('2027-01-15 09:05+00') v")).toBe(0);
      const digest = await stored(ids.bm1, "daily_digest");
      expect(digest).toHaveLength(1);
      expect(digest[0]!.payload).toMatchObject({ count: 1, kinds: { task_status_changed: 1 } });
      const item = (await stored(ids.bm1, "task_status_changed"))[0]!;
      expect(item).toMatchObject({ held: false, digest_id: digest[0]!.id });
      expect(await listed(ids.bm1)).toEqual(
        expect.arrayContaining(["daily_digest", "task_status_changed"]),
      );
    }));

  it("a type turned off sends nothing; turned to immediately, it is listed at once", () =>
    tx(async () => {
      await as(ids.bm1);
      await one("SELECT public.set_notification_setting('task_status', false, 'digest') v");
      const t = await createTask({
        scope: "branch",
        branch_id: ids.b1,
        title: "Tea",
        assignee_ids: [ids.vol1],
      });
      await as(ids.vol1);
      await one("SELECT public.set_task_status($1,'blocked') v", [t]);
      expect(await stored(ids.bm1, "task_status_changed")).toEqual([]);
      await as(ids.bm1);
      await one("SELECT public.set_notification_setting('task_status', true, 'immediate') v");
      await as(ids.vol1);
      await one("SELECT public.set_task_status($1,'done') v", [t]);
      expect((await stored(ids.bm1, "task_status_changed")).map((n) => n.held)).toEqual([false]);
    }));
});

describe("task reminders are always immediate", () => {
  it("never held for the summary, even for a Branch Manager who picks digest; only on/off can change", () =>
    tx(async () => {
      await as(ids.bm1);
      const before = await one<{
        types: { type: string; delivery: string; delivery_locked: boolean }[];
      }>("SELECT public.get_notification_settings() v");
      expect(before.types.find((x) => x.type === "task_reminder")).toMatchObject({
        delivery: "immediate",
        delivery_locked: true,
      });
      expect(before.types.find((x) => x.type === "task_status")).toMatchObject({
        delivery_locked: false,
      });
      expect(
        await one("SELECT public.set_notification_setting('task_reminder', true, 'digest') v"),
      ).toMatchObject({ enabled: true, delivery: "immediate" });
      // A reminder for the Branch Manager (assigned to themselves by the Regional Director) goes out at once.
      await as(ids.rd);
      const t = await createTask({
        scope: "branch",
        branch_id: ids.b1,
        title: "Budget",
        due_date: "2027-01-18",
        assignee_ids: [ids.bm1],
        reminders: { before_days: [3], repeat_kind: "none" },
      });
      await as(null);
      expect(await one("SELECT public.run_task_reminders('2027-01-15 09:30+00') v")).toBe(1);
      expect((await stored(ids.bm1, "task_reminder")).map((n) => n.held)).toEqual([false]);
      // Turned off: no reminder notice.
      await as(ids.bm1);
      await one("SELECT public.set_notification_setting('task_reminder', false, 'immediate') v");
      await as(null);
      await db.exec(
        `DELETE FROM task_reminder_log WHERE task_id='${t}'; DELETE FROM notifications WHERE kind='task_reminder'`,
      );
      await one("SELECT public.run_task_reminders('2027-01-15 09:30+00') v");
      expect(await stored(ids.bm1, "task_reminder")).toEqual([]);
    }));
});

describe("requests waiting for review", () => {
  it("one grouped notice per reviewer, updated in place, gone when nothing waits; counts include applications", () =>
    tx(async () => {
      await as(ids.vol1);
      const a = await one<string>("SELECT public.submit_task_request($1::jsonb) v", [
        JSON.stringify({ target_id: ids.bm1, title: "Hall" }),
      ]);
      const first = await stored(ids.bm1, "review_waiting");
      expect(first).toHaveLength(1);
      expect(first[0]!.payload).toMatchObject({ total: 1, work: 1, branches: ["Riverside"] });
      await as(ids.vol1);
      const b = await one<string>("SELECT public.submit_task_request($1::jsonb) v", [
        JSON.stringify({ target_id: ids.bm1, title: "Tea" }),
      ]);
      const second = await stored(ids.bm1, "review_waiting");
      expect(second.map((n) => n.id)).toEqual([first[0]!.id]);
      expect(second[0]!.payload).toMatchObject({ total: 2 });
      // A volunteer application in the branch waits for the Branch Manager and the Regional Director.
      await as(null);
      await db.exec(
        `INSERT INTO volunteer_applications(user_id, branch_id, motivation, status) VALUES ('${ids.follower}','${ids.b1}','Helping out','submitted')`,
      );
      expect((await stored(ids.bm1, "review_waiting"))[0]!.payload).toMatchObject({
        total: 3,
        applications: 1,
      });
      expect((await stored(ids.rd, "review_waiting"))[0]!.payload).toMatchObject({
        total: 1,
        applications: 1,
      });
      await as(ids.bm1);
      expect(await one("SELECT public.get_review_waiting() v")).toMatchObject({ total: 3 });
      await one("SELECT public.accept_task_request($1) v", [a]);
      await one("SELECT public.decline_task_request($1, 'Not this month, sorry') v", [b]);
      await as(null);
      await db.exec(
        `UPDATE volunteer_applications SET status='withdrawn' WHERE user_id='${ids.follower}'`,
      );
      expect(await stored(ids.bm1, "review_waiting")).toEqual([]);
    }));
});

describe("assignees' own reminders", () => {
  it("apply only to that assignee, also when the task's reminders are muted; stop when done or unassigned", () =>
    tx(async () => {
      await as(ids.bm1);
      const t = await createTask({
        scope: "branch",
        branch_id: ids.b1,
        title: "Leaflets",
        due_date: "2027-01-16",
        assignee_ids: [ids.vol1, ids.vol1b],
      });
      await as(ids.vol1);
      await one("SELECT public.set_task_reminder_mute($1, true) v", [t]);
      expect(
        await one("SELECT public.set_my_task_reminders($1, $2::jsonb) v", [
          t,
          JSON.stringify({ before_days: [1], repeat_kind: "none" }),
        ]),
      ).toMatchObject({ before_days: [1] });
      // Somebody else's own reminders cannot be set; a non-assignee cannot set any.
      await as(ids.bm1);
      await fails(
        "SELECT public.set_my_task_reminders($1, $2::jsonb)",
        [t, JSON.stringify({ before_days: [1] })],
        "Not allowed",
      );
      await as(null);
      expect(await one("SELECT public.run_task_reminders('2027-01-15 09:30+00') v")).toBe(1);
      expect(await q("SELECT user_id FROM task_reminder_log WHERE task_id=$1", [t])).toEqual([
        { user_id: ids.vol1 },
      ]);
      // Done: no more reminders. Unassigned: the own settings go with the assignment.
      await db.exec(`DELETE FROM task_reminder_log WHERE task_id='${t}'`);
      await db.exec(`UPDATE tasks SET status='done' WHERE id='${t}'`);
      expect(await one("SELECT public.run_task_reminders('2027-01-15 09:30+00') v")).toBe(0);
      await db.exec(`UPDATE tasks SET status='todo' WHERE id='${t}'`);
      await as(ids.bm1);
      await db.query("SELECT public.update_task($1, $2::jsonb)", [
        t,
        JSON.stringify({ assignee_ids: [ids.vol1b] }),
      ]);
      await as(null);
      expect(await one("SELECT public.run_task_reminders('2027-01-15 09:30+00') v")).toBe(0);
      // Clearing them: nothing on.
      await as(ids.vol1b);
      expect(await one("SELECT public.set_my_task_reminders($1, NULL) v", [t])).toBeNull();
    }));
});

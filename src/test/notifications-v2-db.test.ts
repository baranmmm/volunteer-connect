import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { initializeRecycleDatabase } from "./recycle-db-fixture";

// Less notification noise: who gets which notice, settings and the daily summary email, the grouped "waiting for you"
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
/** Notices as stored (service view). */
const stored = async (user: string, kind?: string) => {
  await as(null);
  return q<{
    id: string;
    kind: string;
    held: boolean;
    email_digest: boolean;
    email_digested_at: string | null;
    read_at: string | null;
    digest_id: string | null;
    payload: Row;
  }>(
    "SELECT id, kind, held, email_digest, email_digested_at, read_at, digest_id, payload FROM notifications WHERE user_id=$1 AND ($2::text IS NULL OR kind=$2) ORDER BY created_at, id",
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
    INSERT INTO auth.users(id, raw_user_meta_data) SELECT x, jsonb_build_object('full_name','Person '||left(x::text,2),'privacy_notice_version','1.4')
      FROM unnest(ARRAY['${members.join("','")}']::uuid[]) x;
    INSERT INTO auth.users(id, raw_user_meta_data) VALUES ('${ids.follower}', jsonb_build_object('full_name','Follower','privacy_notice_version','1.4','follower',true,'branch_id','${ids.b1}'));
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

type Setting = {
  type: string;
  locked: boolean;
  enabled: boolean;
  email: boolean;
  email_timing: string;
};
const settings = async (user: string) => {
  await as(user);
  return (await one<{ types: Setting[] }>("SELECT public.get_notification_settings() v")).types;
};
const outbox = async (user: string, template?: string) => {
  await as(null);
  return q<{
    template: string;
    status: string;
    priority: number;
    notification_id: string | null;
    payload: Row;
  }>(
    "SELECT template, status, priority, notification_id, payload FROM email_outbox WHERE user_id=$1 AND ($2::text IS NULL OR template=$2) ORDER BY created_at, id",
    [user, template ?? null],
  );
};

describe("settings: in-app on/off, email on/off", () => {
  it("every email is on by default for every role; locked types stay on in the app; delivery is no longer a choice", () =>
    tx(async () => {
      for (const user of [ids.bm1, ids.vol1]) {
        const s = await settings(user);
        expect(s.map((x) => x.email)).toEqual(Array(8).fill(true));
        expect(s.map((x) => x.enabled)).toEqual(Array(8).fill(true));
      }
      const s = await settings(ids.bm1);
      expect(Object.fromEntries(s.map((x) => [x.type, x.email_timing]))).toEqual({
        task_assigned: "immediate",
        mention: "immediate",
        review: "immediate",
        task_status: "digest",
        task_note: "digest",
        task_reminder: "immediate",
        meeting: "mixed",
        request_decided: "digest",
      });
      expect(s.find((x) => x.type === "task_assigned")).toMatchObject({ locked: true });
      await as(ids.bm1);
      await fails(
        "SELECT public.set_notification_setting('task_assigned', false, 'immediate')",
        [],
        "This notice cannot be changed",
      );
      // The email of a locked type can be turned off; it stays on in the app.
      expect(
        await one("SELECT public.set_notification_email('task_assigned', false) v"),
      ).toMatchObject({ type: "task_assigned", enabled: true, email: false });
      // In-app off keeps the email choice, and the other way round.
      await one("SELECT public.set_notification_email('task_status', false) v");
      expect(
        await one("SELECT public.set_notification_setting('task_status', false, 'digest') v"),
      ).toMatchObject({ enabled: false, email: false });
      await one("SELECT public.set_notification_setting('task_status', true, 'immediate') v");
      expect((await settings(ids.bm1)).find((x) => x.type === "task_status")).toMatchObject({
        enabled: true,
        email: false,
      });
      await fails("SELECT public.set_notification_email('nope', false)", [], "Not allowed");
      // Task reminders: the email switch is the task reminder emails setting.
      await as(ids.bm1);
      await one("SELECT public.set_notification_email('task_reminder', false) v");
      expect(await one("SELECT public.get_notification_settings()->'task_reminder_emails' v")).toBe(
        false,
      );
      // Not callable without an account.
      await as(null);
      await db.exec("SET LOCAL ROLE anon");
      await fails(
        "SELECT public.set_notification_email('task_status', false)",
        [],
        "permission denied",
      );
    }));
});

describe("immediate notice emails", () => {
  it("an assignment and a meeting invitation queue one email each; nothing for a switched-off type, still in the app", () =>
    tx(async () => {
      await as(ids.bm1);
      await createTask({
        scope: "branch",
        branch_id: ids.b1,
        title: "Chairs",
        assignee_ids: [ids.vol1],
      });
      const assigned = await stored(ids.vol1, "task_assigned");
      expect(await outbox(ids.vol1)).toEqual([
        {
          template: "notice",
          status: "pending",
          priority: 2,
          notification_id: assigned[0]!.id,
          payload: { type: "task_assigned" },
        },
      ]);
      await as(ids.bm1);
      await one("SELECT public.create_meeting($1::jsonb) v", [
        JSON.stringify({
          scope: "branch",
          branch_id: ids.b1,
          title: "Planning",
          starts_at: "2027-02-01T18:00:00Z",
          ends_at: "2027-02-01T19:00:00Z",
          location_type: "in_person",
          location: "Hall",
          invitee_ids: [ids.vol1],
        }),
      ]);
      const invited = await stored(ids.vol1, "meeting_invited");
      expect(invited).toHaveLength(1);
      // Same transaction (same created_at): compare without order.
      const pairs = (await outbox(ids.vol1)).map(
        (m) => `${m.notification_id} ${String(m.payload["type"])}`,
      );
      expect(pairs.sort()).toEqual(
        [`${assigned[0]!.id} task_assigned`, `${invited[0]!.id} meeting`].sort(),
      );
      // Switched off: the notice still arrives in the app (locked type), no email; pending ones are cancelled.
      await as(ids.vol1);
      await one("SELECT public.set_notification_email('task_assigned', false) v");
      const byType = async () =>
        Object.fromEntries(
          (await outbox(ids.vol1, "notice")).map((m) => [m.payload["type"], m.status]),
        );
      expect(await byType()).toEqual({ task_assigned: "cancelled", meeting: "pending" });
      await as(ids.bm1);
      await createTask({
        scope: "branch",
        branch_id: ids.b1,
        title: "Tables",
        assignee_ids: [ids.vol1],
      });
      expect(await stored(ids.vol1, "task_assigned")).toHaveLength(2);
      expect(await listed(ids.vol1)).toEqual(expect.arrayContaining(["task_assigned"]));
      expect(await outbox(ids.vol1, "notice")).toHaveLength(2);
      // Digest kinds never get an immediate email.
      await as(ids.vol1);
      const t = await createTask({
        scope: "branch",
        branch_id: ids.b1,
        title: "Mine",
        assignee_ids: [ids.vol1b],
      });
      await as(ids.vol1b);
      await one("SELECT public.set_task_status($1,'done') v", [t]);
      expect(await stored(ids.vol1, "task_status_changed")).toMatchObject([{ email_digest: true }]);
      expect(await outbox(ids.vol1, "notice")).toHaveLength(2);
    }));

  it("the grouped review notice emails when it is created or its count goes up, once while one is waiting", () =>
    tx(async () => {
      await as(ids.vol1);
      const a = await one<string>("SELECT public.submit_task_request($1::jsonb) v", [
        JSON.stringify({ target_id: ids.bm1, title: "Hall" }),
      ]);
      expect((await outbox(ids.bm1, "notice")).map((m) => m.payload["type"])).toEqual(["review"]);
      // A second request while the first email waits: still one email (it shows the current count when sent).
      await as(ids.vol1);
      await one("SELECT public.submit_task_request($1::jsonb) v", [
        JSON.stringify({ target_id: ids.bm1, title: "Tea" }),
      ]);
      expect(await outbox(ids.bm1, "notice")).toHaveLength(1);
      // Sent; then a request is decided (count down): no email; a new request (count up): one more.
      await db.exec(
        `UPDATE email_outbox SET status='sent', sent_at=now() WHERE user_id='${ids.bm1}'`,
      );
      await as(ids.bm1);
      await one("SELECT public.accept_task_request($1) v", [a]);
      expect(await outbox(ids.bm1, "notice")).toHaveLength(1);
      await as(ids.vol1);
      await one("SELECT public.submit_task_request($1::jsonb) v", [
        JSON.stringify({ target_id: ids.bm1, title: "Keys" }),
      ]);
      expect((await outbox(ids.bm1, "notice")).map((m) => m.status).sort()).toEqual([
        "pending",
        "sent",
      ]);
      // Review email off: the grouped notice still updates in the app, no email.
      await as(ids.bm1);
      await one("SELECT public.set_notification_email('review', false) v");
      await as(ids.vol1);
      await one("SELECT public.submit_task_request($1::jsonb) v", [
        JSON.stringify({ target_id: ids.bm1, title: "Mugs" }),
      ]);
      expect((await stored(ids.bm1, "review_waiting"))[0]!.payload).toMatchObject({ total: 3 });
      expect((await outbox(ids.bm1, "notice")).map((m) => m.status).sort()).toEqual([
        "cancelled",
        "sent",
      ]);
    }));

  it("the sender's context: language, the notice with its actor, and whether it still applies", () =>
    tx(async () => {
      await as(null);
      await db.exec(`UPDATE profiles SET preferred_language='tr' WHERE id='${ids.vol1}'`);
      await as(ids.bm1);
      await createTask({
        scope: "branch",
        branch_id: ids.b1,
        title: "Chairs",
        assignee_ids: [ids.vol1],
      });
      await as(null);
      const mail = await one<string>("SELECT id v FROM email_outbox WHERE user_id=$1", [ids.vol1]);
      expect(await one("SELECT public.notice_email_context($1) v", [mail])).toMatchObject({
        language: "tr",
        type: "task_assigned",
        applies: true,
        notice: {
          kind: "task_assigned",
          title: "Chairs",
          actor_name: `Person ${ids.bm1.slice(0, 2)}`,
        },
      });
      await db.exec(`UPDATE notifications SET read_at=now() WHERE user_id='${ids.vol1}'`);
      expect(await one("SELECT public.notice_email_context($1)->'applies' v", [mail])).toBe(false);
      await as(ids.vol1);
      await fails("SELECT public.notice_email_context($1)", [mail], "permission denied");
    }));
});

describe("mentions are emailed at once", () => {
  it("one notice email per mention; none when the mention email is off (the mention is still in the app)", () =>
    tx(async () => {
      await as(ids.bm1);
      const t = await createTask({
        scope: "branch",
        branch_id: ids.b1,
        title: "Hall",
        assignee_ids: [ids.bm1],
      });
      await one("SELECT public.add_task_note($1, 'Ask @vol', $2::jsonb) v", [
        t,
        JSON.stringify([ids.vol1b]),
      ]);
      const mention = await stored(ids.vol1b, "task_note_mention");
      expect(mention).toMatchObject([{ email_digest: false }]);
      expect(await outbox(ids.vol1b, "notice")).toMatchObject([
        { notification_id: mention[0]!.id, payload: { type: "mention" }, priority: 2 },
      ]);
      await as(ids.vol1b);
      await one("SELECT public.set_notification_email('mention', false) v");
      await as(ids.bm1);
      await one("SELECT public.add_task_note($1, 'Again @vol', $2::jsonb) v", [
        t,
        JSON.stringify([ids.vol1b]),
      ]);
      expect(await stored(ids.vol1b, "task_note_mention")).toHaveLength(2);
      expect((await outbox(ids.vol1b, "notice")).map((m) => m.status)).toEqual(["cancelled"]);
    }));
});

describe("sending order, the Auth reserve and the 250 warning", () => {
  const seedSent = (n: number) =>
    db.exec(`INSERT INTO email_outbox (to_email, template, status, sent_at)
      SELECT 'x' || g || '@example.org', 'guest_confirm', 'sent', now() FROM generate_series(1, ${n}) g`);
  const queue = (template: string) =>
    one<string>(
      "INSERT INTO email_outbox (to_email, template) VALUES ('q@example.org', $1) RETURNING id v",
      [template],
    );

  it("priorities: transactional, notice, reminders, announcements, daily summary last", () =>
    tx(async () => {
      await as(null);
      const order = [
        "guest_confirm",
        "notice",
        "task_reminder",
        "event_reminder",
        "event_announcement",
        "daily_digest",
      ];
      expect(
        await q<{ t: string; p: number }>(
          "SELECT t, public.email_priority(t) AS p FROM unnest($1::text[]) t",
          [order],
        ),
      ).toEqual([
        { t: "guest_confirm", p: 1 },
        { t: "notice", p: 2 },
        { t: "task_reminder", p: 3 },
        { t: "event_reminder", p: 3 },
        { t: "event_announcement", p: 4 },
        { t: "daily_digest", p: 5 },
      ]);
      // Queued in the reverse order, claimed in priority order.
      for (const t of [
        "daily_digest",
        "event_announcement",
        "task_reminder",
        "notice",
        "registration_confirmed",
      ])
        await queue(t);
      expect(
        (await q<{ template: string }>("SELECT template FROM public.claim_email_batch(10, 5)")).map(
          (r) => r.template,
        ),
      ).toEqual([
        "registration_confirmed",
        "notice",
        "task_reminder",
        "event_announcement",
        "daily_digest",
      ]);
      // A run up to priority 4 leaves the daily summary for later.
      await db.exec(
        "UPDATE email_outbox SET status='pending', claimed_at=NULL WHERE status='sending'",
      );
      expect(
        (await q<{ template: string }>("SELECT template FROM public.claim_email_batch(10, 4)")).map(
          (r) => r.template,
        ),
      ).not.toContain("daily_digest");
    }));

  it("the app stops at 280 a day, leaving 20 of the 300 for Supabase Auth emails", () =>
    tx(async () => {
      await as(null);
      expect(await one("SELECT public.email_daily_limit() v")).toBe(280);
      expect(await one("SELECT public.email_provider_daily_limit() v")).toBe(300);
      await seedSent(278);
      for (let i = 0; i < 5; i++) await queue("guest_confirm");
      expect(await q("SELECT id FROM public.claim_email_batch(10, 5)")).toHaveLength(2);
      expect(await q("SELECT id FROM public.claim_email_batch(10, 5)")).toHaveLength(0);
    }));

  it("at 250 sent today: one in-app warning for each National Coordinator and Branch Manager, once a day", () =>
    tx(async () => {
      await as(null);
      const nc = id(14);
      await db.exec(`INSERT INTO auth.users(id, raw_user_meta_data) VALUES ('${nc}', jsonb_build_object('full_name','Coordinator','privacy_notice_version','1.3'));
        UPDATE profiles SET status='active', branch_id=NULL WHERE id='${nc}';
        UPDATE user_roles SET role='national_coordinator' WHERE user_id='${nc}';`);
      const warned = () =>
        q<{ user_id: string; payload: Row }>(
          "SELECT user_id, payload FROM notifications WHERE kind='email_budget_warning' ORDER BY user_id",
        );
      await seedSent(248);
      const a = await queue("notice");
      const b = await queue("notice");
      const c = await queue("notice");
      // 249 sent: nothing yet.
      await db.query("UPDATE email_outbox SET status='sent', sent_at=now() WHERE id=$1", [a]);
      expect(await warned()).toEqual([]);
      // 250: the warning, for the NC and the Branch Manager only (not the Regional Director, not volunteers).
      await db.query("UPDATE email_outbox SET status='sent', sent_at=now() WHERE id=$1", [b]);
      const first = await warned();
      expect(first.map((w) => w.user_id).sort()).toEqual([ids.bm1, nc].sort());
      expect(first[0]!.payload).toMatchObject({ sent: 250, limit: 300, app_limit: 280 });
      // 251 and another check the same day: no second warning. Never emailed.
      await db.query("UPDATE email_outbox SET status='sent', sent_at=now() WHERE id=$1", [c]);
      expect(await one("SELECT public.email_budget_check() v")).toBe(0);
      expect(await warned()).toHaveLength(2);
      expect(
        await one(
          "SELECT count(*)::int v FROM email_outbox o JOIN notifications n ON n.id=o.notification_id WHERE n.kind='email_budget_warning'",
        ),
      ).toBe(0);
      // Listed for the manager (in the app), with its own text key.
      expect(await listed(ids.bm1)).toContain("email_budget_warning");
      expect(await listed(ids.vol1)).not.toContain("email_budget_warning");
      // A captured test email (sent without a send time) does not count.
      await as(null);
      const d = await queue("notice");
      await db.query("UPDATE email_outbox SET status='sent', sent_at=NULL WHERE id=$1", [d]);
      expect(await one("SELECT public.emails_sent_today() v")).toBe(251);
    }));
});

describe("unsubscribe from one type (signed link, service role)", () => {
  it("turns off exactly that type's email; unknown types and deleted people are invalid; clients cannot call it", () =>
    tx(async () => {
      await as(null);
      expect(await one("SELECT public.notice_email_unsubscribe($1, 'meeting') v", [ids.vol1])).toBe(
        "unsubscribed",
      );
      const s = await settings(ids.vol1);
      expect(s.filter((x) => !x.email).map((x) => x.type)).toEqual(["meeting"]);
      expect(s.find((x) => x.type === "meeting")).toMatchObject({ enabled: true });
      await as(null);
      expect(
        await one("SELECT public.notice_email_unsubscribe($1, 'everything') v", [ids.vol1]),
      ).toBe("invalid");
      expect(await one("SELECT public.notice_email_unsubscribe($1, 'meeting') v", [id(99)])).toBe(
        "invalid",
      );
      await as(ids.vol1);
      await fails(
        "SELECT public.notice_email_unsubscribe($1, 'task_status')",
        [ids.vol1],
        "permission denied",
      );
    }));
});

describe("the daily summary email", () => {
  it("a manager's notice is listed and counted at once; it is marked for the email", () =>
    tx(async () => {
      // The Branch Manager asks the Regional Director for a task; the director accepts: a request decision.
      await as(ids.bm1);
      const r = await one<string>("SELECT public.submit_task_request($1::jsonb) v", [
        JSON.stringify({ target_id: ids.rd, title: "Hall" }),
      ]);
      await as(ids.rd);
      await one("SELECT public.accept_task_request($1) v", [r]);
      expect(await stored(ids.bm1, "task_request_accepted")).toMatchObject([
        { held: false, email_digest: true, email_digested_at: null, read_at: null },
      ]);
      expect(await listed(ids.bm1)).toContain("task_request_accepted");
      await as(ids.bm1);
      expect(
        await one<{ requests: number; total: number }>(
          "SELECT public.get_unread_notification_counts() v",
        ),
      ).toMatchObject({ requests: 1, total: 1 });
    }));

  it("the 08:00 run queues one summary email per person with the counts, marks the notices, once a day; never an empty one", () =>
    tx(async () => {
      await as(ids.bm1);
      const t = await createTask({
        scope: "branch",
        branch_id: ids.b1,
        title: "Posters",
        assignee_ids: [ids.vol1],
      });
      const r = await one<string>("SELECT public.submit_task_request($1::jsonb) v", [
        JSON.stringify({ target_id: ids.rd, title: "Hall" }),
      ]);
      await as(ids.rd);
      await one("SELECT public.accept_task_request($1) v", [r]);
      await as(ids.vol1);
      await one("SELECT public.set_task_status($1,'done') v", [t]);
      const mails = () =>
        q<{ user_id: string; priority: number; payload: Row }>(
          "SELECT user_id, priority, payload FROM email_outbox WHERE template='daily_digest' ORDER BY user_id",
        );
      const log = () =>
        q<{ user_id: string; day: string; email_id: string | null }>(
          "SELECT user_id, day::text AS day, email_id FROM notification_digest_log ORDER BY user_id, day",
        );
      await as(null);
      expect(await one("SELECT public.run_notification_digest('2027-01-15 07:30+00') v")).toBe(0);
      expect(await mails()).toEqual([]);
      expect(await one("SELECT public.run_notification_digest('2027-01-15 08:05+00') v")).toBe(1);
      const queued = await mails();
      expect(queued).toHaveLength(1);
      expect(queued[0]).toMatchObject({ user_id: ids.bm1, priority: 5 });
      expect(queued[0]!.payload).toMatchObject({
        count: 2,
        kinds: { task_request_accepted: 1, task_status_changed: 1 },
        day: "2027-01-15",
      });
      expect([...(queued[0]!.payload["types"] as string[])].sort()).toEqual([
        "request_decided",
        "task_status",
      ]);
      const items = (await stored(ids.bm1)).filter((n) => n.email_digest);
      expect(items).toHaveLength(2);
      for (const n of items) expect(n).toMatchObject({ held: false, read_at: null });
      for (const n of items) expect(n.email_digested_at).not.toBeNull();
      expect(await stored(ids.bm1, "daily_digest")).toEqual([]);
      await as(null);
      const logged = await log();
      expect(logged).toHaveLength(1);
      expect(logged[0]!.email_id).toBe(
        await one("SELECT id v FROM email_outbox WHERE template='daily_digest'"),
      );
      // A second run the same day does nothing; an empty day: no email and no log row.
      expect(await one("SELECT public.run_notification_digest('2027-01-15 09:05+00') v")).toBe(0);
      expect(await one("SELECT public.run_notification_digest('2027-01-16 08:05+00') v")).toBe(0);
      expect(await mails()).toHaveLength(1);
      expect(await log()).toHaveLength(1);
    }));

  it("a notice after today's summary waits for tomorrow's; a type whose email is turned off is not counted", () =>
    tx(async () => {
      await as(ids.bm1);
      const t = await createTask({
        scope: "branch",
        branch_id: ids.b1,
        title: "Banners",
        assignee_ids: [ids.vol1],
      });
      await as(ids.vol1);
      await one("SELECT public.set_task_status($1,'blocked') v", [t]);
      await as(null);
      expect(await one("SELECT public.run_notification_digest('2027-01-15 08:05+00') v")).toBe(1);
      await as(ids.vol1);
      await one("SELECT public.set_task_status($1,'done') v", [t]);
      await as(null);
      expect(await one("SELECT public.run_notification_digest('2027-01-15 13:05+00') v")).toBe(0);
      expect(await one("SELECT public.run_notification_digest('2027-01-16 08:05+00') v")).toBe(1);
      // Marked, then the email turned off before 08:00: not counted, settled (not sent later either).
      await as(ids.vol1);
      await one("SELECT public.set_task_status($1,'blocked') v", [t]);
      await as(ids.bm1);
      await one("SELECT public.set_notification_email('task_status', false) v");
      await as(null);
      expect(await one("SELECT public.run_notification_digest('2027-01-17 08:05+00') v")).toBe(0);
      expect(
        await one("SELECT count(*)::int v FROM notification_digest_log WHERE day='2027-01-17'"),
      ).toBe(0);
      await as(ids.bm1);
      await one("SELECT public.set_notification_email('task_status', true) v");
      await as(null);
      expect(await one("SELECT public.run_notification_digest('2027-01-18 08:05+00') v")).toBe(0);
      // With the email off from the start the notice is not even marked; it is in the app.
      await as(ids.bm1);
      await one("SELECT public.set_notification_email('task_status', false) v");
      await as(ids.vol1);
      await one("SELECT public.set_task_status($1,'done') v", [t]);
      // Same transaction (same now()): the new one is the notice not summarised.
      const last = (await stored(ids.bm1, "task_status_changed")).filter(
        (n) => !n.email_digested_at,
      );
      expect(last).toMatchObject([{ email_digest: false, read_at: null }]);
    }));

  it("only notices still unread count: read before 08:00 → not counted (and never emailed later); all read → no email", () =>
    tx(async () => {
      await as(ids.bm1);
      const t1 = await createTask({
        scope: "branch",
        branch_id: ids.b1,
        title: "Seen",
        assignee_ids: [ids.vol1],
      });
      const t2 = await createTask({
        scope: "branch",
        branch_id: ids.b1,
        title: "Unseen",
        assignee_ids: [ids.vol1],
      });
      await as(ids.vol1);
      await one("SELECT public.set_task_status($1,'done') v", [t1]);
      await one("SELECT public.set_task_status($1,'blocked') v", [t2]);
      // The manager reads one of them in the app before the summary.
      await as(null);
      await db.exec(
        `UPDATE notifications SET read_at=now() WHERE user_id='${ids.bm1}' AND kind='task_status_changed' AND payload->>'status'='done'`,
      );
      expect(await one("SELECT public.run_notification_digest('2027-01-15 08:05+00') v")).toBe(1);
      expect(
        await one(
          "SELECT payload v FROM email_outbox WHERE template='daily_digest' AND user_id=$1",
          [ids.bm1],
        ),
      ).toMatchObject({ count: 1, kinds: { task_status_changed: 1 } });
      // Both are settled: the read one is never emailed later.
      expect((await stored(ids.bm1, "task_status_changed")).every((n) => n.email_digested_at)).toBe(
        true,
      );
      // Next day: two new notices, both read before 08:00 → no email and no log row.
      await as(ids.vol1);
      await one("SELECT public.set_task_status($1,'todo') v", [t1]);
      await one("SELECT public.set_task_status($1,'done') v", [t1]);
      await one("SELECT public.set_task_status($1,'done') v", [t2]);
      await as(null);
      await db.exec(`UPDATE notifications SET read_at=now() WHERE user_id='${ids.bm1}'`);
      expect(await one("SELECT public.run_notification_digest('2027-01-16 08:05+00') v")).toBe(0);
      expect(
        await one("SELECT count(*)::int v FROM email_outbox WHERE template='daily_digest'"),
      ).toBe(1);
      expect(
        await one("SELECT count(*)::int v FROM notification_digest_log WHERE day='2027-01-16'"),
      ).toBe(0);
      expect((await stored(ids.bm1, "task_status_changed")).every((n) => n.email_digested_at)).toBe(
        true,
      );
    }));

  it("a type turned off in the app creates no notice (and so no email)", () =>
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
      await as(null);
      expect(await one("SELECT public.run_notification_digest('2027-01-15 08:05+00') v")).toBe(0);
    }));
});

describe("task reminders keep their own email", () => {
  it("never in the summary email; the reminder email follows the task_reminder email switch; in-app on/off", () =>
    tx(async () => {
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
      expect(await stored(ids.bm1, "task_reminder")).toMatchObject([
        { held: false, email_digest: false },
      ]);
      expect((await outbox(ids.bm1)).map((m) => m.template).sort()).toEqual([
        "notice",
        "task_reminder",
      ]);
      // Turned off in the app: no reminder notice.
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

describe("task note notices", () => {
  it("every assignee hears about a note (never the author); a mentioned assignee gets only the mention; notes group while unread", () =>
    tx(async () => {
      await as(ids.bm1);
      const t = await createTask({
        scope: "branch",
        branch_id: ids.b1,
        title: "Hall",
        assignee_ids: [ids.vol1, ids.vol1b, ids.bm1],
      });
      // The Branch Manager (an assignee and the creator) writes and mentions vol1b.
      const first = await one<string>("SELECT public.add_task_note($1, 'Booked', $2::jsonb) v", [
        t,
        JSON.stringify([ids.vol1b]),
      ]);
      const vol1 = await stored(ids.vol1, "task_note_added");
      expect(vol1).toHaveLength(1);
      expect(vol1[0]).toMatchObject({
        held: false,
        payload: expect.objectContaining({ count: 1, note_id: first }),
      });
      expect(await stored(ids.vol1b, "task_note_added")).toEqual([]);
      expect(await stored(ids.vol1b, "task_note_mention")).toHaveLength(1);
      expect(await stored(ids.bm1, "task_note_added")).toEqual([]);
      await as(null);
      expect(await one("SELECT link v FROM notifications WHERE id=$1", [vol1[0]!.id])).toBe(
        `/tasks?task=${t}&note=${first}`,
      );
      // Two more notes while vol1's notice is unread: the same notice now says 3.
      await as(ids.bm1);
      await one("SELECT public.add_task_note($1, 'Paid', '[]'::jsonb) v", [t]);
      await as(ids.vol1b);
      const third = await one<string>(
        "SELECT public.add_task_note($1, 'Keys collected', '[]'::jsonb) v",
        [t],
      );
      const grouped = await stored(ids.vol1, "task_note_added");
      expect(grouped.map((n) => n.id)).toEqual([vol1[0]!.id]);
      expect(grouped[0]!.payload).toMatchObject({ count: 3, note_id: third });
      // The creator (also an assignee, and a manager who defaults to the daily summary) hears at once, once.
      const creator = await stored(ids.bm1, "task_note_added");
      expect(creator).toHaveLength(1);
      expect(creator[0]).toMatchObject({
        held: false,
        payload: expect.objectContaining({ count: 1 }),
      });
      // Read: the next note starts a new notice.
      await as(null);
      await db.exec(`UPDATE notifications SET read_at = now() WHERE user_id = '${ids.vol1}'`);
      await as(ids.bm1);
      await one("SELECT public.add_task_note($1, 'One more', '[]'::jsonb) v", [t]);
      // Same transaction, same now(): compare without order.
      const counts = (await stored(ids.vol1, "task_note_added")).map((n) =>
        Number(n.payload["count"]),
      );
      expect(counts.sort()).toEqual([1, 3]);
    }));

  it("the creator who is not an assignee still hears about notes by assignees; turned off, nothing", () =>
    tx(async () => {
      await as(ids.bm1);
      const t = await createTask({
        scope: "branch",
        branch_id: ids.b1,
        title: "Tea",
        assignee_ids: [ids.vol1],
      });
      await as(ids.vol1);
      await one("SELECT public.add_task_note($1, 'Bought', '[]'::jsonb) v", [t]);
      expect((await stored(ids.bm1, "task_note_added")).map((n) => n.held)).toEqual([false]);
      await as(ids.bm1);
      expect(
        await one("SELECT public.set_notification_setting('task_note', false, 'digest') v"),
      ).toMatchObject({ enabled: false, email: true });
      await as(null);
      await db.exec(`DELETE FROM notifications WHERE user_id = '${ids.bm1}'`);
      await as(ids.vol1);
      await one("SELECT public.add_task_note($1, 'Milk too', '[]'::jsonb) v", [t]);
      expect(await stored(ids.bm1, "task_note_added")).toEqual([]);
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

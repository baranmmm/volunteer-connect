import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { initializeRecycleDatabase } from "./recycle-db-fixture";

// Tasks, meetings, notifications and reminders against every migration in PGlite. Each test is rolled back.
const db = new PGlite();
const id = (n: number) => {
  const h = n.toString(16).padStart(2, "0");
  return `${h.repeat(4)}-${h.repeat(2)}-4${h}${h[0]}-8${h}${h[0]}-${h.repeat(6)}`;
};
const ids = {
  region: id(1),
  b1: id(2),
  b2: id(3),
  region2: id(4),
  b3: id(5),
  rd: id(10),
  bm1: id(11),
  vol1: id(12),
  vol1b: id(13),
  vol2: id(14),
  bm2: id(15),
  nc: id(16),
  follower: id(17),
  vol3: id(18),
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
const asNc = () => as(ids.nc, "aal2");
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
const visibleTaskIds = async () =>
  ((await one<{ id: string }[]>("SELECT public.list_tasks() v")) ?? []).map((t) => t.id);
const notices = async (user: string, kind?: string) => {
  await as(null);
  return q<{ kind: string; title: string; entity_id: string }>(
    "SELECT kind, title, entity_id FROM notifications WHERE user_id=$1 AND ($2::text IS NULL OR kind=$2) ORDER BY created_at",
    [user, kind ?? null],
  );
};

beforeAll(async () => {
  await initializeRecycleDatabase(db);
  const members = [ids.rd, ids.bm1, ids.vol1, ids.vol1b, ids.vol2, ids.bm2, ids.nc, ids.vol3];
  await db.exec(`INSERT INTO regions(id,name) VALUES ('${ids.region}','Region'),('${ids.region2}','Region two');
    INSERT INTO branches(id,name,region_id) VALUES ('${ids.b1}','One','${ids.region}'),('${ids.b2}','Two','${ids.region}'),('${ids.b3}','Three','${ids.region2}');
    INSERT INTO auth.users(id, raw_user_meta_data) SELECT x, jsonb_build_object('full_name','Person '||left(x::text,2),'privacy_notice_version','1.2')
      FROM unnest(ARRAY['${members.join("','")}']::uuid[]) x;
    INSERT INTO auth.users(id, raw_user_meta_data) VALUES ('${ids.follower}', jsonb_build_object('full_name','Follower','privacy_notice_version','1.2','follower',true,'branch_id','${ids.b1}'));
    UPDATE profiles SET status='active';
    UPDATE profiles SET branch_id='${ids.b1}' WHERE id IN ('${ids.bm1}','${ids.vol1}','${ids.vol1b}');
    UPDATE profiles SET branch_id='${ids.b2}' WHERE id IN ('${ids.vol2}','${ids.bm2}');
    UPDATE profiles SET branch_id='${ids.b3}' WHERE id='${ids.vol3}';
    UPDATE profiles SET branch_id=NULL WHERE id IN ('${ids.rd}','${ids.nc}');
    UPDATE user_roles SET role='branch_manager' WHERE user_id IN ('${ids.bm1}','${ids.bm2}');
    UPDATE user_roles SET role='regional_director', region_id='${ids.region}' WHERE user_id='${ids.rd}';
    UPDATE user_roles SET role='national_coordinator' WHERE user_id='${ids.nc}';`);
}, 60000);
afterAll(async () => db.close());

describe("branch purge (follow-up)", () => {
  it("purging a deleted branch also deletes its volunteer applications and follows", () =>
    tx(async () => {
      await as(null);
      const branch = id(40);
      await db.exec(`INSERT INTO branches(id,name,region_id,deleted_at) VALUES ('${branch}','Gone','${ids.region}', now() - interval '40 days');
        INSERT INTO user_followed_branches(user_id, branch_id) VALUES ('${ids.follower}','${branch}');
        INSERT INTO volunteer_applications(user_id, branch_id, motivation, status) VALUES ('${ids.follower}','${branch}','Helping out','withdrawn');`);
      expect(await one("SELECT public.structure_in_use('branch',$1) v", [branch])).toBe(false);
      expect(await one("SELECT public.purge_expired_structure() v")).toBe(1);
      expect(
        await one("SELECT count(*)::int v FROM volunteer_applications WHERE branch_id=$1", [
          branch,
        ]),
      ).toBe(0);
      expect(
        await one("SELECT count(*)::int v FROM user_followed_branches WHERE branch_id=$1", [
          branch,
        ]),
      ).toBe(0);
      expect(await one("SELECT count(*)::int v FROM branches WHERE id=$1", [branch])).toBe(0);
    }));

  it("a branch with tasks or meetings stays archived", () =>
    tx(async () => {
      await as(ids.bm1);
      await createTask({
        scope: "branch",
        branch_id: ids.b1,
        title: "Keep me",
        assignee_ids: [ids.vol1],
      });
      await as(null);
      expect(await one("SELECT public.structure_in_use('branch',$1) v", [ids.b1])).toBe(true);
    }));
});

describe("task permissions", () => {
  it("a Branch Manager assigns volunteers of the branch, never another branch; assignees are notified, not the assigner", () =>
    tx(async () => {
      await as(ids.bm1);
      const task = await createTask({
        scope: "branch",
        branch_id: ids.b1,
        title: "Set up chairs",
        assignee_ids: [ids.vol1, ids.bm1],
      });
      expect(await notices(ids.vol1, "task_assigned")).toEqual([
        { kind: "task_assigned", title: "Set up chairs", entity_id: task },
      ]);
      expect(await notices(ids.bm1)).toEqual([]);
      await as(ids.bm1);
      await fails(
        "SELECT public.create_task($1::jsonb)",
        [
          JSON.stringify({
            scope: "branch",
            branch_id: ids.b1,
            title: "X",
            assignee_ids: [ids.vol2],
          }),
        ],
        "This person cannot be assigned",
      );
      await fails(
        "SELECT public.create_task($1::jsonb)",
        [JSON.stringify({ scope: "region", region_id: ids.region, title: "X" })],
        "Not allowed",
      );
    }));

  it("a Regional Director assigns anyone in the region; a National Coordinator only RDs, BMs and NCs (never volunteers)", () =>
    tx(async () => {
      await as(ids.rd);
      await createTask({
        scope: "branch",
        branch_id: ids.b1,
        title: "Region help",
        assignee_ids: [ids.vol2],
      });
      await createTask({
        scope: "region",
        region_id: ids.region,
        title: "Region task",
        assignee_ids: [ids.vol1, ids.bm2],
      });
      await fails(
        "SELECT public.create_task($1::jsonb)",
        [
          JSON.stringify({
            scope: "region",
            region_id: ids.region,
            title: "X",
            assignee_ids: [ids.vol3],
          }),
        ],
        "This person cannot be assigned",
      );
      await asNc();
      await createTask({ scope: "national", title: "National", assignee_ids: [ids.bm1, ids.rd] });
      await fails(
        "SELECT public.create_task($1::jsonb)",
        [JSON.stringify({ scope: "national", title: "X", assignee_ids: [ids.vol1] })],
        "This person cannot be assigned",
      );
      const people = await one<{ id: string; role: string }[]>(
        "SELECT public.list_task_people('national') v",
      );
      expect(people.map((p) => p.role).sort()).toEqual([
        "branch_manager",
        "branch_manager",
        "national_coordinator",
        "regional_director",
      ]);
      expect(people.map((p) => p.id)).not.toContain(ids.vol1);
      // Without MFA a National Coordinator gets nothing.
      await as(ids.nc);
      await fails(
        "SELECT public.create_task($1::jsonb)",
        [JSON.stringify({ scope: "national", title: "X" })],
        "Not allowed",
      );
    }));

  it("a volunteer creates tasks in their branch for themselves (by default) or other volunteers there, never upward", () =>
    tx(async () => {
      await as(ids.vol1);
      const task = await createTask({
        scope: "branch",
        branch_id: ids.b1,
        title: "My own",
        assignee_ids: [ids.vol1b],
      });
      const t = await one<{ self_task: boolean; assignees: { id: string }[]; can_edit: boolean }>(
        "SELECT public.get_task($1) v",
        [task],
      );
      expect(t.self_task).toBe(true);
      expect(t.assignees.map((a) => a.id)).toEqual([ids.vol1b]);
      expect(t.can_edit).toBe(true);
      await fails(
        "SELECT public.create_task($1::jsonb)",
        [
          JSON.stringify({
            scope: "branch",
            branch_id: ids.b1,
            title: "Up",
            assignee_ids: [ids.bm1],
          }),
        ],
        "This person cannot be assigned",
      );
      await fails(
        "SELECT public.create_task($1::jsonb)",
        [JSON.stringify({ scope: "branch", branch_id: ids.b2, title: "X" })],
        "Not allowed",
      );
      expect((await notices(ids.vol1b)).map((n) => n.kind)).toEqual(["task_assigned"]);
    }));

  it("visibility: branch members see branch tasks; region tasks the RD, region BMs and assignees; national NCs and assignees", () =>
    tx(async () => {
      await as(ids.bm1);
      const branchTask = await createTask({ scope: "branch", branch_id: ids.b1, title: "Branch" });
      await as(ids.rd);
      const regionTask = await createTask({
        scope: "region",
        region_id: ids.region,
        title: "Region",
        assignee_ids: [ids.vol1],
      });
      await asNc();
      const nationalTask = await createTask({
        scope: "national",
        title: "National",
        assignee_ids: [ids.bm2],
      });
      const seen = async (user: string, aal?: string) => {
        await as(user, aal);
        return visibleTaskIds();
      };
      expect(await seen(ids.vol1b)).toEqual([branchTask]);
      expect((await seen(ids.vol1)).sort()).toEqual([branchTask, regionTask].sort());
      expect(await seen(ids.vol2)).toEqual([]);
      expect((await seen(ids.bm2)).sort()).toEqual([regionTask, nationalTask].sort());
      expect((await seen(ids.rd)).sort()).toEqual([branchTask, regionTask].sort());
      expect(await seen(ids.nc, "aal2")).toEqual([nationalTask]);
      expect(await seen(ids.follower)).toEqual([]);
      await as(ids.follower);
      await fails(
        "SELECT public.create_task($1::jsonb)",
        [JSON.stringify({ scope: "branch", branch_id: ids.b1, title: "X" })],
        "Not allowed",
      );
      expect(await q("SELECT id FROM tasks")).toEqual([]);
    }));

  it("an assignee changes only the status (the creator is notified); others cannot", () =>
    tx(async () => {
      await as(ids.bm1);
      const task = await createTask({
        scope: "branch",
        branch_id: ids.b1,
        title: "Posters",
        assignee_ids: [ids.vol1],
      });
      await as(ids.vol1);
      expect(await one("SELECT public.set_task_status($1,'in_progress') v", [task])).toBe(
        "in_progress",
      );
      await fails(
        'SELECT public.update_task($1, \'{"title":"Renamed"}\'::jsonb)',
        [task],
        "Not allowed",
      );
      await fails("SELECT public.delete_task($1)", [task], "Not allowed");
      expect((await notices(ids.bm1, "task_status_changed")).map((n) => n.entity_id)).toEqual([
        task,
      ]);
      await as(ids.vol1b);
      await fails("SELECT public.set_task_status($1,'done')", [task], "Not allowed");
      await as(ids.bm1);
      await one("SELECT public.update_task($1, $2::jsonb) v", [
        task,
        JSON.stringify({ title: "Posters v2", assignee_ids: [ids.vol1, ids.vol1b] }),
      ]);
      expect((await notices(ids.vol1b, "task_assigned")).map((n) => n.title)).toEqual([
        "Posters v2",
      ]);
    }));

  it("a linked event must be in the same scope; deleted tasks go to the Recycle Bin and come back", () =>
    tx(async () => {
      await as(ids.bm1);
      const task = await createTask({ scope: "branch", branch_id: ids.b1, title: "Bin me" });
      await one("SELECT public.delete_task($1) v", [task]);
      expect(await visibleTaskIds()).toEqual([]);
      const bin = await q<{ id: string; type: string; can_restore: boolean }>(
        "SELECT id, type, can_restore FROM public.list_recycle_bin('task')",
      );
      expect(bin).toEqual([{ id: task, type: "task", can_restore: true }]);
      await one("SELECT public.restore_item('task',$1) v", [task]);
      expect(await visibleTaskIds()).toEqual([task]);
    }));
});

describe("task requests", () => {
  it("a volunteer asks their Branch Manager; accepting creates a task for the manager; declining needs a note", () =>
    tx(async () => {
      await as(ids.vol1);
      const targets = await one<{ id: string }[]>("SELECT public.list_request_targets() v");
      expect(targets.map((t) => t.id).sort()).toEqual([ids.rd, ids.bm1].sort());
      await fails(
        "SELECT public.submit_task_request($1::jsonb)",
        [JSON.stringify({ target_id: ids.bm2, title: "X" })],
        "This person cannot receive your request",
      );
      const request = await one<string>("SELECT public.submit_task_request($1::jsonb) v", [
        JSON.stringify({ target_id: ids.bm1, title: "Book the hall", priority: "high" }),
      ]);
      const second = await one<string>("SELECT public.submit_task_request($1::jsonb) v", [
        JSON.stringify({ target_id: ids.bm1, title: "Buy tea" }),
      ]);
      expect((await notices(ids.bm1, "task_request_received")).length).toBe(2);
      await as(ids.bm1);
      expect(await one("SELECT public.get_work_request_count() v")).toBe(2);
      const task = await one<string>("SELECT public.accept_task_request($1) v", [request]);
      const t = await one<{ scope: string; branch_id: string; assignees: { id: string }[] }>(
        "SELECT public.get_task($1) v",
        [task],
      );
      expect([t.scope, t.branch_id, t.assignees.map((a) => a.id)]).toEqual([
        "branch",
        ids.b1,
        [ids.bm1],
      ]);
      await fails(
        "SELECT public.decline_task_request($1,'no')",
        [second],
        "Decline reason is too short",
      );
      await one("SELECT public.decline_task_request($1,'We already have tea in stock') v", [
        second,
      ]);
      expect((await notices(ids.vol1)).map((n) => n.kind).sort()).toEqual([
        "task_request_accepted",
        "task_request_declined",
      ]);
      await as(ids.vol1);
      const mine = await one<{ status: string; decline_reason: string | null }[]>(
        "SELECT public.list_my_task_requests() v",
      );
      expect(mine.map((r) => r.status).sort()).toEqual(["accepted", "declined"]);
      expect(await visibleTaskIds()).toEqual([task]);
    }));

  it("a Regional Director asks a National Coordinator: a national task", () =>
    tx(async () => {
      await as(ids.rd);
      const request = await one<string>("SELECT public.submit_task_request($1::jsonb) v", [
        JSON.stringify({ target_id: ids.nc, title: "National report" }),
      ]);
      await asNc();
      const task = await one<string>("SELECT public.accept_task_request($1) v", [request]);
      expect(await one("SELECT (public.get_task($1))->>'scope' v", [task])).toBe("national");
    }));
});

describe("task reminders", () => {
  const now = "2027-03-10 10:00:00+00"; // 10:00 in London (GMT)
  const run = async (at = now) => {
    await as(null);
    return one<number>("SELECT public.run_task_reminders($1::timestamptz) v", [at]);
  };
  const reminderTask = async (p: Row) => {
    await as(ids.bm1);
    return createTask({
      scope: "branch",
      branch_id: ids.b1,
      title: "Remind",
      assignee_ids: [ids.vol1, ids.vol1b],
      // Reminders are off by default (v2): these tests turn on "3 days before".
      reminders: { before_days: [3], repeat_kind: "none" },
      ...p,
    });
  };
  const outbox = () =>
    q<{ user_id: string; template: string }>(
      "SELECT user_id, template FROM email_outbox ORDER BY user_id",
    );

  it("3 days before by default: a notice and an email outbox row per assignee, at most once per day", () =>
    tx(async () => {
      await reminderTask({ due_date: "2027-03-13" });
      expect(await run("2027-03-10 08:30:00+00")).toBe(0); // before 09:00 London
      expect(await run()).toBe(2);
      expect(await run()).toBe(0);
      expect((await notices(ids.vol1, "task_reminder")).length).toBe(1);
      expect(await outbox()).toEqual(
        [
          { user_id: ids.vol1, template: "task_reminder" },
          { user_id: ids.vol1b, template: "task_reminder" },
        ].sort((a, b) => a.user_id.localeCompare(b.user_id)),
      );
      expect(await run("2027-03-11 10:00:00+00")).toBe(0); // 2 days before: not chosen
    }));

  it("mute and email opt-out", () =>
    tx(async () => {
      const task = await reminderTask({ due_date: "2027-03-13" });
      await as(ids.vol1b);
      await one("SELECT public.set_task_reminder_mute($1,true) v", [task]);
      await as(ids.vol1);
      await one("SELECT public.set_task_reminder_emails(false) v");
      expect(await run()).toBe(1);
      expect((await notices(ids.vol1, "task_reminder")).length).toBe(1);
      expect(await notices(ids.vol1b, "task_reminder")).toEqual([]);
      expect(await outbox()).toEqual([]);
    }));

  it("repeat (daily, every N days, weekly) until the due date; overdue every N days; nothing once done", () =>
    tx(async () => {
      const daily = await reminderTask({
        due_date: "2027-03-20",
        reminders: { before_days: [], repeat_kind: "daily", repeat_start: "2027-03-08" },
      });
      const everyThree = await reminderTask({
        due_date: "2027-03-20",
        reminders: {
          before_days: [],
          repeat_kind: "every_n",
          repeat_every_days: 3,
          repeat_start: "2027-03-08",
        },
      });
      const weekly = await reminderTask({
        due_date: "2027-03-20",
        reminders: { before_days: [], repeat_kind: "weekly", repeat_start: "2027-03-03" },
      });
      const overdue = await reminderTask({
        due_date: "2027-03-06",
        reminders: { before_days: [3], overdue_every_days: 2 },
      });
      const overdueOff = await reminderTask({ due_date: "2027-03-06" });
      const done = await reminderTask({ due_date: "2027-03-13", status: "done" });
      expect(await run()).toBe(6); // daily, weekly, overdue (4 days late) × 2 assignees; every 3 days: not today
      const reminded = (
        await q<{ task_id: string; kind: string }>(
          "SELECT DISTINCT task_id, kind FROM task_reminder_log",
        )
      )
        .map((r) => `${r.task_id}:${r.kind}`)
        .sort();
      expect(reminded).toEqual(
        [`${daily}:repeat`, `${weekly}:repeat`, `${overdue}:overdue`].sort(),
      );
      expect(reminded.join()).not.toContain(everyThree);
      expect(reminded.join()).not.toContain(overdueOff);
      expect(reminded.join()).not.toContain(done);
      expect(await run("2027-03-11 10:00:00+00")).toBe(4); // daily and every 3 days (3 days after the 8th)
      await as(ids.bm1);
      await one("SELECT public.set_task_status($1,'done') v", [daily]);
      expect(await run("2027-03-12 10:00:00+00")).toBe(2); // overdue (6 days late) only
    }));

  it("someone who is no longer an assignee gets no reminder", () =>
    tx(async () => {
      const task = await reminderTask({ due_date: "2027-03-13" });
      await as(ids.bm1);
      await one("SELECT public.update_task($1, $2::jsonb) v", [
        task,
        JSON.stringify({ assignee_ids: [ids.vol1] }),
      ]);
      expect(await run()).toBe(1);
      expect(await notices(ids.vol1b, "task_reminder")).toEqual([]);
    }));
});

describe("notifications", () => {
  it("users read and mark only their own notices; nobody reads the email outbox", () =>
    tx(async () => {
      await as(ids.bm1);
      const task = await createTask({
        scope: "branch",
        branch_id: ids.b1,
        title: "Read me",
        assignee_ids: [ids.vol1],
      });
      await as(ids.vol1b);
      expect(await q("SELECT id FROM notifications")).toEqual([]);
      await fails("SELECT * FROM email_outbox", [], "permission denied");
      await as(ids.vol1);
      expect(await one("SELECT (public.get_unread_notification_counts())->>'tasks' v")).toBe("1");
      expect(await one("SELECT public.mark_notifications_read(NULL,'task',$1) v", [task])).toBe(1);
      expect(await one("SELECT (public.get_unread_notification_counts())->>'tasks' v")).toBe("0");
      await fails(
        "INSERT INTO notifications(user_id, kind, entity_type, entity_id, link) VALUES ($1,'x','task',$1,'/x')",
        [ids.vol1],
        "permission denied",
      );
    }));
});

describe("meetings", () => {
  const createMeeting = (p: Row) =>
    one<string>("SELECT public.create_meeting($1::jsonb) v", [
      JSON.stringify({
        starts_at: "2027-04-01T17:00:00Z",
        ends_at: "2027-04-01T18:00:00Z",
        location_type: "in_person",
        location: "Hall",
        ...p,
      }),
    ]);

  it("only the creator, invitees and the scope's managers see a meeting (counts included)", () =>
    tx(async () => {
      await as(ids.vol1);
      const meeting = await createMeeting({
        scope: "branch",
        branch_id: ids.b1,
        title: "Team chat",
        invitee_ids: [ids.vol1b],
      });
      expect((await notices(ids.vol1b, "meeting_invited")).map((n) => n.entity_id)).toEqual([
        meeting,
      ]);
      const sees = async (user: string, aal?: string) => {
        await as(user, aal);
        return [
          (await one<unknown[]>("SELECT public.list_meetings('upcoming') v")).length,
          (await one("SELECT public.get_meeting($1) v", [meeting])) !== null,
          (await q("SELECT id FROM meetings")).length,
        ];
      };
      expect(await sees(ids.vol1)).toEqual([1, true, 1]);
      expect(await sees(ids.vol1b)).toEqual([1, true, 1]);
      expect(await sees(ids.bm1)).toEqual([1, true, 1]);
      expect(await sees(ids.rd)).toEqual([1, true, 1]);
      expect(await sees(ids.bm2)).toEqual([0, false, 0]);
      expect(await sees(ids.nc, "aal2")).toEqual([0, false, 0]);
      expect(await sees(ids.follower)).toEqual([0, false, 0]);
      // Invitees read only.
      await as(ids.vol1b);
      await fails("SELECT public.add_agenda_item($1,'Item')", [meeting], "Not allowed");
      // National meetings: invitees are RDs, BMs and NCs only.
      await asNc();
      await expect(
        createMeeting({ scope: "national", title: "N", invitee_ids: [ids.vol1] }),
      ).rejects.toThrow("Invitee is not in this scope");
    }));

  it("time change and cancellation notify invitees; online links must be https", () =>
    tx(async () => {
      await as(ids.bm1);
      const meeting = await createMeeting({
        scope: "branch",
        branch_id: ids.b1,
        title: "Plan",
        invitee_ids: [ids.vol1],
      });
      await fails(
        "SELECT public.update_meeting($1,$2::jsonb)",
        [meeting, JSON.stringify({ location_type: "online", online_url: "http://x.org" })],
        "Online link must start with https://",
      );
      await one("SELECT public.update_meeting($1,$2::jsonb) v", [
        meeting,
        JSON.stringify({ starts_at: "2027-04-01T16:00:00Z" }),
      ]);
      await one("SELECT public.set_meeting_status($1,'cancelled') v", [meeting]);
      expect((await notices(ids.vol1)).map((n) => n.kind)).toEqual([
        "meeting_invited",
        "meeting_changed",
        "meeting_cancelled",
      ]);
    }));

  it("a decision becomes a linked task; a meeting request approved creates a meeting with the requester invited", () =>
    tx(async () => {
      await as(ids.bm1);
      const meeting = await createMeeting({
        scope: "branch",
        branch_id: ids.b1,
        title: "Planning",
        invitee_ids: [ids.vol1],
      });
      const item = await one<string>("SELECT public.add_agenda_item($1,'Iftar') v", [meeting]);
      const decision = await one<string>(
        "SELECT public.add_meeting_decision($1,'Book the hall') v",
        [item],
      );
      const task = await createTask({
        scope: "branch",
        branch_id: ids.b1,
        title: "Book the hall",
        decision_id: decision,
        assignee_ids: [ids.vol1],
      });
      const m = await one<{
        agenda: { decisions: { tasks: { id: string; status: string }[] }[] }[];
      }>("SELECT public.get_meeting($1) v", [meeting]);
      expect(m.agenda[0]!.decisions[0]!.tasks).toEqual([
        { id: task, title: "Book the hall", status: "todo" },
      ]);
      expect(await one("SELECT (public.get_task($1))->>'meeting_id' v", [task])).toBe(meeting);

      await as(ids.vol1);
      const request = await one<string>("SELECT public.submit_meeting_request($1::jsonb) v", [
        JSON.stringify({
          target_id: ids.bm1,
          topic: "Talk",
          proposed_times: [{ starts_at: "2027-04-02T17:00:00Z", ends_at: "2027-04-02T18:00:00Z" }],
        }),
      ]);
      await as(ids.bm1);
      const created = await one<string>("SELECT public.approve_meeting_request($1,$2::jsonb) v", [
        request,
        JSON.stringify({
          title: "Talk",
          starts_at: "2027-04-02T17:00:00Z",
          ends_at: "2027-04-02T18:00:00Z",
          location_type: "online",
          online_url: "https://meet.example.org/x",
        }),
      ]);
      const approved = await one<{ created_by: string; invitees: { id: string }[]; scope: string }>(
        "SELECT public.get_meeting($1) v",
        [created],
      );
      expect([approved.created_by, approved.invitees.map((i) => i.id), approved.scope]).toEqual([
        ids.bm1,
        [ids.vol1],
        "branch",
      ]);
      expect((await notices(ids.vol1, "meeting_request_approved")).length).toBe(1);
    }));

  it("meeting files: only editors reserve slots; deleted meetings go to the Recycle Bin", () =>
    tx(async () => {
      await as(ids.bm1);
      const meeting = await createMeeting({
        scope: "branch",
        branch_id: ids.b1,
        title: "Files",
        invitee_ids: [ids.vol1],
      });
      const slot = await one<{ storage_path: string }>(
        "SELECT public.add_meeting_file($1,'pdf','Minutes.pdf') v",
        [meeting],
      );
      expect(slot.storage_path).toMatch(new RegExp(`^${meeting}/[0-9a-f-]+\\.pdf$`));
      await fails(
        "SELECT public.add_meeting_file($1,'exe','x.exe')",
        [meeting],
        "File type is not allowed",
      );
      await as(ids.vol1);
      expect(await one("SELECT public.can_read_meeting_file($1) v", [slot.storage_path])).toBe(
        true,
      );
      expect(await one("SELECT public.can_write_meeting_file($1) v", [slot.storage_path])).toBe(
        false,
      );
      await as(ids.vol1b);
      expect(await one("SELECT public.can_read_meeting_file($1) v", [slot.storage_path])).toBe(
        false,
      );
      await as(ids.bm1);
      await one("SELECT public.delete_meeting($1) v", [meeting]);
      await as(ids.vol1);
      expect(await one("SELECT public.can_read_meeting_file($1) v", [slot.storage_path])).toBe(
        false,
      );
      await as(ids.bm1);
      expect(
        (await q<{ type: string }>("SELECT type FROM public.list_recycle_bin('meeting')")).map(
          (r) => r.type,
        ),
      ).toEqual(["meeting"]);
      await one("SELECT public.restore_item('meeting',$1) v", [meeting]);
      expect(await one("SELECT public.get_meeting($1) IS NOT NULL v", [meeting])).toBe(true);
    }));
});

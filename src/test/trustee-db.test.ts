import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { initializeRecycleDatabase, PRIVACY_VERSION } from "./recycle-db-fixture";

// The trustee role (20261210090000_app_role_trustee.sql, 20261210090100_trustee_role.sql), against every migration in
// PGlite: trustees read what a volunteer of their branch reads, write nothing (tasks, groups, meetings, agenda,
// decisions, files, events, others' tasks, assignment, archive), change only the status of their own tasks, add notes
// to every readable task of their branch (20261211090000_trustee_task_notes.sql), are assigned only by the branch's Branch Manager, are never "@all" members, send requests like volunteers,
// are approved as trustees or switched by the Branch Manager (audited), and count separately for the NC.
// Each test is rolled back.
const db = new PGlite();
const id = (n: number) => {
  const h = n.toString(16).padStart(2, "0");
  return `${h.repeat(4)}-${h.repeat(2)}-4${h}${h[0]}-8${h}${h[0]}-${h.repeat(6)}`;
};
const ids = {
  region: id(1),
  b1: id(2),
  b2: id(3),
  rd: id(10),
  bm1: id(11),
  vol1: id(12),
  vol1b: id(13),
  tr1: id(14),
  tr2: id(15),
  bm2: id(16),
  nc: id(17),
  fol: id(18),
};
type Row = Record<string, unknown>;
type Task = {
  id: string;
  can_edit: boolean;
  can_set_status: boolean;
  can_archive: boolean;
  can_add_note: boolean;
};

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
async function fails(sql: string, params: unknown[], message: string | RegExp) {
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
const json = (v: unknown) => JSON.stringify(v);
const createTask = (p: Row) =>
  one<string>("SELECT public.create_task($1::jsonb) v", [
    json({ scope: "branch", branch_id: ids.b1, ...p }),
  ]);
const createGroup = (p: Row = {}) =>
  one<string>("SELECT public.create_task_group($1::jsonb) v", [
    json({ scope: "branch", branch_id: ids.b1, title: "Bring a friend", ...p }),
  ]);
const meetingIn = (p: Row) =>
  json({
    scope: "branch",
    branch_id: ids.b1,
    title: "Branch meeting",
    starts_at: "2027-04-01T17:00:00Z",
    ends_at: "2027-04-01T18:00:00Z",
    location_type: "in_person",
    location: "Hall",
    ...p,
  });
const createMeeting = (p: Row = {}) =>
  one<string>("SELECT public.create_meeting($1::jsonb) v", [meetingIn(p)]);
const groupMembers = async (g: string) => {
  await as(null);
  return (
    await q<{ user_id: string }>(
      "SELECT a.user_id FROM tasks t JOIN task_assignees a ON a.task_id=t.id WHERE t.group_id=$1 AND t.deleted_at IS NULL",
      [g],
    )
  )
    .map((r) => r.user_id)
    .sort();
};
const noticesOf = async (user: string) => {
  await as(null);
  return q<{ kind: string; entity_id: string; payload: Row }>(
    "SELECT kind, entity_id, payload FROM notifications WHERE user_id=$1 ORDER BY created_at",
    [user],
  );
};
let event = "";

beforeAll(async () => {
  await initializeRecycleDatabase(db);
  const people = Object.entries(ids).filter(([k]) => !["region", "b1", "b2"].includes(k));
  await db.exec(`INSERT INTO regions(id,name) VALUES ('${ids.region}','Region');
    INSERT INTO branches(id,name,region_id) VALUES ('${ids.b1}','One','${ids.region}'),('${ids.b2}','Two','${ids.region}');
    INSERT INTO auth.users(id, raw_user_meta_data) VALUES ${people
      .filter(([k]) => k !== "fol")
      .map(
        ([k, v]) =>
          `('${v}', jsonb_build_object('full_name','Person ${k}','privacy_notice_version','${PRIVACY_VERSION}'))`,
      )
      .join(",")};
    UPDATE profiles SET status='active';
    UPDATE profiles SET branch_id='${ids.b1}' WHERE id IN ('${ids.bm1}','${ids.vol1}','${ids.vol1b}','${ids.tr1}');
    UPDATE profiles SET branch_id='${ids.b2}' WHERE id IN ('${ids.tr2}','${ids.bm2}');
    UPDATE profiles SET branch_id=NULL WHERE id IN ('${ids.rd}','${ids.nc}');
    UPDATE user_roles SET role='branch_manager' WHERE user_id IN ('${ids.bm1}','${ids.bm2}');
    UPDATE user_roles SET role='trustee' WHERE user_id IN ('${ids.tr1}','${ids.tr2}');
    UPDATE user_roles SET role='regional_director', region_id='${ids.region}' WHERE user_id='${ids.rd}';
    UPDATE user_roles SET role='national_coordinator' WHERE user_id='${ids.nc}';`);
  // A real follower (sign-up without the fixture conversion), for the approval tests.
  await db.query(
    "INSERT INTO auth.users(id, email, raw_user_meta_data) VALUES ($1, 'fol@example.test', jsonb_build_object('full_name', 'Fay Follower', 'privacy_notice_version', $2::text, 'branch_id', $3::text, 'follower', true))",
    [ids.fol, PRIVACY_VERSION, ids.b1],
  );
  await db.exec("SET session_replication_role = replica");
  event = (
    await q<{ id: string }>(
      `INSERT INTO public.events (title, organizer, category, scope, branch_id, region_id, status, start_at, end_at, location,
         location_type, audience, registration_enabled)
       VALUES ('Members dinner', 'Dialogue Society', 'dinner', 'branch', $1, $2, 'published', now() + interval '5 days',
         now() + interval '5 days 2 hours', 'Hall', 'in_person', 'members', true) RETURNING id`,
      [ids.b1, ids.region],
    )
  )[0]!.id;
  await db.exec("SET session_replication_role = origin");
}, 60000);
afterAll(async () => db.close());

/** Everything a Branch Manager sets up in branch One: tasks, a group, a meeting with agenda, decision and file. */
async function branchActivity() {
  await as(ids.bm1);
  const task = await createTask({ title: "Posters", assignee_ids: [ids.vol1b], event_id: event });
  const own = await createTask({ title: "Trustee report", assignee_ids: [ids.tr1] });
  const group = await createGroup();
  const meeting = await createMeeting({ invitee_ids: [ids.vol1, ids.tr1] });
  const item = await one<string>("SELECT public.add_agenda_item($1,'Budget','Notes') v", [meeting]);
  const decision = await one<string>("SELECT public.add_meeting_decision($1,'Buy chairs') v", [
    item,
  ]);
  await one("SELECT public.add_meeting_file($1,'pdf','plan.pdf') v", [meeting]);
  return { task, own, group, meeting, item, decision };
}

describe("a trustee reads what a volunteer of the branch reads", () => {
  it("tasks, groups, linked tasks, meetings they are invited to (agenda, decisions, files, invitees), events", () =>
    tx(async () => {
      const a = await branchActivity();
      const view = async (user: string) => {
        await as(user);
        return {
          task: (await one<Task | null>("SELECT public.get_task($1) v", [a.task]))?.id ?? null,
          groups: (await one<{ id: string }[]>("SELECT public.list_task_groups() v")).map(
            (g) => g.id,
          ),
          group: (await one<Row | null>("SELECT public.get_task_group($1) v", [a.group])) !== null,
          linked: (await one<{ id: string }[]>("SELECT public.get_event_tasks($1) v", [event])).map(
            (t) => t.id,
          ),
          meeting: (await one<Row | null>("SELECT public.get_meeting($1) v", [a.meeting])) !== null,
          rows: await q(
            `SELECT (SELECT count(*)::int FROM meeting_agenda_items WHERE meeting_id=$1) items,
                    (SELECT count(*)::int FROM meeting_decisions WHERE meeting_id=$1) decisions,
                    (SELECT count(*)::int FROM meeting_files WHERE meeting_id=$1) files,
                    (SELECT count(*)::int FROM meeting_invitees WHERE meeting_id=$1) invitees,
                    (SELECT count(*)::int FROM events WHERE id=$2) events,
                    (SELECT count(*)::int FROM tasks WHERE id=$3) tasks`,
            [a.meeting, event, a.task],
          ),
          scopes: (await one<{ branch_id: string }[]>("SELECT public.list_my_work_scopes() v")).map(
            (s) => s.branch_id,
          ),
        };
      };
      const volunteer = await view(ids.vol1);
      expect(volunteer).toMatchObject({
        task: a.task,
        group: true,
        meeting: true,
        linked: [a.task],
      });
      expect(volunteer.rows).toEqual([
        { items: 1, decisions: 1, files: 1, invitees: 2, events: 1, tasks: 1 },
      ]);
      expect(await view(ids.tr1)).toEqual(volunteer);
      // A trustee of another branch sees none of it.
      expect(await view(ids.tr2)).toMatchObject({
        task: null,
        groups: [],
        group: false,
        linked: [],
        meeting: false,
      });
    }));

  it("an uninvited branch meeting: hidden from a volunteer, readable by the branch's trustee", () =>
    tx(async () => {
      await as(ids.bm1);
      const meeting = await createMeeting({ invitee_ids: [] });
      await as(ids.vol1);
      expect(await one("SELECT public.get_meeting($1) v", [meeting])).toBeNull();
      await as(ids.tr1);
      expect(await one("SELECT public.get_meeting($1) v", [meeting])).not.toBeNull();
    }));
});

describe("a trustee sees every meeting of their branch, read only (20261210090300)", () => {
  it("an uninvited branch meeting: readable by the branch's trustee, not by a volunteer or another branch's trustee", () =>
    tx(async () => {
      await as(ids.bm1);
      const meeting = await createMeeting({ title: "Board only", invitee_ids: [ids.bm1] });
      const item = await one<string>("SELECT public.add_agenda_item($1,'Budget','Notes') v", [
        meeting,
      ]);
      const decision = await one<string>("SELECT public.add_meeting_decision($1,'Buy chairs') v", [
        item,
      ]);
      await one("SELECT public.add_meeting_file($1,'pdf','plan.pdf') v", [meeting]);
      await as(null);
      const file = await one<string>("SELECT id v FROM meeting_files WHERE meeting_id=$1", [
        meeting,
      ]);
      const entry = await one<string>("SELECT event_id v FROM meetings WHERE id=$1", [meeting]);
      const reads = async (user: string) => {
        await as(user);
        return {
          meeting: (await one<Row | null>("SELECT public.get_meeting($1) v", [meeting])) !== null,
          listed: (await one<{ id: string }[]>("SELECT public.list_meetings('upcoming') v")).some(
            (m) => m.id === meeting,
          ),
          rows: await q(
            `SELECT (SELECT count(*)::int FROM meetings WHERE id=$1) meetings,
                    (SELECT count(*)::int FROM meeting_agenda_items WHERE meeting_id=$1) items,
                    (SELECT count(*)::int FROM meeting_decisions WHERE meeting_id=$1) decisions,
                    (SELECT count(*)::int FROM meeting_files WHERE meeting_id=$1) files,
                    (SELECT count(*)::int FROM meeting_invitees WHERE meeting_id=$1) invitees,
                    (SELECT count(*)::int FROM events WHERE id=$2) calendar`,
            [meeting, entry],
          ),
        };
      };
      expect(await reads(ids.tr1)).toEqual({
        meeting: true,
        listed: true,
        rows: [{ meetings: 1, items: 1, decisions: 1, files: 1, invitees: 1, calendar: 1 }],
      });
      const none = {
        meeting: false,
        listed: false,
        rows: [{ meetings: 0, items: 0, decisions: 0, files: 0, invitees: 0, calendar: 0 }],
      };
      expect(await reads(ids.vol1)).toEqual(none);
      expect(await reads(ids.tr2)).toEqual(none);

      // Read only: every write is refused.
      await as(ids.tr1);
      expect(
        (await one<{ can_edit: boolean }>("SELECT public.get_meeting($1) v", [meeting])).can_edit,
      ).toBe(false);
      const refused: [string, unknown[]][] = [
        ["SELECT public.update_meeting($1,$2::jsonb)", [meeting, json({ title: "Renamed" })]],
        ["SELECT public.set_meeting_status($1,'cancelled')", [meeting]],
        ["SELECT public.set_meeting_invitees($1,$2::jsonb)", [meeting, json([ids.bm1, ids.tr1])]],
        ["SELECT public.delete_meeting($1)", [meeting]],
        ["SELECT public.add_agenda_item($1,'More','x')", [meeting]],
        ["SELECT public.update_agenda_item($1,'Renamed','x')", [item]],
        ["SELECT public.add_meeting_decision($1,'Another')", [item]],
        ["SELECT public.update_meeting_decision($1,'Changed')", [decision]],
        ["SELECT public.delete_meeting_decision($1)", [decision]],
        ["SELECT public.add_meeting_file($1,'pdf','x.pdf')", [meeting]],
        ["SELECT public.delete_meeting_file($1)", [file]],
        ["SELECT public.carry_over_agenda($1,$2::jsonb)", [meeting, json({ items: [item] })]],
      ];
      for (const [sql, params] of refused)
        await fails(sql, params, /Not allowed|not allowed|cannot/);
      expect(
        await one("SELECT public.list_meeting_carry_over('branch',$1,NULL) v", [ids.b1]),
      ).toEqual([]);
    }));

  it("region meetings stay as for volunteers (invited or created only)", () =>
    tx(async () => {
      await as(ids.rd);
      const meeting = await one<string>("SELECT public.create_meeting($1::jsonb) v", [
        meetingIn({ scope: "region", branch_id: null, region_id: ids.region, invitee_ids: [] }),
      ]);
      await as(ids.tr1);
      expect(await one("SELECT public.get_meeting($1) v", [meeting])).toBeNull();
    }));
});

describe("a trustee writes nothing", () => {
  it("tasks, groups, meetings, agenda items, decisions, files and events are refused", () =>
    tx(async () => {
      const a = await branchActivity();
      await as(ids.tr1);
      const refused: [string, unknown[]][] = [
        [
          "SELECT public.create_task($1::jsonb)",
          [json({ scope: "branch", branch_id: ids.b1, title: "Mine" })],
        ],
        ["SELECT public.update_task($1,$2::jsonb)", [a.own, json({ title: "Renamed" })]],
        ["SELECT public.update_task($1,$2::jsonb)", [a.task, json({ title: "Renamed" })]],
        ["SELECT public.delete_task($1)", [a.own]],
        [
          "SELECT public.create_task_group($1::jsonb)",
          [json({ scope: "branch", branch_id: ids.b1, title: "All" })],
        ],
        ["SELECT public.update_task_group($1,$2::jsonb)", [a.group, json({ title: "Renamed" })]],
        [
          "SELECT public.set_task_group_members($1,$2::jsonb,'[]'::jsonb)",
          [a.group, json([ids.tr1])],
        ],
        ["SELECT public.delete_task_group($1)", [a.group]],
        ["SELECT public.create_meeting($1::jsonb)", [meetingIn({})]],
        ["SELECT public.update_meeting($1,$2::jsonb)", [a.meeting, json({ title: "Renamed" })]],
        ["SELECT public.set_meeting_status($1,'completed')", [a.meeting]],
        ["SELECT public.set_meeting_invitees($1,$2::jsonb)", [a.meeting, json([ids.tr1])]],
        ["SELECT public.delete_meeting($1)", [a.meeting]],
        ["SELECT public.add_agenda_item($1,'More','x')", [a.meeting]],
        ["SELECT public.update_agenda_item($1,'Renamed','x')", [a.item]],
        ["SELECT public.add_meeting_decision($1,'Another')", [a.item]],
        ["SELECT public.update_meeting_decision($1,'Changed')", [a.decision]],
        ["SELECT public.add_meeting_file($1,'pdf','x.pdf')", [a.meeting]],
        [
          "SELECT public.create_event($1::jsonb)",
          [json({ title: "Branch day", scope: "branch", branch_id: ids.b1, status: "draft" })],
        ],
        ["SELECT public.update_event($1,$2::jsonb)", [event, json({ title: "Renamed" })]],
        // Other people's tasks: no status (notes are allowed since 20261211090000, tested below).
        ["SELECT public.set_task_status($1,'done')", [a.task]],
      ];
      for (const [sql, params] of refused)
        await fails(sql, params, /Not allowed|not allowed|cannot/);
      // Storage: no upload slot means no upload, and the policy helper refuses the meeting.
      expect(await one("SELECT public.can_edit_meeting($1) v", [a.meeting])).toBe(false);
      // No create pickers.
      for (const fn of ["list_task_people", "list_meeting_people"])
        expect(await one(`SELECT public.${fn}('branch',$1,NULL) v`, [ids.b1])).toEqual([]);
    }));

  it("own task: status and notes only (no edit, no archive)", () =>
    tx(async () => {
      const a = await branchActivity();
      await as(ids.tr1);
      expect(await one<Task>("SELECT public.get_task($1) v", [a.own])).toMatchObject({
        can_edit: false,
        can_set_status: true,
        can_archive: false,
      });
      expect(await one("SELECT public.set_task_status($1,'in_progress') v", [a.own])).toBe(
        "in_progress",
      );
      const note = await one<string>("SELECT public.add_task_note($1,'Started','[]'::jsonb) v", [
        a.own,
      ]);
      await one("SELECT public.update_task_note($1,'Started today','[]'::jsonb) v", [note]);
      expect(await one("SELECT public.set_task_status($1,'done') v", [a.own])).toBe("done");
      await fails("SELECT public.archive_task($1,true)", [a.own], "Not allowed");
      await fails("SELECT public.archive_done_tasks($1::jsonb)", [json([a.own])], "Not allowed");
      // Their own reminders and the mute switch change nothing others see: allowed.
      await one("SELECT public.set_task_reminder_mute($1,true) v", [a.own]);
      // The Branch Manager still archives it.
      await as(ids.bm1);
      expect(await one("SELECT public.archive_task($1,true) v", [a.own])).toBe(true);
    }));

  it("a volunteer who becomes a trustee loses edit rights on the tasks and meetings they created", () =>
    tx(async () => {
      await as(ids.vol1);
      const task = await createTask({ title: "My poster" });
      const meeting = await createMeeting({ title: "My chat" });
      await as(ids.bm1);
      await db.query("SELECT public.set_user_role($1,'trustee')", [ids.vol1]);
      await as(ids.vol1);
      expect(await one<Task>("SELECT public.get_task($1) v", [task])).toMatchObject({
        can_edit: false,
        can_set_status: true,
      });
      await fails(
        "SELECT public.update_task($1,$2::jsonb)",
        [task, json({ title: "X" })],
        "Not allowed",
      );
      await fails(
        "SELECT public.update_meeting($1,$2::jsonb)",
        [meeting, json({ title: "X" })],
        "Not allowed",
      );
    }));
});

describe("trustee notes on branch tasks (20261211090000)", () => {
  const noteNotices = async (user: string, task: string) =>
    (await noticesOf(user))
      .filter((n) => n.entity_id === task && n.kind.startsWith("task_note"))
      .map((n) => n.kind);

  it("a trustee adds a note to a branch task not assigned to them; assignees, creator and mentions are told", () =>
    tx(async () => {
      const a = await branchActivity();
      await as(ids.tr1);
      expect(await one<Task>("SELECT public.get_task($1) v", [a.task])).toMatchObject({
        can_edit: false,
        can_set_status: false,
        can_archive: false,
        can_add_note: true,
      });
      const note = await one<string>("SELECT public.add_task_note($1,'Looks good',$2::jsonb) v", [
        a.task,
        json([ids.vol1]),
      ]);
      expect(note).toBeTruthy();
      // The assignee and the creator (the Branch Manager) get the note notice; the mentioned volunteer the mention.
      expect(await noteNotices(ids.vol1b, a.task)).toEqual(["task_note_added"]);
      expect(await noteNotices(ids.bm1, a.task)).toEqual(["task_note_added"]);
      expect(await noteNotices(ids.vol1, a.task)).toEqual(["task_note_mention"]);
      expect(await noteNotices(ids.tr1, a.task)).toEqual([]);
      // Their own note: edit and delete as before.
      await as(ids.tr1);
      await one("SELECT public.update_task_note($1,'Looks very good','[]'::jsonb) v", [note]);
      await as(null);
      expect(await one("SELECT body v FROM task_notes WHERE id=$1", [note])).toBe(
        "Looks very good",
      );
      await as(ids.tr1);
      await db.query("SELECT public.delete_task_note($1)", [note]);
      await as(null);
      expect(await one("SELECT count(*)::int v FROM task_notes WHERE id=$1", [note])).toBe(0);
    }));

  it("other people's notes, another branch's tasks and region tasks stay refused", () =>
    tx(async () => {
      const a = await branchActivity();
      const bmNote = await one<string>("SELECT public.add_task_note($1,'Plan','[]'::jsonb) v", [
        a.task,
      ]);
      await as(ids.bm2);
      const other = await createTask({ branch_id: ids.b2, title: "Branch two", assignee_ids: [] });
      await as(ids.rd);
      const region = await one<string>("SELECT public.create_task($1::jsonb) v", [
        json({ scope: "region", region_id: ids.region, title: "Region plan", assignee_ids: [] }),
      ]);
      // The trustee of another branch cannot read or note branch One's task.
      await as(ids.tr2);
      expect(await one("SELECT public.get_task($1) v", [a.task])).toBeNull();
      await fails("SELECT public.add_task_note($1,'Hello','[]'::jsonb)", [a.task], "Not allowed");
      // The trustee of branch One: not branch Two's task, not a region task, not someone else's note.
      await as(ids.tr1);
      for (const task of [other, region])
        await fails("SELECT public.add_task_note($1,'Hello','[]'::jsonb)", [task], "Not allowed");
      await fails(
        "SELECT public.update_task_note($1,'Changed','[]'::jsonb)",
        [bmNote],
        "Not allowed",
      );
      await fails("SELECT public.delete_task_note($1)", [bmNote], "Not allowed");
    }));

  it("notes only: title, description, assignees, due date, status and archive of the task stay refused", () =>
    tx(async () => {
      const a = await branchActivity();
      await one("SELECT public.set_task_status($1,'done') v", [a.task]);
      await as(ids.tr1);
      for (const change of [
        { title: "Renamed" },
        { description: "New text" },
        { assignee_ids: [ids.tr1] },
        { due_date: "2027-01-01" },
      ])
        await fails(
          "SELECT public.update_task($1,$2::jsonb)",
          [a.task, json(change)],
          "Not allowed",
        );
      await fails("SELECT public.set_task_status($1,'todo')", [a.task], "Not allowed");
      await fails("SELECT public.archive_task($1,true)", [a.task], "Not allowed");
      await fails("SELECT public.archive_done_tasks($1::jsonb)", [json([a.task])], "Not allowed");
      await fails("SELECT public.delete_task($1)", [a.task], "Not allowed");
      await as(null);
      expect(
        await q("SELECT title, description, status, due_date, archived_at FROM tasks WHERE id=$1", [
          a.task,
        ]),
      ).toEqual([
        { title: "Posters", description: null, status: "done", due_date: null, archived_at: null },
      ]);
      // Their own task: the status still changes, and notes are allowed.
      await as(ids.tr1);
      expect(await one<Task>("SELECT public.get_task($1) v", [a.own])).toMatchObject({
        can_set_status: true,
        can_add_note: true,
      });
      expect(await one("SELECT public.set_task_status($1,'blocked') v", [a.own])).toBe("blocked");
    }));

  it("volunteers keep today's rules: assignees, creators and managers write notes, other members do not", () =>
    tx(async () => {
      const a = await branchActivity();
      // A volunteer of the branch who is not assigned reads the task but writes no note.
      await as(ids.vol1);
      expect(await one<Task>("SELECT public.get_task($1) v", [a.task])).toMatchObject({
        can_set_status: false,
        can_add_note: false,
      });
      await fails("SELECT public.add_task_note($1,'Hello','[]'::jsonb)", [a.task], "Not allowed");
      // The assignee writes a note; the creator hears about it.
      await as(ids.vol1b);
      expect(await one<Task>("SELECT public.get_task($1) v", [a.task])).toMatchObject({
        can_add_note: true,
      });
      await one("SELECT public.add_task_note($1,'On it','[]'::jsonb) v", [a.task]);
      expect(await noteNotices(ids.bm1, a.task)).toEqual(["task_note_added"]);
      // The creator (and manager) writes a note; the assignee hears about it.
      await as(ids.bm1);
      await one("SELECT public.add_task_note($1,'Thanks','[]'::jsonb) v", [a.task]);
      expect(await noteNotices(ids.vol1b, a.task)).toEqual(["task_note_added"]);
      // A volunteer's own task (created by them): notes allowed.
      await as(ids.vol1);
      const mine = await createTask({ title: "My poster" });
      expect(await one<Task>("SELECT public.get_task($1) v", [mine])).toMatchObject({
        can_edit: true,
        can_add_note: true,
      });
      await one("SELECT public.add_task_note($1,'Draft ready','[]'::jsonb) v", [mine]);
    }));
});

describe("assignment", () => {
  it("the Branch Manager assigns a trustee (the trustee is told); volunteers and the RD cannot", () =>
    tx(async () => {
      await as(ids.bm1);
      expect(
        (
          await one<{ id: string }[]>("SELECT public.list_task_people('branch',$1,NULL) v", [
            ids.b1,
          ])
        ).map((p) => p.id),
      ).toContain(ids.tr1);
      const task = await createTask({
        title: "Read the accounts",
        assignee_ids: [ids.tr1, ids.vol1],
      });
      expect(
        (await noticesOf(ids.tr1))
          .filter((n) => n.kind === "task_assigned")
          .map((n) => n.entity_id),
      ).toEqual([task]);

      await as(ids.vol1);
      expect(
        (
          await one<{ id: string }[]>("SELECT public.list_task_people('branch',$1,NULL) v", [
            ids.b1,
          ])
        ).map((p) => p.id),
      ).not.toContain(ids.tr1);
      await fails(
        "SELECT public.create_task($1::jsonb)",
        [json({ scope: "branch", branch_id: ids.b1, title: "X", assignee_ids: [ids.tr1] })],
        "This person cannot be assigned",
      );

      await as(ids.rd);
      expect(
        (
          await one<{ id: string }[]>("SELECT public.list_task_people('branch',$1,NULL) v", [
            ids.b1,
          ])
        ).map((p) => p.id),
      ).not.toContain(ids.tr1);
      await fails(
        "SELECT public.create_task($1::jsonb)",
        [json({ scope: "branch", branch_id: ids.b1, title: "X", assignee_ids: [ids.tr1] })],
        "This person cannot be assigned",
      );
      // The RD still edits the Branch Manager's task: the trustee assigned earlier stays.
      await db.query("SELECT public.update_task($1,$2::jsonb)", [
        task,
        json({ title: "Read the 2026 accounts", assignee_ids: [ids.tr1, ids.vol1] }),
      ]);
      await as(null);
      expect(
        await one("SELECT count(*)::int v FROM task_assignees WHERE task_id=$1 AND user_id=$2", [
          task,
          ids.tr1,
        ]),
      ).toBe(1);
    }));

  it("@all groups from the Branch Manager, the RD and a volunteer never include trustees and notify them of nothing", () =>
    tx(async () => {
      for (const creator of [ids.bm1, ids.rd, ids.vol1]) {
        await as(creator);
        const g = await createGroup({ title: `All from ${creator}` });
        const members = await groupMembers(g);
        expect(members).not.toContain(ids.tr1);
        expect(members).toContain(ids.vol1b);
      }
      expect(await noticesOf(ids.tr1)).toEqual([]);
      // Nor can a trustee be added to a group later.
      await as(ids.bm1);
      const g = await createGroup();
      await fails(
        "SELECT public.set_task_group_members($1,$2::jsonb,'[]'::jsonb)",
        [g, json([ids.tr1])],
        "This person cannot be assigned",
      );
    }));

  it("meetings: the Branch Manager and the RD invite trustees, a volunteer cannot", () =>
    tx(async () => {
      await as(ids.vol1);
      expect(
        (
          await one<{ id: string }[]>("SELECT public.list_meeting_people('branch',$1,NULL) v", [
            ids.b1,
          ])
        ).map((p) => p.id),
      ).not.toContain(ids.tr1);
      await fails(
        "SELECT public.create_meeting($1::jsonb)",
        [meetingIn({ invitee_ids: [ids.tr1] })],
        "Invitee is not in this scope",
      );
      for (const manager of [ids.bm1, ids.rd]) {
        await as(manager);
        expect(
          (
            await one<{ id: string }[]>("SELECT public.list_meeting_people('branch',$1,NULL) v", [
              ids.b1,
            ])
          ).map((p) => p.id),
        ).toContain(ids.tr1);
        await createMeeting({ invitee_ids: [ids.tr1] });
      }
      expect((await noticesOf(ids.tr1)).filter((n) => n.kind === "meeting_invited")).toHaveLength(
        2,
      );
    }));
});

describe("requests and registration", () => {
  it("a trustee asks their Branch Manager or RD for a task, a meeting and an event, and registers for events", () =>
    tx(async () => {
      await as(ids.tr1);
      expect(
        (await one<{ id: string }[]>("SELECT public.list_request_targets() v"))
          .map((t) => t.id)
          .sort(),
      ).toEqual([ids.bm1, ids.rd].sort());
      await one("SELECT public.submit_task_request($1::jsonb) v", [
        json({ target_id: ids.bm1, title: "Audit the books" }),
      ]);
      const meetingRequest = await one<string>(
        "SELECT public.submit_meeting_request($1::jsonb) v",
        [
          json({
            target_id: ids.bm1,
            topic: "Board review",
            proposed_times: [
              { starts_at: "2027-04-02T17:00:00Z", ends_at: "2027-04-02T18:00:00Z" },
            ],
          }),
        ],
      );
      await one("SELECT public.submit_event_request($1::jsonb) v", [
        json({
          title: "Trustee dinner",
          reason: "Outreach",
          all_day: false,
          proposed_start: new Date(Date.now() + 9 * 86400000).toISOString(),
          proposed_end: new Date(Date.now() + 9 * 86400000 + 7200000).toISOString(),
          location_text: "Hall",
          is_online: false,
          expected_attendees: 20,
        }),
      ]);
      expect(
        await one<{ status: string }>("SELECT public.register_for_event($1) v", [event]),
      ).toMatchObject({
        status: "registered",
      });
      // Approving the meeting request invites the trustee.
      await as(ids.bm1);
      const created = await one<string>("SELECT public.approve_meeting_request($1,$2::jsonb) v", [
        meetingRequest,
        json({
          title: "Board review",
          starts_at: "2027-04-02T17:00:00Z",
          ends_at: "2027-04-02T18:00:00Z",
          location_type: "online",
          online_url: "https://meet.example.org/x",
        }),
      ]);
      await as(ids.tr1);
      expect(
        (
          await one<{ invitees: { id: string }[] }>("SELECT public.get_meeting($1) v", [created])
        ).invitees.map((i) => i.id),
      ).toEqual([ids.tr1]);
    }));
});

describe("roles: approval and switching", () => {
  const apply = async () => {
    await as(ids.fol);
    return one<string>("SELECT public.submit_volunteer_application($1::jsonb) v", [
      json({
        branch_id: ids.b1,
        motivation: "I would like to help plan iftar dinners and welcome guests.",
        time_commitment: "few_hours_month",
        commitment: true,
      }),
    ]);
  };
  const rolesOf = async (user: string) => {
    await as(null);
    return (
      await q<{ role: string }>("SELECT role::text FROM user_roles WHERE user_id=$1", [user])
    ).map((r) => r.role);
  };
  const audit = async (user: string) => {
    await as(null);
    return q(
      "SELECT actor_id, action, old_value, new_value FROM user_audit_log WHERE target_id=$1 AND action='role_change' ORDER BY created_at, new_value",
      [user],
    );
  };

  it("the Branch Manager approves an application as a trustee (audited, told as a trustee)", () =>
    tx(async () => {
      const app = await apply();
      await as(ids.bm1);
      await fails(
        "SELECT public.approve_volunteer_application($1,'branch_manager')",
        [app],
        "Choose Volunteer or Trustee",
      );
      await db.query("SELECT public.approve_volunteer_application($1,'trustee')", [app]);
      expect(await rolesOf(ids.fol)).toEqual(["trustee"]);
      expect(await audit(ids.fol)).toEqual([
        { actor_id: ids.bm1, action: "role_change", old_value: "follower", new_value: "trustee" },
      ]);
      expect(
        (await noticesOf(ids.fol)).find((n) => n.kind === "volunteer_application_approved")
          ?.payload,
      ).toMatchObject({
        role: "trustee",
      });
    }));

  it("approval without a choice still makes a volunteer", () =>
    tx(async () => {
      const app = await apply();
      await as(ids.rd);
      await db.query("SELECT public.approve_volunteer_application($1)", [app]);
      expect(await rolesOf(ids.fol)).toEqual(["volunteer"]);
    }));

  it("the Branch Manager switches Volunteer <-> Trustee in their branch only, audited; nothing else", () =>
    tx(async () => {
      await as(ids.bm1);
      await db.query("SELECT public.set_user_role($1,'trustee')", [ids.vol1]);
      expect(await rolesOf(ids.vol1)).toEqual(["trustee"]);
      await as(ids.bm1);
      await db.query("SELECT public.set_user_role($1,'volunteer')", [ids.vol1]);
      expect(await rolesOf(ids.vol1)).toEqual(["volunteer"]);
      expect(await audit(ids.vol1)).toEqual([
        { actor_id: ids.bm1, action: "role_change", old_value: "volunteer", new_value: "trustee" },
        { actor_id: ids.bm1, action: "role_change", old_value: "trustee", new_value: "volunteer" },
      ]);
      await as(ids.bm1);
      await fails(
        "SELECT public.set_user_role($1,'branch_manager')",
        [ids.vol1],
        "Branch Managers can only switch between Volunteer and Trustee",
      );
      await fails(
        "SELECT public.set_user_role($1,'volunteer')",
        [ids.tr2],
        "You cannot manage this user",
      );
      await as(ids.vol1);
      await fails(
        "SELECT public.set_user_role($1,'volunteer')",
        [ids.tr1],
        "Only active Regional Directors can change roles",
      );
      await as(ids.tr1);
      await fails(
        "SELECT public.set_user_role($1,'trustee')",
        [ids.vol1b],
        "Only active Regional Directors can change roles",
      );
      // The RD may set Trustee too, and make a trustee a Branch Manager.
      await as(ids.rd);
      await db.query("SELECT public.set_user_role($1,'trustee')", [ids.vol1b]);
      await db.query("SELECT public.set_user_role($1,'branch_manager')", [ids.tr2]);
      expect([await rolesOf(ids.vol1b), await rolesOf(ids.tr2)]).toEqual([
        ["trustee"],
        ["branch_manager"],
      ]);
    }));

  it("the Branch Manager reads and manages trustees of the branch like volunteers (Users page)", () =>
    tx(async () => {
      await as(ids.bm1);
      expect(
        (await q<{ id: string }>("SELECT id FROM profiles WHERE id=$1", [ids.tr1])).length,
      ).toBe(1);
      await as(ids.bm2);
      expect(
        (await q<{ id: string }>("SELECT id FROM profiles WHERE id=$1", [ids.tr1])).length,
      ).toBe(0);
    }));
});

describe("National Coordinator counts", () => {
  it("trustees are counted separately and never named", () =>
    tx(async () => {
      await as(ids.nc, "aal2");
      const dashboard = await one<{ volunteers: number; trustees: number }>(
        "SELECT public.get_nc_dashboard() v",
      );
      // Members: rd, bm1, bm2, vol1, vol1b; trustees: tr1, tr2.
      expect(dashboard).toMatchObject({ volunteers: 5, trustees: 2 });
      const tree = await one<
        { id: string; branches: { id: string; volunteers: number; trustees: number }[] }[]
      >("SELECT public.get_regions_tree() v");
      expect(
        tree
          .find((r) => r.id === ids.region)!
          .branches.map((b) => [b.id, b.volunteers, b.trustees]),
      ).toEqual([
        [ids.b1, 2, 1],
        [ids.b2, 0, 1],
      ]);
      const map = await one<{ id: string; trustees: number }[]>("SELECT public.get_branch_map() v");
      expect(
        map.filter((b) => b.id === ids.b1 || b.id === ids.b2).map((b) => [b.id, b.trustees]),
      ).toEqual([
        [ids.b1, 1],
        [ids.b2, 1],
      ]);
      // No trustee names: the profiles stay unreadable for the NC.
      expect(await q("SELECT id FROM profiles WHERE id IN ($1,$2)", [ids.tr1, ids.tr2])).toEqual(
        [],
      );
    }));
});

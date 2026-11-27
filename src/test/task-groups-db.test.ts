import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { initializeRecycleDatabase } from "./recycle-db-fixture";

// Task groups ("@all") and meeting carry-over against every migration in PGlite (20261205090000_task_groups.sql):
// the member snapshot, own tasks, the manager's group view, derived status, propagation, delete, adding and removing
// members, RLS for other branches and the atomic carry-over. Each test is rolled back.
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
  vol2: id(14),
  vol1c: id(15),
  nc: id(16),
  fol: id(17),
};
type Row = Record<string, unknown>;
type Group = {
  id: string;
  title: string;
  status: string;
  member_count: number;
  counts: Record<string, number>;
  members: { task_id: string; user_id: string; status: string }[];
  mine: boolean;
  my_task_id: string | null;
  can_edit: boolean;
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
const createGroup = (p: Row) =>
  one<string>("SELECT public.create_task_group($1::jsonb) v", [
    JSON.stringify({ scope: "branch", branch_id: ids.b1, title: "Bring a friend", ...p }),
  ]);
const getGroup = (g: string) => one<Group | null>("SELECT public.get_task_group($1) v", [g]);
const memberTask = async (g: string, user: string) =>
  (await getGroup(g))!.members.find((m) => m.user_id === user)!.task_id;
const setStatus = (task: string, status: string) =>
  db.query("SELECT public.set_task_status($1,$2)", [task, status]);
const visibleTasks = async () =>
  (await one<{ id: string; group_id: string | null; mine: boolean }[]>(
    "SELECT public.list_tasks() v",
  )) ?? [];

beforeAll(async () => {
  await initializeRecycleDatabase(db);
  const members = [ids.rd, ids.bm1, ids.vol1, ids.vol1b, ids.vol1c, ids.vol2, ids.nc, ids.fol];
  await db.exec(`INSERT INTO regions(id,name) VALUES ('${ids.region}','Region');
    INSERT INTO branches(id,name,region_id) VALUES ('${ids.b1}','One','${ids.region}'),('${ids.b2}','Two','${ids.region}');
    INSERT INTO auth.users(id, raw_user_meta_data) SELECT x, jsonb_build_object('full_name','Person '||left(x::text,2),'privacy_notice_version','1.7')
      FROM unnest(ARRAY['${members.join("','")}']::uuid[]) x;
    UPDATE profiles SET status='active';
    UPDATE profiles SET branch_id='${ids.b1}' WHERE id IN ('${ids.bm1}','${ids.vol1}','${ids.vol1b}','${ids.vol1c}');
    UPDATE profiles SET branch_id='${ids.b2}' WHERE id='${ids.vol2}';
    UPDATE profiles SET branch_id=NULL WHERE id IN ('${ids.rd}','${ids.nc}');
    UPDATE user_roles SET role='branch_manager' WHERE user_id='${ids.bm1}';
    UPDATE user_roles SET role='regional_director', region_id='${ids.region}' WHERE user_id='${ids.rd}';
    UPDATE user_roles SET role='national_coordinator' WHERE user_id='${ids.nc}';
    -- fol is a follower (no branch, no member rights).
    UPDATE profiles SET branch_id=NULL WHERE id='${ids.fol}';
    UPDATE user_roles SET role='follower' WHERE user_id='${ids.fol}';
    -- vol1c is inactive: not a member of a new group.
    UPDATE profiles SET status='inactive' WHERE id='${ids.vol1c}';`);
}, 60000);
afterAll(async () => db.close());

describe("@all creates a task group with one task per active member", () => {
  it("snapshots the active members of the branch, each with their own task and an assignment notice", () =>
    tx(async () => {
      await as(ids.bm1);
      const g = await createGroup({ due_date: "2026-12-20", description: "Each of us brings one" });
      const group = (await getGroup(g))!;
      expect(group.members.map((m) => m.user_id).sort()).toEqual(
        [ids.bm1, ids.vol1, ids.vol1b].sort(),
      );
      expect(group).toMatchObject({ member_count: 3, status: "todo", can_edit: true, mine: true });
      expect(group.counts).toEqual({ todo: 3, in_progress: 0, blocked: 0, done: 0 });
      await as(null);
      const tasks = await q<Row>(
        "SELECT t.title, t.due_date::text due, t.description, t.created_by, t.self_task, array_agg(a.user_id) who FROM tasks t JOIN task_assignees a ON a.task_id=t.id WHERE t.group_id=$1 GROUP BY t.id",
        [g],
      );
      expect(tasks).toHaveLength(3);
      for (const t of tasks) {
        expect(t).toMatchObject({
          title: "Bring a friend",
          due: "2026-12-20",
          description: "Each of us brings one",
          created_by: ids.bm1,
          self_task: false,
        });
        expect((t["who"] as string[]).length).toBe(1);
      }
      // The normal assignment notice for each member (never for the creator themselves).
      const notices = await q<{ user_id: string }>(
        "SELECT user_id FROM notifications WHERE kind='task_assigned' ORDER BY user_id",
      );
      expect(notices.map((n) => n.user_id).sort()).toEqual([ids.vol1, ids.vol1b].sort());
    }));

  // Volunteers of the branch create groups too (20261207090000, task-groups-volunteer-db.test.ts); another branch's
  // volunteer may not.
  it("only the branch's managers and volunteers create groups; their own branch, branch scope only", () =>
    tx(async () => {
      await as(ids.vol2);
      await fails(
        "SELECT public.create_task_group($1::jsonb)",
        [JSON.stringify({ scope: "branch", branch_id: ids.b1, title: "X" })],
        "Not allowed",
      );
      await as(ids.bm1);
      await fails(
        "SELECT public.create_task_group($1::jsonb)",
        [JSON.stringify({ scope: "branch", branch_id: ids.b2, title: "X" })],
        "Not allowed",
      );
      await fails(
        "SELECT public.create_task_group($1::jsonb)",
        [JSON.stringify({ scope: "region", branch_id: ids.b1, title: "X" })],
        "Not allowed",
      );
      await fails(
        "SELECT public.create_task_group($1::jsonb)",
        [JSON.stringify({ scope: "branch", branch_id: ids.b1, title: " " })],
        "Title is required",
      );
      // The Regional Director creates in a branch of the region (members: that branch's people only).
      await as(ids.rd);
      const g = await createGroup({});
      expect((await getGroup(g))!.members.map((m) => m.user_id).sort()).toEqual(
        [ids.bm1, ids.vol1, ids.vol1b].sort(),
      );
    }));
});

describe("members, managers and other branches", () => {
  it("a member owns and updates their own task; My tasks has only that one", () =>
    tx(async () => {
      await as(ids.bm1);
      const g = await createGroup({});
      await as(ids.vol1);
      const mine = (await visibleTasks()).filter((t) => t.mine);
      expect(mine).toHaveLength(1);
      expect(mine[0]!.group_id).toBe(g);
      const group = (await getGroup(g))!;
      expect(group).toMatchObject({ mine: true, my_task_id: mine[0]!.id, can_edit: false });
      await setStatus(mine[0]!.id, "in_progress");
      await db.query("SELECT public.add_task_note($1,'Asked my neighbour','[]'::jsonb)", [
        mine[0]!.id,
      ]);
      // Another member's task: no status change, and the group itself is not theirs to edit.
      await fails(
        "SELECT public.set_task_status($1,'done')",
        [await memberTask(g, ids.vol1b)],
        "Not allowed",
      );
      await fails(
        'SELECT public.update_task_group($1,\'{"title":"Mine now"}\'::jsonb)',
        [g],
        "Not allowed",
      );
      await fails("SELECT public.delete_task_group($1)", [g], "Not allowed");
    }));

  it("the manager sees the group with counts; another branch sees neither the group nor its tasks", () =>
    tx(async () => {
      await as(ids.bm1);
      const g = await createGroup({});
      expect((await one<Group[]>("SELECT public.list_task_groups() v")).map((x) => x.id)).toEqual([
        g,
      ]);
      expect((await q("SELECT id FROM task_groups")).length).toBe(1);
      await as(ids.vol2);
      expect(await getGroup(g)).toBeNull();
      expect(await one<Group[]>("SELECT public.list_task_groups() v")).toEqual([]);
      expect(await q("SELECT id FROM task_groups")).toEqual([]);
      expect((await visibleTasks()).filter((t) => t.group_id === g)).toEqual([]);
      await fails(
        "SELECT public.set_task_group_members($1,$2::jsonb,'[]'::jsonb)",
        [g, JSON.stringify([ids.vol2])],
        "Not allowed",
      );
      // National Coordinators do not see branch work (nor volunteer names).
      await as(ids.nc, "aal2");
      expect(await getGroup(g)).toBeNull();
      // The region's Regional Director manages it.
      await as(ids.rd);
      expect((await getGroup(g))!.can_edit).toBe(true);
    }));
});

describe("derived status", () => {
  it("all done is done; any in progress or done is in progress; otherwise to do (blocked counts as to do)", () =>
    tx(async () => {
      await as(ids.bm1);
      const g = await createGroup({});
      const t1 = await memberTask(g, ids.vol1);
      const t2 = await memberTask(g, ids.vol1b);
      const t3 = await memberTask(g, ids.bm1);
      await setStatus(t1, "blocked");
      expect((await getGroup(g))!.status).toBe("todo");
      await setStatus(t2, "done");
      expect((await getGroup(g))!).toMatchObject({
        status: "in_progress",
        counts: { todo: 1, in_progress: 0, blocked: 1, done: 1 },
      });
      await setStatus(t1, "done");
      await setStatus(t3, "done");
      expect((await getGroup(g))!.status).toBe("done");
      await as(null);
      await expect(
        q(
          "SELECT 1 FROM information_schema.columns WHERE table_name='task_groups' AND column_name='status'",
        ),
      ).resolves.toEqual([]);
    }));
});

describe("editing, members and deleting", () => {
  it("title, description, priority and due date go to every member task", () =>
    tx(async () => {
      await as(ids.bm1);
      const g = await createGroup({ due_date: "2026-12-20" });
      await db.query("SELECT public.update_task_group($1,$2::jsonb)", [
        g,
        JSON.stringify({
          title: "Bring two friends",
          description: "Or more",
          due_date: "2026-12-24",
          priority: "high",
        }),
      ]);
      await as(null);
      const rows = await q<Row>(
        "SELECT DISTINCT title, description, priority, due_date::text due FROM tasks WHERE group_id=$1",
        [g],
      );
      expect(rows).toEqual([
        { title: "Bring two friends", description: "Or more", priority: "high", due: "2026-12-24" },
      ]);
      expect(await one("SELECT title v FROM task_groups WHERE id=$1", [g])).toBe(
        "Bring two friends",
      );
      await as(ids.bm1);
      await fails(
        'SELECT public.update_task_group($1,\'{"title":""}\'::jsonb)',
        [g],
        "Title is required",
      );
    }));

  it("adds a member (own task and notice) and removes one (to the Recycle Bin); the last member stays", () =>
    tx(async () => {
      await as(ids.bm1);
      const g = await createGroup({});
      await as(null);
      await db.query("UPDATE profiles SET status='active' WHERE id=$1", [ids.vol1c]);
      await as(ids.bm1);
      const changed = await one<Row>(
        "SELECT public.set_task_group_members($1,$2::jsonb,$3::jsonb) v",
        [g, JSON.stringify([ids.vol1c]), JSON.stringify([ids.vol1b])],
      );
      expect(changed).toEqual({ added: 1, removed: 1 });
      const group = (await getGroup(g))!;
      expect(group.members.map((m) => m.user_id).sort()).toEqual(
        [ids.bm1, ids.vol1, ids.vol1c].sort(),
      );
      await fails(
        "SELECT public.set_task_group_members($1,$2::jsonb,'[]'::jsonb)",
        [g, JSON.stringify([ids.vol1])],
        "already in the group",
      );
      await fails(
        "SELECT public.set_task_group_members($1,$2::jsonb,'[]'::jsonb)",
        [g, JSON.stringify([ids.vol2])],
        "cannot be assigned",
      );
      await fails(
        "SELECT public.set_task_group_members($1,'[]'::jsonb,$2::jsonb)",
        [g, JSON.stringify([ids.bm1, ids.vol1, ids.vol1c])],
        "at least one member",
      );
      await as(null);
      expect(
        await one(
          "SELECT count(*)::int v FROM notifications WHERE kind='task_assigned' AND user_id=$1",
          [ids.vol1c],
        ),
      ).toBe(1);
      expect(
        await one(
          "SELECT count(*)::int v FROM recycle_bin_audit_log WHERE item_type='task' AND action='delete'",
        ),
      ).toBe(1);
    }));

  it("deleting the group moves every member task to the Recycle Bin and removes the group", () =>
    tx(async () => {
      await as(ids.bm1);
      const g = await createGroup({});
      expect(await one<number>("SELECT public.delete_task_group($1) v", [g])).toBe(3);
      expect(await getGroup(g)).toBeNull();
      await as(null);
      expect(await q("SELECT id FROM task_groups WHERE id=$1", [g])).toEqual([]);
      const rows = await q<Row>(
        "SELECT deleted_at IS NOT NULL gone, group_id FROM tasks WHERE created_by=$1",
        [ids.bm1],
      );
      expect(rows).toHaveLength(3);
      // The group link is cleared (ON DELETE SET NULL): a restored task comes back as an ordinary task.
      expect(rows.every((r) => r["gone"] === true && r["group_id"] === null)).toBe(true);
      expect(
        await one(
          "SELECT count(*)::int v FROM recycle_bin_audit_log WHERE item_type='task' AND action='delete'",
        ),
      ).toBe(3);
    }));
});

describe("from a meeting decision, and meeting carry-over", () => {
  const meeting = (extra: Row = {}) => ({
    scope: "branch",
    branch_id: ids.b1,
    title: "Committee",
    starts_at: new Date(Date.now() - 7 * 86400000).toISOString(),
    ends_at: new Date(Date.now() - 7 * 86400000 + 3600000).toISOString(),
    location_type: "in_person",
    location: "Hall",
    ...extra,
  });
  const create = (p: Row) =>
    one<string>("SELECT public.create_meeting($1::jsonb) v", [JSON.stringify(p)]);

  it("a group from a decision shows as group_id on the decision's tasks", () =>
    tx(async () => {
      await as(ids.bm1);
      const m = await create(meeting());
      const item = await one<string>("SELECT public.add_agenda_item($1,'Outreach') v", [m]);
      const d = await one<string>(
        "SELECT public.add_meeting_decision($1,'Everyone brings a friend') v",
        [item],
      );
      const g = await createGroup({ decision_id: d });
      expect(await one("SELECT meeting_id v FROM task_groups WHERE id=$1", [g])).toBe(m);
      const detail = await one<{
        agenda: { decisions: { tasks: { group_id: string | null }[] }[] }[];
      }>("SELECT public.get_meeting($1) v", [m]);
      const tasks = detail.agenda[0]!.decisions[0]!.tasks;
      expect(tasks).toHaveLength(3);
      expect(new Set(tasks.map((t) => t.group_id))).toEqual(new Set([g]));
    }));

  it("lists unresolved items with decisions and open tasks, and carries them over atomically (tasks move, not copied)", () =>
    tx(async () => {
      await as(ids.bm1);
      const old = await create(meeting());
      const item = await one<string>(
        "SELECT public.add_agenda_item($1,'Hall booking','Call the council') v",
        [old],
      );
      const resolved = await one<string>("SELECT public.add_agenda_item($1,'Done item') v", [old]);
      await db.query("SELECT public.set_agenda_item_resolved($1,true)", [resolved]);
      const d1 = await one<string>("SELECT public.add_meeting_decision($1,'Ask for quotes') v", [
        item,
      ]);
      const d2 = await one<string>("SELECT public.add_meeting_decision($1,'Keep the old date') v", [
        item,
      ]);
      const open = await one<string>("SELECT public.create_task($1::jsonb) v", [
        JSON.stringify({
          scope: "branch",
          branch_id: ids.b1,
          title: "Quotes",
          decision_id: d1,
          assignee_ids: [ids.vol1],
        }),
      ]);
      const done = await one<string>("SELECT public.create_task($1::jsonb) v", [
        JSON.stringify({
          scope: "branch",
          branch_id: ids.b1,
          title: "Old quote",
          decision_id: d1,
          status: "done",
        }),
      ]);
      const offered = await one<
        {
          meeting_id: string;
          items: { id: string; decisions: { id: string; tasks: { id: string }[] }[] }[];
        }[]
      >("SELECT public.list_meeting_carry_over('branch',$1) v", [ids.b1]);
      expect(offered.map((o) => o.meeting_id)).toEqual([old]);
      expect(offered[0]!.items.map((i) => i.id)).toEqual([item]);
      expect(offered[0]!.items[0]!.decisions.map((d) => d.id).sort()).toEqual([d1, d2].sort());
      expect(
        offered[0]!.items[0]!.decisions.find((d) => d.id === d1)!.tasks.map((t) => t.id),
      ).toEqual([open]);
      // Other branches and people who cannot edit the earlier meeting get nothing.
      await as(ids.vol2);
      expect(await one("SELECT public.list_meeting_carry_over('branch',$1) v", [ids.b1])).toEqual(
        [],
      );

      await as(ids.bm1);
      const next = await create(
        meeting({
          starts_at: new Date(Date.now() + 86400000).toISOString(),
          ends_at: new Date(Date.now() + 90000000).toISOString(),
        }),
      );
      // A task of another decision cannot ride along; nothing is written.
      await fails(
        "SELECT public.carry_over_agenda($1,$2::jsonb)",
        [next, JSON.stringify([{ item_id: item, decision_ids: [d2], task_ids: [open] }])],
        "cannot be carried over",
      );
      expect(
        await one("SELECT count(*)::int v FROM meeting_agenda_items WHERE meeting_id=$1", [next]),
      ).toBe(0);
      expect(
        await one<number>("SELECT public.carry_over_agenda($1,$2::jsonb) v", [
          next,
          JSON.stringify([{ item_id: item, decision_ids: [d1], task_ids: [open] }]),
        ]),
      ).toBe(1);
      await as(null);
      const newItem = (
        await q<Row>("SELECT id, title, notes FROM meeting_agenda_items WHERE meeting_id=$1", [
          next,
        ])
      )[0]!;
      expect(newItem).toMatchObject({ title: "Hall booking", notes: "Call the council" });
      expect(await one("SELECT carried_to v FROM meeting_agenda_items WHERE id=$1", [item])).toBe(
        newItem["id"],
      );
      const newDecisions = await q<Row>(
        "SELECT id, text FROM meeting_decisions WHERE meeting_id=$1",
        [next],
      );
      expect(newDecisions.map((d) => d["text"])).toEqual(["Ask for quotes"]);
      // The open task moved (same id, new meeting and decision); the done one stayed; no task was copied.
      expect(await q<Row>("SELECT meeting_id, decision_id FROM tasks WHERE id=$1", [open])).toEqual(
        [{ meeting_id: next, decision_id: newDecisions[0]!["id"] }],
      );
      expect(await q<Row>("SELECT meeting_id, decision_id FROM tasks WHERE id=$1", [done])).toEqual(
        [{ meeting_id: old, decision_id: d1 }],
      );
      expect(await one("SELECT count(*)::int v FROM tasks WHERE title='Quotes'")).toBe(1);
      // The old meeting keeps its decisions; the carried item is not offered again.
      expect(
        await one("SELECT count(*)::int v FROM meeting_decisions WHERE meeting_id=$1", [old]),
      ).toBe(2);
      await as(ids.bm1);
      expect(await one("SELECT public.list_meeting_carry_over('branch',$1) v", [ids.b1])).toEqual(
        [],
      );
      await fails(
        "SELECT public.carry_over_agenda($1,$2::jsonb)",
        [next, JSON.stringify([{ item_id: item, decision_ids: [], task_ids: [] }])],
        "cannot be carried over",
      );
    }));

  it("a grouped task moves with its whole group", () =>
    tx(async () => {
      await as(ids.bm1);
      const old = await create(meeting());
      const item = await one<string>("SELECT public.add_agenda_item($1,'Outreach') v", [old]);
      const d = await one<string>(
        "SELECT public.add_meeting_decision($1,'Everyone brings a friend') v",
        [item],
      );
      const g = await createGroup({ decision_id: d });
      const next = await create(
        meeting({
          starts_at: new Date(Date.now() + 86400000).toISOString(),
          ends_at: new Date(Date.now() + 90000000).toISOString(),
        }),
      );
      const one_task = await memberTask(g, ids.vol1);
      await db.query("SELECT public.carry_over_agenda($1,$2::jsonb)", [
        next,
        JSON.stringify([{ item_id: item, decision_ids: [d], task_ids: [one_task] }]),
      ]);
      await as(null);
      expect(await one("SELECT meeting_id v FROM task_groups WHERE id=$1", [g])).toBe(next);
      expect(
        await one("SELECT count(DISTINCT meeting_id)::int v FROM tasks WHERE group_id=$1", [g]),
      ).toBe(1);
      expect(await one("SELECT meeting_id v FROM tasks WHERE group_id=$1 LIMIT 1", [g])).toBe(next);
    }));
});

describe("grants", () => {
  it("anon cannot read task groups or call the group RPCs; the table has RLS", async () => {
    await as(null);
    expect(
      await one("SELECT relrowsecurity v FROM pg_class WHERE oid='public.task_groups'::regclass"),
    ).toBe(true);
    for (const fn of [
      "create_task_group(jsonb)",
      "update_task_group(uuid,jsonb)",
      "delete_task_group(uuid)",
      "set_task_group_members(uuid,jsonb,jsonb)",
      "get_task_group(uuid)",
      "list_task_groups()",
      "list_meeting_carry_over(text,uuid,uuid)",
      "carry_over_agenda(uuid,jsonb)",
    ]) {
      expect(await one(`SELECT has_function_privilege('anon','public.${fn}','EXECUTE') v`)).toBe(
        false,
      );
      expect(
        await one(`SELECT has_function_privilege('authenticated','public.${fn}','EXECUTE') v`),
      ).toBe(true);
    }
    for (const fn of [
      "task_group_status(uuid)",
      "task_group_people(uuid,uuid)",
      "task_group_trash_task(uuid)",
    ])
      expect(
        await one(`SELECT has_function_privilege('authenticated','public.${fn}','EXECUTE') v`),
      ).toBe(false);
    expect(await one("SELECT has_table_privilege('anon','public.task_groups','SELECT') v")).toBe(
      false,
    );
    expect(
      await one("SELECT has_table_privilege('authenticated','public.task_groups','INSERT') v"),
    ).toBe(false);
  });
});

// Every new function: SECURITY DEFINER with a pinned search path; the client RPCs are executable by authenticated only
// (never PUBLIC or anon), the internal helpers by nobody but their owner.
const CLIENT_RPCS = [
  "can_view_task_group(uuid)",
  "can_edit_task_group(uuid)",
  "create_task_group(jsonb)",
  "update_task_group(uuid,jsonb)",
  "delete_task_group(uuid)",
  "set_task_group_members(uuid,jsonb,jsonb)",
  "get_task_group(uuid)",
  "list_task_groups()",
  "list_meeting_carry_over(text,uuid,uuid)",
  "carry_over_agenda(uuid,jsonb)",
  "list_task_sources()",
];
const INTERNAL = [
  "task_group_status(uuid)",
  "task_group_locked(uuid)",
  "task_group_people(uuid,uuid)",
  "task_group_body(task_groups)",
  "task_group_add_member(task_groups,uuid)",
  "task_group_trash_task(uuid)",
  "task_group_json(task_groups)",
];

describe("security attributes of the new functions", () => {
  it("all are SECURITY DEFINER with search_path=public; EXECUTE only for authenticated (client) or nobody (internal)", async () => {
    await as(null);
    for (const fn of [...CLIENT_RPCS, ...INTERNAL]) {
      const row = (
        await q<{ secdef: boolean; config: string[] | null; public_exec: boolean }>(
          `SELECT p.prosecdef secdef, p.proconfig config,
             EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                     WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE') public_exec
           FROM pg_proc p WHERE p.oid = 'public.${fn}'::regprocedure`,
        )
      )[0]!;
      expect(row.secdef, fn).toBe(true);
      expect(row.config, fn).toContain("search_path=public");
      expect(row.public_exec, `${fn}: PUBLIC must not execute`).toBe(false);
      expect(
        await one(`SELECT has_function_privilege('anon','public.${fn}','EXECUTE') v`),
        fn,
      ).toBe(false);
      expect(
        await one(`SELECT has_function_privilege('authenticated','public.${fn}','EXECUTE') v`),
        fn,
      ).toBe(CLIENT_RPCS.includes(fn));
    }
  });
});

// The write RPCs check the caller in the database: a volunteer of another branch, a follower, a volunteer of the same
// branch (not a manager), a National Coordinator (no branch rights) and anon are refused; the branch's Branch Manager
// and the region's Regional Director may do everything.
describe("write RPC permissions", () => {
  const pastMeeting = {
    scope: "branch",
    branch_id: ids.b1,
    title: "Committee",
    starts_at: new Date(Date.now() - 7 * 86400000).toISOString(),
    ends_at: new Date(Date.now() - 7 * 86400000 + 3600000).toISOString(),
    location_type: "in_person",
    location: "Hall",
  };
  const nextMeeting = {
    ...pastMeeting,
    title: "Next committee",
    starts_at: new Date(Date.now() + 7 * 86400000).toISOString(),
    ends_at: new Date(Date.now() + 7 * 86400000 + 3600000).toISOString(),
  };
  /** As `owner`: a group in b1, a past meeting with one open agenda item, and an upcoming meeting to carry it to. */
  async function fixture(owner: string) {
    await as(owner);
    const group = await createGroup({});
    const source = await one<string>("SELECT public.create_meeting($1::jsonb) v", [
      JSON.stringify(pastMeeting),
    ]);
    const item = await one<string>(
      "SELECT public.add_agenda_item($1,'Hall booking','Call the council') v",
      [source],
    );
    const target = await one<string>("SELECT public.create_meeting($1::jsonb) v", [
      JSON.stringify(nextMeeting),
    ]);
    return { group, item, target };
  }
  const calls = (f: { group: string; item: string; target: string }) =>
    [
      [
        "create_task_group",
        "SELECT public.create_task_group($1::jsonb)",
        [JSON.stringify({ scope: "branch", branch_id: ids.b1, title: "Sneaky" })],
      ],
      [
        "update_task_group",
        "SELECT public.update_task_group($1,$2::jsonb)",
        [f.group, JSON.stringify({ title: "Changed" })],
      ],
      [
        "set_task_group_members (add)",
        "SELECT public.set_task_group_members($1,$2::jsonb,'[]'::jsonb)",
        [f.group, JSON.stringify([ids.vol1c])],
      ],
      [
        "set_task_group_members (remove)",
        "SELECT public.set_task_group_members($1,'[]'::jsonb,$2::jsonb)",
        [f.group, JSON.stringify([ids.vol1])],
      ],
      ["delete_task_group", "SELECT public.delete_task_group($1)", [f.group]],
      [
        "carry_over_agenda",
        "SELECT public.carry_over_agenda($1,$2::jsonb)",
        [f.target, JSON.stringify([{ item_id: f.item, decision_ids: [], task_ids: [] }])],
      ],
    ] as const;

  for (const [who, label] of [
    ["vol2", "a volunteer of another branch"],
    ["fol", "a follower"],
    ["vol1", "a volunteer of the same branch (on a group they did not create)"],
    ["nc", "a National Coordinator"],
  ] as const) {
    it(`${label} is refused by every write RPC, and nothing changed`, () =>
      tx(async () => {
        const f = await fixture(ids.bm1);
        await as(ids[who], who === "nc" ? "aal2" : "aal1");
        // A volunteer of the branch may create a group of their own (20261207090000); everything else is refused.
        const refused = calls(f).filter(
          ([name]) => !(who === "vol1" && name === "create_task_group"),
        );
        for (const [name, sql, params] of refused)
          await fails(sql, [...params], "Not allowed").catch((e) => {
            throw new Error(`${name} as ${who}: ${(e as Error).message}`);
          });
        await as(null);
        expect(await one("SELECT title v FROM task_groups WHERE id=$1", [f.group])).toBe(
          "Bring a friend",
        );
        // The Branch Manager, vol1 and vol1b (vol1c is inactive): three member tasks, still all there.
        expect(
          await one("SELECT count(*)::int v FROM tasks WHERE group_id=$1 AND deleted_at IS NULL", [
            f.group,
          ]),
        ).toBe(3);
        expect(
          await one("SELECT carried_to v FROM meeting_agenda_items WHERE id=$1", [f.item]),
        ).toBeNull();
        expect(await one("SELECT count(*)::int v FROM task_groups")).toBe(1);
      }));
  }

  it("anon is refused by every write RPC (no EXECUTE)", () =>
    tx(async () => {
      const f = await fixture(ids.bm1);
      await db.exec("RESET ROLE");
      await db.exec("SET LOCAL ROLE anon");
      for (const [, sql, params] of calls(f)) await fails(sql, [...params], "permission denied");
    }));

  for (const [who, label] of [
    ["bm1", "the Branch Manager"],
    ["rd", "the region's Regional Director"],
  ] as const) {
    it(`${label} creates, edits, changes members, carries over and deletes`, () =>
      tx(async () => {
        const f = await fixture(ids[who]);
        await as(ids[who]);
        expect(
          await one("SELECT public.update_task_group($1,$2::jsonb) v", [
            f.group,
            JSON.stringify({ title: "Changed" }),
          ]),
        ).toBe(f.group);
        expect(
          await one("SELECT public.set_task_group_members($1,'[]'::jsonb,$2::jsonb) v", [
            f.group,
            JSON.stringify([ids.vol1]),
          ]),
        ).toEqual({ added: 0, removed: 1 });
        expect(
          await one("SELECT public.set_task_group_members($1,$2::jsonb,'[]'::jsonb) v", [
            f.group,
            JSON.stringify([ids.vol1]),
          ]),
        ).toEqual({ added: 1, removed: 0 });
        expect(
          await one("SELECT public.carry_over_agenda($1,$2::jsonb) v", [
            f.target,
            JSON.stringify([{ item_id: f.item, decision_ids: [], task_ids: [] }]),
          ]),
        ).toBe(1);
        expect(
          await one<number>("SELECT public.delete_task_group($1) v", [f.group]),
        ).toBeGreaterThan(0);
        await as(null);
        expect(await one("SELECT count(*)::int v FROM task_groups WHERE id=$1", [f.group])).toBe(0);
        expect(
          await one("SELECT carried_to IS NOT NULL v FROM meeting_agenda_items WHERE id=$1", [
            f.item,
          ]),
        ).toBe(true);
      }));
  }

  it("a volunteer of the branch reads the group; other branches, followers and anon read nothing", () =>
    tx(async () => {
      const f = await fixture(ids.bm1);
      await as(ids.vol1);
      expect((await getGroup(f.group))?.id).toBe(f.group);
      expect((await getGroup(f.group))?.can_edit).toBe(false);
      for (const who of ["vol2", "fol"] as const) {
        await as(ids[who]);
        expect(await getGroup(f.group), who).toBeNull();
        expect(await one("SELECT jsonb_array_length(public.list_task_groups()) v"), who).toBe(0);
        expect(await one("SELECT count(*)::int v FROM task_groups"), who).toBe(0);
      }
      await as(ids.nc, "aal2");
      expect(await getGroup(f.group), "nc").toBeNull();
      await db.exec("RESET ROLE");
      await db.exec("SET LOCAL ROLE anon");
      await fails("SELECT public.get_task_group($1)", [f.group], "permission denied");
      await fails("SELECT 1 FROM public.task_groups", [], "permission denied");
    }));
});

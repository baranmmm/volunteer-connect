import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { initializeRecycleDatabase } from "./recycle-db-fixture";

// Carry-over shares tasks (20261221090000_carry_over_shared_tasks.sql), against every migration in PGlite: a task shows
// under its decision and every later copy, never earlier ones; "Also in" on the Tasks page; a decision deleted for good
// hands its tasks to its copy. The repair is tested on older data: carry-overs made by the earlier carry_over_agenda
// (tasks moved) are put back, and the migration stops without changes when anything cannot be matched.
const MIGRATION = "20261221090000_carry_over_shared_tasks.sql";
const id = (n: number) => {
  const h = n.toString(16).padStart(2, "0");
  return `${h.repeat(4)}-${h.repeat(2)}-4${h}${h[0]}-8${h}${h[0]}-${h.repeat(6)}`;
};
const ids = {
  region: id(1),
  b1: id(2),
  bm1: id(11),
  vol1: id(12),
  vol1b: id(13),
  vol2: id(14),
  b2: id(3),
};
type Row = Record<string, unknown>;
type Meeting = {
  agenda: {
    title: string;
    decisions: { id: string; text: string; tasks: { id: string; group_id?: string }[] }[];
  }[];
};

function helpers(db: PGlite) {
  const as = async (user: string | null) => {
    await db.exec("RESET ROLE");
    await db.query(
      "SELECT set_config('request.jwt.claim.sub',$1,false), set_config('request.jwt.claim.aal','aal1',false)",
      [user ?? ""],
    );
    if (user) await db.exec("SET ROLE authenticated");
  };
  const q = async <T = Row>(sql: string, params: unknown[] = []) =>
    (await db.query<T>(sql, params)).rows;
  const one = async <T = unknown>(sql: string, params: unknown[] = []) =>
    (await db.query<{ v: T }>(sql, params)).rows[0]?.v as T;
  const meeting = (title: string, days: number) =>
    one<string>("SELECT public.create_meeting($1::jsonb) v", [
      JSON.stringify({
        scope: "branch",
        branch_id: ids.b1,
        title,
        starts_at: new Date(Date.now() + days * 86400000).toISOString(),
        ends_at: new Date(Date.now() + days * 86400000 + 3600000).toISOString(),
        location_type: "in_person",
        location: "Hall",
      }),
    ]);
  const item = (m: string, title: string) =>
    one<string>("SELECT public.add_agenda_item($1,$2) v", [m, title]);
  const decision = (i: string, text: string) =>
    one<string>("SELECT public.add_meeting_decision($1,$2) v", [i, text]);
  const task = (d: string, title: string) =>
    one<string>("SELECT public.create_task($1::jsonb) v", [
      JSON.stringify({
        scope: "branch",
        branch_id: ids.b1,
        title,
        decision_id: d,
        assignee_ids: [ids.vol1],
      }),
    ]);
  const group = (d: string, title: string) =>
    one<string>("SELECT public.create_task_group($1::jsonb) v", [
      JSON.stringify({ scope: "branch", branch_id: ids.b1, title, decision_id: d }),
    ]);
  const carry = (target: string, p: unknown) =>
    one<number>("SELECT public.carry_over_agenda($1,$2::jsonb) v", [target, JSON.stringify(p)]);
  const shown = async (m: string) => {
    const r = await one<Meeting>("SELECT public.get_meeting($1) v", [m]);
    return Object.fromEntries(
      r.agenda.flatMap((a) =>
        a.decisions.map((d) => [`${a.title}/${d.text}`, d.tasks.map((t) => t.id).sort()]),
      ),
    );
  };
  const decisionsOf = (m: string) =>
    q<{ id: string; text: string; carried_from: string | null }>(
      "SELECT id, text, carried_from FROM meeting_decisions WHERE meeting_id=$1 ORDER BY created_at, text",
      [m],
    );
  return { as, q, one, meeting, item, decision, task, group, carry, shown, decisionsOf };
}

async function seed(db: PGlite, until?: string) {
  await initializeRecycleDatabase(db, until ? { until } : {});
  const members = [ids.bm1, ids.vol1, ids.vol1b, ids.vol2];
  await db.exec(`INSERT INTO regions(id,name) VALUES ('${ids.region}','Region');
    INSERT INTO branches(id,name,region_id) VALUES ('${ids.b1}','One','${ids.region}'),('${ids.b2}','Two','${ids.region}');
    INSERT INTO auth.users(id, raw_user_meta_data) SELECT x, jsonb_build_object('full_name','Person '||left(x::text,2),'privacy_notice_version','1.7')
      FROM unnest(ARRAY['${members.join("','")}']::uuid[]) x;
    UPDATE profiles SET status='active';
    UPDATE profiles SET branch_id='${ids.b1}' WHERE id IN ('${ids.bm1}','${ids.vol1}','${ids.vol1b}');
    UPDATE profiles SET branch_id='${ids.b2}' WHERE id='${ids.vol2}';
    UPDATE user_roles SET role='branch_manager' WHERE user_id='${ids.bm1}';`);
}

describe("carry-over shares tasks", () => {
  const db = new PGlite();
  const h = helpers(db);
  beforeAll(() => seed(db), 60000);
  afterAll(() => db.close());

  it("a task shows under its decision and every later copy; a task made on a copy only on that copy and later", async () => {
    await h.as(ids.bm1);
    const a = await h.meeting("A", -14),
      b = await h.meeting("B", -7),
      c = await h.meeting("C", 7);
    const ia = await h.item(a, "Flyers");
    const da = await h.decision(ia, "Print flyers");
    const t1 = await h.task(da, "A5"),
      t2 = await h.task(da, "A3");
    // Earlier app versions send task_ids: ignored, nothing moves.
    await h.carry(b, [{ item_id: ia, decision_ids: [da], task_ids: [t1] }]);
    const db_ = (await h.decisionsOf(b))[0]!;
    expect(db_.carried_from).toBe(da);
    const t3 = await h.task(db_.id, "made in B");
    const ib = await h.one<string>("SELECT id v FROM meeting_agenda_items WHERE meeting_id=$1", [
      b,
    ]);
    await h.carry(c, [{ item_id: ib, decision_ids: [db_.id], task_ids: [] }]);
    const dc = (await h.decisionsOf(c))[0]!;
    expect(dc.carried_from).toBe(db_.id);

    expect(await h.shown(a)).toEqual({ "Flyers/Print flyers": [t1, t2].sort() });
    expect(await h.shown(b)).toEqual({ "Flyers/Print flyers": [t1, t2, t3].sort() });
    expect(await h.shown(c)).toEqual({ "Flyers/Print flyers": [t1, t2, t3].sort() });
    // One task: completing it shows everywhere; it still belongs to A.
    await db.query("SELECT public.set_task_status($1,'done')", [t1]);
    await h.as(null);
    expect(
      await h.q("SELECT meeting_id, decision_id, status FROM tasks WHERE id=$1", [t1]),
    ).toEqual([{ meeting_id: a, decision_id: da, status: "done" }]);
    expect(await h.one("SELECT count(*)::int v FROM tasks")).toBe(3);
    await h.as(ids.bm1);

    // Tasks page: the decision's later meetings for "Also in".
    const sources = await h.one<{ decisions: { id: string; also_in: { meeting_id: string }[] }[] }>(
      "SELECT public.list_task_sources() v",
    );
    expect(sources.decisions.find((d) => d.id === da)!.also_in.map((m) => m.meeting_id)).toEqual([
      b,
      c,
    ]);
    expect(
      sources.decisions.find((d) => d.id === db_.id)!.also_in.map((m) => m.meeting_id),
    ).toEqual([c]);
  });

  it("the carry-over list shows the open tasks a copy inherits", async () => {
    await h.as(ids.bm1);
    const a = await h.meeting("Inherit A", -20),
      b = await h.meeting("Inherit B", -10);
    const ia = await h.item(a, "Hall");
    const da = await h.decision(ia, "Book the hall");
    const t = await h.task(da, "Call the council");
    await h.carry(b, [{ item_id: ia, decision_ids: [da] }]);
    const offered = await h.one<
      { meeting_id: string; items: { decisions: { tasks: { id: string }[] }[] }[] }[]
    >("SELECT public.list_meeting_carry_over('branch',$1) v", [ids.b1]);
    const fromB = offered.find((o) => o.meeting_id === b)!;
    expect(fromB.items[0]!.decisions[0]!.tasks.map((x) => x.id)).toEqual([t]);
  });

  it("a decision deleted for good hands its tasks and groups to its copy; the chain stays", async () => {
    await h.as(ids.bm1);
    const a = await h.meeting("Del A", -30),
      b = await h.meeting("Del B", -25),
      c = await h.meeting("Del C", -21);
    const ia = await h.item(a, "Outreach");
    const da = await h.decision(ia, "Everyone brings a friend");
    const t = await h.task(da, "Posters");
    const g = await h.group(da, "Bring one");
    await h.carry(b, [{ item_id: ia, decision_ids: [da] }]);
    const dbId = (await h.decisionsOf(b))[0]!.id;
    const ib = await h.one<string>("SELECT id v FROM meeting_agenda_items WHERE meeting_id=$1", [
      b,
    ]);
    await h.carry(c, [{ item_id: ib, decision_ids: [dbId] }]);
    await db.query("SELECT public.delete_meeting_decision($1)", [da]);
    await h.as(null);
    expect(await h.q("SELECT meeting_id, decision_id FROM tasks WHERE id=$1", [t])).toEqual([
      { meeting_id: b, decision_id: dbId },
    ]);
    expect(await h.q("SELECT meeting_id, decision_id FROM task_groups WHERE id=$1", [g])).toEqual([
      { meeting_id: b, decision_id: dbId },
    ]);
    expect(
      await h.one("SELECT count(*)::int v FROM tasks WHERE group_id=$1 AND decision_id=$2", [
        g,
        dbId,
      ]),
    ).toBe(3);
    await h.as(ids.bm1);
    const cTasks = Object.values(await h.shown(c))[0]!;
    expect(cTasks).toContain(t);
    expect(cTasks).toHaveLength(1 + 3);
  });

  it("the chain helpers and the trigger function are internal", async () => {
    await h.as(null);
    for (const fn of [
      "decision_lineage(uuid)",
      "decision_copies(uuid)",
      "meeting_decisions_pass_on()",
    ])
      for (const role of ["anon", "authenticated"])
        expect(
          await h.one(`SELECT has_function_privilege('${role}','public.${fn}','EXECUTE') v`),
        ).toBe(false);
  });
});

describe("repair of carry-overs made before the migration", () => {
  // Built with the earlier carry_over_agenda (tasks moved), one statement per transaction as in the app.
  async function oldScenario(db: PGlite) {
    const h = helpers(db);
    // Before the migration: no carried_from column yet.
    const decisionsOf = (m: string) =>
      h.q<{ id: string; text: string }>(
        "SELECT id, text FROM meeting_decisions WHERE meeting_id=$1 ORDER BY created_at, text",
        [m],
      );
    await h.as(ids.bm1);
    const m1 = await h.meeting("Monthly", -14),
      m2 = await h.meeting("Weekly", -7),
      m3 = await h.meeting("Weekly next", 7);
    const single = await h.item(m1, "Single");
    const d1 = await h.decision(single, "Print flyers");
    const t1 = await h.task(d1, "A5"),
      t2 = await h.task(d1, "A3");
    const g = await h.group(d1, "Everyone shares");
    const members = (await h.q<{ id: string }>("SELECT id FROM tasks WHERE group_id=$1", [g])).map(
      (x) => x.id,
    );
    const multi = await h.item(m1, "Multi");
    const hall = await h.decision(multi, "Book the hall"),
      food = await h.decision(multi, "Order food");
    const music = await h.decision(multi, "Music");
    const t3 = await h.task(hall, "hall"),
      t4 = await h.task(food, "food"),
      t5 = await h.task(music, "music");
    await h.carry(m2, [
      { item_id: single, decision_ids: [d1], task_ids: [t1, t2, members[0]] },
      { item_id: multi, decision_ids: [hall, food], task_ids: [t3, t4] },
    ]);
    const copy1 = (await decisionsOf(m2)).find((d) => d.text === "Print flyers")!.id;
    const t6 = await h.task(copy1, "made on the copy");
    const single2 = await h.one<string>(
      "SELECT id v FROM meeting_agenda_items WHERE meeting_id=$1 AND title='Single'",
      [m2],
    );
    await h.carry(m3, [
      { item_id: single2, decision_ids: [copy1], task_ids: [t1, t6, members[0]] },
    ]);
    const copy2 = (await decisionsOf(m3))[0]!.id;
    const t7 = await h.task(copy2, "made on the newest copy");
    await h.as(null);
    // The earlier behavior: everything carried sits on the newest copy.
    expect(await h.one("SELECT decision_id v FROM tasks WHERE id=$1", [t1])).toBe(copy2);
    return { h, m1, m2, m3, d1, hall, food, music, copy1, copy2, g, t1, t2, t3, t4, t5, t6, t7 };
  }
  const migration = readFileSync(`supabase/migrations/${MIGRATION}`, "utf8");

  it("puts every moved task and group back on the decision where it was created", async () => {
    const db = new PGlite();
    try {
      await seed(db, MIGRATION);
      const s = await oldScenario(db);
      await db.exec(migration);
      const { h } = s;
      const at = async (t: string) =>
        h.q("SELECT meeting_id, decision_id FROM tasks WHERE id=$1", [t]);
      expect(await at(s.t1)).toEqual([{ meeting_id: s.m1, decision_id: s.d1 }]);
      expect(await at(s.t2)).toEqual([{ meeting_id: s.m1, decision_id: s.d1 }]);
      expect(await at(s.t3)).toEqual([{ meeting_id: s.m1, decision_id: s.hall }]);
      expect(await at(s.t4)).toEqual([{ meeting_id: s.m1, decision_id: s.food }]);
      expect(await at(s.t5)).toEqual([{ meeting_id: s.m1, decision_id: s.music }]);
      // Created on a copy: back on that copy (moved by the second carry-over), or never moved.
      expect(await at(s.t6)).toEqual([{ meeting_id: s.m2, decision_id: s.copy1 }]);
      expect(await at(s.t7)).toEqual([{ meeting_id: s.m3, decision_id: s.copy2 }]);
      expect(
        await h.q("SELECT meeting_id, decision_id FROM task_groups WHERE id=$1", [s.g]),
      ).toEqual([{ meeting_id: s.m1, decision_id: s.d1 }]);
      expect(
        await h.one("SELECT count(*)::int v FROM tasks WHERE group_id=$1 AND decision_id<>$2", [
          s.g,
          s.d1,
        ]),
      ).toBe(0);
      // Copies are linked by the item link (one decision) or identical text (several).
      const m2d = await h.decisionsOf(s.m2);
      expect(Object.fromEntries(m2d.map((d) => [d.text, d.carried_from]))).toEqual({
        "Print flyers": s.d1,
        "Book the hall": s.hall,
        "Order food": s.food,
      });
      expect((await h.decisionsOf(s.m3))[0]!.carried_from).toBe(s.copy1);
      // Each meeting shows the tasks along the chain.
      await h.as(ids.bm1);
      const m1Flyers = (await h.shown(s.m1))["Single/Print flyers"]!;
      const m3Flyers = (await h.shown(s.m3))["Single/Print flyers"]!;
      expect(m1Flyers).toHaveLength(2 + 3);
      expect(m3Flyers).toHaveLength(2 + 3 + 2);
      expect((await h.shown(s.m2))["Multi/Order food"]).toEqual([s.t4]);
    } finally {
      await db.close();
    }
  }, 120000);

  it("stops and changes nothing when a copy cannot be matched", async () => {
    const db = new PGlite();
    try {
      await seed(db, MIGRATION);
      const s = await oldScenario(db);
      // The copy of "Order food" was edited after the carry-over: no unique identical text in its item pair.
      await db.query(
        "UPDATE meeting_decisions SET text='Order food (edited)' WHERE meeting_id=$1 AND text='Order food'",
        [s.m2],
      );
      const before = await s.h.q("SELECT id, meeting_id, decision_id FROM tasks ORDER BY id");
      await expect(db.exec(migration)).rejects.toThrow(
        /Carry-over repair stopped, nothing was changed[\s\S]*food/,
      );
      expect(await s.h.q("SELECT id, meeting_id, decision_id FROM tasks ORDER BY id")).toEqual(
        before,
      );
      expect(
        await s.h.one(
          "SELECT count(*)::int v FROM information_schema.columns WHERE table_name='meeting_decisions' AND column_name='carried_from'",
        ),
      ).toBe(0);
    } finally {
      await db.close();
    }
  }, 120000);
});

import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { initializeRecycleDatabase } from "./recycle-db-fixture";

// Carry-over from any meeting (20261222090000_carry_over_anywhere.sql), against every migration in PGlite: any
// unresolved item of a meeting of the same place (past or upcoming, carried before or not) can be added to a new or
// an existing meeting; a tree of copies is offered once (its latest copy) and never to a meeting that has a copy; tasks
// stay on their decision and show under every copy. The link change is tested on older data.
const MIGRATION = "20261222090000_carry_over_anywhere.sql";
const id = (n: number) => {
  const h = n.toString(16).padStart(2, "0");
  return `${h.repeat(4)}-${h.repeat(2)}-4${h}${h[0]}-8${h}${h[0]}-${h.repeat(6)}`;
};
const ids = { region: id(1), b1: id(2), b2: id(3), bm1: id(11), vol1: id(12), bm2: id(13) };
type Offer = {
  meeting_id: string;
  items: { id: string; title: string; decisions: { id: string; tasks: { id: string }[] }[] }[];
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
  const q = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) =>
    (await db.query<T>(sql, params)).rows;
  const one = async <T = unknown>(sql: string, params: unknown[] = []) =>
    (await db.query<{ v: T }>(sql, params)).rows[0]?.v as T;
  const meeting = (title: string, days: number, branch = ids.b1) =>
    one<string>("SELECT public.create_meeting($1::jsonb) v", [
      JSON.stringify({
        scope: "branch",
        branch_id: branch,
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
  const carry = (target: string, p: unknown) =>
    one<number>("SELECT public.carry_over_agenda($1,$2::jsonb) v", [target, JSON.stringify(p)]);
  const itemsOf = (m: string) =>
    q<{ id: string; title: string; position: number; carried_from: string | null }>(
      "SELECT id, title, position, carried_from FROM meeting_agenda_items WHERE meeting_id=$1 ORDER BY position",
      [m],
    );
  const decisionsOf = (m: string) =>
    q<{ id: string; text: string; carried_from: string | null }>(
      "SELECT id, text, carried_from FROM meeting_decisions WHERE meeting_id=$1 ORDER BY created_at, text",
      [m],
    );
  const offers = async (sql: string, params: unknown[]) =>
    (await one<Offer[]>(sql, params)).map((o) => [o.meeting_id, o.items.map((i) => i.id)]);
  const forNew = () => offers("SELECT public.list_meeting_carry_over('branch',$1) v", [ids.b1]);
  const forMeeting = (m: string) => offers("SELECT public.list_meeting_carry_in($1) v", [m]);
  const shown = async (m: string) => {
    const r = await one<{ agenda: { title: string; decisions: { tasks: { id: string }[] }[] }[] }>(
      "SELECT public.get_meeting($1) v",
      [m],
    );
    return r.agenda.map((a) => [
      a.title,
      a.decisions.flatMap((d) => d.tasks.map((t) => t.id)).sort(),
    ]);
  };
  const fails = async (sql: string, params: unknown[], message: RegExp) => {
    await expect(db.query(sql, params)).rejects.toThrow(message);
  };
  return {
    as,
    q,
    one,
    meeting,
    item,
    decision,
    task,
    carry,
    itemsOf,
    decisionsOf,
    forNew,
    forMeeting,
    shown,
    fails,
  };
}

async function seed(db: PGlite, until?: string) {
  await initializeRecycleDatabase(db, until ? { until } : {});
  const members = [ids.bm1, ids.vol1, ids.bm2];
  await db.exec(`INSERT INTO regions(id,name) VALUES ('${ids.region}','Region');
    INSERT INTO branches(id,name,region_id) VALUES ('${ids.b1}','One','${ids.region}'),('${ids.b2}','Two','${ids.region}');
    INSERT INTO auth.users(id, raw_user_meta_data) SELECT x, jsonb_build_object('full_name','Person '||left(x::text,2),'privacy_notice_version','1.7')
      FROM unnest(ARRAY['${members.join("','")}']::uuid[]) x;
    UPDATE profiles SET status='active';
    UPDATE profiles SET branch_id='${ids.b1}' WHERE id IN ('${ids.bm1}','${ids.vol1}');
    UPDATE profiles SET branch_id='${ids.b2}' WHERE id='${ids.bm2}';
    UPDATE user_roles SET role='branch_manager' WHERE user_id IN ('${ids.bm1}','${ids.bm2}');`);
}

describe("carry-over from any meeting", () => {
  const db = new PGlite();
  const h = helpers(db);
  beforeAll(() => seed(db), 60000);
  afterAll(() => db.close());
  // Each test starts from an empty set of meetings.
  const fresh = async () => {
    await h.as(null);
    await db.exec("DELETE FROM tasks; DELETE FROM task_groups; DELETE FROM meetings;");
    await h.as(ids.bm1);
  };

  it("Christmas Dinner: an item already carried into an upcoming meeting can be added to an extra meeting", async () => {
    await fresh();
    const nov = await h.meeting("25 Nov", -2),
      dec = await h.meeting("2 Dec", 5);
    const xmas = await h.item(nov, "Christmas Dinner");
    const venue = await h.decision(xmas, "Book a venue");
    const call = await h.task(venue, "Call the restaurant");
    const other = await h.item(nov, "Flyers");
    await h.carry(dec, [{ item_id: xmas, decision_ids: [venue] }]);
    const decXmas = (await h.itemsOf(dec))[0]!;
    expect(decXmas.carried_from).toBe(xmas);

    // Creating a meeting: the chain shows once, as its latest copy (2 Dec, upcoming); Flyers from 25 Nov too.
    expect(await h.forNew()).toEqual([
      [dec, [decXmas.id]],
      [nov, [other]],
    ]);
    // An existing meeting never offers its own items, nor a chain it already has.
    expect(await h.forMeeting(dec)).toEqual([[nov, [other]]]);

    const extra = await h.meeting("Extra", 3);
    const welcome = await h.item(extra, "Welcome");
    expect(await h.forMeeting(extra)).toEqual([
      [dec, [decXmas.id]],
      [nov, [other]],
    ]);
    const decVenue = (await h.decisionsOf(dec))[0]!;
    expect(await h.carry(extra, [{ item_id: decXmas.id, decision_ids: [decVenue.id] }])).toBe(1);
    // Appended after the meeting's own items; the copy points to the 2 Dec copy, its decision to 2 Dec's decision.
    const extraItems = await h.itemsOf(extra);
    expect(extraItems.map((i) => [i.title, i.position, i.carried_from])).toEqual([
      ["Welcome", 0, null],
      ["Christmas Dinner", 1, decXmas.id],
    ]);
    expect((await h.decisionsOf(extra))[0]!.carried_from).toBe(decVenue.id);
    // The task stays on 25 Nov and shows in all three meetings.
    for (const m of [nov, dec, extra])
      expect((await h.shown(m)).find(([t]) => t === "Christmas Dinner")![1]).toEqual([call]);
    expect(await h.q("SELECT meeting_id, decision_id FROM tasks WHERE id=$1", [call])).toEqual([
      { meeting_id: nov, decision_id: venue },
    ]);
    // "Also in" lists both later meetings.
    const sources = await h.one<{ decisions: { id: string; also_in: { meeting_id: string }[] }[] }>(
      "SELECT public.list_task_sources() v",
    );
    expect(sources.decisions.find((d) => d.id === venue)!.also_in.map((m) => m.meeting_id)).toEqual(
      [extra, dec],
    );

    // Now the latest copy is the extra meeting's; 2 Dec and the extra meeting are not offered it again.
    expect(await h.forNew()).toEqual([
      [extra, [welcome, extraItems[1]!.id]],
      [nov, [other]],
    ]);
    expect(await h.forMeeting(dec)).toEqual([
      [extra, [welcome]],
      [nov, [other]],
    ]);
    expect(await h.forMeeting(extra)).toEqual([[nov, [other]]]);
    // The server refuses a second copy of the chain in one meeting, from any member of it.
    for (const source of [xmas, decXmas.id])
      await h.fails(
        "SELECT public.carry_over_agenda($1,$2::jsonb)",
        [extra, JSON.stringify([{ item_id: source }])],
        /cannot be carried over/,
      );
  });

  it("a tree: one item carried into two meetings is offered once; resolved, deleted and other places", async () => {
    await fresh();
    const a = await h.meeting("A", -10),
      b = await h.meeting("B", 4),
      c = await h.meeting("C", 8);
    const hall = await h.item(a, "Hall");
    await h.carry(b, [{ item_id: hall }]);
    await h.carry(c, [{ item_id: hall }]); // straight from the original: a second branch of the tree
    const [hb] = await h.itemsOf(b),
      [hc] = await h.itemsOf(c);
    expect([hb!.carried_from, hc!.carried_from]).toEqual([hall, hall]);
    // Offered once, as the copy made last.
    expect(await h.forNew()).toEqual([[c, [hc!.id]]]);
    const d = await h.meeting("D", 12);
    expect(await h.forMeeting(d)).toEqual([[c, [hc!.id]]]);

    // The latest copy resolved: the item is settled and not offered.
    await h.one("SELECT public.set_agenda_item_resolved($1,true) v", [hc!.id]);
    expect(await h.forNew()).toEqual([]);
    await h.one("SELECT public.set_agenda_item_resolved($1,false) v", [hc!.id]);
    // Its meeting deleted: that copy no longer counts and the copy before it is offered.
    await h.one("SELECT public.delete_meeting($1) v", [c]);
    expect(await h.forNew()).toEqual([[b, [hb!.id]]]);

    // Another branch's Branch Manager sees none of it and cannot carry it.
    await h.as(ids.bm2);
    expect(await h.one("SELECT public.list_meeting_carry_over('branch',$1) v", [ids.b1])).toEqual(
      [],
    );
    const theirs = await h.meeting("Theirs", 2, ids.b2);
    await h.fails(
      "SELECT public.carry_over_agenda($1,$2::jsonb)",
      [theirs, JSON.stringify([{ item_id: hb!.id }])],
      /cannot be carried over/,
    );
    expect(await h.one("SELECT public.list_meeting_carry_in($1) v", [d])).toEqual([]);
    // A volunteer cannot edit meetings: nothing offered, nothing carried.
    await h.as(ids.vol1);
    expect(await h.one("SELECT public.list_meeting_carry_in($1) v", [d])).toEqual([]);
    await h.fails(
      "SELECT public.carry_over_agenda($1,$2::jsonb)",
      [d, JSON.stringify([{ item_id: hb!.id }])],
      /Not allowed|not allowed|cannot/,
    );
  });

  it("everything or nothing: two items of one tree in one call are refused and nothing is added", async () => {
    await fresh();
    const a = await h.meeting("A", -10),
      b = await h.meeting("B", -3),
      c = await h.meeting("C", 4);
    const x = await h.item(a, "Budget");
    await h.carry(b, [{ item_id: x }]);
    const [xb] = await h.itemsOf(b);
    await h.fails(
      "SELECT public.carry_over_agenda($1,$2::jsonb)",
      [c, JSON.stringify([{ item_id: xb!.id }, { item_id: x }])],
      /cannot be carried over/,
    );
    expect(await h.itemsOf(c)).toEqual([]);
  });

  it("deleting keeps the tree whole: items, decisions with several copies, and a purge of several meetings at once", async () => {
    await fresh();
    const a = await h.meeting("A", -10),
      b = await h.meeting("B", -5),
      c = await h.meeting("C", 3),
      e = await h.meeting("E", 6);
    const x = await h.item(a, "Rota");
    const dx = await h.decision(x, "Ask for volunteers");
    const t = await h.task(dx, "Make the rota");
    await h.carry(b, [{ item_id: x, decision_ids: [dx] }]);
    const [xb] = await h.itemsOf(b);
    const [db_] = await h.decisionsOf(b);
    await h.carry(c, [{ item_id: xb!.id, decision_ids: [db_!.id] }]);
    await h.carry(e, [{ item_id: x, decision_ids: [dx] }]);
    const [xc] = await h.itemsOf(c);

    // The middle item deleted: its copy now hangs under the original, so the tree is still offered once.
    await h.one("SELECT public.delete_agenda_item($1) v", [xb!.id]);
    expect((await h.itemsOf(c))[0]!.carried_from).toBe(x);
    expect((await h.forNew()).flatMap(([, items]) => items)).toEqual([(await h.itemsOf(e))[0]!.id]);
    expect(await h.forMeeting(c)).toEqual([]);

    // The original decision (two copies: C's and E's) deleted: the task passes to the earliest copy and the other copy
    // hangs under it, so both still show the task.
    await h.one("SELECT public.delete_meeting_decision($1) v", [dx]);
    for (const m of [c, e]) expect((await h.shown(m))[0]![1]).toEqual([t]);

    // A purge of several deleted meetings in one statement, with copies across them.
    const p1 = await h.meeting("P1", -40),
      p2 = await h.meeting("P2", -35);
    const y = await h.item(p1, "Old");
    const dy = await h.decision(y, "Old decision");
    await h.carry(p2, [{ item_id: y, decision_ids: [dy] }]);
    const [yp2] = await h.itemsOf(p2);
    await h.carry(c, [{ item_id: yp2!.id, decision_ids: [(await h.decisionsOf(p2))[0]!.id] }]);
    await h.as(null);
    await db.query(
      "UPDATE meetings SET deleted_at = now() - interval '40 days' WHERE id = ANY($1)",
      [[p1, p2]],
    );
    expect(
      await h.one<number>("SELECT public.purge_expired_work_items() v"),
    ).toBeGreaterThanOrEqual(2);
    expect(await h.one("SELECT count(*)::int v FROM meetings WHERE id = ANY($1)", [[p1, p2]])).toBe(
      0,
    );
    expect(
      await h.q("SELECT title FROM meeting_agenda_items WHERE meeting_id=$1 AND title='Old'", [c]),
    ).toEqual([{ title: "Old" }]);
    expect(await h.one("SELECT count(*)::int v FROM tasks WHERE id=$1", [t])).toBe(1);
    void xc;
  });

  it("the new read is for signed-in people only; the helpers are internal", async () => {
    await h.as(null);
    expect(
      await h.one(
        "SELECT has_function_privilege('anon','public.list_meeting_carry_in(uuid)','EXECUTE') v",
      ),
    ).toBe(false);
    expect(
      await h.one(
        "SELECT has_function_privilege('authenticated','public.list_meeting_carry_in(uuid)','EXECUTE') v",
      ),
    ).toBe(true);
    for (const fn of [
      "agenda_item_root(uuid)",
      "carry_over_candidates(text,uuid,uuid,uuid)",
      "carry_over_json(text,uuid,uuid,uuid)",
      "meeting_agenda_items_pass_on()",
    ])
      for (const role of ["anon", "authenticated"])
        expect(
          await h.one(`SELECT has_function_privilege('${role}','public.${fn}','EXECUTE') v`),
        ).toBe(false);
    expect(
      await h.one(
        "SELECT count(*)::int v FROM information_schema.columns WHERE table_name='meeting_agenda_items' AND column_name='carried_to'",
      ),
    ).toBe(0);
  });
});

describe("the link change on older data", () => {
  const migration = readFileSync(`supabase/migrations/${MIGRATION}`, "utf8");

  it("every carried_to link becomes the copy's carried_from", async () => {
    const db = new PGlite();
    try {
      await seed(db, MIGRATION);
      const h = helpers(db);
      await h.as(ids.bm1);
      const nov = await h.meeting("25 Nov", -2),
        dec = await h.meeting("2 Dec", 5),
        jan = await h.meeting("Jan", 30);
      const xmas = await h.item(nov, "Christmas Dinner");
      const venue = await h.decision(xmas, "Book a venue");
      const t = await h.task(venue, "Call");
      const flyers = await h.item(nov, "Flyers");
      await h.carry(dec, [{ item_id: xmas, decision_ids: [venue] }, { item_id: flyers }]);
      const decItems = await h.q<{ id: string; title: string }>(
        "SELECT id, title FROM meeting_agenda_items WHERE meeting_id=$1 ORDER BY position",
        [dec],
      );
      await h.carry(jan, [{ item_id: decItems[1]!.id }]);
      await h.as(null);
      await db.exec(migration);
      const links = await h.q<{ title: string; meeting_id: string; carried_from: string | null }>(
        "SELECT title, meeting_id, carried_from FROM meeting_agenda_items ORDER BY title, carried_from NULLS FIRST",
      );
      expect(links).toEqual([
        { title: "Christmas Dinner", meeting_id: nov, carried_from: null },
        { title: "Christmas Dinner", meeting_id: dec, carried_from: xmas },
        { title: "Flyers", meeting_id: nov, carried_from: null },
        expect.objectContaining({ title: "Flyers" }),
        expect.objectContaining({ title: "Flyers" }),
      ]);
      expect((await h.itemsOf(jan))[0]!.carried_from).toBe(decItems[1]!.id);
      expect((await h.itemsOf(dec)).find((i) => i.title === "Flyers")!.carried_from).toBe(flyers);
      // Offered as before: the latest copy of each chain; the task still shows in both meetings.
      await h.as(ids.bm1);
      expect(await h.forNew()).toEqual([
        [jan, [(await h.itemsOf(jan))[0]!.id]],
        [dec, [decItems[0]!.id]],
      ]);
      expect((await h.shown(dec))[0]![1]).toEqual([t]);
    } finally {
      await db.close();
    }
  }, 120000);

  it("stops and changes nothing when two items point to the same copy", async () => {
    const db = new PGlite();
    try {
      await seed(db, MIGRATION);
      const h = helpers(db);
      await h.as(ids.bm1);
      const a = await h.meeting("A", -9),
        b = await h.meeting("B", 2);
      const one = await h.item(a, "One"),
        two = await h.item(a, "Two");
      await h.carry(b, [{ item_id: one }]);
      await h.as(null);
      await db.query(
        "UPDATE meeting_agenda_items SET carried_to = (SELECT carried_to FROM meeting_agenda_items WHERE id=$1) WHERE id=$2",
        [one, two],
      );
      await expect(db.exec(migration)).rejects.toThrow(
        /Carry-over link change stopped, nothing was changed[\s\S]*One/,
      );
      expect(
        await h.one(
          "SELECT count(*)::int v FROM information_schema.columns WHERE table_name='meeting_agenda_items' AND column_name='carried_from'",
        ),
      ).toBe(0);
      expect(
        await h.one(
          "SELECT count(*)::int v FROM meeting_agenda_items WHERE carried_to IS NOT NULL",
        ),
      ).toBe(2);
    } finally {
      await db.close();
    }
  }, 120000);
});

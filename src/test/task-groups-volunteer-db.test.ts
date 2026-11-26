import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { initializeRecycleDatabase } from "./recycle-db-fixture";

// Volunteers create "@all" task groups for their own branch (20261207090000_task_groups_volunteer_create.sql), against
// every migration in PGlite: who may create, the members (active volunteers and Branch Managers of the branch; never
// Regional Directors or National Coordinators), the Branch Managers' notice, who edits and deletes, and the refusals.
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
  bm1b: id(12),
  vol1: id(13),
  vol1b: id(14),
  vol1c: id(15),
  vol2: id(16),
  bm2: id(17),
  nc: id(18),
  fol: id(19),
};
type Row = Record<string, unknown>;
type Group = {
  id: string;
  members: { task_id: string; user_id: string }[];
  can_edit: boolean;
  title: string;
};

async function as(user: string | null, aal = "aal1") {
  await db.exec("RESET ROLE");
  await db.query(
    "SELECT set_config('request.jwt.claim.sub',$1,true), set_config('request.jwt.claim.aal',$2,true)",
    [user ?? "", aal],
  );
  if (user) await db.exec("SET LOCAL ROLE authenticated");
}
async function asAnon() {
  await db.exec("RESET ROLE");
  await db.exec("SET LOCAL ROLE anon");
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
const CREATE = "SELECT public.create_task_group($1::jsonb) v";
const groupIn = (branch: string, extra: Row = {}) =>
  JSON.stringify({
    scope: "branch",
    branch_id: branch,
    title: "Bring a friend to the iftar",
    ...extra,
  });
const create = (branch = ids.b1, extra: Row = {}) => one<string>(CREATE, [groupIn(branch, extra)]);
const getGroup = (g: string) => one<Group | null>("SELECT public.get_task_group($1) v", [g]);
const members = async (g: string) => {
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
  return q<{
    kind: string;
    entity_type: string;
    entity_id: string;
    link: string;
    actor_id: string;
    held: boolean;
    title: string;
  }>(
    "SELECT kind, entity_type, entity_id, link, actor_id, held, title FROM notifications WHERE user_id=$1 ORDER BY kind",
    [user],
  );
};

beforeAll(async () => {
  await initializeRecycleDatabase(db);
  const people = Object.entries(ids).filter(([k]) => !["region", "b1", "b2"].includes(k));
  await db.exec(`INSERT INTO regions(id,name) VALUES ('${ids.region}','Region');
    INSERT INTO branches(id,name,region_id) VALUES ('${ids.b1}','One','${ids.region}'),('${ids.b2}','Two','${ids.region}');
    INSERT INTO auth.users(id, raw_user_meta_data) VALUES ${people
      .map(
        ([k, v]) =>
          `('${v}', jsonb_build_object('full_name','Person ${k}','privacy_notice_version','1.5'))`,
      )
      .join(",")};
    UPDATE profiles SET status='active';
    UPDATE profiles SET branch_id='${ids.b1}' WHERE id IN ('${ids.bm1}','${ids.bm1b}','${ids.vol1}','${ids.vol1b}','${ids.vol1c}');
    UPDATE profiles SET branch_id='${ids.b2}' WHERE id IN ('${ids.vol2}','${ids.bm2}');
    UPDATE profiles SET branch_id=NULL WHERE id IN ('${ids.rd}','${ids.nc}','${ids.fol}');
    UPDATE user_roles SET role='branch_manager' WHERE user_id IN ('${ids.bm1}','${ids.bm1b}','${ids.bm2}');
    UPDATE user_roles SET role='regional_director', region_id='${ids.region}' WHERE user_id='${ids.rd}';
    UPDATE user_roles SET role='national_coordinator' WHERE user_id='${ids.nc}';
    UPDATE user_roles SET role='follower' WHERE user_id='${ids.fol}';
    -- vol1c is inactive: neither a member nor allowed to create.
    UPDATE profiles SET status='inactive' WHERE id='${ids.vol1c}';`);
}, 60000);
afterAll(async () => db.close());

describe("a volunteer creates an @all group for their own branch", () => {
  it("members: every active volunteer and both Branch Managers of the branch, each with their own task", () =>
    tx(async () => {
      await as(ids.vol1);
      const g = await create(ids.b1, { due_date: "2026-12-20", description: "One friend each" });
      expect(await members(g)).toEqual([ids.bm1, ids.bm1b, ids.vol1, ids.vol1b].sort());
      const tasks = await q<Row>(
        "SELECT title, due_date::text due, description, created_by, self_task, status FROM tasks WHERE group_id=$1",
        [g],
      );
      expect(tasks).toHaveLength(4);
      for (const t of tasks)
        expect(t).toMatchObject({
          title: "Bring a friend to the iftar",
          due: "2026-12-20",
          description: "One friend each",
          created_by: ids.vol1,
          self_task: false,
          status: "todo",
        });
      expect(await one("SELECT created_by v FROM task_groups WHERE id=$1", [g])).toBe(ids.vol1);
    }));

  it("the Branch Managers get one immediate notice linking to the group; volunteers the normal assignment notice", () =>
    tx(async () => {
      await as(ids.vol1);
      const g = await create();
      for (const bm of [ids.bm1, ids.bm1b]) {
        const own = await one<string>(
          "SELECT t.id v FROM tasks t JOIN task_assignees a ON a.task_id=t.id WHERE t.group_id=$1 AND a.user_id=$2",
          [g, bm],
        );
        // Managers default to the daily summary, but an assignment is always immediate (held = false).
        expect(await noticesOf(bm)).toEqual([
          {
            kind: "task_group_created",
            entity_type: "task",
            entity_id: own,
            link: `/tasks?group=${g}`,
            actor_id: ids.vol1,
            held: false,
            title: "Bring a friend to the iftar",
          },
        ]);
        await as(bm);
        expect(await one("SELECT (public.get_unread_notification_counts())->>'tasks' v")).toBe("1");
      }
      expect((await noticesOf(ids.vol1b)).map((n) => n.kind)).toEqual(["task_assigned"]);
      // Never a notice for the creator about their own task.
      expect(await noticesOf(ids.vol1)).toEqual([]);
    }));

  it("the Regional Director and the National Coordinator are not members and get no notice", () =>
    tx(async () => {
      await as(ids.vol1);
      const g = await create();
      const people = await members(g);
      for (const who of [ids.rd, ids.nc, ids.vol2, ids.bm2, ids.fol, ids.vol1c]) {
        expect(people).not.toContain(who);
        expect(await noticesOf(who)).toEqual([]);
      }
      // The RD still sees and manages the group of a branch in their region; the NC sees no branch group.
      await as(ids.rd);
      expect((await getGroup(g))?.can_edit).toBe(true);
      await as(ids.nc, "aal2");
      expect(await getGroup(g)).toBeNull();
    }));

  it("a manager's group is unchanged: the RD creating one is not a member either", () =>
    tx(async () => {
      await as(ids.rd);
      const g = await create();
      expect(await members(g)).toEqual([ids.bm1, ids.bm1b, ids.vol1, ids.vol1b].sort());
      expect((await noticesOf(ids.bm1)).map((n) => n.kind)).toEqual(["task_assigned"]);
    }));
});

describe("who may create", () => {
  it("a volunteer of another branch, a follower, the NC, an inactive volunteer and anon are refused", () =>
    tx(async () => {
      await as(ids.vol2);
      await fails(CREATE, [groupIn(ids.b1)], "Not allowed");
      await as(ids.vol1);
      await fails(CREATE, [groupIn(ids.b2)], "Not allowed");
      await fails(
        CREATE,
        [JSON.stringify({ scope: "region", branch_id: ids.b1, title: "X" })],
        "Not allowed",
      );
      await as(ids.fol);
      await fails(CREATE, [groupIn(ids.b1)], "Not allowed");
      await as(ids.nc, "aal2");
      await fails(CREATE, [groupIn(ids.b1)], "Not allowed");
      await as(ids.vol1c);
      await fails(CREATE, [groupIn(ids.b1)], "Not allowed");
      await asAnon();
      await fails(CREATE, [groupIn(ids.b1)], "permission denied");
      await as(null);
      expect(await one("SELECT count(*)::int v FROM task_groups")).toBe(0);
      expect(await one("SELECT count(*)::int v FROM tasks")).toBe(0);
    }));

  it("the volunteer of the other branch creates one for their own branch: their branch only", () =>
    tx(async () => {
      await as(ids.vol2);
      const g = await create(ids.b2);
      expect(await members(g)).toEqual([ids.bm2, ids.vol2].sort());
      expect((await noticesOf(ids.bm2)).map((n) => n.kind)).toEqual(["task_group_created"]);
      expect(await noticesOf(ids.bm1)).toEqual([]);
    }));
});

describe("editing and deleting a volunteer's group", () => {
  it("the creating volunteer edits, changes members and deletes", () =>
    tx(async () => {
      await as(ids.vol1);
      const g = await create();
      expect((await getGroup(g))?.can_edit).toBe(true);
      await db.query("SELECT public.update_task_group($1,$2::jsonb)", [
        g,
        JSON.stringify({ title: "Bring two friends" }),
      ]);
      await as(null);
      expect(await q("SELECT DISTINCT title FROM tasks WHERE group_id=$1", [g])).toEqual([
        { title: "Bring two friends" },
      ]);
      await as(ids.vol1);
      await db.query("SELECT public.set_task_group_members($1,'[]'::jsonb,$2::jsonb)", [
        g,
        JSON.stringify([ids.bm1, ids.vol1b]),
      ]);
      expect(await members(g)).toEqual([ids.bm1b, ids.vol1].sort());
      // Adding back by the same member rule (a Branch Manager gets the group notice again); never the RD.
      await as(ids.vol1);
      await db.query("SELECT public.set_task_group_members($1,$2::jsonb,'[]'::jsonb)", [
        g,
        JSON.stringify([ids.bm1, ids.vol1b]),
      ]);
      expect(await members(g)).toEqual([ids.bm1, ids.bm1b, ids.vol1, ids.vol1b].sort());
      expect(
        (await noticesOf(ids.bm1)).filter((n) => n.kind === "task_group_created"),
      ).toHaveLength(2);
      await as(ids.vol1);
      for (const who of [ids.rd, ids.vol2, ids.fol])
        await fails(
          "SELECT public.set_task_group_members($1,$2::jsonb,'[]'::jsonb)",
          [g, JSON.stringify([who])],
          "cannot be assigned",
        );
      expect(await one<number>("SELECT public.delete_task_group($1) v", [g])).toBe(4);
      await as(null);
      expect(await one("SELECT count(*)::int v FROM task_groups")).toBe(0);
    }));

  it("the Branch Manager and the Regional Director edit and delete it", () =>
    tx(async () => {
      for (const editor of [ids.bm1, ids.rd]) {
        await as(ids.vol1);
        const g = await create();
        await as(editor);
        await db.query("SELECT public.update_task_group($1,$2::jsonb)", [
          g,
          JSON.stringify({ priority: "high" }),
        ]);
        expect(await one<number>("SELECT public.delete_task_group($1) v", [g])).toBe(4);
      }
    }));

  it("another volunteer only updates their own member task", () =>
    tx(async () => {
      await as(ids.vol1);
      const g = await create();
      const group = (await getGroup(g))!;
      const mine = group.members.find((m) => m.user_id === ids.vol1b)!.task_id;
      const creators = group.members.find((m) => m.user_id === ids.vol1)!.task_id;
      await as(ids.vol1b);
      expect((await getGroup(g))?.can_edit).toBe(false);
      for (const [sql, params] of [
        [
          "SELECT public.update_task_group($1,$2::jsonb)",
          [g, JSON.stringify({ title: "Mine now" })],
        ],
        ["SELECT public.delete_task_group($1)", [g]],
        [
          "SELECT public.set_task_group_members($1,'[]'::jsonb,$2::jsonb)",
          [g, JSON.stringify([ids.vol1])],
        ],
        ["SELECT public.set_task_status($1,'done')", [creators]],
      ] as const)
        await fails(sql, [...params], "Not allowed");
      await db.query("SELECT public.set_task_status($1,'done')", [mine]);
      await as(null);
      expect(await one("SELECT status v FROM tasks WHERE id=$1", [mine])).toBe("done");
      expect(
        await one("SELECT count(*)::int v FROM tasks WHERE group_id=$1 AND deleted_at IS NULL", [
          g,
        ]),
      ).toBe(4);
    }));

  it("a volunteer of another branch, a follower and anon cannot edit or delete it", () =>
    tx(async () => {
      await as(ids.vol1);
      const g = await create();
      for (const who of [ids.vol2, ids.fol]) {
        await as(who);
        await fails(
          "SELECT public.update_task_group($1,$2::jsonb)",
          [g, JSON.stringify({ title: "X" })],
          "Not allowed",
        );
        await fails("SELECT public.delete_task_group($1)", [g], "Not allowed");
      }
      await asAnon();
      await fails("SELECT public.delete_task_group($1)", [g], "permission denied");
    }));
});

describe("security attributes of the new helpers", () => {
  it("SECURITY DEFINER, search_path=public, executable by nobody but their owner", async () => {
    await as(null);
    for (const fn of [
      "task_group_member_ok(uuid,uuid)",
      "task_group_branch_people(uuid)",
      "task_group_insert_member_task(task_groups,jsonb,uuid)",
    ]) {
      const row = (
        await q<{ secdef: boolean; config: string[] | null }>(
          `SELECT prosecdef secdef, proconfig config FROM pg_proc WHERE oid = 'public.${fn}'::regprocedure`,
        )
      )[0]!;
      expect(row.secdef, fn).toBe(true);
      expect(row.config, fn).toContain("search_path=public");
      for (const role of ["anon", "authenticated"])
        expect(
          await one(`SELECT has_function_privilege('${role}','public.${fn}','EXECUTE') v`),
          `${fn} ${role}`,
        ).toBe(false);
    }
    expect(
      await one(
        "SELECT has_function_privilege('anon','public.create_task_group(jsonb)','EXECUTE') v",
      ),
    ).toBe(false);
    expect(
      await one(
        "SELECT has_function_privilege('authenticated','public.create_task_group(jsonb)','EXECUTE') v",
      ),
    ).toBe(true);
  });
});

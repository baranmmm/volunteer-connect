import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { initializeRecycleDatabase } from "./recycle-db-fixture";

// The Notifications page: list_my_notifications_page pages the caller's own notices (read and unread) newest first
// with a (created_at, id) cursor (notices marked for the daily summary email included) and anon cannot call it. Every migration in PGlite.
const db = new PGlite();
const id = (n: number) => {
  const h = n.toString(16).padStart(2, "0");
  return `${h.repeat(4)}-${h.repeat(2)}-4${h}${h[0]}-8${h}${h[0]}-${h.repeat(6)}`;
};
const ids = { region: id(1), b1: id(2), bm: id(10), vol: id(11), other: id(12) };
type Notice = { id: string; title: string; created_at: string; actor_name: string | null };

async function as(user: string | null) {
  await db.exec("RESET ROLE");
  await db.query(
    "SELECT set_config('request.jwt.claim.sub',$1,true), set_config('request.jwt.claim.aal','aal1',true)",
    [user ?? ""],
  );
  if (user) await db.exec("SET LOCAL ROLE authenticated");
}
async function page(user: string, before: Notice | null, limit: number) {
  await as(user);
  const row = (
    await db.query<{ v: Notice[] }>("SELECT public.list_my_notifications_page($1, $2, $3) v", [
      before?.created_at ?? null,
      before?.id ?? null,
      limit,
    ])
  ).rows[0];
  return row?.v ?? [];
}
async function tx(action: () => Promise<void>) {
  await db.exec("BEGIN");
  try {
    await action();
  } finally {
    await db.exec("ROLLBACK");
  }
}

beforeAll(async () => {
  await initializeRecycleDatabase(db);
  const members = [ids.bm, ids.vol, ids.other];
  await db.exec(`INSERT INTO regions(id,name) VALUES ('${ids.region}','Region');
    INSERT INTO branches(id,name,region_id) VALUES ('${ids.b1}','Riverside','${ids.region}');
    INSERT INTO auth.users(id, raw_user_meta_data) SELECT x, jsonb_build_object('full_name','Person '||left(x::text,2),'privacy_notice_version','1.6')
      FROM unnest(ARRAY['${members.join("','")}']::uuid[]) x;
    UPDATE profiles SET status='active', branch_id='${ids.b1}';
    UPDATE user_roles SET role='branch_manager' WHERE user_id='${ids.bm}';`);
  // Five notices for the volunteer from the Branch Manager: two share one created_at (the cursor's id tie-break),
  // one is read, one is marked for the daily summary email (listed at once all the same); one notice for someone else.
  await db.exec(`INSERT INTO notifications(id, user_id, kind, actor_id, entity_type, entity_id, title, link, created_at, read_at, email_digest) VALUES
    ('${id(31)}','${ids.vol}','task_assigned','${ids.bm}','task','${id(41)}','n1','/tasks','2026-11-01T10:00:00Z',NULL,false),
    ('${id(32)}','${ids.vol}','task_assigned','${ids.bm}','task','${id(42)}','n2','/tasks','2026-11-02T10:00:00Z','2026-11-02T11:00:00Z',false),
    ('${id(33)}','${ids.vol}','task_assigned','${ids.bm}','task','${id(43)}','n3','/tasks','2026-11-03T10:00:00Z',NULL,false),
    ('${id(34)}','${ids.vol}','task_assigned','${ids.bm}','task','${id(44)}','n4','/tasks','2026-11-03T10:00:00Z',NULL,false),
    ('${id(35)}','${ids.vol}','task_status_changed','${ids.bm}','task','${id(45)}','summary','/tasks','2026-11-04T10:00:00Z',NULL,true),
    ('${id(36)}','${ids.other}','task_assigned','${ids.bm}','task','${id(46)}','other','/tasks','2026-11-05T10:00:00Z',NULL,false);`);
}, 60000);
afterAll(async () => db.close());

describe("list_my_notifications_page", () => {
  it("pages own notices newest first with a (created_at, id) cursor; read ones and summary-email ones included", () =>
    tx(async () => {
      const first = await page(ids.vol, null, 2);
      // Same created_at: the larger id comes first (n4 before n3, across the page boundary).
      expect(first.map((n) => n.title)).toEqual(["summary", "n4"]);
      expect(first[0]!.actor_name).toBe(`Person ${ids.bm.slice(0, 2)}`);
      const second = await page(ids.vol, first[1]!, 2);
      expect(second.map((n) => n.title)).toEqual(["n3", "n2"]);
      const third = await page(ids.vol, second[1]!, 2);
      expect(third.map((n) => n.title)).toEqual(["n1"]);
      expect(await page(ids.vol, third[0]!, 2)).toEqual([]);
      const all = await page(ids.vol, null, 100);
      expect(all.map((n) => n.title)).toEqual(["summary", "n4", "n3", "n2", "n1"]);
    }));

  it("lists only the caller's own notices and caps the page size", () =>
    tx(async () => {
      expect((await page(ids.other, null, 30)).map((n) => n.title)).toEqual(["other"]);
      expect(await page(ids.bm, null, 30)).toEqual([]);
      expect(await page(ids.vol, null, 0)).toHaveLength(1);
    }));

  it("is not callable by anon", () =>
    tx(async () => {
      await as(null);
      await db.exec("SET LOCAL ROLE anon");
      await expect(db.query("SELECT public.list_my_notifications_page()")).rejects.toThrow(
        "permission denied",
      );
    }));
});

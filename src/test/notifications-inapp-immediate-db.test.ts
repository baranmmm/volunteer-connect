import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { initializeRecycleDatabase } from "./recycle-db-fixture";

// 20261208090000: notices held for the former in-app daily summary are released when the migration runs (listed and
// counted at once, marked for the next summary email), and nothing can be held afterwards. The database is built from
// the migrations before it, the held notices are added, then the migration runs.
const MIGRATION = "20261208090000_notifications_inapp_immediate.sql";
const db = new PGlite();
const id = (n: number) => {
  const h = n.toString(16).padStart(2, "0");
  return `${h.repeat(4)}-${h.repeat(2)}-4${h}${h[0]}-8${h}${h[0]}-${h.repeat(6)}`;
};
const ids = { region: id(1), b1: id(2), bm: id(10), vol: id(11) };

async function as(user: string | null) {
  await db.exec("RESET ROLE");
  await db.query(
    "SELECT set_config('request.jwt.claim.sub',$1,false), set_config('request.jwt.claim.aal','aal1',false)",
    [user ?? ""],
  );
  if (user) await db.exec("SET ROLE authenticated");
}

beforeAll(async () => {
  await initializeRecycleDatabase(db, { until: MIGRATION });
  await db.exec(`INSERT INTO regions(id,name) VALUES ('${ids.region}','Region');
    INSERT INTO branches(id,name,region_id) VALUES ('${ids.b1}','Riverside','${ids.region}');
    INSERT INTO auth.users(id, raw_user_meta_data) SELECT x, jsonb_build_object('full_name','Person '||left(x::text,2),'privacy_notice_version','1.3')
      FROM unnest(ARRAY['${ids.bm}','${ids.vol}']::uuid[]) x;
    UPDATE profiles SET status='active', branch_id='${ids.b1}';
    UPDATE user_roles SET role='branch_manager' WHERE user_id='${ids.bm}';
    INSERT INTO notifications(user_id, kind, actor_id, entity_type, entity_id, title, link, created_at, held) VALUES
      ('${ids.bm}','task_status_changed','${ids.vol}','task','${id(40)}','Held 1','/tasks','2026-11-20T10:00:00Z',true),
      ('${ids.bm}','meeting_changed','${ids.vol}','meeting','${id(41)}','Held 2','/meetings','2026-11-20T11:00:00Z',true),
      ('${ids.bm}','task_assigned','${ids.vol}','task','${id(42)}','Shown','/tasks','2026-11-20T12:00:00Z',false);`);
  await db.exec(readFileSync(`supabase/migrations/${MIGRATION}`, "utf8"));
}, 60000);
afterAll(async () => db.close());

describe("held notices before the migration", () => {
  it("are released: listed, counted and marked for the next summary email; nothing can be held any more", async () => {
    await as(null);
    const rows = (
      await db.query<{ title: string; held: boolean; email_digest: boolean }>(
        "SELECT title, held, email_digest FROM notifications ORDER BY created_at",
      )
    ).rows;
    expect(rows).toEqual([
      { title: "Held 1", held: false, email_digest: true },
      { title: "Held 2", held: false, email_digest: true },
      { title: "Shown", held: false, email_digest: false },
    ]);
    await as(ids.bm);
    const counts = (
      await db.query<{ v: { total: number } }>("SELECT public.get_unread_notification_counts() v")
    ).rows[0]!.v;
    expect(counts.total).toBe(3);
    const listed = (
      await db.query<{ v: { title: string }[] }>("SELECT public.list_my_notifications(50) v")
    ).rows[0]!.v;
    expect(listed.map((n) => n.title)).toEqual(["Shown", "Held 2", "Held 1"]);
    await as(null);
    await expect(
      db.query(`UPDATE notifications SET held = true WHERE title = 'Shown'`),
    ).rejects.toThrow("notifications_never_held");
    // The next summary email carries them.
    expect(
      (
        await db.query<{ v: number }>(
          "SELECT public.run_notification_digest('2027-01-15 08:05+00') v",
        )
      ).rows[0]!.v,
    ).toBe(1);
    const mail = (
      await db.query<{ user_id: string; payload: Record<string, unknown> }>(
        "SELECT user_id, payload FROM email_outbox WHERE template='daily_digest'",
      )
    ).rows;
    expect(mail).toEqual([
      {
        user_id: ids.bm,
        payload: {
          count: 2,
          kinds: { task_status_changed: 1, meeting_changed: 1 },
          day: "2027-01-15",
        },
      },
    ]);
  });
});

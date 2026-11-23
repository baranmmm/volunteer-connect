import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { initializeRecycleDatabase } from "./recycle-db-fixture";

// A2b rules against every migration in PGlite (no QA needed). Each test runs in a rolled-back transaction.
const db = new PGlite();
const id = (n: number) =>
  `${String(n).repeat(8)}-${String(n).repeat(4)}-4${String(n).repeat(3)}-8${String(n).repeat(3)}-${String(n).repeat(12)}`;
const ids = {
  region: id(1),
  branch: id(2),
  branch2: id(3),
  manager: id(4),
  manager2: id(5),
  a: id(6),
  b: id(7),
  c: id(8),
  d: id(9),
};
const start = (days: number, time = "18:00") =>
  `((now() AT TIME ZONE 'Europe/London')::date + ${days} + time '${time}') AT TIME ZONE 'Europe/London'`;
async function as(user: string | null) {
  await db.exec("RESET ROLE");
  await db.query("SELECT set_config('request.jwt.claim.sub',$1,true)", [user ?? ""]);
  if (user) await db.exec("SET LOCAL ROLE authenticated");
}
/** Expects `sql` to fail with `message`, keeping the surrounding transaction usable. */
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
async function createEvent(extra: Record<string, unknown> = {}, days = 5, time = "18:00") {
  await as(ids.manager);
  const startAt = (await db.query<{ s: string }>(`SELECT (${start(days, time)})::text s`)).rows[0]!
    .s;
  const endAt = (
    await db.query<{ s: string }>(`SELECT ((${start(days, time)}) + interval '90 minutes')::text s`)
  ).rows[0]!.s;
  const data = {
    title: "Dialogue evening",
    description: "",
    location: "Hall",
    location_type: "in_person",
    online_url: null,
    organizer: "DS",
    category: "dialogue",
    all_day: false,
    start_date: null,
    end_date: null,
    start_at: startAt,
    end_at: endAt,
    capacity: null,
    scope: "branch",
    branch_id: ids.branch,
    status: "published",
    ...extra,
  };
  return (
    await db.query<{ id: string }>("SELECT public.create_event($1::jsonb) id", [
      JSON.stringify(data),
    ])
  ).rows[0]!.id;
}
const register = async (user: string, event: string) => {
  await as(user);
  return (
    await db.query<{
      r: { status: string; waitlist_position: number | null; registration_id: string };
    }>("SELECT public.register_for_event($1) r", [event])
  ).rows[0]!.r;
};
const row = async (event: string, user: string) => {
  await as(null);
  return (
    await db.query<{ status: string; notice: string | null }>(
      "SELECT status, notice FROM public.event_registrations WHERE event_id=$1 AND user_id=$2",
      [event, user],
    )
  ).rows[0];
};

beforeAll(async () => {
  await initializeRecycleDatabase(db);
  await db.exec(`INSERT INTO regions(id,name) VALUES ('${ids.region}','Region');
    INSERT INTO branches(id,name,region_id) VALUES ('${ids.branch}','Branch','${ids.region}'),('${ids.branch2}','Branch 2','${ids.region}');
    INSERT INTO auth.users(id, raw_user_meta_data) SELECT x, jsonb_build_object('full_name', 'User ' || left(x::text, 1), 'privacy_notice_version', '1.1') FROM unnest(ARRAY['${ids.manager}','${ids.manager2}','${ids.a}','${ids.b}','${ids.c}','${ids.d}']::uuid[]) x;
    UPDATE profiles SET status='active', branch_id='${ids.branch}';
    UPDATE profiles SET branch_id='${ids.branch2}' WHERE id='${ids.manager2}';
    UPDATE user_roles SET role='branch_manager' WHERE user_id IN ('${ids.manager}','${ids.manager2}');`);
}, 30000);
afterAll(async () => db.close());

describe("event registrations (database)", () => {
  it("registers, is idempotent, waitlists at capacity and promotes FIFO on cancel", () =>
    tx(async () => {
      const e = await createEvent({ capacity: 1 });
      const first = await register(ids.a, e);
      expect(first.status).toBe("registered");
      expect((await register(ids.a, e)).registration_id).toBe(first.registration_id);
      expect(await register(ids.b, e)).toMatchObject({
        status: "waitlisted",
        waitlist_position: 1,
      });
      expect(await register(ids.c, e)).toMatchObject({
        status: "waitlisted",
        waitlist_position: 2,
      });
      await as(ids.a);
      await db.query("SELECT public.cancel_registration($1)", [e]);
      expect(await row(e, ids.b)).toEqual({ status: "registered", notice: "promoted" });
      expect(await row(e, ids.c)).toEqual({ status: "waitlisted", notice: null });
      expect((await register(ids.a, e)).registration_id).toBe(first.registration_id);
    }));
  it("more capacity promotes the waitlist; less capacity removes nobody", () =>
    tx(async () => {
      const e = await createEvent({ capacity: 1 });
      await register(ids.a, e);
      await register(ids.b, e);
      await register(ids.c, e);
      await as(null);
      await db.query("UPDATE public.events SET capacity = 3 WHERE id = $1", [e]);
      expect((await row(e, ids.c))?.status).toBe("registered");
      await db.query("UPDATE public.events SET capacity = 1 WHERE id = $1", [e]);
      expect(
        (
          await db.query<{ n: number }>(
            "SELECT count(*)::int n FROM public.event_registrations WHERE event_id=$1 AND status='registered'",
            [e],
          )
        ).rows[0]!.n,
      ).toBe(3);
      expect((await register(ids.d, e)).status).toBe("waitlisted");
    }));
  it("clients only read; volunteers see their own rows, the other branch manager none", () =>
    tx(async () => {
      const e = await createEvent();
      await register(ids.a, e);
      await register(ids.b, e);
      await as(ids.a);
      expect((await db.query("SELECT user_id FROM public.event_registrations")).rows).toEqual([
        { user_id: ids.a },
      ]);
      await fails(
        "INSERT INTO public.event_registrations(event_id,user_id,status) VALUES ($1,$2,'registered')",
        [e, ids.a],
        "permission denied",
      );
      await fails("SELECT * FROM public.get_event_registrations($1)", [e], "Not allowed");
      await as(ids.manager2);
      expect((await db.query("SELECT 1 FROM public.event_registrations")).rows).toEqual([]);
      await as(ids.manager);
      expect(
        (await db.query("SELECT * FROM public.get_event_registrations($1)", [e])).rows,
      ).toHaveLength(2);
    }));
  it("cancelled, removed and restored events set and clear notices", () =>
    tx(async () => {
      const e = await createEvent();
      await register(ids.a, e);
      await as(ids.manager);
      await db.query("SELECT public.delete_event($1)", [e]);
      expect(await row(e, ids.a)).toEqual({ status: "registered", notice: "event_removed" });
      await as(ids.manager);
      await db.query("SELECT public.delete_event($1,NULL,true)", [e]);
      await db.query("SELECT public.restore_event($1)", [e]);
      await db.query("SELECT public.restore_event($1,true)", [e]);
      expect(await row(e, ids.a)).toEqual({ status: "registered", notice: null });
      await as(ids.manager);
      await db.query("SELECT public.cancel_event($1)", [e]);
      expect(await row(e, ids.a)).toEqual({ status: "registered", notice: "event_cancelled" });
      await as(ids.b);
      await fails("SELECT public.register_for_event($1)", [e], "Registration is closed");
    }));
  it("a series 'all' edit keeps the registered occurrence (same id, exception) and regenerates the rest", () =>
    tx(async () => {
      await as(ids.manager);
      const data = async (time: string) => ({
        title: "Weekly",
        description: "",
        location: "Hall",
        location_type: "in_person",
        online_url: null,
        organizer: "DS",
        category: "dialogue",
        all_day: false,
        start_date: null,
        end_date: null,
        start_at: (await db.query<{ s: string }>(`SELECT (${start(7, time)})::text s`)).rows[0]!.s,
        end_at: (
          await db.query<{ s: string }>(`SELECT ((${start(7, time)}) + interval '1 hour')::text s`)
        ).rows[0]!.s,
        capacity: null,
        scope: "branch",
        branch_id: ids.branch,
        status: "published",
      });
      const s = (
        await db.query<{ r: { series_id: string } }>(
          "SELECT public.create_series($1::jsonb, 'FREQ=WEEKLY;COUNT=3') r",
          [JSON.stringify(await data("18:00"))],
        )
      ).rows[0]!.r;
      const occ = async () => {
        await as(null);
        return (
          await db.query<{ id: string; ex: boolean; t: string }>(
            "SELECT id, series_exception ex, to_char(start_at AT TIME ZONE 'Europe/London','HH24:MI') t FROM public.events WHERE series_id=$1 AND deleted_at IS NULL ORDER BY recurrence_key",
            [s.series_id],
          )
        ).rows;
      };
      const before = await occ();
      await register(ids.a, before[1]!.id);
      await as(ids.manager);
      await db.query("SELECT public.update_series_event($1,'all',$2::jsonb)", [
        before[0]!.id,
        JSON.stringify(await data("19:00")),
      ]);
      const after = await occ();
      expect(after.find((o) => o.id === before[1]!.id)).toEqual({
        id: before[1]!.id,
        ex: true,
        t: "19:00",
      });
      expect(
        after
          .filter((o) => o.id !== before[1]!.id)
          .every((o) => !before.some((b) => b.id === o.id) && o.t === "19:00" && !o.ex),
      ).toBe(true);
      expect(await row(before[1]!.id, ids.a)).toEqual({
        status: "registered",
        notice: "event_changed",
      });
    }));
  it("deleting a user frees their seat for the waitlist; erasure anonymises without changing counts", () =>
    tx(async () => {
      const e = await createEvent({ capacity: 1 });
      await register(ids.a, e);
      await register(ids.b, e);
      await as(null);
      await db.query(
        "UPDATE public.profiles SET deleted_at = now(), status = 'inactive' WHERE id = $1",
        [ids.a],
      );
      expect(await row(e, ids.a)).toEqual({ status: "cancelled", notice: null });
      expect(await row(e, ids.b)).toEqual({ status: "registered", notice: "promoted" });
      await db.query("DELETE FROM auth.users WHERE id = $1", [ids.b]);
      expect(
        (
          await db.query(
            "SELECT user_id, status, show_name, notice FROM public.event_registrations WHERE event_id=$1 AND status=$2",
            [e, "registered"],
          )
        ).rows,
      ).toEqual([{ user_id: null, status: "registered", show_name: false, notice: null }]);
    }));
  it("names are opt-out: shown by default, hidden on request, still hidden after registering again", () =>
    tx(async () => {
      const e = await createEvent();
      const showName = async (user: string) => {
        await as(null);
        return (
          await db.query<{ show_name: boolean }>(
            "SELECT show_name FROM public.event_registrations WHERE event_id=$1 AND user_id=$2",
            [e, user],
          )
        ).rows[0]?.show_name;
      };
      await register(ids.a, e);
      expect(await showName(ids.a)).toBe(true);
      await as(ids.b);
      await db.query("SELECT public.register_for_event($1, false)", [e]);
      expect(await showName(ids.b)).toBe(false);
      await as(ids.b);
      await db.query("SELECT public.cancel_registration($1)", [e]);
      await register(ids.b, e);
      expect(await showName(ids.b)).toBe(false);
      await as(ids.b);
      await db.query("SELECT public.set_registration_show_name($1, true)", [e]);
      expect(await showName(ids.b)).toBe(true);
    }));
});

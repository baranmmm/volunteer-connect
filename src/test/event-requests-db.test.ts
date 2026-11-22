import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { initializeRecycleDatabase } from "./recycle-db-fixture";

// A3 event request rules against every migration in PGlite (no QA needed). Each test is rolled back.
const db = new PGlite();
const id = (n: number) =>
  `${String(n).repeat(8)}-${String(n).repeat(4)}-4${String(n).repeat(3)}-8${String(n).repeat(3)}-${String(n).repeat(12)}`;
const ids = {
  region: id(1),
  branch: id(2),
  branch2: id(3),
  rd: id(4),
  bm: id(5),
  bm2: id(6),
  vol: id(7),
  vol2: id(8),
};
async function as(user: string | null) {
  await db.exec("RESET ROLE");
  await db.query("SELECT set_config('request.jwt.claim.sub',$1,true)", [user ?? ""]);
  if (user) await db.exec("SET LOCAL ROLE authenticated");
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
const future = (days: number, hours = 0) =>
  new Date(Date.now() + days * 86400000 + hours * 3600000).toISOString();
const request = (extra: Record<string, unknown> = {}) =>
  JSON.stringify({
    title: "Community iftar",
    description: "Evening dialogue dinner",
    reason: "Ramadan outreach",
    all_day: false,
    proposed_start: future(5),
    proposed_end: future(5, 2),
    location_text: "Community Hall",
    is_online: false,
    expected_attendees: 40,
    ...extra,
  });
async function submit(user: string, extra: Record<string, unknown> = {}) {
  await as(user);
  return (
    await db.query<{ id: string }>("SELECT public.submit_event_request($1::jsonb) id", [
      request(extra),
    ])
  ).rows[0]!.id;
}
async function stored(requestId: string) {
  await as(null);
  return (
    await db.query<{
      status: string;
      requester_id: string | null;
      event_id: string | null;
      notice: string | null;
      scope: string;
      branch_id: string | null;
    }>(
      "SELECT status, requester_id, event_id, notice, scope, branch_id FROM public.event_requests WHERE id=$1",
      [requestId],
    )
  ).rows[0];
}

beforeAll(async () => {
  await initializeRecycleDatabase(db);
  await db.exec(`INSERT INTO regions(id,name) VALUES ('${ids.region}','Region');
    INSERT INTO branches(id,name,region_id) VALUES ('${ids.branch}','Branch','${ids.region}'),('${ids.branch2}','Branch 2','${ids.region}');
    INSERT INTO auth.users(id, raw_user_meta_data) SELECT x, jsonb_build_object('full_name', 'User ' || left(x::text, 1)) FROM unnest(ARRAY['${ids.rd}','${ids.bm}','${ids.bm2}','${ids.vol}','${ids.vol2}']::uuid[]) x;
    UPDATE profiles SET status='active', branch_id='${ids.branch}';
    UPDATE profiles SET branch_id='${ids.branch2}' WHERE id IN ('${ids.bm2}','${ids.vol2}');
    UPDATE user_roles SET role='branch_manager' WHERE user_id IN ('${ids.bm}','${ids.bm2}');
    UPDATE user_roles SET role='regional_director', region_id='${ids.region}' WHERE user_id='${ids.rd}';`);
}, 30000);
afterAll(async () => db.close());

describe("event requests (database)", () => {
  it("volunteers request branch events, branch managers region events, directors create directly", () =>
    tx(async () => {
      const v = await submit(ids.vol);
      expect(await stored(v)).toMatchObject({
        status: "submitted",
        scope: "branch",
        branch_id: ids.branch,
        requester_id: ids.vol,
      });
      await as(ids.vol);
      await fails(
        "SELECT public.submit_event_request($1::jsonb)",
        [request({ scope: "region" })],
        "Not allowed",
      );
      const b = await submit(ids.bm);
      expect(await stored(b)).toMatchObject({ scope: "region", branch_id: null });
      await as(ids.bm);
      await fails(
        "SELECT public.submit_event_request($1::jsonb)",
        [request({ scope: "branch" })],
        "Branch managers create branch events directly",
      );
      await as(ids.rd);
      await fails(
        "SELECT public.submit_event_request($1::jsonb)",
        [request()],
        "Regional directors create events directly",
      );
      // create_event: branch managers cannot create region events at all.
      await as(ids.bm);
      const region = JSON.stringify({
        title: "Region day",
        scope: "region",
        branch_id: null,
        status: "draft",
      });
      await fails("SELECT public.create_event($1::jsonb)", [region], "Not allowed");
      const own = JSON.stringify({
        title: "Branch day",
        scope: "branch",
        branch_id: ids.branch,
        status: "draft",
      });
      expect((await db.query("SELECT public.create_event($1::jsonb) id", [own])).rows).toHaveLength(
        1,
      );
    }));

  it("validates dates, links and the open-request limit", () =>
    tx(async () => {
      await as(ids.vol);
      const call = "SELECT public.submit_event_request($1::jsonb)";
      await fails(
        call,
        [request({ proposed_start: future(-1), proposed_end: future(-1, 1) })],
        "Proposed date must be in the future",
      );
      await fails(call, [request({ proposed_end: future(4) })], "Event end must be after start");
      await fails(
        call,
        [request({ is_online: true, online_url: "http://example.org/x" })],
        "Online meeting link must use https",
      );
      await fails(call, [request({ title: "  " })], "Request title is required");
      await fails(
        call,
        [request({ all_day: true, proposed_start_date: "2020-01-01" })],
        "Proposed date must be in the future",
      );
      const day = future(6).slice(0, 10);
      await db.query(call, [
        request({ all_day: true, proposed_start_date: day, proposed_end_date: day }),
      ]);
      for (let i = 0; i < 4; i++) await db.query(call, [request()]);
      await fails(call, [request()], "Too many open requests");
    }));

  it("reviewers by scope; nobody reviews their own request", () =>
    tx(async () => {
      const v = await submit(ids.vol);
      await as(ids.bm2);
      await fails("SELECT public.get_event_request($1)", [v], "Request not found");
      expect((await db.query("SELECT id FROM public.event_requests")).rows).toEqual([]);
      await as(ids.bm);
      await db.query("SELECT public.start_review_event_request($1)", [v]);
      expect(await stored(v)).toMatchObject({ status: "under_review", notice: "under_review" });
      const r = await submit(ids.bm);
      await as(ids.bm2);
      await fails("SELECT public.approve_event_request($1)", [r], "Request not found");
      await as(ids.bm);
      await fails(
        "SELECT public.approve_event_request($1)",
        [r],
        "You cannot review your own request",
      );
      await as(ids.rd);
      const counts = (
        await db.query<{ c: { total: number } }>(
          "SELECT public.get_pending_event_request_count() c",
        )
      ).rows[0]!.c;
      expect(counts).toMatchObject({ submitted: 1, under_review: 1, total: 2 });
    }));

  it("approval creates one draft owned by the approver; decline needs a reason", () =>
    tx(async () => {
      const r = await submit(ids.bm);
      await as(ids.rd);
      const approved = (
        await db.query<{ a: { event_id: string } }>(
          "SELECT public.approve_event_request($1) a",
          [r],
        )
      ).rows[0]!.a;
      await fails("SELECT public.approve_event_request($1)", [r], "Request already decided");
      await as(null);
      const event = (
        await db.query<{
          status: string;
          scope: string;
          created_by: string;
          capacity: number;
          title: string;
        }>("SELECT status, scope, created_by, capacity, title FROM public.events WHERE id=$1", [
          approved.event_id,
        ])
      ).rows[0];
      expect(event).toEqual({
        status: "draft",
        scope: "region",
        created_by: ids.rd,
        capacity: null,
        title: "Community iftar",
      });
      expect(await stored(r)).toMatchObject({
        status: "approved",
        event_id: approved.event_id,
        notice: "approved",
      });
      const v = await submit(ids.vol);
      await as(ids.bm);
      await fails(
        "SELECT public.decline_event_request($1, $2)",
        [v, "too short"],
        "Decline reason is required",
      );
      await db.query("SELECT public.decline_event_request($1, $2)", [
        v,
        "The hall is booked that week.",
      ]);
      expect(await stored(v)).toMatchObject({ status: "declined", notice: "declined" });
      // A purged draft leaves the request approved with event_id NULL.
      await as(null);
      await db.query("DELETE FROM public.events WHERE id=$1", [approved.event_id]);
      expect(await stored(r)).toMatchObject({ status: "approved", event_id: null });
    }));

  it("update and withdraw only while submitted, by the requester", () =>
    tx(async () => {
      const v = await submit(ids.vol);
      await as(ids.vol);
      await db.query("SELECT public.update_event_request($1, $2::jsonb)", [
        v,
        request({ title: "Renamed" }),
      ]);
      await as(ids.vol2);
      await fails("SELECT public.withdraw_event_request($1)", [v], "Request not found");
      await as(ids.bm);
      await db.query("SELECT public.start_review_event_request($1)", [v]);
      await as(ids.vol);
      await fails(
        "SELECT public.update_event_request($1, $2::jsonb)",
        [v, request()],
        "Request can no longer be changed",
      );
      await fails(
        "SELECT public.withdraw_event_request($1)",
        [v],
        "Request can no longer be changed",
      );
      const w = await submit(ids.vol);
      await as(ids.vol);
      await db.query("SELECT public.withdraw_event_request($1)", [w]);
      expect((await stored(w))?.status).toBe("withdrawn");
    }));

  it("clients only read; internal helpers are not callable", () =>
    tx(async () => {
      const v = await submit(ids.vol);
      await as(ids.vol);
      await fails(
        "INSERT INTO public.event_requests(scope, branch_id, region_id, title, proposed_start, proposed_end) VALUES ('branch',$1,$2,'x',now()+interval '1 day',now()+interval '2 days')",
        [ids.branch, ids.region],
        "permission denied",
      );
      await fails(
        "UPDATE public.event_requests SET status='approved' WHERE id=$1",
        [v],
        "permission denied",
      );
      await fails("SELECT public.event_request_fields('{}'::jsonb, 'proposal')", [], "permission denied");
      await fails("SELECT public.restore_event_request($1)", [v], "permission denied");
      await fails("SELECT public.purge_expired_event_requests()", [], "permission denied");
      await as(ids.vol2);
      expect(
        (await db.query("SELECT id FROM public.event_requests WHERE id=$1", [v])).rows,
      ).toEqual([]);
    }));

  it("Recycle Bin, user deletion and erasure", () =>
    tx(async () => {
      const v = await submit(ids.vol);
      await as(ids.vol);
      await db.query("SELECT public.delete_event_request($1)", [v]);
      expect((await db.query("SELECT public.list_my_event_requests() l")).rows[0]).toEqual({
        l: [],
      });
      await as(ids.bm);
      const bin = (
        await db.query<{ id: string; type: string }>(
          "SELECT id, type FROM public.list_recycle_bin('event_request','',0)",
        )
      ).rows;
      expect(bin).toEqual([{ id: v, type: "event_request" }]);
      await db.query("SELECT public.restore_item('event_request',$1)", [v]);
      // Deleting an open request withdrew it; restoring never reopens it.
      expect((await stored(v))?.status).toBe("withdrawn");
      await as(ids.bm);
      await db.query("SELECT public.delete_event_request($1)", [v]);
      const gone = (
        await db.query<{ r: { deleted: boolean } }>(
          "SELECT public.permanent_delete_item('event_request',$1,'DELETE') r",
          [v],
        )
      ).rows[0]!.r;
      expect(gone.deleted).toBe(true);
      expect(await stored(v)).toBeUndefined();
      // Approved requests: the requester cannot delete them.
      const a = await submit(ids.vol);
      await as(ids.bm);
      await db.query("SELECT public.approve_event_request($1)", [a]);
      await as(ids.vol);
      await fails("SELECT public.delete_event_request($1)", [a], "Not allowed");
      // Soft-deleting the user withdraws open requests; erasure keeps the row without a requester.
      const open = await submit(ids.vol);
      await as(null);
      await db.query("UPDATE public.profiles SET deleted_at = now() WHERE id=$1", [ids.vol]);
      expect((await stored(open))?.status).toBe("withdrawn");
      expect((await stored(a))?.status).toBe("approved");
      await db.query("DELETE FROM auth.users WHERE id=$1", [ids.vol]);
      expect(await stored(open)).toMatchObject({ status: "withdrawn", requester_id: null });
      expect(await stored(a)).toMatchObject({ status: "approved", requester_id: null });
    }));
  it("delete, new requests, restore: the open-request limit holds and nothing reopens", () =>
    tx(async () => {
      const old: string[] = [];
      for (let i = 0; i < 5; i++) old.push(await submit(ids.vol2, { title: `Old ${i}` }));
      await as(ids.bm2);
      await db.query("SELECT public.start_review_event_request($1)", [old[0]]);
      await as(ids.vol2);
      for (const id of old) await db.query("SELECT public.delete_event_request($1)", [id]);
      for (const id of old) expect((await stored(id))?.status).toBe("withdrawn");
      for (let i = 0; i < 5; i++) await submit(ids.vol2, { title: `New ${i}` });
      await as(ids.bm2);
      for (const id of old) await db.query("SELECT public.restore_item('event_request',$1)", [id]);
      await as(null);
      const open = (
        await db.query<{ n: number }>(
          "SELECT count(*)::int n FROM public.event_requests WHERE requester_id=$1 AND status IN ('submitted','under_review') AND deleted_at IS NULL",
          [ids.vol2],
        )
      ).rows[0]!.n;
      expect(open).toBe(5);
      for (const id of old) expect((await stored(id))?.status).toBe("withdrawn");
      await as(ids.vol2);
      await fails(
        "SELECT public.submit_event_request($1::jsonb)",
        [request()],
        "Too many open requests",
      );
      // The restored, formerly under-review request is not back in the reviewer's queue.
      await as(ids.bm2);
      const queue = (
        await db.query<{ r: { rows: { id: string }[] } }>(
          "SELECT public.list_managed_event_requests('under_review',0) r",
        )
      ).rows[0]!.r.rows;
      expect(queue.map((x) => x.id)).not.toContain(old[0]);
    }));
});

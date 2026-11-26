import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { initializeRecycleDatabase } from "./recycle-db-fixture";

// A3 revision (request types, reviewer editing, attachments) against every migration in PGlite. Rolled back per test.
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
const external = (extra: Record<string, unknown> = {}) =>
  JSON.stringify({
    request_type: "external",
    title: "Interfaith iftar",
    organizer_name: "Medway Mosque",
    source: "leaflet",
    source_url: "https://example.org/iftar",
    notes: "Seen at the library",
    all_day: false,
    proposed_start: future(6),
    proposed_end: future(6, 2),
    location_text: "",
    is_online: false,
    ...extra,
  });
async function submit(user: string, body: string) {
  await as(user);
  return (
    await db.query<{ id: string }>("SELECT public.submit_event_request($1::jsonb) id", [body])
  ).rows[0]!.id;
}
async function row(requestId: string) {
  await as(null);
  return (
    await db.query<Record<string, unknown>>("SELECT * FROM public.event_requests WHERE id=$1", [
      requestId,
    ])
  ).rows[0];
}

beforeAll(async () => {
  await initializeRecycleDatabase(db);
  await db.exec(`INSERT INTO regions(id,name) VALUES ('${ids.region}','Region');
    INSERT INTO branches(id,name,region_id) VALUES ('${ids.branch}','Branch','${ids.region}'),('${ids.branch2}','Branch 2','${ids.region}');
    INSERT INTO auth.users(id, raw_user_meta_data) SELECT x, jsonb_build_object('full_name', 'User ' || left(x::text, 1), 'privacy_notice_version', '1.5') FROM unnest(ARRAY['${ids.rd}','${ids.bm}','${ids.bm2}','${ids.vol}','${ids.vol2}']::uuid[]) x;
    UPDATE profiles SET status='active', branch_id='${ids.branch}';
    UPDATE profiles SET branch_id='${ids.branch2}' WHERE id IN ('${ids.bm2}','${ids.vol2}');
    UPDATE user_roles SET role='branch_manager' WHERE user_id IN ('${ids.bm}','${ids.bm2}');
    UPDATE user_roles SET role='regional_director', region_id='${ids.region}' WHERE user_id='${ids.rd}';`);
}, 30000);
afterAll(async () => db.close());

describe("event request types (database)", () => {
  it("external requests need an organiser and a source; proposal-only fields are dropped", () =>
    tx(async () => {
      await as(ids.vol);
      const call = "SELECT public.submit_event_request($1::jsonb)";
      await fails(call, [external({ organizer_name: " " })], "Organiser is required");
      await fails(call, [external({ source: "poster" })], "Invalid request source");
      await fails(
        call,
        [external({ source_url: "http://example.org/x" })],
        "Source link must use https",
      );
      const r = await submit(
        ids.vol,
        external({
          expected_attendees: 40,
          reason: "x",
          alt_start: future(8),
          alt_end: future(8, 1),
          category: "dinner",
        }),
      );
      expect(await row(r)).toMatchObject({
        request_type: "external",
        organizer_name: "Medway Mosque",
        expected_attendees: null,
        reason: null,
        alt_start: null,
        category: null,
      });
      const p = await submit(
        ids.vol,
        JSON.stringify({
          title: "Proposal",
          proposed_start: future(6),
          proposed_end: future(6, 1),
          organizer_name: "x",
          source: "leaflet",
        }),
      );
      expect(await row(p)).toMatchObject({
        request_type: "proposal",
        organizer_name: null,
        source: null,
      });
    }));

  it("external approval publishes only with publish fields; the reviewer completes them by editing", () =>
    tx(async () => {
      const r = await submit(ids.vol, external());
      await as(ids.bm);
      await fails(
        "SELECT public.approve_event_request($1)",
        [r],
        "Required publish fields missing",
      );
      await fails(
        "SELECT public.manager_update_event_request($1,$2::jsonb)",
        [r, external({ scope: "region" })],
        "Request scope and type cannot be changed",
      );
      await fails(
        "SELECT public.manager_update_event_request($1,$2::jsonb)",
        [r, external({ request_type: "proposal" })],
        "Request scope and type cannot be changed",
      );
      await db.query("SELECT public.manager_update_event_request($1,$2::jsonb)", [
        r,
        external({
          title: "Interfaith iftar dinner",
          category: "dinner",
          location_text: "Medway Mosque hall",
        }),
      ]);
      expect(await row(r)).toMatchObject({
        status: "under_review",
        last_edited_by: ids.bm,
        reviewer_id: ids.bm,
        notice: "under_review",
        category: "dinner",
      });
      // The requester can no longer edit once a reviewer has.
      await as(ids.vol);
      await fails(
        "SELECT public.update_event_request($1,$2::jsonb)",
        [r, external()],
        "Request can no longer be changed",
      );
      await as(ids.bm2);
      await fails(
        "SELECT public.manager_update_event_request($1,$2::jsonb)",
        [r, external()],
        "Request not found",
      );
      await as(ids.bm);
      const a = (
        await db.query<{ a: { event_id: string; published: boolean } }>(
          "SELECT public.approve_event_request($1) a",
          [r],
        )
      ).rows[0]!.a;
      expect(a.published).toBe(true);
      await as(null);
      const e = (
        await db.query<Record<string, unknown>>(
          "SELECT status, is_external, organizer, title, category, location, created_by FROM public.events WHERE id=$1",
          [a.event_id],
        )
      ).rows[0];
      expect(e).toEqual({
        status: "published",
        is_external: true,
        organizer: "Medway Mosque",
        title: "Interfaith iftar dinner",
        category: "dinner",
        location: "Medway Mosque hall",
        created_by: ids.bm,
      });
      await as(ids.bm);
      await fails(
        "SELECT public.manager_update_event_request($1,$2::jsonb)",
        [r, external()],
        "Request already decided",
      );
    }));

  it("proposals still become drafts; declined requests cannot be edited", () =>
    tx(async () => {
      const p = await submit(
        ids.vol,
        JSON.stringify({
          title: "Proposal",
          proposed_start: future(6),
          proposed_end: future(6, 1),
        }),
      );
      await as(ids.bm);
      const a = (
        await db.query<{ a: { event_id: string; published: boolean } }>(
          "SELECT public.approve_event_request($1) a",
          [p],
        )
      ).rows[0]!.a;
      expect(a.published).toBe(false);
      await as(null);
      expect(
        (await db.query("SELECT status, is_external FROM public.events WHERE id=$1", [a.event_id]))
          .rows[0],
      ).toEqual({ status: "draft", is_external: false });
      const d = await submit(ids.vol, external());
      await as(ids.bm);
      await db.query("SELECT public.decline_event_request($1,'Not a branch event, sorry.')", [d]);
      await fails(
        "SELECT public.manager_update_event_request($1,$2::jsonb)",
        [d, external()],
        "Request already decided",
      );
      await fails("SELECT public.approve_event_request($1,'{}'::jsonb)", [d], "does not exist");
    }));

  it("attachments: 3 per request, images and PDFs, only the requester and reviewers; copied on approval", () =>
    tx(async () => {
      const r = await submit(ids.vol, external({ category: "dinner", location_text: "Hall" }));
      await as(ids.vol);
      const add = (kind: string, ext: string) =>
        db.query<{ m: { id: string; storage_path: string } }>(
          "SELECT public.add_event_request_media($1,$2,$3,'leaflet') m",
          [r, kind, ext],
        );
      await fails(
        "SELECT public.add_event_request_media($1,'document','docx')",
        [r],
        "Invalid request file",
      );
      await fails(
        "SELECT public.add_event_request_media($1,'image','pdf')",
        [r],
        "Invalid request file",
      );
      const m1 = (await add("image", "jpeg")).rows[0]!.m;
      expect(m1.storage_path).toMatch(new RegExp(`^${r}/[0-9a-f-]{36}\\.jpg$`));
      await add("pdf", "pdf");
      await add("image", "png");
      await fails(
        "SELECT public.add_event_request_media($1,'image','webp')",
        [r],
        "Maximum 3 files per request",
      );
      await as(ids.vol2);
      await fails(
        "SELECT public.add_event_request_media($1,'image','png')",
        [r],
        "Request not found",
      );
      expect(
        (
          await db.query<{ ok: boolean }>("SELECT public.can_read_event_request_file($1) ok", [
            m1.storage_path,
          ])
        ).rows[0]!.ok,
      ).toBe(false);
      await fails("SELECT public.list_event_request_media($1)", [r], "Request not found");
      await as(ids.bm);
      expect(
        (
          await db.query<{ ok: boolean }>("SELECT public.can_read_event_request_file($1) ok", [
            m1.storage_path,
          ])
        ).rows[0]!.ok,
      ).toBe(true);
      // Storage first: a stored file blocks removing its row.
      await as(null);
      await db.query(
        "INSERT INTO storage.objects(bucket_id,name) VALUES ('event-request-files',$1)",
        [m1.storage_path],
      );
      await as(ids.vol);
      await fails(
        "SELECT public.delete_event_request_media($1)",
        [m1.id],
        "Remove stored file first",
      );
      await as(ids.bm);
      await db.query("SELECT public.manager_update_event_request($1,$2::jsonb)", [
        r,
        external({ category: "dinner", location_text: "Hall" }),
      ]);
      const a = (
        await db.query<{ a: { event_id: string; copies: { from: string; to: string }[] } }>(
          "SELECT public.approve_event_request($1) a",
          [r],
        )
      ).rows[0]!.a;
      expect(a.copies).toHaveLength(3);
      // Images before PDFs; among images the upload order (ties possible in PGlite's coarse clock).
      expect(a.copies.map((c) => c.from)).toContain(m1.storage_path);
      expect(a.copies.map((c) => c.from.endsWith(".pdf"))).toEqual([false, false, true]);
      expect(a.copies.every((c) => c.to.startsWith(`${a.event_id}/`))).toBe(true);
      await as(null);
      const media = (
        await db.query<{ kind: string; position: number }>(
          "SELECT kind, position FROM public.event_media WHERE event_id=$1 ORDER BY position",
          [a.event_id],
        )
      ).rows;
      expect(media).toEqual([
        { kind: "image", position: 0 },
        { kind: "image", position: 1 },
        { kind: "pdf", position: 2 },
      ]);
      await as(ids.vol);
      expect(
        (
          await db.query<{ ok: boolean }>("SELECT public.can_write_event_request_file($1) ok", [
            m1.storage_path,
          ])
        ).rows[0]!.ok,
      ).toBe(false);
    }));

  it("possible duplicates: same London day, title contained either way, case-insensitive", () =>
    tx(async () => {
      const start = future(9);
      const r = await submit(
        ids.vol,
        external({ title: "Iftar", proposed_start: start, proposed_end: future(9, 2) }),
      );
      await as(ids.bm);
      const ev = JSON.stringify({
        title: "Community IFTAR evening",
        description: "",
        location: "Hall",
        location_type: "in_person",
        organizer: "DS",
        category: "dinner",
        all_day: false,
        start_at: start,
        end_at: future(9, 1),
        scope: "branch",
        branch_id: ids.branch,
        status: "published",
      });
      const eventId = (
        await db.query<{ id: string }>("SELECT public.create_event($1::jsonb) id", [ev])
      ).rows[0]!.id;
      const other = JSON.stringify({ ...JSON.parse(ev), title: "Quiz night" });
      await db.query("SELECT public.create_event($1::jsonb)", [other]);
      const dup = (
        await db.query<{ d: { id: string }[] }>(
          "SELECT public.get_event_request_duplicates($1) d",
          [r],
        )
      ).rows[0]!.d;
      expect(dup.map((x) => x.id)).toEqual([eventId]);
      await as(ids.vol);
      await fails("SELECT public.get_event_request_duplicates($1)", [r], "Request not found");
    }));

  it("purge: stored files block deletion until removed through Storage; restore refused once purge started", () =>
    tx(async () => {
      const r = await submit(ids.vol, external());
      await as(ids.vol);
      const m = (
        await db.query<{ m: { storage_path: string } }>(
          "SELECT public.add_event_request_media($1,'pdf','pdf') m",
          [r],
        )
      ).rows[0]!.m;
      await as(null);
      await db.query(
        "INSERT INTO storage.objects(bucket_id,name) VALUES ('event-request-files',$1)",
        [m.storage_path],
      );
      await as(ids.vol);
      await db.query("SELECT public.delete_event_request($1)", [r]);
      await as(ids.bm);
      const prep = (
        await db.query<{ r: { deleted: boolean; paths: string[] } }>(
          "SELECT public.permanent_delete_item('event_request',$1,'DELETE') r",
          [r],
        )
      ).rows[0]!.r;
      expect(prep).toMatchObject({ deleted: false, paths: [m.storage_path] });
      await fails("SELECT public.restore_item('event_request',$1)", [r], "Item cannot be restored");
      await fails("SELECT public.purge_event_request($1,true)", [r], "permission denied");
      await as(null);
      await fails("SELECT public.purge_event_request($1,true)", [r], "Event files still exist");
      await db.query("DELETE FROM storage.objects WHERE name=$1", [m.storage_path]);
      expect(
        (
          await db.query<{ r: { deleted: boolean } }>(
            "SELECT public.purge_event_request($1,true) r",
            [r],
          )
        ).rows[0]!.r.deleted,
      ).toBe(true);
      expect(await row(r)).toBeUndefined();
      expect(
        (
          await db.query("SELECT 1 FROM public.event_request_media WHERE storage_path=$1", [
            m.storage_path,
          ])
        ).rows,
      ).toEqual([]);
    }));
});

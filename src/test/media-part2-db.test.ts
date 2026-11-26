import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { initializeRecycleDatabase, PRIVACY_VERSION } from "./recycle-db-fixture";

// The Media tab, part 2 (20261217090000_media_part2.sql), against every migration in PGlite: only events that have
// started are chapters, and of a regular event only photos added after its start count (past records in full; photos
// sent or moved to an event whatever their date); future events cannot be targets; the five-photo preview; highlights
// (managers star, stars follow moves); download requests (volunteers and trustees, files only after approval and inside
// the 24-hour window); the post-event nudge (once per event and person, at 09:30 London; type 'media' with push on and
// email off by default). Each test is rolled back.
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
  vol2: id(15),
  bm2: id(16),
};
const hash = (n: number) => n.toString(16).padStart(64, "0");
type Row = Record<string, unknown>;
type Photo = { id: string; source: string; starred?: boolean };
type Chapter = { kind: string; id: string; title: string; photo_count: number; photos: Photo[] };

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
const variants = (path: string) => {
  const base = path.replace(/\.[a-z]+$/, "");
  return [`${base}.w640.webp`, `${base}.w1280.webp`];
};
async function store(path: string) {
  for (const name of [path, ...variants(path)])
    await db.query("INSERT INTO storage.objects(bucket_id, name) VALUES ('media-library', $1)", [
      name,
    ]);
}
/** A branch event (service role, triggers off): start `startHours` from now (negative = past), 2 hours long. */
async function event(
  title: string,
  startHours: number,
  opts: { past_record?: boolean; branch?: string } = {},
) {
  await as(null);
  await db.exec("SET session_replication_role = replica");
  const e = (
    await q<{ id: string }>(
      `INSERT INTO public.events (title, organizer, category, scope, branch_id, region_id, status, start_at, end_at, location,
         location_type, audience, registration_enabled, past_record)
       VALUES ($1, 'Dialogue Society', 'dinner', 'branch', $2, $3, 'published', now() + make_interval(hours => $4),
         now() + make_interval(hours => $4 + 2), 'Hall', 'in_person', 'members', true, $5) RETURNING id`,
      [title, opts.branch ?? ids.b1, ids.region, startHours, opts.past_record ?? false],
    )
  )[0]!.id;
  await db.exec("SET session_replication_role = origin");
  return e;
}
/** An event page image created `hoursAgo` hours ago (stored, with copies). */
async function pagePhoto(eventId: string, n: number, hoursAgo: number, position = n) {
  await as(null);
  const path = `${eventId}/${id(n)}.jpg`;
  await db.query(
    `INSERT INTO event_media(id, event_id, storage_path, kind, position, has_variants, width, height, content_hash, created_at)
     VALUES ($1,$2,$3,'image',$4,true,1600,1200,$5, now() - make_interval(hours => $6))`,
    [id(n), eventId, path, position, hash(n), hoursAgo],
  );
  for (const name of [path, ...variants(path)])
    await db.query("INSERT INTO storage.objects(bucket_id, name) VALUES ('event-media', $1)", [
      name,
    ]);
  return id(n);
}
async function bmPhoto(target: Row, n: number) {
  await as(ids.bm1);
  const r = await one<{ id: string; path: string }>(
    "SELECT public.add_media_photo($1, $2::jsonb, 'webp', 'p.webp', $3) v",
    [ids.b1, json(target), hash(n)],
  );
  await store(r.path);
  await db.query("SELECT public.finish_media_photo($1, 1600, 1200)", [r.id]);
  return r.id;
}
const chapters = async (user: string) => {
  await as(user);
  return (await one<{ chapters: Chapter[] }>("SELECT public.get_media_chapters($1) v", [ids.b1]))
    .chapters;
};
const chapterOf = async (user: string, eventId: string) =>
  (await chapters(user)).find((c) => c.id === eventId);

beforeAll(async () => {
  await initializeRecycleDatabase(db);
  const people = Object.entries(ids).filter(([k]) => !["region", "b1", "b2"].includes(k));
  await db.exec(`INSERT INTO regions(id,name) VALUES ('${ids.region}','Region P2');
    INSERT INTO branches(id,name,region_id) VALUES ('${ids.b1}','Medway P2','${ids.region}'),('${ids.b2}','Other P2','${ids.region}');
    INSERT INTO auth.users(id, raw_user_meta_data) VALUES ${people
      .map(
        ([k, v]) =>
          `('${v}', jsonb_build_object('full_name','Person ${k}','privacy_notice_version','${PRIVACY_VERSION}'))`,
      )
      .join(",")};
    UPDATE profiles SET status='active';
    UPDATE profiles SET branch_id='${ids.b1}' WHERE id IN ('${ids.bm1}','${ids.vol1}','${ids.vol1b}','${ids.tr1}');
    UPDATE profiles SET branch_id='${ids.b2}' WHERE id IN ('${ids.vol2}','${ids.bm2}');
    UPDATE profiles SET branch_id=NULL WHERE id='${ids.rd}';
    UPDATE user_roles SET role='branch_manager' WHERE user_id IN ('${ids.bm1}','${ids.bm2}');
    UPDATE user_roles SET role='trustee' WHERE user_id='${ids.tr1}';
    UPDATE user_roles SET role='regional_director', region_id='${ids.region}' WHERE user_id='${ids.rd}';`);
}, 60000);
afterAll(async () => db.close());

describe("only events that have started", () => {
  it("an upcoming event with a cover is no chapter, no target, and cannot be opened", () =>
    tx(async () => {
      const upcoming = await event("Upcoming dinner", 48);
      await pagePhoto(upcoming, 40, 1);
      for (const user of [ids.vol1, ids.bm1, ids.tr1]) {
        expect(await chapterOf(user, upcoming)).toBeUndefined();
        await as(user);
        await fails(
          "SELECT public.get_media_chapter('event', $1)",
          [upcoming],
          "Chapter not found",
        );
      }
      await as(ids.vol1);
      const targets = await one<{ events: { id: string }[] }>(
        "SELECT public.list_media_targets($1) v",
        [ids.b1],
      );
      expect(targets.events.map((e) => e.id)).not.toContain(upcoming);
      // The photo is not in the grid or highlights either.
      const grid = await one<{ photos: Photo[] }>("SELECT public.get_media_photos($1) v", [ids.b1]);
      expect(grid.photos.map((p) => p.id)).not.toContain(id(40));
    }));

  it("a started event shows only photos added after its start; posters from before stay on the event page only", () =>
    tx(async () => {
      const past = await event("Iftar Dinner", -10);
      await pagePhoto(past, 41, 30, 0); // the poster/cover, uploaded before the start
      await pagePhoto(past, 42, 5, 1); // taken at the event
      const c = (await chapterOf(ids.vol1, past))!;
      expect(c.photo_count).toBe(1);
      expect(c.photos.map((p) => p.id)).toEqual([id(42)]);
      // With only pre-start images there is no chapter at all.
      const promo = await event("Promo only", -10);
      await pagePhoto(promo, 43, 30);
      expect(await chapterOf(ids.vol1, promo)).toBeUndefined();
      // Media-only photos of an event count whatever their date (an approved request, a move, a direct upload).
      const library = await bmPhoto({ event_id: promo }, 44);
      await as(null);
      await db.query(
        "UPDATE media_photos SET created_at = now() - interval '40 hours', added_at = now() - interval '40 hours' WHERE id = $1",
        [library],
      );
      expect((await chapterOf(ids.vol1, promo))!.photos.map((p) => p.id)).toEqual([library]);
    }));

  it("a past record counts in full", () =>
    tx(async () => {
      const record = await event("Imported record", -500, { past_record: true });
      await pagePhoto(record, 45, 900, 0); // stored long before the recorded date (an import)
      await pagePhoto(record, 46, 1, 1);
      expect((await chapterOf(ids.vol1, record))!.photo_count).toBe(2);
    }));

  it("requests, direct uploads and moves to an event that has not started are refused", () =>
    tx(async () => {
      const upcoming = await event("Next week", 24 * 7);
      await as(ids.vol1);
      await fails(
        "SELECT public.create_media_upload_request($1::jsonb)",
        [json({ event_id: upcoming })],
        "Event has not started yet",
      );
      await as(ids.bm1);
      await fails(
        "SELECT public.add_media_photo($1, $2::jsonb, 'webp', 'p.webp', $3)",
        [ids.b1, json({ event_id: upcoming }), hash(50)],
        "Event has not started yet",
      );
      const album = await one<string>("SELECT public.create_media_album($1, $2::jsonb) v", [
        ids.b1,
        json({ title: "A" }),
      ]);
      const p = await bmPhoto({ album_id: album }, 51);
      await as(ids.bm1);
      await fails(
        "SELECT public.move_media_photos($1::jsonb, $2::jsonb)",
        [json([{ source: "library", id: p }]), json({ event_id: upcoming })],
        "Event has not started yet",
      );
    }));
});

describe("preview, highlights", () => {
  it("chapters carry five photos for the collage", () =>
    tx(async () => {
      await as(ids.bm1);
      const album = await one<string>("SELECT public.create_media_album($1, $2::jsonb) v", [
        ids.b1,
        json({ title: "Six" }),
      ]);
      for (let n = 0; n < 6; n++) await bmPhoto({ album_id: album }, 60 + n);
      const c = (await chapters(ids.vol1)).find((x) => x.id === album)!;
      expect(c.photo_count).toBe(6);
      expect(c.photos).toHaveLength(5);
    }));

  it("managers star photos (library and event page); the star follows a move; volunteers and trustees cannot star", () =>
    tx(async () => {
      const past = await event("Peace Walk", -10);
      await pagePhoto(past, 70, 30, 0); // cover (before the start: not in Media)
      const page = await pagePhoto(past, 71, 5, 1);
      await as(ids.bm1);
      const album = await one<string>("SELECT public.create_media_album($1, $2::jsonb) v", [
        ids.b1,
        json({ title: "Stars" }),
      ]);
      const lib = await bmPhoto({ album_id: album }, 72);
      await as(ids.bm1);
      await db.query("SELECT public.set_media_highlight('library', $1, true)", [lib]);
      await db.query("SELECT public.set_media_highlight('event', $1, true)", [page]);
      // A photo not shown in Media (the pre-start cover) cannot be starred.
      await fails("SELECT public.set_media_highlight('event', $1, true)", [id(70)], "Not allowed");
      for (const user of [ids.vol1, ids.tr1, ids.bm2]) {
        await as(user);
        await fails(
          "SELECT public.set_media_highlight('library', $1, false)",
          [lib],
          "Not allowed",
        );
      }
      await as(ids.vol1);
      const h = await one<{ photos: Photo[] }>("SELECT public.get_media_highlights($1) v", [
        ids.b1,
      ]);
      expect(h.photos.map((p) => p.id)).toEqual([page, lib]); // most recently starred first
      expect((await chapterOf(ids.vol1, past))!.photos.find((p) => p.id === page)!.starred).toBe(
        true,
      );
      // The event page photo moves to the album: copies stored by the server, then the commit; the star stays.
      await as(null);
      for (const name of [`${ids.b1}/${page}.jpg`, ...variants(`${ids.b1}/${page}.jpg`)])
        await db.query(
          "INSERT INTO storage.objects(bucket_id, name) VALUES ('media-library', $1)",
          [name],
        );
      await as(ids.bm1);
      await db.query("SELECT public.move_media_photos($1::jsonb, $2::jsonb, true)", [
        json([{ source: "event", id: page }]),
        json({ album_id: album }),
      ]);
      await as(ids.vol1);
      const after = await one<{ photos: Photo[] }>("SELECT public.get_media_highlights($1) v", [
        ids.b1,
      ]);
      expect(after.photos.map((p) => [p.id, p.source])).toEqual([
        [page, "library"],
        [lib, "library"],
      ]);
      await as(ids.bm1);
      await db.query("SELECT public.set_media_highlight('library', $1, false)", [lib]);
      await as(ids.vol1);
      expect(
        (await one<{ photos: Photo[] }>("SELECT public.get_media_highlights($1) v", [ids.b1]))
          .photos,
      ).toHaveLength(1);
    }));
});

describe("download requests", () => {
  const files = async (request: string, user: string) => {
    await as(null);
    return one<{ state: string; files?: { path: string; bucket: string }[] }>(
      "SELECT public.media_download_files($1, $2) v",
      [request, user],
    );
  };

  it("volunteers and trustees request; files only after approval, for the requester, inside 24 hours", () =>
    tx(async () => {
      await as(ids.bm1);
      const album = await one<string>("SELECT public.create_media_album($1, $2::jsonb) v", [
        ids.b1,
        json({ title: "D" }),
      ]);
      const a = await bmPhoto({ album_id: album }, 80);
      const b = await bmPhoto({ album_id: album }, 81);
      // Managers download directly; they do not request.
      await as(ids.bm1);
      await fails(
        "SELECT public.request_media_download($1::jsonb)",
        [json([{ source: "library", id: a }])],
        "Not allowed",
      );
      // Another branch's volunteer cannot request this branch's photos.
      await as(ids.vol2);
      await fails(
        "SELECT public.request_media_download($1::jsonb)",
        [json([{ source: "library", id: a }])],
        "Not allowed",
      );
      await as(ids.tr1);
      const trusteeRequest = await one<string>(
        "SELECT public.request_media_download($1::jsonb, 'Annual report') v",
        [json([{ source: "library", id: a }])],
      );
      expect(trusteeRequest).toBeTruthy();
      await as(ids.vol1);
      const request = await one<string>(
        "SELECT public.request_media_download($1::jsonb, 'Newsletter') v",
        [
          json([
            { source: "library", id: a },
            { source: "library", id: b },
          ]),
        ],
      );
      expect((await files(request, ids.vol1)).state).toBe("submitted");
      await as(ids.bm1);
      expect(
        await one<{ downloads: number }>("SELECT public.get_review_waiting() v"),
      ).toMatchObject({ downloads: 2 });
      const review = await one<{ id: string; items: unknown[] }[]>(
        "SELECT public.list_media_download_requests('review') v",
      );
      expect(review.map((r) => r.id).sort()).toEqual([request, trusteeRequest].sort());
      await db.query("SELECT public.approve_media_download_request($1)", [request]);
      const ready = await files(request, ids.vol1);
      expect(ready.state).toBe("ready");
      expect(ready.files!.map((f) => f.path).sort()).toEqual(
        [`${ids.b1}/${a}.webp`, `${ids.b1}/${b}.webp`].sort(),
      );
      // Never for someone else, and not after the window.
      expect((await files(request, ids.vol1b)).state).toBe("not_found");
      await as(null);
      expect(
        await q(
          "SELECT kind, link FROM notifications WHERE user_id=$1 AND kind LIKE 'media_download_%'",
          [ids.vol1],
        ),
      ).toEqual([{ kind: "media_download_approved", link: `/media/download/${request}` }]);
      await db.query(
        "UPDATE media_download_requests SET expires_at = now() - interval '1 minute' WHERE id = $1",
        [request],
      );
      expect((await files(request, ids.vol1)).state).toBe("expired");
      await as(ids.vol1);
      expect(
        await one<{ expired: boolean }>("SELECT public.get_media_download($1) v", [request]),
      ).toMatchObject({
        expired: true,
        status: "approved",
      });
      // Decline with a reason: the trustee is told.
      await as(ids.bm1);
      await db.query("SELECT public.decline_media_download_request($1, 'Not this one')", [
        trusteeRequest,
      ]);
      await as(null);
      expect(
        await q(
          "SELECT kind, payload->>'reason' AS reason FROM notifications WHERE user_id=$1 AND kind LIKE 'media_download_%'",
          [ids.tr1],
        ),
      ).toEqual([{ kind: "media_download_declined", reason: "Not this one" }]);
      expect((await files(trusteeRequest, ids.tr1)).state).toBe("declined");
      // Clients never call the file listing.
      expect(
        await one<boolean>(
          "SELECT has_function_privilege('authenticated', 'public.media_download_files(uuid,uuid)', 'EXECUTE') v",
        ),
      ).toBe(false);
    }));
});

describe("post-event nudge", () => {
  // 09:30 London today, and the run one hour later (outside the London 09:00 hour).
  const nineThirty =
    "(date_trunc('day', now() AT TIME ZONE 'Europe/London') + interval '9 hours 30 minutes') AT TIME ZONE 'Europe/London'";

  it("the day after: volunteers who attended or were assigned get one 'Share your photos' notice, once", () =>
    tx(async () => {
      await as(null);
      await db.exec("SET session_replication_role = replica");
      const ev = (
        await q<{ id: string }>(
          `INSERT INTO public.events (title, organizer, category, scope, branch_id, region_id, status, start_at, end_at, location,
             location_type, audience, registration_enabled)
           VALUES ('Christmas Dinner', 'DS', 'dinner', 'branch', $1, $2, 'published', (${nineThirty}) - interval '21 hours',
             (${nineThirty}) - interval '19 hours', 'Hall', 'in_person', 'members', true) RETURNING id`,
          [ids.b1, ids.region],
        )
      )[0]!.id;
      await db.query(
        "INSERT INTO event_registrations(event_id, user_id, status) VALUES ($1,$2,'attended'), ($1,$3,'attended'), ($1,$4,'registered')",
        [ev, ids.vol1, ids.tr1, ids.bm1],
      );
      const task = (
        await q<{ id: string }>(
          "INSERT INTO tasks(scope, branch_id, region_id, title, created_by, event_id) VALUES ('branch',$1,$2,'Set up chairs',$3,$4) RETURNING id",
          [ids.b1, ids.region, ids.bm1, ev],
        )
      )[0]!.id;
      await db.query(
        "INSERT INTO task_assignees(task_id, user_id, assigned_by) VALUES ($1,$2,$3)",
        [task, ids.vol1b, ids.bm1],
      );
      await db.exec("SET session_replication_role = origin");

      expect(
        await one<number>(`SELECT public.run_media_nudges((${nineThirty}) + interval '1 hour') v`),
      ).toBe(0);
      expect(await one<number>(`SELECT public.run_media_nudges(${nineThirty}) v`)).toBe(2);
      expect(await one<number>(`SELECT public.run_media_nudges(${nineThirty}) v`)).toBe(0);
      const notices = await q<{ user_id: string; kind: string; link: string }>(
        "SELECT user_id, kind, link FROM notifications WHERE kind = 'media_photo_nudge' ORDER BY user_id",
      );
      // The attending volunteer and the assigned one; not the trustee, not the Branch Manager.
      expect(notices.map((n) => n.user_id).sort()).toEqual([ids.vol1, ids.vol1b].sort());
      expect(notices[0]!.link).toBe(`/media?request=event:${ev}`);
      expect(await one<string>("SELECT public.notification_type('media_photo_nudge') v")).toBe(
        "media",
      );
      expect(
        await one<Row>("SELECT public.notification_setting($1, 'media') v", [ids.vol1]),
      ).toEqual({
        enabled: true,
        email: false,
        push: true,
      });
    }));
});

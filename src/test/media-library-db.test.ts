import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { initializeRecycleDatabase, PRIVACY_VERSION } from "./recycle-db-fixture";

// The Media tab, part 1 (20261216090000_media_library.sql), against every migration in PGlite: one members-only
// gallery per branch (event photos + albums), never another branch's; managers (BM, the region's RD) create albums and
// upload directly; volunteers send upload requests whose files nobody else sees until approval; trustees only read;
// approve all / some / decline discard the other files (paths returned for Storage, rows cleared once the files are
// gone); duplicates (same hash in the same album or event) are skipped; the review notice counts the requests; the
// full-size original of a library photo is readable only by managers (Storage policy). Each test is rolled back.
const db = new PGlite();
const id = (n: number) => {
  const h = n.toString(16).padStart(2, "0");
  return `${h.repeat(4)}-${h.repeat(2)}-4${h}${h[0]}-8${h}${h[0]}-${h.repeat(6)}`;
};
const ids = {
  region: id(1),
  b1: id(2),
  b2: id(3),
  region2: id(4),
  b3: id(5),
  rd: id(10),
  bm1: id(11),
  vol1: id(12),
  vol1b: id(13),
  tr1: id(14),
  vol2: id(15),
  bm2: id(16),
  nc: id(17),
  fol: id(18),
  rd2: id(19),
};
const hash = (n: number) => n.toString(16).padStart(64, "0");
type Row = Record<string, unknown>;
type Photo = { id: string; source: string; original: string | null; w640: string | null };
type Chapter = {
  kind: string;
  id: string;
  title: string;
  photo_count: number;
  photos: Photo[];
  unseen: boolean;
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
/** Upload as the current user through the Storage policy (original + copies). */
async function store(path: string) {
  for (const name of [path, ...variants(path)])
    await db.query("INSERT INTO storage.objects(bucket_id, name) VALUES ('media-library', $1)", [
      name,
    ]);
}
/** What the current user can read in the bucket (Storage policy). */
async function readable(names: string[]) {
  return (
    await q<{ name: string }>(
      "SELECT name FROM storage.objects WHERE bucket_id='media-library' AND name = ANY($1) ORDER BY name",
      [names],
    )
  ).map((r) => r.name);
}
/** The server's Storage removal after a delete/decision (service role), then the row cleanup. */
async function removeFiles(paths: string[]) {
  await as(null);
  await db.query("DELETE FROM storage.objects WHERE bucket_id='media-library' AND name = ANY($1)", [
    paths,
  ]);
  return one<Row>("SELECT public.clear_deleted_media() v");
}
async function bmPhoto(target: Row, n: number, branch = ids.b1) {
  const r = await one<{ id: string; path: string }>(
    "SELECT public.add_media_photo($1, $2::jsonb, 'jpg', 'photo.jpg', $3) v",
    [branch, json(target), hash(n)],
  );
  await store(r.path);
  await db.query("SELECT public.finish_media_photo($1, 1600, 1200)", [r.id]);
  return r;
}
async function volunteerRequest(target: Row, hashes: number[], user = ids.vol1) {
  await as(user);
  const req = await one<string>("SELECT public.create_media_upload_request($1::jsonb) v", [
    json({ ...target, note: "From the evening" }),
  ]);
  const files: { id: string; path: string }[] = [];
  for (const n of hashes) {
    const f = await one<{ id: string; path: string; duplicate: boolean }>(
      "SELECT public.add_media_upload_file($1, 'png', 'p.png', $2) v",
      [req, hash(n)],
    );
    if (f.duplicate) continue;
    await store(f.path);
    await db.query("SELECT public.finish_media_upload_file($1, 800, 600)", [f.id]);
    files.push(f);
  }
  await db.query("SELECT public.submit_media_upload_request($1)", [req]);
  return { req, files };
}
const chapters = async (user: string, branch = ids.b1) => {
  await as(user);
  return (await one<{ chapters: Chapter[] }>("SELECT public.get_media_chapters($1) v", [branch]))
    .chapters;
};
let ev1 = "";
let ev2 = "";
let evDraft = "";

beforeAll(async () => {
  await initializeRecycleDatabase(db);
  const people = Object.entries(ids).filter(
    ([k]) => !["region", "b1", "b2", "region2", "b3", "fol"].includes(k),
  );
  await db.exec(`INSERT INTO regions(id,name) VALUES ('${ids.region}','Region T'),('${ids.region2}','North T');
    INSERT INTO branches(id,name,region_id) VALUES ('${ids.b1}','Medway Test','${ids.region}'),('${ids.b2}','Other Test','${ids.region}'),
      ('${ids.b3}','Far Test','${ids.region2}');
    INSERT INTO auth.users(id, raw_user_meta_data) VALUES ${people
      .map(
        ([k, v]) =>
          `('${v}', jsonb_build_object('full_name','Person ${k}','privacy_notice_version','${PRIVACY_VERSION}'))`,
      )
      .join(",")};
    UPDATE profiles SET status='active';
    UPDATE profiles SET branch_id='${ids.b1}' WHERE id IN ('${ids.bm1}','${ids.vol1}','${ids.vol1b}','${ids.tr1}');
    UPDATE profiles SET branch_id='${ids.b2}' WHERE id IN ('${ids.vol2}','${ids.bm2}');
    UPDATE profiles SET branch_id=NULL WHERE id IN ('${ids.rd}','${ids.nc}','${ids.rd2}');
    UPDATE user_roles SET role='branch_manager' WHERE user_id IN ('${ids.bm1}','${ids.bm2}');
    UPDATE user_roles SET role='trustee' WHERE user_id='${ids.tr1}';
    UPDATE user_roles SET role='regional_director', region_id='${ids.region}' WHERE user_id='${ids.rd}';
    UPDATE user_roles SET role='regional_director', region_id='${ids.region2}' WHERE user_id='${ids.rd2}';
    UPDATE user_roles SET role='national_coordinator' WHERE user_id='${ids.nc}';`);
  await db.query(
    "INSERT INTO auth.users(id, email, raw_user_meta_data) VALUES ($1, 'fol@example.test', jsonb_build_object('full_name', 'Fay', 'privacy_notice_version', $2::text, 'branch_id', $3::text, 'follower', true))",
    [ids.fol, PRIVACY_VERSION, ids.b1],
  );
  await db.exec("SET session_replication_role = replica");
  const event = async (branch: string, title: string, status: string, days: number) =>
    (
      await q<{ id: string }>(
        `INSERT INTO public.events (title, organizer, category, scope, branch_id, region_id, status, start_at, end_at, location,
           location_type, audience, registration_enabled)
         VALUES ($1, 'Dialogue Society', 'dinner', 'branch', $2, $3, $4, now() - make_interval(days => $5),
           now() - make_interval(days => $5) + interval '2 hours', 'Rochester Cathedral', 'in_person', 'public', true) RETURNING id`,
        [title, branch, ids.region, status, days],
      )
    )[0]!.id;
  ev1 = await event(ids.b1, "Iftar Dinner", "published", 10);
  ev2 = await event(ids.b2, "Other branch dinner", "published", 5);
  evDraft = await event(ids.b1, "Draft plan", "draft", 3);
  for (const [e, n] of [
    [ev1, 1],
    [ev2, 2],
    [evDraft, 3],
  ] as const) {
    const path = `${e}/${id(100 + n)}.jpg`;
    await db.query(
      "INSERT INTO event_media(id, event_id, storage_path, kind, position, has_variants, width, height) VALUES ($1,$2,$3,'image',0,true,1600,1200)",
      [id(100 + n), e, path],
    );
    for (const name of [path, ...variants(path)])
      await db.query("INSERT INTO storage.objects(bucket_id, name) VALUES ('event-media', $1)", [
        name,
      ]);
  }
  await db.exec("SET session_replication_role = origin");
}, 60000);
afterAll(async () => db.close());

describe("who sees the gallery", () => {
  it("branch members, trustees and the region's RD see the branch; never another branch, followers or NCs", () =>
    tx(async () => {
      await as(ids.bm1);
      const album = await one<string>("SELECT public.create_media_album($1, $2::jsonb) v", [
        ids.b1,
        json({ title: "Volunteer meet-ups" }),
      ]);
      await bmPhoto({ album_id: album }, 10);
      await as(ids.bm2);
      const other = await one<string>("SELECT public.create_media_album($1, $2::jsonb) v", [
        ids.b2,
        json({ title: "Other album" }),
      ]);
      await bmPhoto({ album_id: other }, 11, ids.b2);

      for (const user of [ids.bm1, ids.vol1, ids.tr1, ids.rd]) {
        const list = await chapters(user);
        expect(list.map((c) => c.title).sort()).toEqual(["Iftar Dinner", "Volunteer meet-ups"]);
      }
      // The other branch's public event and album never appear in Medway's gallery.
      const titles = (await chapters(ids.vol1)).map((c) => c.title);
      expect(titles).not.toContain("Other branch dinner");
      expect(titles).not.toContain("Other album");
      // ...and Medway members cannot open the other branch's gallery at all.
      for (const user of [ids.vol1, ids.tr1, ids.bm1]) {
        await as(user);
        await fails("SELECT public.get_media_chapters($1)", [ids.b2], "Not allowed");
        await fails("SELECT public.get_media_chapter('album', $1)", [other], "Chapter not found");
        await fails("SELECT public.get_media_chapter('event', $1)", [ev2], "Chapter not found");
      }
      await as(ids.fol);
      await fails("SELECT public.get_media_home()", [], "Not allowed");
      await fails("SELECT public.get_media_chapters($1)", [ids.b1], "Not allowed");
      // Another region's RD sees only their own region's branches.
      await as(ids.rd2);
      expect(
        (
          await one<{ branches: { name: string }[] }>("SELECT public.get_media_home($1) v", [
            ids.b1,
          ])
        ).branches.map((b) => b.name),
      ).toEqual(["Far Test"]);
      await fails("SELECT public.get_media_chapters($1)", [ids.b1], "Not allowed");
      await as(ids.nc, "aal2");
      await fails("SELECT public.get_media_home()", [], "Not allowed");
      // The RD chooses among the region's branches.
      await as(ids.rd);
      const home = await one<{ branches: { name: string }[]; can_manage: boolean }>(
        "SELECT public.get_media_home($1) v",
        [ids.b1],
      );
      expect(home.branches.map((b) => b.name)).toEqual(["Medway Test", "Other Test"]);
      expect(home.can_manage).toBe(true);
    }));

  it("drafts are not chapters; volunteers get only the copies of library photos, managers the original too", () =>
    tx(async () => {
      await as(ids.bm1);
      const album = await one<string>("SELECT public.create_media_album($1, $2::jsonb) v", [
        ids.b1,
        json({ title: "Ramadan 2026", date: "2026-03-01", description: "Evenings" }),
      ]);
      const p = await bmPhoto({ album_id: album }, 20);
      const all = [p.path, ...variants(p.path)].sort();
      expect(await readable(all)).toEqual(all);
      const bmChapter = await one<Chapter>("SELECT public.get_media_chapter('album', $1) v", [
        album,
      ]);
      expect(bmChapter.photos[0]!.original).toBe(p.path);

      for (const user of [ids.vol1, ids.tr1]) {
        await as(user);
        expect(await readable(all)).toEqual(variants(p.path).sort());
        const c = await one<Chapter>("SELECT public.get_media_chapter('album', $1) v", [album]);
        expect(c.photos[0]!.original).toBeNull();
        expect(c.photos[0]!.w640).toBe(variants(p.path)[0]);
      }
      await as(ids.vol2);
      expect(await readable(all)).toEqual([]);
      expect((await chapters(ids.bm1)).map((c) => c.title)).not.toContain("Draft plan");
    }));
});

describe("direct uploads and albums (managers only)", () => {
  it("volunteers and trustees cannot create albums, upload, delete or reorder", () =>
    tx(async () => {
      await as(ids.bm1);
      const album = await one<string>("SELECT public.create_media_album($1, $2::jsonb) v", [
        ids.b1,
        json({ title: "Peace Walk" }),
      ]);
      const p = await bmPhoto({ album_id: album }, 30);
      for (const user of [ids.vol1, ids.tr1, ids.bm2]) {
        await as(user);
        await fails(
          "SELECT public.create_media_album($1, $2::jsonb)",
          [ids.b1, json({ title: "X" })],
          "Not allowed",
        );
        await fails(
          "SELECT public.add_media_photo($1, $2::jsonb, 'jpg', 'x.jpg', $3)",
          [ids.b1, json({ album_id: album }), hash(31)],
          "Not allowed",
        );
        await fails("SELECT public.delete_media_photos($1)", [[p.id]], "Not allowed");
        await fails("SELECT public.delete_media_album($1)", [album], "Not allowed");
        await fails("SELECT public.set_media_album_cover($1, $2)", [album, p.id], "Not allowed");
        await fails(
          "SELECT public.update_media_album($1, $2::jsonb)",
          [album, json({ title: "Y" })],
          "Not allowed",
        );
        // Storage: no upload into the branch's folder without a reservation they may write.
        await fails(
          "INSERT INTO storage.objects(bucket_id, name) VALUES ('media-library', $1)",
          [`${ids.b1}/${id(77)}.jpg`],
          "row-level security",
        );
      }
      // A trustee cannot send upload requests either.
      await as(ids.tr1);
      await fails(
        "SELECT public.create_media_upload_request($1::jsonb)",
        [json({ album_id: album })],
        "Not allowed",
      );
    }));

  it("order, cover (default first photo), duplicates refused, deletion through Storage first", () =>
    tx(async () => {
      await as(ids.bm1);
      const album = await one<string>("SELECT public.create_media_album($1, $2::jsonb) v", [
        ids.b1,
        json({ title: "Christmas Dinner" }),
      ]);
      const a = await bmPhoto({ album_id: album }, 40);
      const b = await bmPhoto({ album_id: album }, 41);
      expect(
        await one<Row>("SELECT public.add_media_photo($1, $2::jsonb, 'jpg', 'again.jpg', $3) v", [
          ids.b1,
          json({ album_id: album }),
          hash(40),
        ]),
      ).toEqual({ duplicate: true });
      // The same photo may go into another album.
      const other = await one<string>("SELECT public.create_media_album($1, $2::jsonb) v", [
        ids.b1,
        json({ title: "Another" }),
      ]);
      expect(
        (
          await one<Row>("SELECT public.add_media_photo($1, $2::jsonb, 'jpg', 'again.jpg', $3) v", [
            ids.b1,
            json({ album_id: other }),
            hash(40),
          ])
        )["duplicate"],
      ).toBe(false);
      let c = await one<Chapter>("SELECT public.get_media_chapter('album', $1) v", [album]);
      expect(c.photos.map((p) => p.id)).toEqual([a.id, b.id]);
      await db.query("SELECT public.reorder_media_photos($1, $2)", [album, [b.id, a.id]]);
      await db.query("SELECT public.set_media_album_cover($1, $2)", [album, a.id]);
      c = await one<Chapter>("SELECT public.get_media_chapter('album', $1) v", [album]);
      expect(c.photos.map((p) => p.id)).toEqual([a.id, b.id]); // the cover leads
      await db.query("SELECT public.set_media_album_cover($1, NULL)", [album]);
      c = await one<Chapter>("SELECT public.get_media_chapter('album', $1) v", [album]);
      expect(c.photos.map((p) => p.id)).toEqual([b.id, a.id]);

      const del = await one<{ paths: string[] }>("SELECT public.delete_media_photos($1) v", [
        [b.id],
      ]);
      expect(del.paths.sort()).toEqual([b.path, ...variants(b.path)].sort());
      c = await one<Chapter>("SELECT public.get_media_chapter('album', $1) v", [album]);
      expect(c.photos.map((p) => p.id)).toEqual([a.id]); // hidden at once
      expect(await removeFiles(del.paths)).toMatchObject({ photos: 1 });

      await as(ids.bm1);
      const gone = await one<{ paths: string[] }>("SELECT public.delete_media_album($1) v", [
        album,
      ]);
      expect(gone.paths).toHaveLength(3);
      await fails("SELECT public.get_media_chapter('album', $1)", [album], "Chapter not found");
      expect(await removeFiles(gone.paths)).toMatchObject({ photos: 1, albums: 1 });
    }));
});

describe("upload requests", () => {
  it("pending files are seen only by the requester and the reviewers; approve all into an event", () =>
    tx(async () => {
      const { req, files } = await volunteerRequest({ event_id: ev1 }, [50, 51]);
      const paths = files.flatMap((f) => [f.path, ...variants(f.path)]).sort();
      await as(ids.vol1);
      expect(await readable(paths)).toEqual(paths);
      for (const user of [ids.vol1b, ids.tr1, ids.bm2, ids.vol2]) {
        await as(user);
        expect(await readable(paths)).toEqual([]);
        await fails("SELECT public.get_media_upload_request($1)", [req], "Request not found");
      }
      // Nothing shows in the gallery yet.
      const before = (await chapters(ids.vol1b)).find((c) => c.id === ev1)!;
      expect(before.photo_count).toBe(1);
      // The volunteer cannot approve their own request; the reviewers see it and get the review notice.
      await as(ids.vol1);
      await fails(
        "SELECT public.approve_media_upload_request($1, $2)",
        [req, [files[0]!.id]],
        "Not allowed",
      );
      await as(ids.bm1);
      expect(await readable(paths)).toEqual(paths);
      expect(await one<{ media: number }>("SELECT public.get_review_waiting() v")).toMatchObject({
        media: 1,
      });
      await as(null);
      expect(
        await one<number>(
          "SELECT count(*)::int v FROM notifications WHERE user_id=$1 AND kind='review_waiting' AND read_at IS NULL",
          [ids.bm1],
        ),
      ).toBe(1);
      await as(ids.bm1);
      const review = await one<{ id: string; files: unknown[] }[]>(
        "SELECT public.list_media_upload_requests('review') v",
      );
      expect(review.map((r) => r.id)).toEqual([req]);
      const result = await one<{ added: number; skipped: number; paths: string[] }>(
        "SELECT public.approve_media_upload_request($1, $2) v",
        [req, files.map((f) => f.id)],
      );
      expect(result).toMatchObject({ added: 2, skipped: 0, paths: [] });
      const after = (await chapters(ids.vol1b)).find((c) => c.id === ev1)!;
      expect(after.photo_count).toBe(3);
      await as(null);
      expect(
        await q("SELECT kind FROM notifications WHERE user_id=$1 AND kind LIKE 'media_upload_%'", [
          ids.vol1,
        ]),
      ).toEqual([{ kind: "media_upload_approved" }]);
      expect(
        await one<number>(
          "SELECT count(*)::int v FROM notifications WHERE user_id=$1 AND kind='review_waiting' AND read_at IS NULL",
          [ids.bm1],
        ),
      ).toBe(0);
      // Approved photos: copies for every member, the original only for managers.
      await as(ids.vol1b);
      expect(await readable(paths)).toEqual(files.flatMap((f) => variants(f.path)).sort());
    }));

  it("partial approval into a proposed album: deselected files are discarded and cleared after Storage", () =>
    tx(async () => {
      const { req, files } = await volunteerRequest(
        { proposed_title: "Volunteer picnic" },
        [60, 61, 62],
      );
      await as(ids.bm1);
      const result = await one<{ album_id: string; added: number; paths: string[] }>(
        "SELECT public.approve_media_upload_request($1, $2, 'Summer picnic') v",
        [req, [files[0]!.id, files[2]!.id]],
      );
      expect(result.added).toBe(2);
      expect(result.paths.sort()).toEqual([files[1]!.path, ...variants(files[1]!.path)].sort());
      const c = await one<Chapter>("SELECT public.get_media_chapter('album', $1) v", [
        result.album_id,
      ]);
      expect(c.title).toBe("Summer picnic");
      expect(c.photos.map((p) => p.id)).toEqual([files[0]!.id, files[2]!.id]);
      // The discarded file is unreadable at once, and its row goes once Storage no longer has it.
      await as(ids.vol1);
      expect(await readable([files[1]!.path])).toEqual([]);
      expect(await removeFiles(result.paths)).toMatchObject({ files: 1 });
      expect(
        await one<number>("SELECT count(*)::int v FROM media_upload_files WHERE request_id=$1", [
          req,
        ]),
      ).toBe(0);
    }));

  it("decline: every file is discarded, the requester is told with the reason", () =>
    tx(async () => {
      const { req, files } = await volunteerRequest({ event_id: ev1 }, [70, 71]);
      await as(ids.rd);
      const result = await one<{ paths: string[] }>(
        "SELECT public.decline_media_upload_request($1, 'Blurry') v",
        [req],
      );
      expect(result.paths).toHaveLength(6);
      await as(ids.vol1);
      expect(await readable(files.map((f) => f.path))).toEqual([]);
      const mine = await one<{ status: string; decline_reason: string }[]>(
        "SELECT public.list_media_upload_requests('mine') v",
      );
      expect(mine[0]).toMatchObject({ status: "declined", decline_reason: "Blurry" });
      await as(null);
      expect(
        await q(
          "SELECT kind, payload->>'reason' AS reason FROM notifications WHERE user_id=$1 AND kind LIKE 'media_upload_%'",
          [ids.vol1],
        ),
      ).toEqual([{ kind: "media_upload_declined", reason: "Blurry" }]);
      expect(await removeFiles(result.paths)).toMatchObject({ files: 2 });
      await as(ids.bm1);
      await fails(
        "SELECT public.approve_media_upload_request($1, $2)",
        [req, [files[0]!.id]],
        "already decided",
      );
    }));

  it("duplicates: refused at reservation, skipped at approval; at most 20 files", () =>
    tx(async () => {
      await as(ids.bm1);
      const album = await one<string>("SELECT public.create_media_album($1, $2::jsonb) v", [
        ids.b1,
        json({ title: "Meet-ups" }),
      ]);
      await bmPhoto({ album_id: album }, 80);
      // 80 is already in the album; 81 twice in one request counts once.
      const { req, files } = await volunteerRequest({ album_id: album }, [80, 81, 81, 82]);
      expect(files).toHaveLength(2);
      // Meanwhile the manager adds 82 directly: approval skips it.
      await as(ids.bm1);
      await bmPhoto({ album_id: album }, 82);
      const result = await one<{ added: number; skipped: number; paths: string[] }>(
        "SELECT public.approve_media_upload_request($1, $2) v",
        [req, files.map((f) => f.id)],
      );
      expect(result).toMatchObject({ added: 1, skipped: 1 });
      expect(result.paths).toHaveLength(3);
      // The event's own file hash counts too.
      await as(null);
      await db.query("UPDATE event_media SET content_hash=$1 WHERE id=$2", [hash(90), id(101)]);
      await as(ids.vol1);
      const req2 = await one<string>("SELECT public.create_media_upload_request($1::jsonb) v", [
        json({ event_id: ev1 }),
      ]);
      expect(
        await one<Row>("SELECT public.add_media_upload_file($1, 'jpg', 'x.jpg', $2) v", [
          req2,
          hash(90),
        ]),
      ).toEqual({ duplicate: true });
      for (let n = 0; n < 20; n++)
        await db.query("SELECT public.add_media_upload_file($1, 'jpg', 'x.jpg', $2)", [
          req2,
          hash(200 + n),
        ]);
      await fails(
        "SELECT public.add_media_upload_file($1, 'jpg', 'x.jpg', $2)",
        [req2, hash(300)],
        "Maximum 20 photos per request",
      );
      // Unfinished files are dropped on submit; a request needs one stored photo.
      await fails(
        "SELECT public.submit_media_upload_request($1)",
        [req2],
        "Add at least one photo",
      );
    }));

  it("others' requests stay private; other branches' events and albums cannot be targets", () =>
    tx(async () => {
      const { req } = await volunteerRequest({ event_id: ev1 }, [95]);
      await as(ids.vol1b);
      expect(await one<unknown[]>("SELECT public.list_media_upload_requests('mine') v")).toEqual(
        [],
      );
      expect(await one<unknown[]>("SELECT public.list_media_upload_requests('review') v")).toEqual(
        [],
      );
      await fails(
        "SELECT public.add_media_upload_file($1, 'jpg', 'x.jpg', $2)",
        [req, hash(96)],
        "Not allowed",
      );
      await fails("SELECT public.withdraw_media_upload_request($1)", [req], "Not allowed");
      await fails(
        "SELECT public.create_media_upload_request($1::jsonb)",
        [json({ event_id: ev2 })],
        "Event not found",
      );
      await fails(
        "SELECT public.create_media_upload_request($1::jsonb)",
        [json({ event_id: evDraft })],
        "Event not found",
      );
      await as(ids.bm2);
      await fails("SELECT public.approve_media_upload_request($1, $2)", [req, []], "Not allowed");
      // Withdrawn by the requester: files discarded.
      await as(ids.vol1);
      const w = await one<{ paths: string[] }>(
        "SELECT public.withdraw_media_upload_request($1) v",
        [req],
      );
      expect(w.paths).toHaveLength(3);
    }));

  it("a soft-deleted requester's open requests are withdrawn and their files swept", () =>
    tx(async () => {
      const { req, files } = await volunteerRequest({ event_id: ev1 }, [97]);
      await as(null);
      await db.query("UPDATE profiles SET deleted_at = now() WHERE id=$1", [ids.vol1]);
      expect(
        await one<string>("SELECT status v FROM media_upload_requests WHERE id=$1", [req]),
      ).toBe("withdrawn");
      const sweep = await one<{ paths: string[] }>("SELECT public.media_cleanup_paths() v");
      expect(sweep.paths.sort()).toEqual([files[0]!.path, ...variants(files[0]!.path)].sort());
      expect(await removeFiles(sweep.paths)).toMatchObject({ files: 1 });
    }));
});

describe("viewed markers", () => {
  it("a chapter is unseen until the member opens it, and again when photos are added", () =>
    tx(async () => {
      let c = (await chapters(ids.vol1)).find((x) => x.id === ev1)!;
      expect(c.unseen).toBe(true);
      await db.query("SELECT public.mark_media_chapter_viewed('event', $1)", [ev1]);
      c = (await chapters(ids.vol1)).find((x) => x.id === ev1)!;
      expect(c.unseen).toBe(false);
      await as(ids.bm1);
      await bmPhoto({ event_id: ev1 }, 98);
      c = (await chapters(ids.vol1)).find((x) => x.id === ev1)!;
      expect(c.unseen).toBe(true);
      await as(ids.vol1);
      await fails(
        "SELECT public.mark_media_chapter_viewed('event', $1)",
        [ev2],
        "Chapter not found",
      );
    }));
});

describe("grants", () => {
  it("no table privileges for clients; cleanup only for the service role", async () => {
    const rows = await q<{ t: string; ok: boolean }>(
      `SELECT t, has_table_privilege('authenticated', 'public.' || t, 'SELECT') OR has_table_privilege('anon', 'public.' || t, 'SELECT') ok
       FROM unnest(ARRAY['media_albums','media_photos','media_upload_requests','media_upload_files','media_chapter_views']) t`,
    );
    expect(rows.filter((r) => r.ok)).toEqual([]);
    for (const fn of [
      "media_cleanup_paths()",
      "clear_deleted_media()",
      "media_branch_photos(uuid)",
    ])
      expect(
        await one<boolean>(
          `SELECT has_function_privilege('authenticated', 'public.${fn}', 'EXECUTE') v`,
        ),
      ).toBe(false);
    expect(
      await one<boolean>(
        "SELECT has_function_privilege('anon', 'public.get_media_chapters(uuid,text,integer,text,timestamptz,uuid,integer)', 'EXECUTE') v",
      ),
    ).toBe(false);
  });
});

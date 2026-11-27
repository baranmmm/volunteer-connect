import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { initializeRecycleDatabase, PRIVACY_VERSION } from "./recycle-db-fixture";

// Media for followers (20261219090000_media_followers.sql), against every migration in PGlite: a follower sees,
// read-only, the Media of the branches they follow (public events that have started and albums; never members-only
// events), never another branch's; they get only the copies; they cannot upload, request uploads or downloads, star,
// move or delete. Each test is rolled back.
const db = new PGlite();
const id = (n: number) => {
  const h = n.toString(16).padStart(2, "0");
  return `${h.repeat(4)}-${h.repeat(2)}-4${h}${h[0]}-8${h}${h[0]}-${h.repeat(6)}`;
};
const ids = {
  region: id(1),
  b1: id(2),
  b2: id(3),
  bm1: id(11),
  vol1: id(12),
  folA: id(20), // follows Medway
  folB: id(21), // follows Other only
  folAB: id(22), // follows Other first, then Medway
};
const hash = (n: number) => n.toString(16).padStart(64, "0");
type Row = Record<string, unknown>;
type Chapter = {
  kind: string;
  id: string;
  title: string;
  photos: { id: string; original: string | null }[];
};

async function as(user: string | null) {
  await db.exec("RESET ROLE");
  await db.query(
    "SELECT set_config('request.jwt.claim.sub',$1,true), set_config('request.jwt.claim.aal','aal1',true)",
    [user ?? ""],
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
async function event(title: string, audience: "public" | "members") {
  await as(null);
  await db.exec("SET session_replication_role = replica");
  const e = (
    await q<{ id: string }>(
      `INSERT INTO public.events (title, organizer, category, scope, branch_id, region_id, status, start_at, end_at, location,
         location_type, audience, registration_enabled)
       VALUES ($1, 'DS', 'dinner', 'branch', $2, $3, 'published', now() - interval '3 days', now() - interval '3 days' + interval '2 hours',
         'Hall', 'in_person', $4, true) RETURNING id`,
      [title, ids.b1, ids.region, audience],
    )
  )[0]!.id;
  await db.exec("SET session_replication_role = origin");
  return e;
}
/** A photo uploaded by the Branch Manager into an album or event chapter (stored with its copies). */
async function bmPhoto(target: Row, n: number) {
  await as(ids.bm1);
  const r = await one<{ id: string; path: string }>(
    "SELECT public.add_media_photo($1, $2::jsonb, 'webp', 'p.webp', $3) v",
    [ids.b1, json(target), hash(n)],
  );
  for (const name of [r.path, ...variants(r.path)])
    await db.query("INSERT INTO storage.objects(bucket_id, name) VALUES ('media-library', $1)", [
      name,
    ]);
  await db.query("SELECT public.finish_media_photo($1, 1600, 1200)", [r.id]);
  return r;
}

beforeAll(async () => {
  await initializeRecycleDatabase(db);
  await db.exec(`INSERT INTO regions(id,name) VALUES ('${ids.region}','Region F');
    INSERT INTO branches(id,name,region_id) VALUES ('${ids.b1}','Medway F','${ids.region}'),('${ids.b2}','Other F','${ids.region}');
    INSERT INTO auth.users(id, raw_user_meta_data) VALUES
      ('${ids.bm1}', jsonb_build_object('full_name','BM','privacy_notice_version','${PRIVACY_VERSION}')),
      ('${ids.vol1}', jsonb_build_object('full_name','Vol','privacy_notice_version','${PRIVACY_VERSION}'));
    UPDATE profiles SET status='active', branch_id='${ids.b1}' WHERE id IN ('${ids.bm1}','${ids.vol1}');
    UPDATE user_roles SET role='branch_manager' WHERE user_id='${ids.bm1}';`);
  for (const [user, branch] of [
    [ids.folA, ids.b1],
    [ids.folB, ids.b2],
    [ids.folAB, ids.b2],
  ] as const)
    await db.query(
      "INSERT INTO auth.users(id, email, raw_user_meta_data) VALUES ($1, $2, jsonb_build_object('full_name','Fol','privacy_notice_version',$3::text,'branch_id',$4::text,'follower',true))",
      [user, `${user}@example.test`, PRIVACY_VERSION, branch],
    );
  // folAB follows Medway too, later.
  await db.query(
    "INSERT INTO user_followed_branches(user_id, branch_id, created_at) VALUES ($1, $2, now() + interval '1 minute')",
    [ids.folAB, ids.b1],
  );
}, 60000);
afterAll(async () => db.close());

describe("followers see the Media of the branches they follow, read-only", () => {
  it("a follower of Medway sees its albums and public events, not members-only events; copies only", () =>
    tx(async () => {
      await as(ids.bm1);
      const album = await one<string>("SELECT public.create_media_album($1, $2::jsonb) v", [
        ids.b1,
        json({ title: "Meet-ups" }),
      ]);
      const albumPhoto = await bmPhoto({ album_id: album }, 1);
      const pub = await event("Open dinner", "public");
      await bmPhoto({ event_id: pub }, 2);
      const members = await event("Members night", "members");
      await bmPhoto({ event_id: members }, 3);

      await as(ids.folA);
      const home = await one<{ branch: { id: string }; can_manage: boolean; can_request: boolean }>(
        "SELECT public.get_media_home() v",
      );
      expect(home).toMatchObject({ branch: { id: ids.b1 }, can_manage: false, can_request: false });
      const chapters = (
        await one<{ chapters: Chapter[] }>("SELECT public.get_media_chapters($1) v", [ids.b1])
      ).chapters;
      expect(chapters.map((c) => c.title).sort()).toEqual(["Meet-ups", "Open dinner"]);
      expect(chapters.flatMap((c) => c.photos).every((p) => p.original === null)).toBe(true);
      await fails("SELECT public.get_media_chapter('event', $1)", [members], "Chapter not found");
      // Storage: the copies, never the original.
      const names = [albumPhoto.path, ...variants(albumPhoto.path)];
      const readable = (
        await q<{ name: string }>(
          "SELECT name FROM storage.objects WHERE bucket_id='media-library' AND name = ANY($1)",
          [names],
        )
      )
        .map((r) => r.name)
        .sort();
      expect(readable).toEqual(variants(albumPhoto.path).sort());
      // Viewed markers work for them (the stories ring).
      await db.query("SELECT public.mark_media_chapter_viewed('album', $1)", [album]);
    }));

  it("a follower of another branch sees nothing of Medway", () =>
    tx(async () => {
      await as(ids.bm1);
      const album = await one<string>("SELECT public.create_media_album($1, $2::jsonb) v", [
        ids.b1,
        json({ title: "Meet-ups" }),
      ]);
      const p = await bmPhoto({ album_id: album }, 4);
      await as(ids.folB);
      await fails("SELECT public.get_media_chapters($1)", [ids.b1], "Not allowed");
      await fails("SELECT public.get_media_chapter('album', $1)", [album], "Chapter not found");
      expect(
        await q(
          "SELECT name FROM storage.objects WHERE bucket_id='media-library' AND name = ANY($1)",
          [variants(p.path)],
        ),
      ).toEqual([]);
      const home = await one<{ branches: { id: string }[] }>("SELECT public.get_media_home() v");
      expect(home.branches.map((b) => b.id)).toEqual([ids.b2]);
    }));

  it("following several branches: a branch list, the first followed by default", () =>
    tx(async () => {
      await as(ids.folAB);
      const home = await one<{ branches: { id: string }[]; branch: { id: string } }>(
        "SELECT public.get_media_home() v",
      );
      expect(home.branches.map((b) => b.id).sort()).toEqual([ids.b1, ids.b2].sort());
      expect(home.branch.id).toBe(ids.b2); // followed first
      expect(
        (await one<{ branch: { id: string } }>("SELECT public.get_media_home($1) v", [ids.b1]))
          .branch.id,
      ).toBe(ids.b1);
    }));

  it("followers cannot upload, request uploads or downloads, star, move, delete; NCs and members of other branches unchanged", () =>
    tx(async () => {
      await as(ids.bm1);
      const album = await one<string>("SELECT public.create_media_album($1, $2::jsonb) v", [
        ids.b1,
        json({ title: "A" }),
      ]);
      const p = await bmPhoto({ album_id: album }, 5);
      await as(ids.folA);
      await fails(
        "SELECT public.create_media_upload_request($1::jsonb)",
        [json({ album_id: album })],
        "Not allowed",
      );
      await fails(
        "SELECT public.request_media_download($1::jsonb)",
        [json([{ source: "library", id: p.id }])],
        "Not allowed",
      );
      await fails("SELECT public.set_media_highlight('library', $1, true)", [p.id], "Not allowed");
      await fails(
        "SELECT public.add_media_photo($1, $2::jsonb, 'webp', 'x.webp', $3)",
        [ids.b1, json({ album_id: album }), hash(6)],
        "Not allowed",
      );
      await fails("SELECT public.delete_media_photos($1)", [[p.id]], "Not allowed");
      await fails(
        "SELECT public.move_media_photos($1::jsonb, $2::jsonb)",
        [json([{ source: "library", id: p.id }]), json({ album_id: album })],
        "Not allowed",
      );
      await fails("SELECT public.list_media_targets($1)", [ids.b1], "Not allowed");
      // A volunteer of the branch still requests downloads.
      await as(ids.vol1);
      expect(
        await one<string>("SELECT public.request_media_download($1::jsonb) v", [
          json([{ source: "library", id: p.id }]),
        ]),
      ).toBeTruthy();
    }));
});

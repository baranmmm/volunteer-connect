import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PRIVACY_VERSION, initializeRecycleDatabase } from "./recycle-db-fixture";

// can_read_event_file (Storage policy event_files_read) as an index lookup
// (20261220090000_event_file_read_index.sql): the same answers as the old full-scan version for every viewer and
// every kind of path, the same privileges, and an index the planner can use. Against every migration in PGlite.
const db = new PGlite();
const id = (n: number) =>
  `${String(n).padStart(8, "0")}-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ids = {
  r1: id(1),
  r2: id(2),
  b1: id(11),
  b2: id(12),
  b3: id(13),
  rd: id(21),
  bm1: id(22),
  vol1: id(23),
  vol2: id(24),
  nc: id(26),
  f1: id(28),
};
type Who = "rd" | "bm1" | "vol1" | "vol2" | "nc" | "f1";
const VIEWERS: Who[] = ["rd", "bm1", "vol1", "vol2", "nc", "f1"];

async function as(user: Who | null) {
  await db.exec("RESET ROLE");
  await db.query(
    "SELECT set_config('request.jwt.claim.sub',$1,false), set_config('request.jwt.claim.aal',$2,false)",
    [user ? ids[user] : "", user === "nc" ? "aal2" : "aal1"],
  );
  if (user) await db.exec("SET ROLE authenticated");
}

// The function as it was before the migration (20261203090000_public_perf_branch_map.sql).
const OLD = `CREATE FUNCTION public.test_old_can_read_event_file(_path text) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
  SELECT EXISTS (SELECT 1 FROM public.event_media WHERE (storage_path = _path OR (kind = 'image' AND _path = ANY (public.event_media_variant_paths(storage_path)))) AND public.can_view_event_media(event_id))
$f$;
GRANT EXECUTE ON FUNCTION public.test_old_can_read_event_file(text) TO authenticated;`;

const paths: string[] = [];

beforeAll(async () => {
  await initializeRecycleDatabase(db);
  await db.exec(`INSERT INTO regions(id,name) VALUES ('${ids.r1}','Read Region One'),('${ids.r2}','Read Region Two');
    INSERT INTO branches(id,name,region_id) VALUES ('${ids.b1}','Read Branch One','${ids.r1}'),('${ids.b2}','Read Branch Two','${ids.r1}'),('${ids.b3}','Read Branch Three','${ids.r2}');`);
  for (const key of ["rd", "bm1", "vol1", "vol2", "nc"] as const) {
    await db.query(
      "INSERT INTO auth.users(id, email, raw_user_meta_data) VALUES ($1, $2, jsonb_build_object('full_name', $3::text, 'privacy_notice_version', $4::text))",
      [ids[key], `${key}@example.test`, `Person ${key}`, PRIVACY_VERSION],
    );
  }
  await db.query(
    "INSERT INTO auth.users(id, email, raw_user_meta_data) VALUES ($1, 'f1@example.test', jsonb_build_object('full_name', 'Fay Follower', 'privacy_notice_version', $2::text, 'branch_id', $3::text, 'follower', true))",
    [ids.f1, PRIVACY_VERSION, ids.b1],
  );
  await db.exec(`UPDATE profiles SET status='active';
    UPDATE profiles SET branch_id='${ids.b1}' WHERE id IN ('${ids.bm1}','${ids.vol1}');
    UPDATE profiles SET branch_id='${ids.b2}' WHERE id='${ids.vol2}';
    UPDATE user_roles SET role='regional_director', region_id='${ids.r1}' WHERE user_id='${ids.rd}';
    UPDATE user_roles SET role='branch_manager' WHERE user_id='${ids.bm1}';
    UPDATE user_roles SET role='national_coordinator' WHERE user_id='${ids.nc}';`);
  await db.exec(OLD);

  // Events of every visibility: members/public, published/draft, three branches in two regions.
  const events: { branch: string; region: string; status: string; audience: string }[] = [
    { branch: ids.b1, region: ids.r1, status: "published", audience: "members" },
    { branch: ids.b1, region: ids.r1, status: "draft", audience: "public" },
    { branch: ids.b2, region: ids.r1, status: "published", audience: "members" },
    { branch: ids.b3, region: ids.r2, status: "published", audience: "public" },
    { branch: ids.b3, region: ids.r2, status: "draft", audience: "members" },
  ];
  for (const [n, e] of events.entries()) {
    const ev = await db.query<{ id: string }>(
      `INSERT INTO events (title, organizer, category, scope, branch_id, region_id, status, start_at, end_at, location, audience, created_by)
       VALUES ($1, 'DS', 'dialogue', 'branch', $2, $3, 'draft', now() + interval '5 days', now() + interval '5 days 2 hours', 'Hall', $4, $5) RETURNING id`,
      [`Read event ${n}`, e.branch, e.region, e.audience, ids.bm1],
    );
    const eventId = ev.rows[0]!.id;
    // Images with different extensions (and a dotted name), a PDF and a document; each image has two copies.
    const files: [string, string][] = [
      ["image", `${eventId}/${id(100 + n)}.webp`],
      ["image", `${eventId}/${id(200 + n)}.jpg`],
      ["image", `${eventId}/${id(300 + n)}.JPG`],
      ["image", `${eventId}/photo.v2.${n}.png`],
      ["pdf", `${eventId}/${id(400 + n)}.pdf`],
      ["document", `${eventId}/${id(500 + n)}.docx`],
    ];
    for (const [pos, [kind, path]] of files.entries()) {
      await db.query(
        "INSERT INTO event_media (event_id, storage_path, kind, position) VALUES ($1, $2, $3, $4)",
        [eventId, path, kind, pos],
      );
      const stem = path.replace(/\.[A-Za-z0-9]+$/, "");
      paths.push(
        path,
        `${stem}.w640.webp`,
        `${stem}.w1280.webp`,
        `${stem}.w320.webp`,
        `${path}.w640.webp`,
      );
    }
    // Published only now: a public event needs its cover image first.
    if (e.status !== "draft")
      await db.query("UPDATE events SET status = $1 WHERE id = $2", [e.status, eventId]);
  }
  paths.push(
    `${id(999)}/${id(998)}.webp`,
    `${id(999)}/${id(998)}.w640.webp`,
    "",
    "no-folder.w1280.webp",
  );
}, 60000);
afterAll(async () => db.close());

describe("can_read_event_file", () => {
  it("answers exactly like the full-scan version for every viewer and path", async () => {
    let allowed = 0;
    for (const who of VIEWERS) {
      await as(who);
      const rows = await db.query<{ path: string; old: boolean; new: boolean }>(
        "SELECT p AS path, public.test_old_can_read_event_file(p) AS old, public.can_read_event_file(p) AS new FROM unnest($1::text[]) p",
        [paths],
      );
      const differ = rows.rows.filter((r) => r.old !== r.new).map((r) => `${who}: ${r.path}`);
      expect(differ).toEqual([]);
      allowed += rows.rows.filter((r) => r.new).length;
    }
    await as(null);
    // Sanity: some viewers may read some files, and no one reads everything.
    expect(allowed).toBeGreaterThan(0);
    expect(allowed).toBeLessThan(paths.length * VIEWERS.length);
  });

  it("keeps its privileges and can use the stem index", async () => {
    await as(null);
    const acl = await db.query<{ grantee: string }>(
      `SELECT r.rolname AS grantee FROM pg_proc p, aclexplode(p.proacl) a JOIN pg_roles r ON r.oid = a.grantee
       WHERE p.proname = 'can_read_event_file' AND p.pronamespace = 'public'::regnamespace ORDER BY 1`,
    );
    expect(acl.rows.map((r) => r.grantee)).not.toContain("anon");
    expect(acl.rows.map((r) => r.grantee)).toContain("authenticated");
    await db.exec("SET enable_seqscan = off");
    try {
      const plan = await db.query<{ "QUERY PLAN": string }>(
        `EXPLAIN SELECT 1 FROM public.event_media WHERE storage_path = 'x/y.w640.webp' OR (kind = 'image'
           AND regexp_replace(storage_path, '\\.[A-Za-z0-9]+$', '') = regexp_replace('x/y.w640.webp', '\\.w(640|1280)\\.webp$', '')
           AND 'x/y.w640.webp' = ANY (public.event_media_variant_paths(storage_path)))`,
      );
      expect(plan.rows.map((r) => r["QUERY PLAN"]).join("\n")).toContain(
        "event_media_image_stem_idx",
      );
    } finally {
      await db.exec("RESET enable_seqscan");
    }
  });
});

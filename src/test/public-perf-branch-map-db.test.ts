import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PRIVACY_VERSION, initializeRecycleDatabase } from "./recycle-db-fixture";

// Image copies (.w640/.w1280 next to the original: storage access, the variants flag, deleting and restoring) and
// the branch map (postcode rules, who may set it, coordinates only from the server, get_branch_map scope and counts
// without names). Against every migration in PGlite, rolled back per test.
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
  nc: id(26),
  f1: id(28),
};
type Who = "rd" | "bm1" | "vol1" | "nc" | "f1" | null;

async function as(user: Who, aal: "aal1" | "aal2" = "aal1") {
  await db.exec("RESET ROLE");
  await db.query(
    "SELECT set_config('request.jwt.claim.sub',$1,true), set_config('request.jwt.claim.aal',$2,true)",
    [user ? ids[user] : "", aal],
  );
  if (user) await db.exec("SET LOCAL ROLE authenticated");
}
async function fails(sql: string, params: unknown[], message: string | RegExp) {
  await db.exec("SAVEPOINT sp");
  try {
    await expect(db.query(sql, params)).rejects.toThrow(message);
  } finally {
    await db.exec("ROLLBACK TO SAVEPOINT sp");
  }
}
const tx = (action: () => Promise<void>) => async () => {
  await db.exec("BEGIN");
  try {
    await action();
  } finally {
    await db.exec("ROLLBACK");
  }
};
const one = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) =>
  (await db.query<T>(sql, params)).rows[0]!;
const val = async <T = unknown>(sql: string, params: unknown[] = []) =>
  Object.values(await one<Record<string, T>>(sql, params))[0] as T;

beforeAll(async () => {
  await initializeRecycleDatabase(db);
  await db.exec(`INSERT INTO regions(id,name) VALUES ('${ids.r1}','Map Region One'),('${ids.r2}','Map Region Two');
    INSERT INTO branches(id,name,region_id) VALUES ('${ids.b1}','Map Branch One','${ids.r1}'),('${ids.b2}','Map Branch Two','${ids.r1}'),('${ids.b3}','Map Branch Three','${ids.r2}');`);
  for (const [key, name] of [
    ["rd", "Rita Director"],
    ["bm1", "Ben Manager"],
    ["vol1", "Vera Volunteer"],
    ["nc", "Nina Coordinator"],
  ] as const) {
    await db.query(
      "INSERT INTO auth.users(id, email, raw_user_meta_data) VALUES ($1, $2, jsonb_build_object('full_name', $3::text, 'privacy_notice_version', $4::text))",
      [ids[key], `${key}@example.test`, name, PRIVACY_VERSION],
    );
  }
  await db.query(
    "INSERT INTO auth.users(id, email, raw_user_meta_data) VALUES ($1, 'f1@example.test', jsonb_build_object('full_name', 'Fay Follower', 'privacy_notice_version', $2::text, 'branch_id', $3::text, 'follower', true))",
    [ids.f1, PRIVACY_VERSION, ids.b1],
  );
  await db.exec(`UPDATE profiles SET status='active';
    UPDATE profiles SET branch_id='${ids.b1}' WHERE id IN ('${ids.bm1}','${ids.vol1}');
    UPDATE user_roles SET role='regional_director', region_id='${ids.r1}' WHERE user_id='${ids.rd}';
    UPDATE user_roles SET role='branch_manager' WHERE user_id='${ids.bm1}';
    UPDATE user_roles SET role='national_coordinator' WHERE user_id='${ids.nc}';`);
}, 60000);
afterAll(async () => db.close());

describe("image copies", () => {
  it(
    "copy paths sit next to the original; storage access follows the image row; the flag needs both copies",
    tx(async () => {
      expect(await val("SELECT public.event_media_variant_paths('e/x.webp')")).toEqual([
        "e/x.w640.webp",
        "e/x.w1280.webp",
      ]);
      expect(await val("SELECT public.event_media_variant_paths('e/x.jpg')")).toEqual([
        "e/x.w640.webp",
        "e/x.w1280.webp",
      ]);
      await as(null);
      const ev = await val<string>(
        `INSERT INTO events (title, organizer, category, scope, branch_id, region_id, status, start_at, end_at, location, audience, created_by)
         VALUES ('Copies', 'DS', 'dialogue', 'branch', $1, $2, 'draft', now() + interval '5 days', now() + interval '5 days 2 hours', 'Hall', 'public', $3) RETURNING id`,
        [ids.b1, ids.r1, ids.bm1],
      );
      await as("bm1");
      const media = await val<string>(
        "SELECT public.add_event_media($1, 'image', 'webp', 'cover.webp')",
        [ev],
      );
      const path = await val<string>("SELECT storage_path FROM event_media WHERE id=$1", [media]);
      const [w640, w1280] = await val<string[]>("SELECT public.event_media_variant_paths($1)", [
        path,
      ]);
      expect(await val("SELECT public.can_write_event_file($1)", [w640])).toBe(true);
      expect(await val("SELECT public.can_write_event_file($1)", [`${ev}/other.w640.webp`])).toBe(
        false,
      );
      await as("vol1");
      expect(await val("SELECT public.can_write_event_file($1)", [w640])).toBe(false);
      await as("bm1");
      await fails(
        "SELECT public.set_event_media_variants($1)",
        [media],
        "Image copies are missing",
      );
      await as(null);
      await db.query(
        "INSERT INTO storage.objects (bucket_id, name) VALUES ('event-media', $1), ('event-media', $2), ('event-media', $3)",
        [path, w640, w1280],
      );
      await as("bm1");
      await db.query("SELECT public.set_event_media_variants($1)", [media]);
      expect(await val("SELECT has_variants FROM event_media WHERE id=$1", [media])).toBe(true);
      // Deleting the image needs the original AND its copies removed from Storage first.
      await as(null);
      await db.query("DELETE FROM storage.objects WHERE name = $1", [path]);
      await as("bm1");
      await fails("SELECT public.delete_event_media($1)", [media], "Remove stored file first");
      await as(null);
      await db.query("DELETE FROM storage.objects WHERE name = ANY($1)", [[w640, w1280]]);
      await as("bm1");
      await db.query("SELECT public.delete_event_media($1)", [media]);
      // Server only.
      await fails("SELECT public.event_media_has_variants($1)", [path], "permission denied");
    }),
  );
});

describe("branch locations and the map", () => {
  it(
    "the seed placed known branches; postcodes are normalised and validated; NC and the region's RD may set them",
    tx(async () => {
      await as("rd");
      expect(await val("SELECT public.set_branch_postcode($1, ' me4  4tb ')", [ids.b1])).toBe(
        "ME4 4TB",
      );
      await fails(
        "SELECT public.set_branch_postcode($1, 'NOT A CODE')",
        [ids.b1],
        "Enter a valid UK postcode",
      );
      await fails("SELECT public.set_branch_postcode($1, 'BN1 1AA')", [ids.b3], "Not allowed"); // other region
      await as("bm1");
      await fails("SELECT public.set_branch_postcode($1, 'ME4 4TB')", [ids.b1], "Not allowed");
      await as("nc", "aal1");
      await fails("SELECT public.set_branch_postcode($1, 'BN1 1AA')", [ids.b3], "Not allowed");
      await as("nc", "aal2");
      expect(await val("SELECT public.set_branch_postcode($1, 'bn11aa')", [ids.b3])).toBe(
        "BN1 1AA",
      );
      expect(await val("SELECT public.set_branch_postcode($1, '')", [ids.b3])).toBeNull();
      // Coordinates come only from the server (geocoder), and only for the current postcode.
      await fails(
        "SELECT public.set_branch_coordinates($1, 'ME4 4TB', 51.38, 0.52)",
        [ids.b1],
        "permission denied",
      );
      await as(null);
      await db.query("SELECT public.set_branch_coordinates($1, 'OLD 1AA', 1, 1)", [ids.b1]);
      expect(await val("SELECT latitude FROM branches WHERE id=$1", [ids.b1])).toBeNull();
      await db.query("SELECT public.set_branch_coordinates($1, 'ME4 4TB', 51.38, 0.52)", [ids.b1]);
      expect(await one("SELECT latitude, longitude FROM branches WHERE id=$1", [ids.b1])).toEqual({
        latitude: 51.38,
        longitude: 0.52,
      });
      await fails(
        "SELECT public.set_branch_coordinates($1, 'ME4 4TB', 40, 0)",
        [ids.b1],
        "branches_coordinates_check",
      );
    }),
  );

  it(
    "get_branch_map: NC (aal2) all branches, RD only their region, others nothing; counts and managers, never member names",
    tx(async () => {
      await as("nc", "aal2");
      const all = await val<Array<Record<string, unknown>>>("SELECT public.get_branch_map()");
      const b1 = all.find((b) => b["id"] === ids.b1)!;
      expect(b1).toMatchObject({
        name: "Map Branch One",
        region: "Map Region One",
        managers: ["Ben Manager"],
        volunteers: 1,
        followers: 1,
        upcoming_events: 0,
        open_tasks: 0,
      });
      expect(JSON.stringify(all)).not.toContain("Vera Volunteer");
      expect(JSON.stringify(all)).not.toContain("Fay Follower");
      expect(all.map((b) => b["id"])).toEqual(expect.arrayContaining([ids.b1, ids.b2, ids.b3]));
      await as("rd");
      const mine = await val<Array<Record<string, unknown>>>("SELECT public.get_branch_map()");
      expect(mine.map((b) => b["id"]).sort()).toEqual([ids.b1, ids.b2].sort());
      for (const who of ["bm1", "vol1", "f1"] as const) {
        await as(who);
        await fails("SELECT public.get_branch_map()", [], "Not allowed");
      }
      await as("nc", "aal1");
      await fails("SELECT public.get_branch_map()", [], "Not allowed");
      await db.exec("RESET ROLE");
      await db.exec("SET LOCAL ROLE anon");
      await fails("SELECT public.get_branch_map()", [], "permission denied");
    }),
  );
});

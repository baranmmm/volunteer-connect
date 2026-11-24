import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PRIVACY_VERSION, initializeRecycleDatabase } from "./recycle-db-fixture";

// Roles (follower, volunteer, branch manager, regional director, national coordinator), event audience, volunteer
// applications, structure and the public functions, against every migration in PGlite. Rolled back per test.
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
  bm3: id(24),
  vol3: id(25),
  nc: id(26),
  nc2: id(27),
  f1: id(28),
  f2: id(29),
};
type Who = keyof typeof ids | null;

async function as(user: Who, aal: "aal1" | "aal2" = "aal1") {
  await db.exec("RESET ROLE");
  await db.query(
    "SELECT set_config('request.jwt.claim.sub',$1,true), set_config('request.jwt.claim.aal',$2,true)",
    [user ? ids[user] : "", aal],
  );
  if (user) await db.exec("SET LOCAL ROLE authenticated");
}
async function anon() {
  await db.exec("RESET ROLE");
  await db.query("SELECT set_config('request.jwt.claim.sub','',true)");
  await db.exec("SET LOCAL ROLE anon");
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
const sees = async (event: string) => val<boolean>("SELECT public.can_view_event($1)", [event]);

type EventKey =
  | "membersB1"
  | "publicB1"
  | "publicB3"
  | "draftPublicB1"
  | "nationalMembers"
  | "nationalPublic"
  | "upcomingB2";
let ev = {} as Record<EventKey, string>;
async function event(
  key: EventKey,
  fields: {
    scope: string;
    branch?: string | null;
    region?: string | null;
    status?: string;
    audience?: string;
    online?: boolean;
  },
) {
  // A public event is published only with a cover image: insert as a draft, add the image, then publish.
  const publicPublished =
    fields.audience === "public" && (fields.status ?? "published") === "published";
  const start = new Date(Date.now() + 7 * 86400000).toISOString();
  const end = new Date(Date.now() + 7 * 86400000 + 7200000).toISOString();
  const row = await one<{ id: string }>(
    `INSERT INTO public.events (title, organizer, category, scope, branch_id, region_id, status, start_at, end_at, location, location_type, online_url, audience, created_by)
     VALUES ($1, 'Dialogue Society', 'dialogue', $2, $3, $4, $5, $6, $7, 'Hall', $8, $9, $10, $11) RETURNING id`,
    [
      `Event ${key}`,
      fields.scope,
      fields.branch ?? null,
      fields.region ?? null,
      publicPublished ? "draft" : (fields.status ?? "published"),
      start,
      end,
      fields.online ? "online" : "in_person",
      fields.online ? "https://meet.example.org/secret" : null,
      fields.audience ?? "members",
      ids.bm1,
    ],
  );
  if (publicPublished) {
    await db.query(
      "INSERT INTO public.event_media (event_id, storage_path, kind, position) VALUES ($1::uuid, $1::text || '/cover.webp', 'image', 0)",
      [row.id],
    );
    await db.query("UPDATE public.events SET status = 'published' WHERE id = $1", [row.id]);
  }
  ev[key] = row.id;
}

beforeAll(async () => {
  await initializeRecycleDatabase(db);
  await db.exec(`INSERT INTO regions(id,name) VALUES ('${ids.r1}','Region One'),('${ids.r2}','Region Two');
    INSERT INTO branches(id,name,region_id) VALUES ('${ids.b1}','Branch One','${ids.r1}'),('${ids.b2}','Branch Two','${ids.r1}'),('${ids.b3}','Branch Three','${ids.r2}');`);
  // Members and coordinators (legacy pending volunteers in the fixture, then set up like the seed does).
  for (const [key, name] of [
    ["rd", "Rita Director"],
    ["bm1", "Ben Manager"],
    ["vol1", "Vera Volunteer"],
    ["bm3", "Bo Manager"],
    ["vol3", "Val Volunteer"],
    ["nc", "Nina Coordinator"],
    ["nc2", "Ned Coordinator"],
  ] as const) {
    await db.query(
      "INSERT INTO auth.users(id, email, raw_user_meta_data) VALUES ($1, $2, jsonb_build_object('full_name', $3::text, 'privacy_notice_version', $4::text))",
      [ids[key], `${key}@example.test`, name, PRIVACY_VERSION],
    );
  }
  await db.exec(`UPDATE profiles SET status='active';
    UPDATE profiles SET branch_id='${ids.b1}' WHERE id IN ('${ids.bm1}','${ids.vol1}');
    UPDATE profiles SET branch_id='${ids.b3}' WHERE id IN ('${ids.bm3}','${ids.vol3}');
    UPDATE user_roles SET role='regional_director', region_id='${ids.r1}' WHERE user_id='${ids.rd}';
    UPDATE user_roles SET role='branch_manager' WHERE user_id IN ('${ids.bm1}','${ids.bm3}');
    UPDATE user_roles SET role='national_coordinator' WHERE user_id IN ('${ids.nc}','${ids.nc2}');
    UPDATE profiles SET status='inactive' WHERE id='${ids.nc2}';`);
  // Followers sign up for real (no fixture conversion).
  for (const [key, branch] of [
    ["f1", ids.b1],
    ["f2", ids.b3],
  ] as const) {
    await db.query(
      "INSERT INTO auth.users(id, email, raw_user_meta_data) VALUES ($1, $2, jsonb_build_object('full_name', $3::text, 'privacy_notice_version', $4::text, 'branch_id', $5::text, 'follower', true))",
      [ids[key], `${key}@example.test`, `Follower ${key}`, PRIVACY_VERSION, branch],
    );
  }
  ev = {} as Record<EventKey, string>;
  await event("membersB1", { scope: "branch", branch: ids.b1, region: ids.r1 });
  await event("publicB1", {
    scope: "branch",
    branch: ids.b1,
    region: ids.r1,
    audience: "public",
    online: true,
  });
  await event("publicB3", { scope: "branch", branch: ids.b3, region: ids.r2, audience: "public" });
  await event("draftPublicB1", {
    scope: "branch",
    branch: ids.b1,
    region: ids.r1,
    audience: "public",
    status: "draft",
  });
  await event("nationalMembers", { scope: "national" });
  await event("nationalPublic", { scope: "national", audience: "public" });
}, 60000);
afterAll(async () => db.close());

describe("sign-up and followers", () => {
  it(
    "a new account is an active follower of the chosen branch; without a branch sign-up is refused",
    tx(async () => {
      expect(
        await one(
          "SELECT p.status, p.branch_id, r.role FROM profiles p JOIN user_roles r ON r.user_id=p.id WHERE p.id=$1",
          [ids.f1],
        ),
      ).toEqual({ status: "active", branch_id: null, role: "follower" });
      expect(
        (await db.query("SELECT branch_id FROM user_followed_branches WHERE user_id=$1", [ids.f1]))
          .rows,
      ).toEqual([{ branch_id: ids.b1 }]);
      await fails(
        "INSERT INTO auth.users(id, raw_user_meta_data) VALUES ($1, jsonb_build_object('privacy_notice_version',$2::text,'branch_id','','follower',true))",
        [id(90), PRIVACY_VERSION],
        "Choose a branch to follow",
      );
    }),
  );

  it(
    "followers see only public published events (cancelled ones only when registered), never names, members events or drafts",
    tx(async () => {
      await as("f1");
      expect(await sees(ev.publicB1!)).toBe(true);
      expect(await sees(ev.publicB3!)).toBe(true); // all branches
      expect(await sees(ev.nationalPublic!)).toBe(true);
      expect(await sees(ev.membersB1!)).toBe(false);
      expect(await sees(ev.nationalMembers!)).toBe(false);
      expect(await sees(ev.draftPublicB1!)).toBe(false);
      expect(
        (await db.query("SELECT id FROM events ORDER BY title")).rows
          .map((r) => (r as { id: string }).id)
          .sort(),
      ).toEqual([ev.nationalPublic, ev.publicB1, ev.publicB3].sort());
      // Registration: public yes, members no; registrant names hidden.
      await db.query("SELECT public.register_for_event($1)", [ev.publicB1]);
      await fails("SELECT public.register_for_event($1)", [ev.membersB1], "Not allowed");
      expect(
        await one("SELECT public.get_event_registration_summary($1) s", [ev.publicB1]),
      ).toMatchObject({ s: { names_visible: false, names: [] } });
      // Other people's data stays hidden.
      expect((await db.query("SELECT id FROM profiles")).rows).toEqual([{ id: ids.f1 }]);
      await fails(
        "SELECT public.submit_event_request($1::jsonb)",
        [JSON.stringify({ title: "X" })],
        "Only members can request events",
      );
      // A cancelled public event stays visible to the follower registered to it, not to another follower.
      await as(null);
      await db.query("UPDATE events SET status='cancelled' WHERE id=$1", [ev.publicB1]);
      await as("f1");
      expect(await sees(ev.publicB1!)).toBe(true);
      await as("f2");
      expect(await sees(ev.publicB1!)).toBe(false);
    }),
  );

  it(
    "volunteers see their members events and every public event; names visible to them",
    tx(async () => {
      await as("vol1");
      expect(await sees(ev.membersB1!)).toBe(true);
      expect(await sees(ev.publicB3!)).toBe(true);
      expect(await sees(ev.nationalMembers!)).toBe(true);
      expect(
        await one("SELECT public.get_event_registration_summary($1) s", [ev.membersB1]),
      ).toMatchObject({ s: { names_visible: true } });
      await as("vol3");
      expect(await sees(ev.membersB1!)).toBe(false);
    }),
  );

  it(
    "followed branches: add and remove, a follower keeps at least one",
    tx(async () => {
      await as("f1");
      await db.query("SELECT public.follow_branch($1)", [ids.b2]);
      await db.query("SELECT public.unfollow_branch($1)", [ids.b1]);
      await fails("SELECT public.unfollow_branch($1)", [ids.b2], "Follow at least one branch");
      await fails(
        "INSERT INTO user_followed_branches(user_id, branch_id) VALUES ($1,$2)",
        [ids.f1, ids.b3],
        "permission denied",
      );
      await as("vol1"); // members always follow their own branch, so they may remove every followed row
      await db.query("SELECT public.follow_branch($1)", [ids.b3]);
      await db.query("SELECT public.unfollow_branch($1)", [ids.b3]);
      expect(
        (await one<{ b: { own: boolean }[] }>("SELECT public.get_followed_branches() b")).b,
      ).toEqual([expect.objectContaining({ branch_id: ids.b1, own: true })]);
    }),
  );
});

describe("volunteer applications", () => {
  const HELP = "I would like to help plan iftar dinners and welcome guests.";
  const answers = (branch: string, extra: Record<string, unknown> = {}) =>
    JSON.stringify({
      branch_id: branch,
      motivation: HELP,
      time_commitment: "few_hours_month",
      commitment: true,
      ...extra,
    });
  const submit = async (who: Who, branch = ids.b1) => {
    await as(who);
    return val<string>("SELECT public.submit_volunteer_application($1::jsonb)", [
      answers(branch, { phone: "0123" }),
    ]);
  };

  it(
    "one open application; the branch manager and the regional director see it, others and the NC do not (count only)",
    tx(async () => {
      const app = await submit("f1");
      await fails(
        "SELECT public.submit_volunteer_application($1::jsonb)",
        [answers(ids.b1)],
        "You already have an open application",
      );
      await as("vol1");
      await fails(
        "SELECT public.submit_volunteer_application($1::jsonb)",
        [answers(ids.b1)],
        "Only followers can apply",
      );
      expect((await db.query("SELECT id FROM volunteer_applications")).rows).toEqual([]);
      for (const reviewer of ["bm1", "rd"] as const) {
        await as(reviewer);
        expect((await db.query("SELECT id FROM volunteer_applications")).rows).toEqual([
          { id: app },
        ]);
        expect(
          (
            await one<{ l: { applicant_name: string }[] }>(
              "SELECT public.list_volunteer_applications() l",
            )
          ).l[0],
        ).toMatchObject({ applicant_name: "Follower f1" });
      }
      await as("bm3");
      expect((await db.query("SELECT id FROM volunteer_applications")).rows).toEqual([]);
      await as("nc", "aal2");
      expect((await db.query("SELECT id FROM volunteer_applications")).rows).toEqual([]);
      expect(await val("SELECT public.get_volunteer_application_count()")).toBe(1);
      await fails("SELECT public.list_volunteer_applications()", [], "Not allowed");
    }),
  );

  it(
    "approval makes the follower a volunteer of the branch with audit rows; decline needs a reason",
    tx(async () => {
      const app = await submit("f1");
      await as("bm3");
      await fails("SELECT public.approve_volunteer_application($1)", [app], "Not allowed");
      await as("bm1");
      await fails(
        "SELECT public.decline_volunteer_application($1,'short')",
        [app],
        "at least 10 characters",
      );
      await db.query("SELECT public.approve_volunteer_application($1)", [app]);
      await as(null);
      expect(
        await one(
          "SELECT p.branch_id, array_agg(r.role::text) roles FROM profiles p JOIN user_roles r ON r.user_id=p.id WHERE p.id=$1 GROUP BY 1",
          [ids.f1],
        ),
      ).toEqual({ branch_id: ids.b1, roles: ["volunteer"] });
      expect(
        (
          await db.query(
            "SELECT action, old_value, new_value FROM user_audit_log WHERE target_id=$1 ORDER BY action::text",
            [ids.f1],
          )
        ).rows,
      ).toEqual([
        { action: "branch_change", old_value: null, new_value: ids.b1 },
        { action: "role_change", old_value: "follower", new_value: "volunteer" },
      ]);
      await as("f1"); // now a member of Branch One
      expect(await sees(ev.membersB1!)).toBe(true);
    }),
  );

  it(
    "Recycle Bin: deleting an open application withdraws it; the reviewer restores it within 30 days",
    tx(async () => {
      const app = await submit("f1");
      await db.query("SELECT public.delete_volunteer_application($1)", [app]);
      expect((await db.query("SELECT id FROM volunteer_applications")).rows).toEqual([]);
      await as("bm1");
      expect(
        (await db.query("SELECT type FROM public.list_recycle_bin('volunteer_application')")).rows,
      ).toEqual([{ type: "volunteer_application" }]);
      await db.query("SELECT public.restore_item('volunteer_application', $1)", [app]);
      expect(await one("SELECT status FROM volunteer_applications WHERE id=$1", [app])).toEqual({
        status: "withdrawn",
      });
    }),
  );
});

describe("National Coordinators", () => {
  it(
    "without MFA (aal1) an NC gets nothing; with aal2 every published event and national drafts",
    tx(async () => {
      await as("nc", "aal1");
      expect(await sees(ev.publicB1!)).toBe(false);
      expect(await val("SELECT public.is_nc()")).toBe(false);
      await fails("SELECT public.get_nc_dashboard()", [], "Not allowed");
      await as("nc", "aal2");
      for (const key of ["membersB1", "publicB3", "nationalMembers"] as const)
        expect(await sees(ev[key])).toBe(true);
      expect(await sees(ev.draftPublicB1!)).toBe(false);
      expect(await one("SELECT public.get_nc_dashboard() d")).toMatchObject({
        d: { regions: expect.any(Number), followers: 2, open_applications: 0 },
      });
    }),
  );

  it(
    "only NCs create and manage national events; registrations are counts only for them",
    tx(async () => {
      const data = {
        title: "National day",
        scope: "national",
        status: "draft",
        category: "dialogue",
      };
      for (const who of ["rd", "bm1"] as const) {
        await as(who);
        await fails("SELECT public.create_event($1::jsonb)", [JSON.stringify(data)], "Not allowed");
      }
      await as("nc", "aal2");
      const created = await val<string>("SELECT public.create_event($1::jsonb)", [
        JSON.stringify({ ...data, audience: "public" }),
      ]);
      expect(
        await one("SELECT scope, branch_id, region_id, audience FROM events WHERE id=$1", [
          created,
        ]),
      ).toEqual({ scope: "national", branch_id: null, region_id: null, audience: "public" });
      await fails(
        "SELECT * FROM public.get_event_registrations($1)",
        [ev.nationalMembers],
        "Registrant details are not available",
      );
      expect(
        await one("SELECT public.get_event_registration_summary($1) s", [ev.nationalMembers]),
      ).toMatchObject({ s: { names_visible: false, names: [] } });
      await as("nc", "aal1");
      await fails("SELECT public.create_event($1::jsonb)", [JSON.stringify(data)], "Not allowed");
    }),
  );

  it(
    "NCs see and manage Regional Directors and Branch Managers, never volunteers or followers",
    tx(async () => {
      await as("nc", "aal2");
      expect(
        (await db.query<{ id: string }>("SELECT id FROM profiles ORDER BY id")).rows
          .map((r) => r.id)
          .sort(),
      ).toEqual([ids.rd, ids.bm1, ids.bm3, ids.nc].sort());
      await db.query("SELECT public.set_user_role($1, 'regional_director', $2)", [ids.bm3, ids.r2]);
      expect(
        await one("SELECT role::text, region_id FROM user_roles WHERE user_id=$1", [ids.bm3]),
      ).toEqual({ role: "regional_director", region_id: ids.r2 });
      await db.query("SELECT public.set_user_branch($1, $2)", [ids.bm1, ids.b3]);
      await fails(
        "SELECT public.set_user_role($1, 'branch_manager')",
        [ids.vol1],
        "You cannot manage this user",
      );
      await fails(
        "SELECT public.set_user_role($1, 'national_coordinator')",
        [ids.bm1],
        "cannot be assigned in the app",
      );
      await as("rd");
      await fails(
        "SELECT public.set_user_role($1, 'regional_director')",
        [ids.bm1],
        /Regional Director cannot be assigned|cannot manage/,
      );
    }),
  );

  it(
    "the last active NC cannot be deactivated, deleted or lose the role; with another active NC it can",
    tx(async () => {
      await as(null);
      await fails(
        "UPDATE profiles SET status='inactive' WHERE id=$1",
        [ids.nc],
        "last active National Coordinator",
      );
      await fails(
        "DELETE FROM user_roles WHERE user_id=$1 AND role='national_coordinator'",
        [ids.nc],
        "last active National Coordinator",
      );
      await fails(
        "UPDATE profiles SET deleted_at=now() WHERE id=$1",
        [ids.nc],
        "last active National Coordinator",
      );
      await fails(
        "DELETE FROM auth.users WHERE id=$1",
        [ids.nc],
        "last active National Coordinator",
      );
      await db.query("UPDATE profiles SET status='active' WHERE id=$1", [ids.nc2]);
      await db.query("UPDATE profiles SET status='inactive' WHERE id=$1", [ids.nc]);
      await as("rd"); // and nobody manages an NC in the app
      expect(await val("SELECT public.can_manage_user($1,$2)", [ids.rd, ids.nc2])).toBe(false);
    }),
  );

  it(
    "regions and branches: created and deleted by NCs only, not while in use; a region takes its branches; restore",
    tx(async () => {
      await as("rd");
      await fails("SELECT public.create_branch('New', $1)", [ids.r1], "Not allowed");
      await as("nc", "aal2");
      const region = await val<string>("SELECT public.create_region('Region Three')");
      const branch = await val<string>("SELECT public.create_branch('Branch Four', $1)", [region]);
      await fails("SELECT public.delete_branch($1)", [ids.b1], "still has active users");
      await as(null);
      await event("upcomingB2", { scope: "branch", branch: ids.b2, region: ids.r1 });
      await as("nc", "aal2");
      await fails("SELECT public.delete_branch($1)", [ids.b2], "still has upcoming events");
      // An empty region goes to the Recycle Bin with its branch, hidden from everyone (anon sign-up page included).
      await db.query("SELECT public.delete_region($1)", [region]);
      expect(
        (await db.query("SELECT type, event_count FROM public.list_recycle_bin('region')")).rows,
      ).toEqual([{ type: "region", event_count: 1 }]);
      await anon();
      expect((await db.query("SELECT id FROM branches WHERE id=$1", [branch])).rows).toEqual([]);
      await as("nc", "aal2");
      await db.query("SELECT public.restore_item('region', $1)", [region]);
      expect(await one("SELECT deleted_at FROM branches WHERE id=$1", [branch])).toEqual({
        deleted_at: null,
      });
    }),
  );
});

describe("public functions (anon)", () => {
  it(
    "anon reads no table, gets only public events and only the allowed fields (no online link)",
    tx(async () => {
      await anon();
      await fails("SELECT id FROM events", [], "permission denied");
      await fails("SELECT id FROM profiles", [], "permission denied");
      const list = (
        await one<{ l: Record<string, unknown>[] }>("SELECT public.get_public_events() l")
      ).l;
      expect(list.map((e) => e["id"]).sort()).toEqual(
        [ev.nationalPublic, ev.publicB1, ev.publicB3].sort(),
      );
      const online = list.find((e) => e["id"] === ev.publicB1)!;
      expect(Object.keys(online).sort()).toEqual([
        "all_day",
        "branch",
        "branch_id",
        "category",
        "description",
        "end_at",
        "end_date",
        "has_image",
        "id",
        "is_online",
        "location",
        "location_tba",
        "map",
        "max_places",
        "organizer",
        "past_record",
        "region",
        "region_id",
        "registration",
        "scope",
        "spots_left",
        "start_at",
        "start_date",
        "status",
        "title",
      ]);
      expect(JSON.stringify(list)).not.toContain("meet.example.org");
      expect(online).toMatchObject({ is_online: true, location: null, registration: "open" });
      expect(
        (await one<{ l: unknown[] }>("SELECT public.get_public_events($1::uuid[]) l", [[ids.b3]])).l
          .map((e) => (e as { id: string }).id)
          .sort(),
      ).toEqual([ev.nationalPublic, ev.publicB3].sort());
      expect(await val("SELECT public.get_public_event($1)", [ev.membersB1])).toBeNull();
      await fails(
        "SELECT public.get_public_events(NULL, now(), now() + interval '13 months')",
        [],
        "at most 12 months",
      );
    }),
  );
});

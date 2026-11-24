import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PRIVACY_VERSION, initializeRecycleDatabase } from "./recycle-db-fixture";

// Follower vs volunteer at sign-up and later: the application answers (help 30–500, time choice, commitment), the
// sign-up metadata creating the application, one open application, decision notices for the applicant, the welcome
// flag and the managers' list. Against every migration in PGlite, rolled back per test.
const db = new PGlite();
const id = (n: number) =>
  `${String(n).padStart(8, "0")}-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ids = {
  r1: id(1),
  b1: id(11),
  b2: id(12),
  bm1: id(22),
  vol1: id(23),
  f1: id(28),
  new1: id(40),
  new2: id(41),
};
type Who = "bm1" | "vol1" | "f1" | "new1" | "new2" | null;
const HELP = "I would like to help plan iftar dinners and welcome guests at the door.";

async function as(user: Who) {
  await db.exec("RESET ROLE");
  await db.query(
    "SELECT set_config('request.jwt.claim.sub',$1,true), set_config('request.jwt.claim.aal','aal1',true)",
    [user ? ids[user] : ""],
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
const answers = (extra: Record<string, unknown> = {}) =>
  JSON.stringify({
    branch_id: ids.b1,
    motivation: HELP,
    time_commitment: "few_hours_week",
    commitment: true,
    ...extra,
  });
/** Signs up like the join form: follower of b1, optionally with a volunteer application in the metadata. */
async function signUp(who: "new1" | "new2", application?: Record<string, unknown>) {
  await as(null);
  await db.query(
    `INSERT INTO auth.users(id, email, raw_user_meta_data) VALUES ($1, $2, jsonb_build_object('full_name', 'New Person',
       'privacy_notice_version', $3::text, 'branch_id', $4::text, 'phone', '0700', 'follower', true) || $5::jsonb)`,
    [
      ids[who],
      `${who}@example.test`,
      PRIVACY_VERSION,
      ids.b1,
      JSON.stringify(application ? { volunteer_application: application } : {}),
    ],
  );
}

beforeAll(async () => {
  await initializeRecycleDatabase(db);
  await db.exec(`INSERT INTO regions(id,name) VALUES ('${ids.r1}','Onboard Region');
    INSERT INTO branches(id,name,region_id) VALUES ('${ids.b1}','Onboard One','${ids.r1}'),('${ids.b2}','Onboard Two','${ids.r1}');`);
  for (const [key, name] of [
    ["bm1", "Ben Manager"],
    ["vol1", "Vera Volunteer"],
  ] as const) {
    await db.query(
      "INSERT INTO auth.users(id, email, raw_user_meta_data) VALUES ($1, $2, jsonb_build_object('full_name', $3::text, 'privacy_notice_version', $4::text))",
      [ids[key], `${key}@example.test`, name, PRIVACY_VERSION],
    );
  }
  await db.exec(`UPDATE profiles SET status='active', branch_id='${ids.b1}';
    UPDATE user_roles SET role='branch_manager' WHERE user_id='${ids.bm1}';`);
  await db.query(
    "INSERT INTO auth.users(id, email, raw_user_meta_data) VALUES ($1, $2, jsonb_build_object('full_name', 'Fay Follower', 'privacy_notice_version', $3::text, 'branch_id', $4::text, 'follower', true))",
    [ids.f1, "f1@example.test", PRIVACY_VERSION, ids.b1],
  );
}, 60000);
afterAll(async () => db.close());

describe("sign-up: follower or volunteer", () => {
  it(
    "the follower choice: a follower of the branch, no application",
    tx(async () => {
      await signUp("new1");
      expect(await val("SELECT role FROM user_roles WHERE user_id=$1", [ids.new1])).toBe(
        "follower",
      );
      expect(
        await val("SELECT count(*)::int FROM volunteer_applications WHERE user_id=$1", [ids.new1]),
      ).toBe(0);
      expect(await val("SELECT welcome_seen_at FROM profiles WHERE id=$1", [ids.new1])).toBeNull();
    }),
  );

  it(
    "the volunteer choice: a follower AND an open application with the answers, visible to the branch manager",
    tx(async () => {
      await signUp("new1", { help: `  ${HELP}  `, time: "more", commitment: true });
      expect(await val("SELECT role FROM user_roles WHERE user_id=$1", [ids.new1])).toBe(
        "follower",
      );
      expect(
        await one(
          "SELECT branch_id, status, motivation, time_commitment, commitment_accepted_at IS NOT NULL AS confirmed, phone FROM volunteer_applications WHERE user_id=$1",
          [ids.new1],
        ),
      ).toEqual({
        branch_id: ids.b1,
        status: "submitted",
        motivation: HELP,
        time_commitment: "more",
        confirmed: true,
        phone: "0700",
      });
      await as("bm1");
      const list = await val<Array<Record<string, unknown>>>(
        "SELECT public.list_volunteer_applications('open')",
      );
      expect(list.find((a) => a["applicant_id"] === ids.new1)).toMatchObject({
        motivation: HELP,
        time_commitment: "more",
      });
      // A second open application is refused.
      await as("new1");
      await db
        .query("SELECT public.accept_privacy_notice($1)", [PRIVACY_VERSION])
        .catch(() => undefined);
      await fails(
        "SELECT public.submit_volunteer_application($1::jsonb)",
        [answers()],
        "You already have an open application",
      );
    }),
  );

  it(
    "invalid answers stop the sign-up (the form checks them first)",
    tx(async () => {
      for (const [application, message] of [
        [
          { help: "too short", time: "more", commitment: true },
          "Tell us how you would like to help",
        ],
        [
          { help: "x".repeat(501), time: "more", commitment: true },
          "Tell us how you would like to help",
        ],
        [{ help: HELP, time: "every day", commitment: true }, "Choose how much time you can give"],
        [
          { help: HELP, time: "more", commitment: false },
          "Please confirm the volunteering commitment",
        ],
        [{ help: HELP, time: "more" }, "Please confirm the volunteering commitment"],
        ["yes", "Invalid volunteer application"],
      ] as const) {
        await db.exec("SAVEPOINT su");
        await expect(
          signUp("new2", application as unknown as Record<string, unknown>),
        ).rejects.toThrow(message);
        await db.exec("ROLLBACK TO SAVEPOINT su");
      }
    }),
  );
});

describe("become a volunteer later", () => {
  it(
    "the same required answers; the decision reaches the applicant as a notice (declined with the manager's note)",
    tx(async () => {
      await as("f1");
      for (const [extra, message] of [
        [{ motivation: "short" }, "Tell us how you would like to help"],
        [{ time_commitment: null }, "Choose how much time you can give"],
        [{ commitment: false }, "Please confirm the volunteering commitment"],
      ] as const)
        await fails(
          "SELECT public.submit_volunteer_application($1::jsonb)",
          [answers(extra)],
          message,
        );
      const app = await val<string>("SELECT public.submit_volunteer_application($1::jsonb)", [
        answers(),
      ]);
      const mine = await val<Array<Record<string, unknown>>>(
        "SELECT public.list_my_volunteer_applications()",
      );
      expect(mine[0]).toMatchObject({ id: app, time_commitment: "few_hours_week" });
      await as("bm1");
      await db.query(
        "SELECT public.decline_volunteer_application($1, 'Please come to two events first, then apply again.')",
        [app],
      );
      await as(null);
      expect(
        await one(
          "SELECT kind, entity_type, payload->>'reason' AS reason, payload->>'branch' AS branch FROM notifications WHERE user_id=$1",
          [ids.f1],
        ),
      ).toEqual({
        kind: "volunteer_application_declined",
        entity_type: "volunteer_application",
        reason: "Please come to two events first, then apply again.",
        branch: "Onboard One",
      });
      // Apply again → approved: a volunteer of the branch, with the approved notice.
      await as("f1");
      const again = await val<string>("SELECT public.submit_volunteer_application($1::jsonb)", [
        answers(),
      ]);
      await as("bm1");
      await db.query("SELECT public.approve_volunteer_application($1)", [again]);
      await as(null);
      expect(await val("SELECT role FROM user_roles WHERE user_id=$1", [ids.f1])).toBe("volunteer");
      expect(
        (
          await db.query<{ kind: string }>(
            "SELECT kind FROM notifications WHERE user_id=$1 ORDER BY created_at, kind",
            [ids.f1],
          )
        ).rows
          .map((r) => r.kind)
          .sort(),
      ).toEqual(["volunteer_application_approved", "volunteer_application_declined"]);
      expect(await val("SELECT public.notification_type('volunteer_application_approved')")).toBe(
        "request_decided",
      );
    }),
  );
});

describe("welcome screen", () => {
  it(
    "mark_welcome_seen sets the time once; anon cannot call it; the answer checker is internal",
    tx(async () => {
      await as("f1");
      await db.query("SELECT public.mark_welcome_seen()");
      const first = await val<string>("SELECT welcome_seen_at::text FROM profiles WHERE id=$1", [
        ids.f1,
      ]);
      expect(first).not.toBeNull();
      await db.query("SELECT public.mark_welcome_seen()");
      expect(await val("SELECT welcome_seen_at::text FROM profiles WHERE id=$1", [ids.f1])).toBe(
        first,
      );
      await fails(
        "SELECT public.check_volunteer_answers('x', 'more', true)",
        [],
        "permission denied",
      );
      await db.exec("RESET ROLE");
      await db.exec("SET LOCAL ROLE anon");
      await fails("SELECT public.mark_welcome_seen()", [], "permission denied");
    }),
  );
});

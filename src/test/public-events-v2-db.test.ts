import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PRIVACY_VERSION, initializeRecycleDatabase } from "./recycle-db-fixture";

// Public events v2 in the database: cover image required to publish public events, "To be announced", past-event
// records, guest registrations (pending → confirmed, places, waitlist, cancel), subscribers (double opt-in), event
// emails queued by triggers, announcements within the manager's reach, the attendee list, and grants (anon and
// signed-in clients can call none of the server-only functions). Against every migration in PGlite, rolled back per test.
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
  nc: id(26),
};
type Who = "rd" | "bm1" | "vol1" | "bm3" | "nc" | null;

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
const rows = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) =>
  (await db.query<T>(sql, params)).rows;

const START = new Date(Math.floor(Date.now() / 3600000) * 3600000 + 5 * 86400000);
function payload(extra: Record<string, unknown> = {}) {
  return {
    title: "Open evening",
    description: "",
    location: "Hall",
    location_type: "in_person",
    organizer: "Dialogue Society",
    category: "dialogue",
    all_day: false,
    start_at: START.toISOString(),
    end_at: new Date(START.getTime() + 7200000).toISOString(),
    audience: "public",
    scope: "branch",
    branch_id: ids.b1,
    status: "draft",
    registration_enabled: true,
    ...extra,
  };
}
/** A published public branch-1 event created by the branch manager the app's way: draft → image → publish. */
async function publicEvent(extra: Record<string, unknown> = {}): Promise<string> {
  await as("bm1");
  const e = await val<string>("SELECT public.create_event($1::jsonb)", [
    JSON.stringify(payload(extra)),
  ]);
  await val("SELECT public.add_event_media($1, 'image', 'webp', 'cover.webp')", [e]);
  await db.query("SELECT public.update_event($1, $2::jsonb)", [
    e,
    JSON.stringify(payload({ ...extra, status: "published" })),
  ]);
  await as(null);
  return e;
}
/** Service role (server code): RESET ROLE runs as the superuser, which can call the service-only functions. */
const service = () => as(null);
const outbox = (where = "true", params: unknown[] = []) =>
  rows<{
    template: string;
    status: string;
    registration_id: string | null;
    subscriber_id: string | null;
    priority: number;
    payload: Record<string, unknown>;
  }>(
    `SELECT template, status, registration_id, subscriber_id, priority, payload FROM public.email_outbox WHERE ${where} ORDER BY created_at, id`,
    params,
  );
async function guest(event: string, email: string, places = 1, keep = false) {
  await service();
  const r = await val<{ registration_id: string }>(
    "SELECT public.guest_register($1, 'Gita Guest', $2, NULL, $3, $4)",
    [event, email, places, keep],
  );
  return r.registration_id;
}

beforeAll(async () => {
  await initializeRecycleDatabase(db);
  await db.exec(`INSERT INTO regions(id,name) VALUES ('${ids.r1}','Region One'),('${ids.r2}','Region Two');
    INSERT INTO branches(id,name,region_id) VALUES ('${ids.b1}','Branch One','${ids.r1}'),('${ids.b2}','Branch Two','${ids.r1}'),('${ids.b3}','Branch Three','${ids.r2}');`);
  for (const [key, name] of [
    ["rd", "Rita Director"],
    ["bm1", "Ben Manager"],
    ["vol1", "Vera Volunteer"],
    ["bm3", "Bo Manager"],
    ["nc", "Nina Coordinator"],
  ] as const) {
    await db.query(
      "INSERT INTO auth.users(id, email, raw_user_meta_data) VALUES ($1, $2, jsonb_build_object('full_name', $3::text, 'privacy_notice_version', $4::text))",
      [ids[key], `${key}@example.test`, name, PRIVACY_VERSION],
    );
  }
  await db.exec(`UPDATE profiles SET status='active';
    UPDATE profiles SET branch_id='${ids.b1}' WHERE id IN ('${ids.bm1}','${ids.vol1}');
    UPDATE profiles SET branch_id='${ids.b3}' WHERE id='${ids.bm3}';
    UPDATE user_roles SET role='regional_director', region_id='${ids.r1}' WHERE user_id='${ids.rd}';
    UPDATE user_roles SET role='branch_manager' WHERE user_id IN ('${ids.bm1}','${ids.bm3}');
    UPDATE user_roles SET role='national_coordinator' WHERE user_id='${ids.nc}';`);
}, 60000);
afterAll(async () => db.close());

describe("publishing rules", () => {
  it(
    "a public event needs a cover image to be published; members events and drafts do not",
    tx(async () => {
      await as("bm1");
      const e = await val<string>("SELECT public.create_event($1::jsonb)", [
        JSON.stringify(payload()),
      ]);
      await fails(
        "SELECT public.update_event($1, $2::jsonb)",
        [e, JSON.stringify(payload({ status: "published" }))],
        "Public events need a cover image",
      );
      await fails(
        "SELECT public.create_event($1::jsonb)",
        [JSON.stringify(payload({ status: "published" }))],
        "Public events need a cover image",
      );
      expect(
        await val("SELECT public.create_event($1::jsonb) IS NOT NULL", [
          JSON.stringify(payload({ status: "published", audience: "members" })),
        ]),
      ).toBe(true);
      // Members → public on a published event also needs the image.
      const m = await val<string>("SELECT public.create_event($1::jsonb)", [
        JSON.stringify(payload({ status: "published", audience: "members" })),
      ]);
      await fails(
        "SELECT public.update_event($1, $2::jsonb)",
        [m, JSON.stringify(payload({ status: "published" }))],
        "Public events need a cover image",
      );
      await val("SELECT public.add_event_media($1, 'image', 'webp', 'c.webp')", [e]);
      await db.query("SELECT public.update_event($1, $2::jsonb)", [
        e,
        JSON.stringify(payload({ status: "published" })),
      ]);
      expect(await val("SELECT status FROM public.events WHERE id=$1", [e])).toBe("published");
    }),
  );

  it(
    "location may be 'To be announced' (date and time still required); the public JSON says so and has no place",
    tx(async () => {
      const e = await publicEvent({ location: "", location_tba: true });
      const json = await val<Record<string, unknown>>("SELECT public.get_public_event($1)", [e]);
      expect(json).toMatchObject({
        location: null,
        location_tba: true,
        max_places: 1,
        past_record: false,
        spots_left: null,
      });
      await as("bm1");
      await fails(
        "SELECT public.update_event($1, $2::jsonb)",
        [
          e,
          JSON.stringify(
            payload({
              status: "published",
              location: "",
              location_tba: true,
              start_at: null,
              end_at: null,
            }),
          ),
        ],
        "Required publish fields missing",
      );
      await fails(
        "SELECT public.update_event($1, $2::jsonb)",
        [e, JSON.stringify(payload({ status: "published", location: "", location_tba: false }))],
        "Required publish fields missing",
      );
    }),
  );

  it(
    "past-event records: only through create_past_event, date in the past, public, no registration; stays a record",
    tx(async () => {
      await as("bm1");
      const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
      await fails(
        "SELECT public.create_past_event('Future', (now() + interval '3 days')::date, $1, '')",
        [ids.b1],
        "Past event date must be in the past",
      );
      await fails(
        "SELECT public.create_past_event('Other branch', $1::date, $2, '')",
        [yesterday, ids.b3],
        "Not allowed",
      );
      await fails(
        "SELECT public.create_past_event('National', $1::date, NULL, '')",
        [yesterday],
        "Not allowed",
      );
      const p = await val<string>(
        "SELECT public.create_past_event('Iftar 2025', $1::date, $2, 'A shared meal.')",
        [yesterday, ids.b1],
      );
      expect(
        await one(
          "SELECT audience, status, registration_enabled, past_record, all_day, scope, region_id FROM public.events WHERE id=$1",
          [p],
        ),
      ).toEqual({
        audience: "public",
        status: "published",
        registration_enabled: false,
        past_record: true,
        all_day: true,
        scope: "branch",
        region_id: ids.r1,
      });
      await fails(
        "SELECT public.update_event($1, $2::jsonb)",
        [p, JSON.stringify(payload({ status: "published" }))],
        "Past events are edited from the past event form",
      );
      await db.query(
        "SELECT public.update_past_event($1, 'Iftar 2025 (renamed)', $2::date, $3, '')",
        [p, yesterday, ids.b1],
      );
      // 12 photos for a record, never documents; a past record is not a registration target.
      for (let i = 0; i < 12; i++)
        await val("SELECT public.add_event_media($1, 'image', 'webp', 'p.webp')", [p]);
      await fails(
        "SELECT public.add_event_media($1, 'image', 'webp', 'p.webp')",
        [p],
        "Maximum 12 photos per past event",
      );
      await service();
      await fails(
        "SELECT public.guest_register($1, 'G', 'g@example.test', NULL, 1, false)",
        [p],
        "Registration is closed",
      );
      // A direct client-side flag flip is not possible: past_record is fixed after insert.
      await db.query("UPDATE public.events SET past_record = false WHERE id = $1", [p]);
      expect(await val("SELECT past_record FROM public.events WHERE id=$1", [p])).toBe(true);
    }),
  );
});

describe("guest registrations", () => {
  it(
    "pending until the email link; seats count places; full → waitlist; cancel promotes FIFO when the places fit",
    tx(async () => {
      const e = await publicEvent({ capacity: 3, max_places: 3 });
      const a = await guest(e, "A@Example.test", 2);
      expect(
        await one(
          "SELECT status, places, guest, user_id FROM public.event_registrations WHERE id=$1",
          [a],
        ),
      ).toEqual({
        status: "pending",
        places: 2,
        guest: true,
        user_id: null,
      });
      expect(await val("SELECT email FROM public.event_guests WHERE registration_id=$1", [a])).toBe(
        "a@example.test",
      );
      expect(await outbox("registration_id=$1", [a])).toMatchObject([
        { template: "guest_confirm", status: "pending", priority: 1 },
      ]);
      await fails(
        "SELECT public.guest_register($1, 'X', 'x@example.test', NULL, 4, false)",
        [e],
        "Invalid number of places",
      );
      await fails(
        "SELECT public.guest_register($1, '', 'x@example.test', NULL, 1, false)",
        [e],
        "Invalid guest details",
      );
      await fails(
        "SELECT public.guest_register($1, 'X', 'not-an-email', NULL, 1, false)",
        [e],
        "Invalid guest details",
      );

      expect(await val("SELECT public.guest_confirm($1)->>'status'", [a])).toBe("registered");
      expect(await val("SELECT public.guest_confirm($1)->>'status'", [a])).toBe("registered"); // idempotent
      expect(
        (await val<Record<string, unknown>>("SELECT public.get_public_event($1)", [e]))[
          "spots_left"
        ],
      ).toBe(1);
      expect(
        (await outbox("registration_id=$1 AND template='registration_confirmed'", [a]))[0]?.payload,
      ).toMatchObject({ status: "registered" });

      const b = await guest(e, "b@example.test", 2);
      expect(await val("SELECT public.guest_confirm($1)->>'status'", [b])).toBe("waitlisted");
      // A member's single place still fits (members register at once, as before).
      await as("vol1");
      expect(await val("SELECT public.register_for_event($1)->>'status'", [e])).toBe("registered");
      await service();
      expect(await val("SELECT seats FROM public.registration_counts($1)", [e])).toBe(3);
      // Cancelling a: 2 places free → b (2 places) is promoted and emailed.
      await service();
      expect(await val("SELECT public.guest_cancel($1)->>'status'", [a])).toBe("cancelled");
      expect(await val("SELECT status FROM public.event_registrations WHERE id=$1", [b])).toBe(
        "registered",
      );
      expect(
        (await outbox("registration_id=$1 AND template='registration_confirmed'", [b])).map(
          (o) => o.payload["promoted"],
        ),
      ).toContain(true);
      expect(
        await outbox("registration_id=$1 AND template='registration_cancelled'", [a]),
      ).toHaveLength(1);
    }),
  );

  it(
    "re-registering never reveals state; repeated requests are throttled; links expire; started events cannot be cancelled",
    tx(async () => {
      const e = await publicEvent();
      const a = await guest(e, "c@example.test");
      // Same address again while pending: same row, still one pending confirmation email (coalesced).
      expect(await guest(e, "c@example.test")).toBe(a);
      expect(await outbox("registration_id=$1 AND status='pending'", [a])).toHaveLength(1);
      await db.query("SELECT public.guest_confirm($1)", [a]);
      expect(
        await val(
          "SELECT public.guest_register($1, 'C', 'c@example.test', NULL, 1, false)->>'action'",
          [e],
        ),
      ).toBe("already");
      await db.query("UPDATE public.email_outbox SET status='sent' WHERE registration_id=$1", [a]);
      await db.query("SELECT public.guest_register($1, 'C', 'c@example.test', NULL, 1, false)", [
        e,
      ]);
      expect(
        await val(
          "SELECT public.guest_register($1, 'C', 'c@example.test', NULL, 1, false)->>'action'",
          [e],
        ),
      ).toBe("throttled");
      // An old pending link no longer works.
      const d = await guest(e, "d@example.test");
      await db.query(
        "UPDATE public.event_registrations SET registered_at = now() - interval '49 hours' WHERE id=$1",
        [d],
      );
      await fails("SELECT public.guest_confirm($1)", [d], "Link is no longer valid");
      // Started events cannot be cancelled (seed the start in the past directly).
      await db.query("ALTER TABLE public.events DISABLE TRIGGER USER");
      await db.query("UPDATE public.events SET start_at = now() - interval '1 hour' WHERE id=$1", [
        e,
      ]);
      await db.query("ALTER TABLE public.events ENABLE TRIGGER USER");
      await fails("SELECT public.guest_cancel($1)", [a], "Event has started");
    }),
  );

  it(
    "'Keep me informed' makes the guest a confirmed subscriber only after the email link",
    tx(async () => {
      const e = await publicEvent();
      const a = await guest(e, "keen@example.test", 1, true);
      expect(
        await rows("SELECT 1 FROM public.subscribers WHERE email='keen@example.test'"),
      ).toEqual([]);
      await db.query("SELECT public.guest_confirm($1)", [a]);
      expect(
        await one(
          "SELECT source, branch_id, confirmed_at IS NOT NULL AS confirmed FROM public.subscribers WHERE email='keen@example.test'",
        ),
      ).toEqual({
        source: "event_registration",
        branch_id: ids.b1,
        confirmed: true,
      });
    }),
  );

  it(
    "guests appear in the attendee list for scope managers (members and guests together); NCs get counts only",
    tx(async () => {
      const e = await publicEvent();
      const a = await guest(e, "list@example.test", 1);
      await guest(e, "pending@example.test", 1);
      await db.query("SELECT public.guest_confirm($1)", [a]);
      await as("vol1");
      await db.query("SELECT public.register_for_event($1)", [e]);
      await as("bm1");
      const list = await rows<{ kind: string; email: string; status: string }>(
        "SELECT kind, email, status FROM public.get_event_attendees($1) ORDER BY kind",
        [e],
      );
      expect(list).toEqual([
        { kind: "guest", email: "list@example.test", status: "registered" },
        { kind: "member", email: "vol1@example.test", status: "registered" },
      ]);
      await as("rd");
      expect(await rows("SELECT * FROM public.get_event_attendees($1)", [e])).toHaveLength(2);
      await as("bm3");
      await fails("SELECT * FROM public.get_event_attendees($1)", [e], "Not allowed");
      await as("nc", "aal2");
      await fails(
        "SELECT * FROM public.get_event_attendees($1)",
        [e],
        /Not allowed|Registrant details are not available/,
      );
      expect(
        await val("SELECT (public.get_event_registration_summary($1)->>'registered_count')::int", [
          e,
        ]),
      ).toBe(2);
    }),
  );
});

describe("online joining link", () => {
  it(
    "reaches a guest's manage view only with a place (confirmed, registered); never the public JSON",
    tx(async () => {
      const link = "https://meet.example.org/room-42";
      const e = await publicEvent({
        location_type: "online",
        location: "",
        online_url: link,
        capacity: 1,
      });
      const a = await guest(e, "online-a@example.test");
      const view = (r: string) =>
        val<Record<string, unknown>>("SELECT public.guest_registration_view($1)", [r]);
      expect((await view(a))["online_url"]).toBeNull(); // pending
      await db.query("SELECT public.guest_confirm($1)", [a]);
      expect((await view(a))["online_url"]).toBe(link);
      const b = await guest(e, "online-b@example.test");
      await db.query("SELECT public.guest_confirm($1)", [b]);
      expect(await val("SELECT status FROM public.event_registrations WHERE id=$1", [b])).toBe(
        "waitlisted",
      );
      expect((await view(b))["online_url"]).toBeNull();
      expect(JSON.stringify(await view(a))).toContain("meet.example.org"); // only in online_url
      expect(JSON.stringify((await view(a))["event"])).not.toContain("meet.example.org");
      expect(JSON.stringify(await val("SELECT public.get_public_event($1)", [e]))).not.toContain(
        "meet.example.org",
      );
      await db.query("SELECT public.guest_cancel($1)", [a]);
      expect((await view(a))["online_url"]).toBeNull();
    }),
  );
});

describe("calendar sequence per attendee", () => {
  it(
    "cancelling and registering again raise the registration's offset, so the next invitation comes after the cancellation",
    tx(async () => {
      const e = await publicEvent();
      const a = await guest(e, "seq@example.test");
      await db.query("SELECT public.guest_confirm($1)", [a]);
      const offset = () =>
        val<number>("SELECT ics_offset FROM public.event_registrations WHERE id=$1", [a]);
      expect(await offset()).toBe(0);
      await db.query("SELECT public.guest_cancel($1)", [a]);
      expect(await offset()).toBe(1);
      // (Three emails within the hour throttle the address; move them back.)
      await db.query(
        "UPDATE public.email_outbox SET created_at = now() - interval '2 hours' WHERE registration_id=$1",
        [a],
      );
      await guest(e, "seq@example.test");
      expect(await offset()).toBe(2);
      expect(
        await val("SELECT (public.email_event_context($1)->'registration'->>'ics_offset')::int", [
          a,
        ]),
      ).toBe(2);
    }),
  );
});

describe("event emails", () => {
  it(
    "time/place changes queue one update per reachable attendee (TBA → place), with SEQUENCE+1; cancel queues cancellations",
    tx(async () => {
      const e = await publicEvent({ location: "", location_tba: true });
      const a = await guest(e, "upd@example.test");
      await guest(e, "unconfirmed@example.test");
      await db.query("SELECT public.guest_confirm($1)", [a]);
      await as("vol1");
      const m = await val<string>("SELECT (public.register_for_event($1)->>'registration_id')", [
        e,
      ]);
      expect(await val("SELECT ics_sequence FROM public.events WHERE id=$1", [e])).toBe(0);
      await as("bm1");
      await db.query("SELECT public.update_event($1, $2::jsonb)", [
        e,
        JSON.stringify(
          payload({ status: "published", location: "Town Hall", location_tba: false }),
        ),
      ]);
      expect(await val("SELECT ics_sequence FROM public.events WHERE id=$1", [e])).toBe(1);
      await service();
      const updates = await outbox("template='event_update'");
      expect(updates.map((u) => u.registration_id).sort()).toEqual([a, m].sort());
      expect(updates[0]?.payload).toMatchObject({ location_announced: true });
      // A second change before sending rides on the same pending row.
      await as("bm1");
      await db.query("SELECT public.update_event($1, $2::jsonb)", [
        e,
        JSON.stringify(payload({ status: "published", location: "Library" })),
      ]);
      await service();
      expect(await outbox("template='event_update'")).toHaveLength(2);
      // Title-only changes send nothing.
      await as("bm1");
      await db.query("SELECT public.update_event($1, $2::jsonb)", [
        e,
        JSON.stringify(payload({ status: "published", location: "Library", title: "Renamed" })),
      ]);
      expect(await val("SELECT ics_sequence FROM public.events WHERE id=$1", [e])).toBe(2);
      await db.query("SELECT public.cancel_event($1)", [e]);
      await service();
      expect(await val("SELECT ics_sequence FROM public.events WHERE id=$1", [e])).toBe(3);
      expect(
        (await outbox("template='event_cancelled'")).map((o) => o.registration_id).sort(),
      ).toEqual([a, m].sort());
      // Pending updates/confirmations of a cancelled event are withdrawn.
      expect(
        await outbox("template IN ('event_update','registration_confirmed') AND status='pending'"),
      ).toEqual([]);
    }),
  );

  it(
    "members events never queue attendee emails; reminders go out 2 London days before, once",
    tx(async () => {
      await as("bm1");
      const members = await val<string>("SELECT public.create_event($1::jsonb)", [
        JSON.stringify(payload({ audience: "members", status: "published" })),
      ]);
      await as("vol1");
      await db.query("SELECT public.register_for_event($1)", [members]);
      await service();
      expect(await outbox("event_id=$1", [members])).toEqual([]);
      const start = await val<string>(
        "SELECT ((((now() AT TIME ZONE 'Europe/London')::date + 2) + time '18:00') AT TIME ZONE 'Europe/London')::text",
      );
      const e = await publicEvent({
        start_at: start,
        end_at: new Date(new Date(start).getTime() + 3600000).toISOString(),
      });
      await as("vol1");
      await db.query("SELECT public.register_for_event($1)", [e]);
      await service();
      expect(await val("SELECT public.enqueue_event_reminders()")).toBe(1);
      expect(await val("SELECT public.enqueue_event_reminders()")).toBe(0);
      expect(await outbox("template='event_reminder'")).toMatchObject([{ priority: 3 }]);
    }),
  );
});

describe("subscribers and announcements", () => {
  it(
    "double opt-in; re-signup never reveals state; unsubscribe cancels pending announcements and keeps only the address",
    tx(async () => {
      await service();
      const s = await val<{ subscriber_id: string; action: string }>(
        "SELECT public.subscriber_signup('Sub@Example.test', 'Sam', $1, 'landing')",
        [ids.b1],
      );
      expect(s.action).toBe("confirm_sent");
      expect(await outbox("subscriber_id=$1", [s.subscriber_id])).toMatchObject([
        { template: "subscriber_confirm", priority: 1 },
      ]);
      expect(
        await val(
          "SELECT public.subscriber_signup('sub@example.test', NULL, NULL, 'landing')->>'action'",
        ),
      ).toBe("throttled");
      expect(await val("SELECT public.subscriber_confirm($1)->>'state'", [s.subscriber_id])).toBe(
        "confirmed",
      );
      expect(
        await val(
          "SELECT public.subscriber_signup('sub@example.test', NULL, NULL, 'landing')->>'action'",
        ),
      ).toBe("already");
      const e = await publicEvent();
      await as("bm1");
      expect(
        await val("SELECT public.announce_event($1, 'branch', $2, NULL, true)", [e, ids.b1]),
      ).toBe(1);
      expect(await val("SELECT public.announce_event($1, 'branch', $2)", [e, ids.b1])).toBe(1);
      expect(await val("SELECT public.announce_event($1, 'branch', $2)", [e, ids.b1])).toBe(0); // once per subscriber
      await service();
      expect(await outbox("template='event_announcement'")).toMatchObject([
        { status: "pending", priority: 4 },
      ]);
      expect(
        await val("SELECT public.subscriber_unsubscribe($1)->>'state'", [s.subscriber_id]),
      ).toBe("unsubscribed");
      expect(await outbox("template='event_announcement'")).toMatchObject([
        { status: "cancelled" },
      ]);
      expect(
        await one(
          "SELECT full_name, unsubscribed_at IS NOT NULL AS out FROM public.subscribers WHERE id=$1",
          [s.subscriber_id],
        ),
      ).toEqual({
        full_name: null,
        out: true,
      });
      // Signing up again (after the 10-minute resend pause) needs a new confirmation.
      await db.query(
        "UPDATE public.subscribers SET confirm_sent_at = now() - interval '11 minutes' WHERE id=$1",
        [s.subscriber_id],
      );
      expect(
        await val(
          "SELECT public.subscriber_signup('sub@example.test', NULL, NULL, 'landing')->>'action'",
        ),
      ).toBe("confirm_sent");
      expect(
        await val("SELECT confirmed_at FROM public.subscribers WHERE id=$1", [s.subscriber_id]),
      ).toBeNull();
    }),
  );

  it(
    "announcement targets stay within the manager's reach",
    tx(async () => {
      const e = await publicEvent();
      await as("bm1");
      await fails(
        "SELECT public.announce_event($1, 'region', NULL, $2, true)",
        [e, ids.r1],
        "Not allowed",
      );
      await fails("SELECT public.announce_event($1, 'all', NULL, NULL, true)", [e], "Not allowed");
      await fails(
        "SELECT public.announce_event($1, 'branch', $2, NULL, true)",
        [e, ids.b2],
        "Not allowed",
      );
      await as("rd");
      expect(
        await val("SELECT public.announce_event($1, 'region', NULL, $2, true)", [e, ids.r1]),
      ).toBe(0);
      expect(
        await val("SELECT public.announce_event($1, 'branch', $2, NULL, true)", [e, ids.b2]),
      ).toBe(0);
      await fails("SELECT public.announce_event($1, 'all', NULL, NULL, true)", [e], "Not allowed");
      await as("bm3");
      await fails(
        "SELECT public.announce_event($1, 'branch', $2, NULL, true)",
        [e, ids.b3],
        "Not allowed",
      ); // not their event
    }),
  );
});

describe("grants", () => {
  it(
    "anon and signed-in clients cannot reach the new tables or the server-only functions",
    tx(async () => {
      const serverOnly = [
        "SELECT public.guest_register($1::uuid, 'x', 'x@example.test', NULL, 1, false)",
        "SELECT public.guest_confirm($1::uuid)",
        "SELECT public.guest_cancel($1::uuid)",
        "SELECT public.guest_registration_view($1::uuid)",
        "SELECT public.subscriber_confirm($1::uuid)",
        "SELECT public.subscriber_unsubscribe($1::uuid)",
        "SELECT public.set_event_video_thumb($1::uuid, 'videos/x.jpg')",
        "SELECT public.finish_email($1::uuid, 'sent')",
        "SELECT public.capture_email($1::uuid, '{}'::jsonb)",
        "SELECT public.email_event_context($1::uuid)",
      ];
      for (const who of ["anon", "authenticated"]) {
        await db.exec("RESET ROLE");
        await db.query("SELECT set_config('request.jwt.claim.sub',$1,true)", [
          who === "anon" ? "" : ids.bm1,
        ]);
        await db.exec(`SET LOCAL ROLE ${who}`);
        for (const sql of serverOnly) await fails(sql, [ids.b1], "permission denied");
        for (const sql of [
          "SELECT public.claim_email_batch()",
          "SELECT public.public_landing_data()",
          "SELECT public.purge_guest_data()",
          "SELECT public.enqueue_event_reminders()",
          "SELECT public.subscriber_signup('a@example.test', NULL, NULL, 'landing')",
          "SELECT public.public_rate_hit('x', 60, 1)",
        ])
          await fails(sql, [], "permission denied");
        for (const table of [
          "event_guests",
          "subscribers",
          "event_announcements",
          "event_videos",
          "public_rate_limits",
          "email_outbox",
        ])
          await fails(`SELECT * FROM public.${table}`, [], "permission denied");
      }
      await db.exec("RESET ROLE");
      await db.exec("SET LOCAL ROLE anon");
      for (const sql of [
        "SELECT * FROM public.get_event_attendees($1::uuid)",
        "SELECT public.create_past_event('x', current_date, $1::uuid, '')",
      ])
        await fails(sql, [ids.b1], "permission denied");
    }),
  );
});

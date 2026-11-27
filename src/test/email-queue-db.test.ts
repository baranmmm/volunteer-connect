import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { initializeRecycleDatabase } from "./recycle-db-fixture";

// The email queue (claim_email_batch / finish_email / capture_email) and guest data retention (purge_guest_data)
// against every migration in PGlite. Each test is rolled back.
const db = new PGlite();
const id = (n: number) => {
  const h = n.toString(16).padStart(2, "0");
  return `${h.repeat(4)}-${h.repeat(2)}-4${h}${h[0]}-8${h}${h[0]}-${h.repeat(6)}`;
};
const ids = { region: id(1), branch: id(2), member: id(10), inactive: id(11) };
type Row = Record<string, unknown>;

async function q<T = Row>(sql: string, params: unknown[] = []) {
  return (await db.query<T>(sql, params)).rows;
}
async function one<T = unknown>(sql: string, params: unknown[] = []) {
  const row = (await db.query<{ v: T }>(sql, params)).rows[0];
  return row?.v as T;
}
async function tx(action: () => Promise<void>) {
  await db.exec("BEGIN");
  try {
    await action();
  } finally {
    await db.exec("ROLLBACK");
  }
}
type Claimed = {
  id: string;
  template: string;
  priority: number;
  attempts: number;
  to_email: string | null;
  skip_reason: string | null;
};
const claim = (max = 20, maxPriority = 5) =>
  q<Claimed>("SELECT * FROM public.claim_email_batch($1, $2)", [max, maxPriority]);
const outbox = (template: string, email: string, extra = "") =>
  one<string>(
    `INSERT INTO email_outbox (template, to_email, payload${extra ? ", " + extra.split("=")[0] : ""})
     VALUES ($1, $2, '{}'::jsonb${extra ? ", " + extra.split("=").slice(1).join("=") : ""}) RETURNING id v`,
    [template, email],
  );
const status = (rowId: string) =>
  one<string>("SELECT status v FROM email_outbox WHERE id=$1", [rowId]);

/** A published public event starting `days` from now. Inserted with triggers off (test fixture: no cover image, and
 * past events that are published already). */
async function publicEvent(days: number, hours = 2) {
  await db.exec("SET LOCAL session_replication_role = replica");
  const eventId = await one<string>(
    `INSERT INTO public.events (title, organizer, category, scope, branch_id, region_id, status, start_at, end_at, location,
       location_type, audience)
     VALUES ('Open dinner', 'Dialogue Society', 'dinner', 'branch', $1, $2, 'published', now() + make_interval(days => $3),
       now() + make_interval(days => $3, hours => $4), 'Hall', 'in_person', 'public') RETURNING id v`,
    [ids.branch, ids.region, days, hours],
  );
  await db.exec("SET LOCAL session_replication_role = origin");
  return eventId;
}
async function guest(
  eventId: string,
  email: string,
  status: string,
  confirmed = true,
  registeredAgo = "0 minutes",
) {
  const reg = await one<string>(
    `INSERT INTO event_registrations (event_id, user_id, status, guest, show_name, registered_at)
     VALUES ($1, NULL, 'pending', true, false, now() - $2::interval) RETURNING id v`,
    [eventId, registeredAgo],
  );
  await db.query(
    `INSERT INTO event_guests (registration_id, event_id, full_name, email, confirmed_at) VALUES ($1, $2, 'Guest', $3, $4)`,
    [reg, eventId, email, confirmed ? new Date().toISOString() : null],
  );
  if (status !== "pending")
    await db.query("UPDATE event_registrations SET status=$2 WHERE id=$1", [reg, status]);
  return reg;
}

beforeAll(async () => {
  await initializeRecycleDatabase(db);
  await db.exec(`INSERT INTO regions(id,name) VALUES ('${ids.region}','Region');
    INSERT INTO branches(id,name,region_id) VALUES ('${ids.branch}','Camden','${ids.region}');
    INSERT INTO auth.users(id, email, raw_user_meta_data) VALUES
      ('${ids.member}', 'member@example.org', jsonb_build_object('full_name','Member','privacy_notice_version','1.7')),
      ('${ids.inactive}', 'inactive@example.org', jsonb_build_object('full_name','Inactive','privacy_notice_version','1.7'));
    UPDATE profiles SET status='active', branch_id='${ids.branch}' WHERE id='${ids.member}';
    UPDATE profiles SET status='inactive', branch_id='${ids.branch}' WHERE id='${ids.inactive}';`);
}, 60000);
afterAll(async () => db.close());

describe("email queue", () => {
  it("claims by priority (transactional, reminders, announcements; 20261208090200), then oldest first", () =>
    tx(async () => {
      const announce = await outbox("event_announcement", "a@example.org");
      const reminder = await outbox("event_reminder", "r@example.org");
      const first = await outbox(
        "guest_confirm",
        "t1@example.org",
        "created_at=now() - interval '1 minute'",
      );
      const second = await outbox("registration_confirmed", "t2@example.org");
      expect(await one("SELECT priority v FROM email_outbox WHERE id=$1", [announce])).toBe(4);
      expect(await one("SELECT priority v FROM email_outbox WHERE id=$1", [reminder])).toBe(3);
      const rows = await claim();
      expect(rows.map((r) => r.id)).toEqual([first, second, reminder, announce]);
      expect(rows.every((r) => r.attempts === 1)).toBe(true);
      expect(await status(first)).toBe("sending");
    }));

  it("max priority leaves announcements for the scheduled run", () =>
    tx(async () => {
      const announce = await outbox("event_announcement", "a@example.org");
      const t = await outbox("guest_confirm", "t@example.org");
      expect((await claim(20, 1)).map((r) => r.id)).toEqual([t]);
      expect(await status(announce)).toBe("pending");
    }));

  it("the daily limit (280: 20 of Brevo's 300 stay for Supabase Auth) counts today's sent and in-flight rows", () =>
    tx(async () => {
      await db.exec(`INSERT INTO email_outbox (template, to_email, status, sent_at)
        SELECT 'guest_confirm', 'x' || g || '@example.org', 'sent', now() FROM generate_series(1, 278) g;
        INSERT INTO email_outbox (template, to_email, status, sent_at)
        SELECT 'guest_confirm', 'old' || g || '@example.org', 'sent', now() - interval '2 days' FROM generate_series(1, 50) g;
        INSERT INTO email_outbox (template, to_email, status, claimed_at) VALUES ('guest_confirm', 'inflight@example.org', 'sending', now());`);
      const a = await outbox("guest_confirm", "a@example.org");
      // One transaction = one now(): order the two explicitly.
      const b = await outbox(
        "guest_confirm",
        "b@example.org",
        "created_at=now() + interval '1 second'",
      );
      expect((await claim()).map((r) => r.id)).toEqual([a]);
      expect(await claim()).toHaveLength(0);
      expect(await status(b)).toBe("pending");
    }));

  it("a stale 'sending' claim (crashed sender) is claimed again", () =>
    tx(async () => {
      const stale = await outbox("guest_confirm", "s@example.org", "status='sending'");
      await db.query(
        "UPDATE email_outbox SET claimed_at = now() - interval '20 minutes', attempts = 1 WHERE id=$1",
        [stale],
      );
      const fresh = await outbox("guest_confirm", "f@example.org", "status='sending'");
      await db.query("UPDATE email_outbox SET claimed_at = now(), attempts = 1 WHERE id=$1", [
        fresh,
      ]);
      const rows = await claim();
      expect(rows.map((r) => r.id)).toEqual([stale]);
      expect(rows[0]!.attempts).toBe(2);
    }));

  it("finish_email: sent, skipped, retry with backoff, failed after 5 attempts", () =>
    tx(async () => {
      const ok = await outbox("guest_confirm", "ok@example.org");
      const skip = await outbox("guest_confirm", "skip@example.org");
      const retry = await outbox("guest_confirm", "retry@example.org");
      await claim();
      await db.query("SELECT public.finish_email($1, 'sent')", [ok]);
      await db.query("SELECT public.finish_email($1, 'skipped', 'invalid_recipient')", [skip]);
      await db.query("SELECT public.finish_email($1, 'retry', 'http_503')", [retry]);
      expect(await status(ok)).toBe("sent");
      expect(await one("SELECT sent_at IS NOT NULL v FROM email_outbox WHERE id=$1", [ok])).toBe(
        true,
      );
      expect(await status(skip)).toBe("skipped");
      expect(await status(retry)).toBe("pending");
      expect(await one("SELECT last_error v FROM email_outbox WHERE id=$1", [retry])).toBe(
        "http_503",
      );
      expect(
        await one(
          "SELECT not_before > now() + interval '9 minutes' v FROM email_outbox WHERE id=$1",
          [retry],
        ),
      ).toBe(true);
      // Backing off: not claimed again yet.
      expect(await claim()).toHaveLength(0);
      await db.query("UPDATE email_outbox SET not_before = NULL, attempts = 4 WHERE id=$1", [
        retry,
      ]);
      expect((await claim()).map((r) => r.attempts)).toEqual([5]);
      await db.query("SELECT public.finish_email($1, 'retry', 'http_503')", [retry]);
      expect(await status(retry)).toBe("failed");
      // A finished row is not changed again.
      await db.query("SELECT public.finish_email($1, 'sent')", [retry]);
      expect(await status(retry)).toBe("failed");
    }));

  it("capture_email stores the rendered email and counts as sent", () =>
    tx(async () => {
      const row = await outbox("guest_confirm", "c@example.org");
      await claim();
      await db.query("SELECT public.capture_email($1, $2::jsonb)", [
        row,
        JSON.stringify({ subject: "Hi", text: "Body" }),
      ]);
      expect(await status(row)).toBe("sent");
      expect(
        await one("SELECT payload->'captured'->>'subject' v FROM email_outbox WHERE id=$1", [row]),
      ).toBe("Hi");
    }));

  it("skip reasons for rows that no longer apply", () =>
    tx(async () => {
      const eventId = await publicEvent(5);
      // A confirmed guest: the trigger queues registration_confirmed.
      const registered = await guest(eventId, "g@example.org", "registered");
      const confirmRow = await one<string>(
        "SELECT id v FROM email_outbox WHERE registration_id=$1 AND template='registration_confirmed'",
        [registered],
      );
      expect(confirmRow).toBeTruthy();
      // guest_confirm for a registration that is no longer pending.
      const stale = await one<string>(
        "SELECT public.enqueue_email('guest_confirm', $1::uuid, NULL, $2::uuid) v",
        [registered, eventId],
      );
      const unsub = await one<string>(
        `INSERT INTO subscribers (email, source, confirmed_at, unsubscribed_at) VALUES ('u@example.org', 'landing', now(), now()) RETURNING id v`,
      );
      const confirmed = await one<string>(
        `INSERT INTO subscribers (email, source, confirmed_at) VALUES ('c@example.org', 'landing', now()) RETURNING id v`,
      );
      const unconfirmed = await one<string>(
        `INSERT INTO subscribers (email, source) VALUES ('n@example.org', 'landing') RETURNING id v`,
      );
      const announceUnsub = await one<string>(
        "SELECT public.enqueue_email('event_announcement', NULL, $1::uuid, $2::uuid, '{}'::jsonb, $3::text) v",
        [unsub, eventId, `announce:${eventId}:${unsub}`],
      );
      const alreadyConfirmed = await one<string>(
        "SELECT public.enqueue_email('subscriber_confirm', NULL, $1::uuid, NULL) v",
        [confirmed],
      );
      const announceUnconfirmed = await one<string>(
        "SELECT public.enqueue_email('event_announcement', NULL, $1::uuid, $2::uuid, '{}'::jsonb, $3::text) v",
        [unconfirmed, eventId, `announce:${eventId}:${unconfirmed}`],
      );
      const inactiveTask = await one<string>(
        "INSERT INTO email_outbox (user_id, template, payload) VALUES ($1, 'task_reminder', '{}'::jsonb) RETURNING id v",
        [ids.inactive],
      );
      const memberTask = await one<string>(
        "INSERT INTO email_outbox (user_id, template, payload) VALUES ($1, 'task_reminder', '{}'::jsonb) RETURNING id v",
        [ids.member],
      );
      const rows = new Map((await claim()).map((r) => [r.id, r]));
      expect(rows.get(confirmRow)?.skip_reason).toBeNull();
      expect(rows.get(confirmRow)?.to_email).toBe("g@example.org");
      expect(rows.get(stale)?.skip_reason).toBe("not_pending");
      expect(rows.get(announceUnsub)?.skip_reason).toBe("unsubscribed");
      expect(rows.get(alreadyConfirmed)?.skip_reason).toBe("already_confirmed");
      expect(rows.get(announceUnconfirmed)?.skip_reason).toBe("not_confirmed");
      expect(rows.get(inactiveTask)?.skip_reason).toBe("no_recipient");
      expect(rows.get(memberTask)?.skip_reason).toBeNull();
      expect(rows.get(memberTask)?.to_email).toBe("member@example.org");
      // The sender's context for a registration email.
      const ctx = await one<{ registration: Row; event: Row; branch: string }>(
        "SELECT public.email_event_context($1) v",
        [registered],
      );
      expect(ctx.registration["guest"]).toBe(true);
      expect(ctx.event["ics_sequence"]).toBe(0);
      expect(ctx.branch).toBe("Camden");
      expect(ctx.event).not.toHaveProperty("created_by");
    }));

  it("event reminders are queued once, two days before", () =>
    tx(async () => {
      // 2 London days ahead at midday: safe regardless of the time the test runs.
      await db.exec("SET LOCAL session_replication_role = replica");
      const eventId = await one<string>(
        `INSERT INTO public.events (title, organizer, category, scope, branch_id, region_id, status, start_at, end_at, location, location_type, audience)
         VALUES ('Soon', 'DS', 'dinner', 'branch', $1, $2, 'published',
           (((now() AT TIME ZONE 'Europe/London')::date + 2) + time '12:00') AT TIME ZONE 'Europe/London',
           (((now() AT TIME ZONE 'Europe/London')::date + 2) + time '14:00') AT TIME ZONE 'Europe/London', 'Hall', 'in_person', 'public') RETURNING id v`,
        [ids.branch, ids.region],
      );
      await db.exec("SET LOCAL session_replication_role = origin");
      await guest(eventId, "r@example.org", "registered");
      await guest(eventId, "w@example.org", "waitlisted");
      expect(await one("SELECT public.enqueue_event_reminders() v")).toBe(1);
      expect(await one("SELECT public.enqueue_event_reminders() v")).toBe(0);
      expect(
        await one(
          "SELECT count(*)::int v FROM email_outbox WHERE template='event_reminder' AND priority=3",
        ),
      ).toBe(1);
    }));
});

describe("guest data retention", () => {
  it("purge_guest_data removes old guest registrations, pending guests and unconfirmed subscribers", () =>
    tx(async () => {
      const old = await publicEvent(-400);
      const recent = await publicEvent(-30);
      const future = await publicEvent(10);
      const oldGuest = await guest(old, "keep@example.org", "registered");
      const recentGuest = await guest(recent, "recent@example.org", "registered");
      const stalePending = await guest(future, "pending@example.org", "pending", false, "49 hours");
      const freshPending = await guest(future, "fresh@example.org", "pending", false, "1 hour");
      const subscriber = await one<string>(
        `INSERT INTO subscribers (email, source, confirmed_at) VALUES ('keep@example.org', 'event_registration', now() - interval '400 days') RETURNING id v`,
      );
      const staleSub = await one<string>(
        `INSERT INTO subscribers (email, source, confirm_sent_at, created_at) VALUES ('stale@example.org', 'landing', now() - interval '8 days', now() - interval '8 days') RETURNING id v`,
      );
      const freshSub = await one<string>(
        `INSERT INTO subscribers (email, source, confirm_sent_at) VALUES ('freshsub@example.org', 'landing', now() - interval '2 days') RETURNING id v`,
      );
      const oldSent = await outbox("guest_confirm", "o@example.org", "status='sent'");
      await db.query("UPDATE email_outbox SET sent_at = now() - interval '31 days' WHERE id=$1", [
        oldSent,
      ]);
      const result = await one<Record<string, number>>("SELECT public.purge_guest_data() v");
      expect(result["guest_registrations"]).toBe(1);
      expect(result["pending_guests"]).toBe(1);
      expect(result["unconfirmed_subscribers"]).toBe(1);
      expect(result["outbox"]).toBeGreaterThanOrEqual(1);
      const regs = (await q<{ id: string }>("SELECT id FROM event_registrations")).map((r) => r.id);
      expect(regs).not.toContain(oldGuest);
      expect(regs).not.toContain(stalePending);
      expect(regs).toContain(recentGuest);
      expect(regs).toContain(freshPending);
      expect(
        await one("SELECT count(*)::int v FROM event_guests WHERE email='keep@example.org'"),
      ).toBe(0);
      const subs = (await q<{ id: string }>("SELECT id FROM subscribers")).map((r) => r.id);
      expect(subs).toContain(subscriber);
      expect(subs).toContain(freshSub);
      expect(subs).not.toContain(staleSub);
      expect(await one("SELECT count(*)::int v FROM email_outbox WHERE id=$1", [oldSent])).toBe(0);
    }));
});

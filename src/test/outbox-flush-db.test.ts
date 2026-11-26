import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { initializeRecycleDatabase } from "./recycle-db-fixture";

// The outbox tick (20261213090000) against every migration in PGlite (no pg_cron, pg_net or Vault: the migration skips
// the cron job with a NOTICE): outbox_flush_due() says whether pushes or emails are due, and outbox_flush_tick() never
// raises (here it cannot reach Vault). Neither is callable by anon or authenticated. Rolled back per test.
const db = new PGlite();
const USER = "0c0c0c0c-0c0c-4c0c-8c0c-0c0c0c0c0c0c";
const KEY = "B" + "a".repeat(86);
const AUTH = "c".repeat(22);

async function tx(action: () => Promise<void>) {
  await db.exec("BEGIN");
  try {
    await action();
  } finally {
    await db.exec("ROLLBACK");
  }
}
const due = async () =>
  (await db.query<{ v: boolean }>("SELECT public.outbox_flush_due() v")).rows[0]!.v;
async function queuePush(sql: string) {
  await db.exec(`INSERT INTO public.notifications(id, user_id, kind, entity_type, entity_id, title, link)
      VALUES ('0d0d0d0d-0d0d-4d0d-8d0d-0d0d0d0d0d0d', '${USER}', 'task_assigned', 'task', gen_random_uuid(), 't', '/tasks')
      ON CONFLICT DO NOTHING;
    INSERT INTO public.push_subscriptions(id, user_id, endpoint, p256dh, auth)
      VALUES ('0e0e0e0e-0e0e-4e0e-8e0e-0e0e0e0e0e0e', '${USER}', 'https://push.example.test/x', '${KEY}', '${AUTH}')
      ON CONFLICT DO NOTHING;
    INSERT INTO public.push_outbox(user_id, subscription_id, notification_id, type, status, not_before, claimed_at)
      SELECT '${USER}', '0e0e0e0e-0e0e-4e0e-8e0e-0e0e0e0e0e0e', '0d0d0d0d-0d0d-4d0d-8d0d-0d0d0d0d0d0d', 'task_assigned', ${sql};`);
}
const queueEmail = (sql: string) =>
  db.exec(`INSERT INTO public.email_outbox(to_email, template, priority, status, not_before, claimed_at, sent_at) SELECT
    'person@example.test', 'task_reminder', 3, ${sql}`);

beforeAll(async () => {
  await initializeRecycleDatabase(db);
  await db.exec(`INSERT INTO auth.users(id) VALUES ('${USER}');`);
}, 60000);
afterAll(async () => db.close());

describe("outbox_flush_due", () => {
  it("nothing waiting, or only pushes and emails not due yet: false", () =>
    tx(async () => {
      expect(await due()).toBe(false);
      await queuePush("'pending', now() + interval '2 minutes', NULL");
      await queuePush("'sending', NULL, now() - interval '1 minute'");
      await queuePush("'sent', NULL, NULL");
      await queueEmail("'pending', now() + interval '5 minutes', NULL, NULL");
      await queueEmail("'sending', NULL, now() - interval '5 minutes', NULL");
      await queueEmail("'failed', NULL, NULL, NULL");
      expect(await due()).toBe(false);
    }));

  it("a due push (not_before passed or none) or a stale push claim: true", async () => {
    for (const row of [
      "'pending', NULL, NULL",
      "'pending', now() - interval '1 second', NULL",
      "'sending', NULL, now() - interval '6 minutes'",
    ])
      await tx(async () => {
        await queuePush(row);
        expect(await due()).toBe(true);
      });
  });

  it("a due email or a stale email claim: true; not while the London day's limit is used up", async () => {
    for (const row of [
      "'pending', NULL, NULL, NULL",
      "'sending', NULL, now() - interval '16 minutes', NULL",
    ])
      await tx(async () => {
        await queueEmail(row);
        expect(await due()).toBe(true);
      });
    await tx(async () => {
      await queueEmail("'pending', NULL, NULL, NULL");
      await db.exec(`INSERT INTO public.email_outbox(to_email, template, priority, status, sent_at)
        SELECT 'person@example.test', 'task_reminder', 3, 'sent', now() FROM generate_series(1, public.email_daily_limit())`);
      expect(await due()).toBe(false);
    });
  });
});

describe("outbox_flush_tick", () => {
  it("never raises without pg_net / Vault; does nothing when nothing is due", () =>
    tx(async () => {
      await db.query("SELECT public.outbox_flush_tick()");
      await queuePush("'pending', NULL, NULL");
      await db.query("SELECT public.outbox_flush_tick()");
      // The row stays for the app (the tick only asks the app to send).
      expect(
        (
          await db.query<{ n: number }>(
            "SELECT count(*)::int n FROM public.push_outbox WHERE status = 'pending'",
          )
        ).rows[0]!.n,
      ).toBe(1);
    }));

  it("no client can call either function", async () => {
    for (const role of ["anon", "authenticated"])
      for (const fn of ["outbox_flush_due()", "outbox_flush_tick()"])
        await tx(async () => {
          await db.exec(`SET LOCAL ROLE ${role}`);
          await expect(db.query(`SELECT public.${fn}`)).rejects.toThrow("permission denied");
        });
    const grants = await db.query<{ p: string; tick: boolean; flushdue: boolean }>(
      `SELECT r p, has_function_privilege(r, 'public.outbox_flush_tick()', 'EXECUTE') tick,
         has_function_privilege(r, 'public.outbox_flush_due()', 'EXECUTE') flushdue
       FROM unnest(ARRAY['anon', 'authenticated', 'service_role']) r ORDER BY r`,
    );
    expect(grants.rows).toEqual([
      { p: "anon", tick: false, flushdue: false },
      { p: "authenticated", tick: false, flushdue: false },
      { p: "service_role", tick: false, flushdue: true },
    ]);
  });
});

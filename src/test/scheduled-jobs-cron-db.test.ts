import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { initializeRecycleDatabase } from "./recycle-db-fixture";

// The scheduled jobs on pg_cron (20261214090000) against every migration in PGlite (no pg_cron, pg_net or Vault: the
// migration skips the cron jobs with a NOTICE): post_scheduled_route() only takes /api/public/ paths and never raises
// (here it cannot reach Vault, so it returns NULL); recycle_bin_cleanup_tick() never raises; no client can call either.
const db = new PGlite();

async function tx(action: () => Promise<void>) {
  await db.exec("BEGIN");
  try {
    await action();
  } finally {
    await db.exec("ROLLBACK");
  }
}
const post = async (path: string | null) =>
  (await db.query<{ id: string | null }>("SELECT public.post_scheduled_route($1) id", [path]))
    .rows[0]!.id;

beforeAll(async () => {
  await initializeRecycleDatabase(db);
}, 60000);
afterAll(async () => db.close());

describe("post_scheduled_route", () => {
  it("returns NULL without raising: bad paths, and no Vault / pg_net", () =>
    tx(async () => {
      for (const path of [
        null,
        "",
        "/api/private/x",
        "https://evil.example/api/public/x",
        "/api/public/../admin",
        "/api/public/x?y=1",
        "/api/public/cleanup-deleted-events",
      ])
        expect(await post(path)).toBeNull();
    }));
});

describe("recycle_bin_cleanup_tick", () => {
  it("never raises without pg_net / Vault", () =>
    tx(async () => {
      await db.query("SELECT public.recycle_bin_cleanup_tick()");
    }));

  it("no client can call either function", async () => {
    for (const role of ["anon", "authenticated"])
      for (const fn of [
        "post_scheduled_route('/api/public/outbox-flush')",
        "recycle_bin_cleanup_tick()",
      ])
        await tx(async () => {
          await db.exec(`SET LOCAL ROLE ${role}`);
          await expect(db.query(`SELECT public.${fn}`)).rejects.toThrow("permission denied");
        });
    const grants = await db.query<{ p: string; post: boolean; tick: boolean }>(
      `SELECT r p, has_function_privilege(r, 'public.post_scheduled_route(text, integer)', 'EXECUTE') post,
         has_function_privilege(r, 'public.recycle_bin_cleanup_tick()', 'EXECUTE') tick
       FROM unnest(ARRAY['anon', 'authenticated', 'service_role']) r ORDER BY r`,
    );
    expect(grants.rows).toEqual([
      { p: "anon", post: false, tick: false },
      { p: "authenticated", post: false, tick: false },
      { p: "service_role", post: false, tick: false },
    ]);
  });
});

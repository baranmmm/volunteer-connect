// Removes per-test users (fresh-*@<domain>), their deletion requests and leftover test events ("E2E Event …").
// Seeded users stay and are reset by the next seed. Audit rows remain (user references are set to NULL).
import { adminClient, deleteAuthUser, listAllUsers } from "../api/SupabaseClient";
import { deleteLeftoverTestEvents } from "../api/events";
import { FRESH_PREFIX } from "../data/users";
import { emailDomain, isMain } from "./env";
import { assertQaEnvironment } from "./guard";

/** Fresh users of other, possibly still running, runs are left alone until they are this old. */
export const STALE_FRESH_USER_MS = 2 * 60 * 60 * 1000;

/**
 * The QA database is shared by CI and local runs, so teardown never deletes another run's users while that run
 * may still be using them. It removes only fresh-* users of this run (E2E_RUN_ID, which CI always sets) and
 * fresh-* users older than STALE_FRESH_USER_MS (leftovers of interrupted runs).
 */
export async function teardown(): Promise<number> {
  assertQaEnvironment();
  const suffix = `@${emailDomain()}`.toLowerCase();
  const runId = process.env["E2E_RUN_ID"]?.trim().toLowerCase();
  const ownPrefix = runId ? `${FRESH_PREFIX}${runId}-` : null;
  const staleBefore = Date.now() - STALE_FRESH_USER_MS;
  let kept = 0;
  const fresh = (await listAllUsers()).filter((u) => {
    const email = u.email?.toLowerCase() ?? "";
    if (!email.startsWith(FRESH_PREFIX) || !email.endsWith(suffix)) return false;
    if ((ownPrefix && email.startsWith(ownPrefix)) || Date.parse(u.created_at) < staleBefore) return true;
    kept++;
    return false;
  });
  if (fresh.length) {
    const { error } = await adminClient().from("account_deletion_requests").delete().in("user_id", fresh.map((u) => u.id));
    if (error) throw new Error(`delete deletion requests: ${error.message}`);
  }
  // Events first: they are identified by their fresh-* creator, which deleting the user would null out.
  const events = await deleteLeftoverTestEvents(fresh.map((u) => u.id));
  for (const user of fresh) await deleteAuthUser(user.id);
  console.log(`[teardown] Removed ${fresh.length} fresh test user(s) and ${events} leftover test event(s).` +
    (kept ? ` Kept ${kept} recent fresh user(s) of other runs (${runId ? "not run " + runId : "no E2E_RUN_ID set"}).` : ""));
  return fresh.length;
}

if (isMain(import.meta.url)) {
  teardown().catch((e) => {
    console.error(`[teardown] ${(e as Error).message}`);
    process.exit(1);
  });
}

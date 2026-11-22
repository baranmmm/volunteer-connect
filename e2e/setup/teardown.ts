// Removes per-test users (fresh-*@<domain>), their deletion requests and leftover test events ("E2E Event …").
// Seeded users stay and are reset by the next seed. Audit rows remain (user references are set to NULL).
import { adminClient, deleteAuthUser, listAllUsers } from "../api/SupabaseClient";
import { deleteLeftoverTestEvents } from "../api/events";
import { FRESH_PREFIX } from "../data/users";
import { emailDomain, isMain } from "./env";
import { assertQaEnvironment } from "./guard";

export async function teardown(): Promise<number> {
  assertQaEnvironment();
  const suffix = `@${emailDomain()}`.toLowerCase();
  const fresh = (await listAllUsers()).filter((u) => {
    const email = u.email?.toLowerCase() ?? "";
    return email.startsWith(FRESH_PREFIX) && email.endsWith(suffix);
  });
  if (fresh.length) {
    const { error } = await adminClient().from("account_deletion_requests").delete().in("user_id", fresh.map((u) => u.id));
    if (error) throw new Error(`delete deletion requests: ${error.message}`);
  }
  for (const user of fresh) await deleteAuthUser(user.id);
  const events = await deleteLeftoverTestEvents();
  console.log(`[teardown] Removed ${fresh.length} fresh test user(s) and ${events} leftover test event(s).`);
  return fresh.length;
}

if (isMain(import.meta.url)) {
  teardown().catch((e) => {
    console.error(`[teardown] ${(e as Error).message}`);
    process.exit(1);
  });
}

// Idempotent QA seed: verifies the schema, then creates/resets the fixed test users.
// Order on a fresh QA project: npm run qa:migrate → npm run qa:seed → npm test
import { mkdirSync, writeFileSync } from "node:fs";
import { ensureUser, listAllUsers } from "../api/SupabaseClient";
import { SEED_USERS, seedEmail, type RoleKey, type SeedState, type SeededUser } from "../data/users";
import { AUTH_DIR, SEED_STATE_FILE, isMain, userPassword } from "./env";
import { assertQaEnvironment } from "./guard";
import { runPreflight } from "./preflight";

export async function seed(): Promise<SeedState> {
  assertQaEnvironment();
  if (userPassword().length < 8) throw new Error("E2E_USER_PASSWORD must be at least 8 characters.");

  const { regionId, branches, regionBranches } = await runPreflight();
  console.log(`[seed] Schema OK. Region ${regionId}, branches Medway=${branches.Medway}, Brighton=${branches.Brighton}`);

  const existing = new Map((await listAllUsers()).map((u) => [u.email?.toLowerCase(), u.id]));
  const users = {} as Record<RoleKey, SeededUser>;
  for (const key of Object.keys(SEED_USERS) as RoleKey[]) {
    const def = SEED_USERS[key];
    const email = seedEmail(key);
    const branchId = def.branch ? branches[def.branch] : null;
    const id = await ensureUser(
      { email, fullName: def.fullName, branchId, role: def.role, regionId, status: def.status, language: "en" },
      existing.get(email.toLowerCase()) ?? null,
    );
    users[key] = { key, id, email, fullName: def.fullName, branchId };
    console.log(`[seed] ${existing.has(email.toLowerCase()) ? "reset  " : "created"} ${key.padEnd(18)} ${email}`);
  }

  const state: SeedState = { regionId, branches, regionBranches, users };
  mkdirSync(AUTH_DIR, { recursive: true });
  writeFileSync(SEED_STATE_FILE, JSON.stringify(state, null, 2));
  console.log(`[seed] Wrote ${SEED_STATE_FILE}`);
  return state;
}

if (isMain(import.meta.url)) {
  seed().catch((e) => {
    console.error(`[seed] ${(e as Error).message}`);
    process.exit(1);
  });
}


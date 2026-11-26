// Idempotent QA seed: verifies the schema, then creates/resets the fixed test users.
// Order on a fresh QA project: npm run qa:migrate → npm run qa:seed → npm test
import { mkdirSync, writeFileSync } from "node:fs";
import { enrollTotp, ensureUser, listAllUsers } from "../api/SupabaseClient";
import { SEED_USERS, seedEmail, type RoleKey, type SeedState, type SeededUser } from "../data/users";
import { AUTH_DIR, NC_TOTP_FILE, SEED_STATE_FILE, isLocalTarget, isMain, userPassword } from "./env";
import { acquireLocalStackLock } from "./local-lock";
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
      { email, fullName: def.fullName, branchId, role: def.role, regionId, status: def.status, language: "en", followBranchId: branchId ?? branches.Medway },
      existing.get(email.toLowerCase()) ?? null,
    );
    users[key] = { key, id, email, fullName: def.fullName, branchId };
    console.log(`[seed] ${existing.has(email.toLowerCase()) ? "reset  " : "created"} ${key.padEnd(18)} ${email}`);
  }

  // The NC needs a TOTP factor. Locally the seed enrols one and keeps the secret in e2e/.auth/local (throwaway stack);
  // on QA the factor and E2E_NC_TOTP_SECRET come from `npm run qa:nc-mfa`, which the seed never changes.
  if (isLocalTarget()) {
    const secret = await enrollTotp(users.nationalCoordinator.email);
    mkdirSync(AUTH_DIR, { recursive: true });
    writeFileSync(NC_TOTP_FILE, JSON.stringify({ secret }));
    console.log("[seed] NC authenticator enrolled (local)");
  } else if (!process.env["E2E_NC_TOTP_SECRET"]) {
    console.log("[seed] E2E_NC_TOTP_SECRET is not set: NC tests need it (run npm run qa:nc-mfa once, then add the GitHub secret).");
  }

  const state: SeedState = { regionId, branches, regionBranches, users };
  mkdirSync(AUTH_DIR, { recursive: true });
  writeFileSync(SEED_STATE_FILE, JSON.stringify(state, null, 2));
  console.log(`[seed] Wrote ${SEED_STATE_FILE}`);
  return state;
}

if (isMain(import.meta.url)) {
  if (isLocalTarget()) acquireLocalStackLock("local:seed");
  seed().catch((e) => {
    console.error(`[seed] ${(e as Error).message}`);
    process.exit(1);
  });
}


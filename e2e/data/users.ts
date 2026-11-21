import { readFileSync, existsSync } from "node:fs";
import { SEED_STATE_FILE, emailDomain } from "../setup/env";
import type { AppRole, ProfileStatus } from "../api/SupabaseClient";

export const REGION = "South of England";
export type BranchName = "Medway" | "Brighton";

export type RoleKey =
  | "director"
  | "managerMedway"
  | "volunteerMedway"
  | "pendingMedway"
  | "managerBrighton"
  | "volunteerBrighton"
  | "pendingBrighton"
  | "disposable";

type SeedUser = { localPart: string; fullName: string; branch: BranchName | null; role: AppRole; status: ProfileStatus };

/** Fixed, idempotently seeded users. Tests never mutate them; mutating tests use freshUser(). */
export const SEED_USERS: Record<RoleKey, SeedUser> = {
  director: { localPart: "director", fullName: "E2E Director South", branch: null, role: "regional_director", status: "active" },
  managerMedway: { localPart: "manager.medway", fullName: "E2E Manager Medway", branch: "Medway", role: "branch_manager", status: "active" },
  volunteerMedway: { localPart: "volunteer.medway", fullName: "E2E Volunteer Medway", branch: "Medway", role: "volunteer", status: "active" },
  pendingMedway: { localPart: "pending.medway", fullName: "E2E Pending Medway", branch: "Medway", role: "volunteer", status: "pending" },
  managerBrighton: { localPart: "manager.brighton", fullName: "E2E Manager Brighton", branch: "Brighton", role: "branch_manager", status: "active" },
  volunteerBrighton: { localPart: "volunteer.brighton", fullName: "E2E Volunteer Brighton", branch: "Brighton", role: "volunteer", status: "active" },
  pendingBrighton: { localPart: "pending.brighton", fullName: "E2E Pending Brighton", branch: "Brighton", role: "volunteer", status: "pending" },
  disposable: { localPart: "disposable", fullName: "E2E Disposable User", branch: "Medway", role: "volunteer", status: "active" },
};

/** Roles that get a storageState file in auth.setup.ts. */
export const STORAGE_ROLES: RoleKey[] = ["director", "managerMedway", "volunteerMedway", "pendingMedway", "managerBrighton", "volunteerBrighton", "pendingBrighton"];

export const seedEmail = (key: RoleKey) => `${SEED_USERS[key].localPart}@${emailDomain()}`;
export const FRESH_PREFIX = "fresh-";

export type SeededUser = { key: RoleKey; id: string; email: string; fullName: string; branchId: string | null };
export type SeedState = {
  regionId: string;
  branches: Record<BranchName, string>;
  /** All branches in the region, ordered by name exactly like the app's branch selects. */
  regionBranches: { id: string; name: string }[];
  users: Record<RoleKey, SeededUser>;
};

export function readSeedState(): SeedState {
  if (!existsSync(SEED_STATE_FILE)) throw new Error("Seed state not found (e2e/.auth/users.json). Run `npm run qa:seed` first.");
  return JSON.parse(readFileSync(SEED_STATE_FILE, "utf8")) as SeedState;
}

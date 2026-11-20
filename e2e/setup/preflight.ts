// Verifies the QA schema exists before seeding. Fails with a clear "run migrate first" message.
import { adminClient } from "../api/SupabaseClient";
import { REGION, type BranchName } from "../data/users";

const REQUIRED_TABLES = ["regions", "branches", "profiles", "user_roles", "user_audit_log", "account_deletion_requests"] as const;
const REQUIRED_BRANCHES: BranchName[] = ["Medway", "Brighton"];
const MISSING_TABLE_CODES = new Set(["PGRST205", "42P01", "PGRST106"]);

export class MissingSchemaError extends Error {}

const migrateHint = (what: string) =>
  `QA şeması eksik (${what}). Önce migrate çalıştırın: cd e2e && npm run qa:migrate ` +
  `(CI'da: "QA DB migrate" workflow'unu elle tetikleyin). / QA schema missing — run migrate first.`;

export async function runPreflight() {
  const db = adminClient();
  const missing: string[] = [];
  for (const table of REQUIRED_TABLES) {
    const { error } = await db.from(table).select("*", { count: "exact", head: true }).limit(1);
    if (!error) continue;
    if (MISSING_TABLE_CODES.has(error.code ?? "") || /does not exist|could not find the table/i.test(error.message)) missing.push(table);
    else throw new Error(`Preflight could not read ${table}: ${error.message}`);
  }
  if (missing.length) throw new MissingSchemaError(migrateHint(`tablolar: ${missing.join(", ")}`));

  const region = await db.from("regions").select("id").eq("name", REGION).maybeSingle();
  if (region.error) throw new Error(`Preflight: ${region.error.message}`);
  if (!region.data) throw new MissingSchemaError(migrateHint(`bölge: ${REGION}`));
  const regionId = (region.data as { id: string }).id;

  const branches = await db.from("branches").select("id, name").eq("region_id", regionId).order("name");
  if (branches.error) throw new Error(`Preflight: ${branches.error.message}`);
  const regionBranches = (branches.data ?? []) as { id: string; name: string }[];
  const missingBranches = REQUIRED_BRANCHES.filter((b) => !regionBranches.some((r) => r.name === b));
  if (missingBranches.length) throw new MissingSchemaError(migrateHint(`şubeler: ${missingBranches.join(", ")}`));

  const byName = Object.fromEntries(regionBranches.map((b) => [b.name, b.id]));
  return {
    regionId,
    regionBranches,
    branches: { Medway: byName["Medway"]!, Brighton: byName["Brighton"]! } as Record<BranchName, string>,
  };
}

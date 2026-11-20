import { config } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const E2E_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const REPO_ROOT = path.resolve(E2E_DIR, "..");
export const AUTH_DIR = path.join(E2E_DIR, ".auth");
export const SEED_STATE_FILE = path.join(AUTH_DIR, "users.json");
/** storageState file written by setup/auth.setup.ts for a seeded role. */
export const storageFile = (role: string) => path.join(AUTH_DIR, `${role}.json`);

// Loads e2e/.env.qa only (never the repo-root .env, which points at production).
// Values already present in the environment (e.g. GitHub Actions secrets) win.
config({ path: path.join(E2E_DIR, ".env.qa") });

export function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing environment variable ${name}. Copy e2e/.env.qa.example to e2e/.env.qa and fill it in.`);
  return value;
}

export const emailDomain = () => process.env["E2E_EMAIL_DOMAIN"]?.trim() || "dsvolunteer.test";
export const userPassword = () => requireEnv("E2E_USER_PASSWORD");
export const baseUrl = () => process.env["BASE_URL"]?.trim() || "http://localhost:3100";

/** True when the given module is the entry point (`tsx setup/x.ts`). */
export function isMain(moduleUrl: string): boolean {
  return !!process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(moduleUrl);
}

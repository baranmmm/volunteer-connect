import { config } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const E2E_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const REPO_ROOT = path.resolve(E2E_DIR, "..");
export const AUTH_DIR = path.join(E2E_DIR, ".auth");
export const SEED_STATE_FILE = path.join(AUTH_DIR, "users.json");
/** storageState file written by setup/auth.setup.ts for a seeded role. */
export const storageFile = (role: string) => path.join(AUTH_DIR, `${role}.json`);

/** E2E_TARGET=local: the local Docker stack (`npm run local:up`) instead of the remote QA project. */
export const isLocalTarget = () => process.env["E2E_TARGET"] === "local";
/**
 * Password of every test user on the LOCAL stack: a fixed, public test value (that stack is throwaway and only
 * reachable from this machine). Never used against QA, whose password comes from E2E_USER_PASSWORD.
 */
export const LOCAL_TEST_PASSWORD = "local-e2e-only-Passw0rd";
export const LOCAL_ENV_FILE = path.join(E2E_DIR, ".env.local");

// Loads e2e/.env.qa (QA) or e2e/.env.local (local stack, written by `npm run local:up`) — never the repo-root
// .env, which points at production. Values already present in the environment (e.g. GitHub Actions secrets) win.
config({ path: isLocalTarget() ? LOCAL_ENV_FILE : path.join(E2E_DIR, ".env.qa") });

export function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(isLocalTarget()
      ? `Missing environment variable ${name}. Start the local stack first: npm run local:up`
      : `Missing environment variable ${name}. Copy e2e/.env.qa.example to e2e/.env.qa and fill it in.`);
  }
  return value;
}

export const emailDomain = () => process.env["E2E_EMAIL_DOMAIN"]?.trim() || "dsvolunteer.test";
export const userPassword = () => (isLocalTarget() ? LOCAL_TEST_PASSWORD : requireEnv("E2E_USER_PASSWORD"));
export const baseUrl = () => process.env["BASE_URL"]?.trim() || "http://localhost:3100";

/** True when the given module is the entry point (`tsx setup/x.ts`). */
export function isMain(moduleUrl: string): boolean {
  return !!process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(moduleUrl);
}

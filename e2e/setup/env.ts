import { config } from "dotenv";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const E2E_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const REPO_ROOT = path.resolve(E2E_DIR, "..");
// The local stack keeps its own seed state and sessions (e2e/.auth/local), so it never overwrites QA's.
export const AUTH_DIR = process.env["E2E_TARGET"] === "local" ? path.join(E2E_DIR, ".auth", "local") : path.join(E2E_DIR, ".auth");
export const SEED_STATE_FILE = path.join(AUTH_DIR, "users.json");
/** Local stack only: the seeded NC's TOTP secret (throwaway). QA uses E2E_NC_TOTP_SECRET from e2e/.env.qa / CI. */
export const NC_TOTP_FILE = path.join(AUTH_DIR, "nc-totp.json");
export function ncTotpSecret(): string | null {
  if (process.env["E2E_TARGET"] === "local") {
    try { return (JSON.parse(readFileSync(NC_TOTP_FILE, "utf8")) as { secret?: string }).secret ?? null; } catch { return null; }
  }
  return process.env["E2E_NC_TOTP_SECRET"]?.trim() || null;
}
/** E2E_LOCAL_PORT (local target only): this run's app port, for parallel local shards that each start a dev server. */
function isLocalPort(): boolean {
  return process.env["E2E_TARGET"] === "local" && /^\d{4,5}$/.test(process.env["E2E_LOCAL_PORT"]?.trim() ?? "");
}
// Sessions are tied to the app's origin: parallel local shards keep their own, next to the shared seed state.
const SESSION_DIR = isLocalPort() ? path.join(AUTH_DIR, `port-${process.env["E2E_LOCAL_PORT"]!.trim()}`) : AUTH_DIR;
/** storageState file written by setup/auth.setup.ts for a seeded role. */
export const storageFile = (role: string) => path.join(SESSION_DIR, `${role}.json`);

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
// Locally the generated file wins over the shell, so a QA value exported in the terminal can never mix in.
config(isLocalTarget() ? { path: LOCAL_ENV_FILE, override: true } : { path: path.join(E2E_DIR, ".env.qa") });
// Parallel local shards (`--shard=n/3` at the same time) each need their own dev server: E2E_LOCAL_PORT moves the
// local app to another localhost port. Local target only; QA and CI keep BASE_URL.
if (isLocalPort()) process.env["BASE_URL"] = `http://localhost:${process.env["E2E_LOCAL_PORT"]!.trim()}`;

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

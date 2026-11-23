import { isLocalTarget, isMain } from "./env";

export const QA_REF = "impdbvwsaancutwlrmac";
export const PROD_REF = "kcxmjscxooqqhsgrhknb";
export const QA_HOST = `${QA_REF}.supabase.co`;

type Env = Record<string, string | undefined>;

class GuardError extends Error {
  constructor(message: string) {
    super(`[e2e guard] ${message} — aborting. Tests may only run against ds-volunteer-qa (${QA_REF}).`);
    this.name = "GuardError";
  }
}

function jwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.split(".");
  if (parts.length !== 3 || !parts[1]) return null;
  try {
    return JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * Throws unless the environment unambiguously targets the QA project.
 * Called by playwright.config, start-app, migrate, seed, teardown and the API client.
 */
export function assertQaEnvironment(env: Env = process.env, opts: { requireDb?: boolean } = {}): void {
  // 1. The production ref must not appear anywhere in the environment.
  for (const [name, value] of Object.entries(env)) {
    if (value?.includes(PROD_REF)) throw new GuardError(`${name} contains the production project ref`);
  }
  if (env["E2E_TARGET"] === "local") return assertLocalEnvironment(env, opts);

  // 2. Explicit QA ref and URL.
  if (env["SUPABASE_PROJECT_REF"] !== QA_REF) {
    throw new GuardError(`SUPABASE_PROJECT_REF must be "${QA_REF}" (got "${env["SUPABASE_PROJECT_REF"] ?? ""}")`);
  }
  for (const name of ["SUPABASE_URL", "VITE_SUPABASE_URL"]) {
    const value = env[name];
    if (value === undefined && name.startsWith("VITE_")) continue;
    let host = "";
    try {
      host = new URL(value ?? "").hostname;
    } catch {
      throw new GuardError(`${name} is missing or not a URL`);
    }
    if (host !== QA_HOST) throw new GuardError(`${name} host must be ${QA_HOST} (got ${host})`);
  }
  if (env["VITE_SUPABASE_PROJECT_ID"] !== undefined && env["VITE_SUPABASE_PROJECT_ID"] !== QA_REF) {
    throw new GuardError("VITE_SUPABASE_PROJECT_ID does not match the QA ref");
  }

  // 3. The service_role key must never be exposed through a VITE_* variable.
  const serviceKey = env["SUPABASE_SERVICE_ROLE_KEY"];
  for (const [name, value] of Object.entries(env)) {
    if (!name.startsWith("VITE_")) continue;
    if (/SERVICE|SECRET/i.test(name)) throw new GuardError(`${name} looks like a server secret in a VITE_ variable`);
    if (serviceKey && value === serviceKey) throw new GuardError(`${name} contains the service_role key`);
    if (value?.startsWith("sb_secret_")) throw new GuardError(`${name} contains a secret API key`);
  }

  // 4. Legacy JWT keys carry their project ref; check it when available.
  for (const name of ["SUPABASE_PUBLISHABLE_KEY", "SUPABASE_SERVICE_ROLE_KEY"]) {
    const payload = env[name] ? jwtPayload(env[name]!) : null;
    if (payload && "ref" in payload && payload["ref"] !== QA_REF) throw new GuardError(`${name} belongs to project "${String(payload["ref"])}"`);
  }
  if (env["SUPABASE_PUBLISHABLE_KEY"]?.startsWith("sb_secret_")) {
    throw new GuardError("SUPABASE_PUBLISHABLE_KEY contains a secret key; use the publishable/anon key");
  }

  // 5. Database access must go through the Session pooler (IPv4), never the IPv6-only direct host.
  const pooler = env["SUPABASE_DB_POOLER_URL"];
  if (pooler || opts.requireDb) {
    let url: URL;
    try {
      url = new URL(pooler ?? "");
    } catch {
      throw new GuardError("SUPABASE_DB_POOLER_URL is missing or not a URL");
    }
    if (url.hostname.startsWith("db.")) throw new GuardError("SUPABASE_DB_POOLER_URL is a direct connection; use the Session pooler URL");
    if (!url.hostname.endsWith(".pooler.supabase.com")) throw new GuardError("SUPABASE_DB_POOLER_URL host must end with .pooler.supabase.com");
    if (decodeURIComponent(url.username) !== `postgres.${QA_REF}`) throw new GuardError(`SUPABASE_DB_POOLER_URL user must be postgres.${QA_REF}`);
    if (url.password) throw new GuardError("SUPABASE_DB_POOLER_URL must not contain the password; put it in SUPABASE_DB_PASSWORD");
  }
}

const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

/** E2E_TARGET=local: every Supabase URL (API and database) must point at this machine. */
function assertLocalEnvironment(env: Env, opts: { requireDb?: boolean }): void {
  const local = (name: string, required: boolean) => {
    const value = env[name];
    if (value === undefined && !required) return;
    let host = "";
    try {
      host = new URL(value ?? "").hostname;
    } catch {
      throw new GuardError(`${name} is missing or not a URL (local target; run npm run local:up)`);
    }
    if (!LOCAL_HOSTS.has(host)) throw new GuardError(`${name} must point at the local stack (got ${host})`);
  };
  local("SUPABASE_URL", true);
  local("VITE_SUPABASE_URL", false);
  local("SUPABASE_DB_URL", !!opts.requireDb);
  if (env["SUPABASE_DB_POOLER_URL"]) throw new GuardError("SUPABASE_DB_POOLER_URL (remote QA) is set while the target is local");
  for (const [name, value] of Object.entries(env)) {
    if (!name.startsWith("VITE_")) continue;
    if (/SERVICE|SECRET/i.test(name)) throw new GuardError(`${name} looks like a server secret in a VITE_ variable`);
    if (value?.startsWith("sb_secret_")) throw new GuardError(`${name} contains a secret API key`);
  }
}

if (isMain(import.meta.url)) {
  try {
    assertQaEnvironment();
    console.log(`[e2e guard] OK — environment targets ${isLocalTarget() ? "the local stack" : QA_HOST}`);
  } catch (e) {
    console.error((e as Error).message);
    process.exit(1);
  }
}

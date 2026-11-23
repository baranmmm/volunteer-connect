// Local Supabase stack (Docker) for e2e tests and migration dry runs. Run inside e2e/:
//   npm run local:up      start the stack (e2e/local), write e2e/.env.local, apply supabase/migrations, seed users
//   npm run local:reset   recreate the database from scratch (all migrations again), then seed
//   npm run local:down    stop the stack (data is kept in Docker volumes until local:reset)
// Test users get LOCAL_TEST_PASSWORD (setup/env.ts), a fixed test value; nothing is read from e2e/.env.qa.
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { E2E_DIR, LOCAL_ENV_FILE, REPO_ROOT, isLocalTarget } from "./env";

const WORKDIR = path.join(E2E_DIR, "local");

const PROJECT_ID = "dsvh-e2e-local";

function run(cmd: string, args: string[], opts: { capture?: boolean; env?: NodeJS.ProcessEnv } = {}): string {
  // The Supabase CLI runs inside e2e/local with its project id set explicitly: run from the repo root it also reads
  // the root .env, whose project id (production) would name the local containers. Node scripts run inside e2e/.
  const supabase = cmd === "supabase";
  const result = spawnSync(cmd, args, {
    cwd: supabase ? WORKDIR : E2E_DIR,
    env: { ...process.env, ...(supabase ? { SUPABASE_PROJECT_ID: PROJECT_ID } : {}), ...opts.env },
    encoding: "utf8",
    stdio: opts.capture ? ["ignore", "pipe", "inherit"] : "inherit",
  });
  if (result.error) {
    const hint = cmd === "supabase" ? " Install the Supabase CLI (brew install supabase/tap/supabase)." : "";
    throw new Error(`Could not run ${cmd} (${result.error.message}).${hint}`);
  }
  if (result.status !== 0) throw new Error(`${cmd} ${args.join(" ")} failed with exit code ${result.status}`);
  return result.stdout ?? "";
}

function checkDocker() {
  const result = spawnSync("docker", ["info"], { stdio: "ignore" });
  if (result.error || result.status !== 0) {
    throw new Error("Docker is not running. Start Docker Desktop (or colima) and try again.");
  }
}

/** `supabase status -o env` → e2e/.env.local. Local default keys only; the values are not printed. */
function writeLocalEnv() {
  const out = run("supabase", ["status", "--workdir", WORKDIR, "-o", "env"], { capture: true });
  const vars = Object.fromEntries(
    out.split("\n").map((l) => l.match(/^([A-Z_]+)="?(.*?)"?$/)).filter((m): m is RegExpMatchArray => !!m).map((m) => [m[1], m[2]]),
  );
  const pick = (...names: string[]) => names.map((n) => vars[n]).find(Boolean);
  const env = {
    E2E_TARGET: "local",
    SUPABASE_URL: pick("API_URL"),
    SUPABASE_PUBLISHABLE_KEY: pick("PUBLISHABLE_KEY", "ANON_KEY"),
    SUPABASE_SERVICE_ROLE_KEY: pick("SECRET_KEY", "SERVICE_ROLE_KEY"),
    SUPABASE_DB_URL: pick("DB_URL"),
    E2E_EMAIL_DOMAIN: "dsvolunteer.test",
    BASE_URL: "http://localhost:3100",
  };
  const missing = Object.entries(env).filter(([, v]) => !v).map(([k]) => k);
  if (missing.length) throw new Error(`supabase status did not report: ${missing.join(", ")}`);
  writeFileSync(LOCAL_ENV_FILE, `# Written by npm run local:up — local stack only (default local keys).\n${Object.entries(env).map(([k, v]) => `${k}=${v}`).join("\n")}\n`);
  console.log(`[local] Wrote ${path.relative(REPO_ROOT, LOCAL_ENV_FILE)}`);
}

function migrateAndSeed() {
  const env = { E2E_TARGET: "local" };
  run("npx", ["tsx", path.join(E2E_DIR, "setup", "migrate.ts")], { env });
  run("npx", ["tsx", path.join(E2E_DIR, "setup", "seed.ts")], { env });
}

const command = process.argv[2];
// Started through the npm scripts (E2E_TARGET=local), so e2e/.env.qa was never loaded into this process.
if (!isLocalTarget()) {
  console.error("[local] Run through npm (npm run local:up|reset|down), which sets E2E_TARGET=local.");
  process.exit(2);
}
try {
  if (command === "up") {
    checkDocker();
    // E2E_LOCAL_EXCLUDE (comma-separated, e.g. in CI): containers the tests never use, so they are not pulled or started.
    const exclude = process.env["E2E_LOCAL_EXCLUDE"]?.trim();
    run("supabase", ["start", "--workdir", WORKDIR, ...(exclude ? ["--exclude", exclude] : [])]);
    writeLocalEnv();
    migrateAndSeed();
    console.log("[local] Ready. Tests: npm run local:test -- <specs>");
  } else if (command === "reset") {
    checkDocker();
    run("supabase", ["db", "reset", "--workdir", WORKDIR, "--local", "--no-seed"]);
    writeLocalEnv();
    migrateAndSeed();
  } else if (command === "down") {
    run("supabase", ["stop", "--workdir", WORKDIR]);
  } else {
    console.error("usage: tsx setup/local.ts up|reset|down");
    process.exit(2);
  }
} catch (e) {
  console.error(`[local] ${(e as Error).message}`);
  process.exit(1);
}

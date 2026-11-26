// Applies supabase/migrations to the QA project through the Session pooler (IPv4), or with E2E_TARGET=local to the
// local Docker stack (`npm run local:migrate`, also run by `npm run local:up`).
// QA: run manually (`npm run qa:migrate`, only while CI is idle) or from the E2E (QA) / QA DB migrate workflows.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import pg from "pg";
import { E2E_DIR, REPO_ROOT, isLocalTarget, requireEnv } from "./env";
import { acquireLocalStackLock } from "./local-lock";
import { assertQaEnvironment } from "./guard";

function databaseUrl(): string {
  // Local stack: the URL from `supabase status` (local default credentials, never a real secret).
  return isLocalTarget() ? requireEnv("SUPABASE_DB_URL") : poolerUrlWithPassword();
}

function poolerUrlWithPassword(): string {
  const url = new URL(requireEnv("SUPABASE_DB_POOLER_URL"));
  const password = encodeURIComponent(requireEnv("SUPABASE_DB_PASSWORD"));
  return `${url.protocol}//${url.username}:${password}@${url.host}${url.pathname}${url.search}`;
}

function supabaseCli(args: string[]): void {
  const shown = args.map((a) => (a.startsWith("postgres") ? "<pooler-url>" : a)).join(" ");
  console.log(`\n[migrate] $ supabase ${shown}`);
  const result = spawnSync("supabase", args, { cwd: REPO_ROOT, stdio: "inherit", env: process.env });
  if (result.error) {
    throw new Error(`Could not run the Supabase CLI (${result.error.message}). Install it: https://supabase.com/docs/guides/local-development/cli/getting-started`);
  }
  if (result.status !== 0) throw new Error(`supabase ${args[0]} ${args[1]} failed with exit code ${result.status}`);
}

/** `db push --dry-run` as JSON: the migrations it would apply, or null when the output cannot be read. */
function pendingMigrations(dbUrl: string): string[] | null {
  console.log("\n[migrate] $ supabase db push --db-url <pooler-url> --dry-run --output-format json");
  const result = spawnSync("supabase", ["db", "push", "--db-url", dbUrl, "--dry-run", "--output-format", "json"], {
    cwd: REPO_ROOT,
    env: process.env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  });
  if (result.error) {
    throw new Error(`Could not run the Supabase CLI (${result.error.message}). Install it: https://supabase.com/docs/guides/local-development/cli/getting-started`);
  }
  if (result.status !== 0) throw new Error(`supabase db push --dry-run failed with exit code ${result.status}`);
  const json = result.stdout.slice(result.stdout.indexOf("{"), result.stdout.lastIndexOf("}") + 1);
  try {
    const parsed = JSON.parse(json) as { upToDate?: boolean; migrations?: unknown };
    if (parsed.upToDate === true) return [];
    if (Array.isArray(parsed.migrations)) return parsed.migrations.map(String);
  } catch {
    /* fall through */
  }
  console.log(result.stdout.trim());
  return null;
}

async function main() {
  if (isLocalTarget()) acquireLocalStackLock("local:migrate");
  assertQaEnvironment(process.env, { requireDb: true });
  const dbUrl = databaseUrl();
  const host = new URL(dbUrl).hostname;
  console.log(isLocalTarget() ? `[migrate] Local stack: ${host}` : `[migrate] Connecting through the Session pooler: ${host}`);

  const client = new pg.Client({ connectionString: dbUrl, ...(isLocalTarget() ? {} : { ssl: { rejectUnauthorized: false } }) });
  await client.connect();
  try {
    const info = await client.query<{ db: string; addr: string | null }>("select current_database() as db, inet_server_addr()::text as addr");
    console.log(`[migrate] Connected: database=${info.rows[0]?.db} server=${info.rows[0]?.addr ?? "n/a"}`);

    const check = await client.query<{ fn: string | null }>("select to_regprocedure('public.rls_auto_enable()')::text as fn");
    if (check.rows[0]?.fn) {
      console.log("[migrate] public.rls_auto_enable() exists — no bootstrap needed.");
    } else {
      console.log("[migrate] public.rls_auto_enable() is missing — applying the bootstrap (setup/qa-bootstrap.sql).");
      await client.query(readFileSync(path.join(E2E_DIR, "setup", "qa-bootstrap.sql"), "utf8"));
      console.log("[migrate] Bootstrap applied.");
    }
  } finally {
    await client.end();
  }

  // `supabase link` is intentionally not used: it may try the IPv6-only direct connection.
  const pending = pendingMigrations(dbUrl);
  if (pending?.length === 0) {
    console.log("[migrate] No pending migrations: QA is up to date, nothing applied.");
    console.log("\n[migrate] Done. Next: npm run qa:seed");
    return;
  }
  if (pending) {
    console.log(`[migrate] ${pending.length} pending migration(s):`);
    for (const m of pending) console.log(`[migrate]   • ${m}`);
  } else {
    console.log("[migrate] Could not read the dry-run result; running db push anyway (it applies only what is pending).");
  }
  // CLI 3.x asks for confirmation before applying and aborts when stdout is not a terminal (CI).
  // The dry-run above has already listed what will be applied.
  supabaseCli(["db", "push", "--db-url", dbUrl, "--yes"]);
  console.log("\n[migrate] Done. Next: npm run qa:seed");
}

main().catch((e) => {
  console.error(`[migrate] ${(e as Error).message}`);
  process.exit(1);
});

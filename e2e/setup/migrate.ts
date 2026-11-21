// Applies supabase/migrations to the QA project through the Session pooler (IPv4).
// Run manually (`npm run qa:migrate`) or from the "QA DB migrate" workflow. Never part of the per-push run.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import pg from "pg";
import { E2E_DIR, REPO_ROOT, requireEnv } from "./env";
import { assertQaEnvironment } from "./guard";

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

async function main() {
  assertQaEnvironment(process.env, { requireDb: true });
  const dbUrl = poolerUrlWithPassword();
  const host = new URL(dbUrl).hostname;
  console.log(`[migrate] Connecting through the Session pooler: ${host}`);

  const client = new pg.Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    const info = await client.query<{ db: string; addr: string | null }>("select current_database() as db, inet_server_addr()::text as addr");
    console.log(`[migrate] Connected: database=${info.rows[0]?.db} server=${info.rows[0]?.addr ?? "n/a"}`);

    const check = await client.query<{ fn: string | null }>("select to_regprocedure('public.rls_auto_enable()')::text as fn");
    if (check.rows[0]?.fn) {
      console.log("[migrate] public.rls_auto_enable() exists — no bootstrap needed.");
    } else {
      console.log("[migrate] public.rls_auto_enable() is missing — applying QA bootstrap (setup/qa-bootstrap.sql).");
      await client.query(readFileSync(path.join(E2E_DIR, "setup", "qa-bootstrap.sql"), "utf8"));
      console.log("[migrate] Bootstrap applied.");
    }
  } finally {
    await client.end();
  }

  // `supabase link` is intentionally not used: it may try the IPv6-only direct connection.
  supabaseCli(["db", "push", "--db-url", dbUrl, "--dry-run"]);
  // CLI 3.x asks for confirmation before applying and aborts when stdout is not a terminal (CI).
  // The dry-run above has already listed what will be applied.
  supabaseCli(["db", "push", "--db-url", dbUrl, "--yes"]);
  console.log("\n[migrate] Done. Next: npm run qa:seed");
}

main().catch((e) => {
  console.error(`[migrate] ${(e as Error).message}`);
  process.exit(1);
});

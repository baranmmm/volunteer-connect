// Rolled-back migration dry run (high-risk changes): applies new migration file(s) inside ONE transaction that is
// always rolled back, and prints what they change in pg_proc (security definer, search_path, ACL) and in policies.
//   npm run local:dryrun -- ../supabase/migrations/<file>.sql [<file> ...]   (local stack; the default)
//   npm run qa:dryrun -- <files>                                             (remote QA; only while CI is idle)
// Fails when a SECURITY DEFINER function has no pinned search_path, or anon/PUBLIC can execute one.
// Behaviour checks belong in the migration's tests (Vitest/PGlite and the e2e API specs), run after applying it.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import pg from "pg";
import { isLocalTarget, requireEnv } from "./env";
import { assertQaEnvironment } from "./guard";

assertQaEnvironment(process.env, { requireDb: true });
const files = process.argv.slice(2).map((f) => path.resolve(f));
if (!files.length) { console.error("usage: dryrun.ts <migration.sql> [...]"); process.exit(2); }

if (!isLocalTarget()) {
  // QA is shared with CI: never change it (even inside a transaction that holds locks) while a run is active.
  const running = execFileSync("gh", ["run", "list", "--limit", "10", "--json", "status", "-q", '[.[] | select(.status!="completed")] | length'], { encoding: "utf8" }).trim();
  if (running !== "0") { console.error(`[dryrun] ${running} CI run(s) in progress on QA — try again when CI is idle.`); process.exit(2); }
}

function connectionConfig(): pg.ClientConfig {
  if (isLocalTarget()) return { connectionString: requireEnv("SUPABASE_DB_URL") };
  const u = new URL(requireEnv("SUPABASE_DB_POOLER_URL"));
  return { host: u.hostname, port: Number(u.port || 5432), user: decodeURIComponent(u.username), password: requireEnv("SUPABASE_DB_PASSWORD"), database: u.pathname.slice(1) || "postgres", ssl: { rejectUnauthorized: false } };
}

const PROCS = `SELECT p.oid::regprocedure::text AS signature, p.prosecdef AS secdef, coalesce(array_to_string(p.proconfig, ','), '') AS config,
    coalesce(p.proacl::text, '(default: PUBLIC)') AS acl,
    has_function_privilege('anon', p.oid, 'EXECUTE') AS anon, has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated,
    md5(pg_get_functiondef(p.oid)) AS body
  FROM pg_proc p WHERE p.pronamespace IN ('public'::regnamespace, 'storage'::regnamespace) AND p.prokind = 'f'`;
const POLICIES = `SELECT schemaname || '.' || tablename || ' / ' || policyname AS policy, permissive, cmd, roles::text, md5(coalesce(qual, '') || coalesce(with_check, '')) AS body
  FROM pg_policies WHERE schemaname IN ('public', 'storage')`;

type Row = Record<string, unknown>;
const key = (r: Row) => String(r["signature"] ?? r["policy"]);
function diff(before: Row[], after: Row[]) {
  const b = new Map(before.map((r) => [key(r), r])), a = new Map(after.map((r) => [key(r), r]));
  const added = [...a.keys()].filter((k) => !b.has(k)), removed = [...b.keys()].filter((k) => !a.has(k));
  const changed = [...a.keys()].filter((k) => b.has(k) && JSON.stringify(b.get(k)) !== JSON.stringify(a.get(k)));
  return { added, removed, changed, a, b };
}

const client = new pg.Client(connectionConfig());
const t0 = Date.now();
let problems = 0;
await client.connect();
// A dry run is only meaningful before the migration is applied (write it, dry-run it, then local:migrate).
const versions = files.map((f) => path.basename(f).split("_")[0]!);
const applied = (await client.query<{ version: string }>(
  "SELECT version FROM supabase_migrations.schema_migrations WHERE version = ANY($1)", [versions],
).catch(() => ({ rows: [] as { version: string }[] }))).rows.map((r) => r.version);
if (applied.length) {
  console.error(`[dryrun] Already applied here: ${applied.join(", ")}. Dry-run a migration before applying it` +
    (isLocalTarget() ? " (local:up applies every migration in supabase/migrations: write the new one after local:up)." : "."));
  await client.end();
  process.exit(2);
}
try {
  await client.query("BEGIN");
  await client.query("SET LOCAL statement_timeout = '60s'; SET LOCAL lock_timeout = '5s'");
  const procs = (await client.query(PROCS)).rows, policies = (await client.query(POLICIES)).rows;
  for (const f of files) {
    await client.query(readFileSync(f, "utf8"));
    console.log(`[dryrun] applied ${path.basename(f)}`);
  }
  const p = diff(procs, (await client.query(PROCS)).rows), pol = diff(policies, (await client.query(POLICIES)).rows);
  const show = (k: string, r: Row | undefined) => r && console.log(`    ${k}  secdef=${r["secdef"]} config=${r["config"] || "-"} acl=${r["acl"]}`);
  console.log(`\n[dryrun] functions: +${p.added.length} -${p.removed.length} ~${p.changed.length}`);
  for (const k of p.added) { console.log("  + " + k); show("", p.a.get(k)); }
  for (const k of p.removed) console.log("  - " + k);
  for (const k of p.changed) {
    const before = p.b.get(k)!, after = p.a.get(k)!;
    const what = ["secdef", "config", "acl", "body"].filter((c) => before[c] !== after[c]).join(", ");
    console.log(`  ~ ${k} (${what})`);
    if (what !== "body") { console.log("    before:"); show("", before); console.log("    after:"); show("", after); }
  }
  console.log(`\n[dryrun] policies: +${pol.added.length} -${pol.removed.length} ~${pol.changed.length}`);
  for (const k of [...pol.added.map((x) => "+ " + x), ...pol.removed.map((x) => "- " + x), ...pol.changed.map((x) => "~ " + x)]) console.log("  " + k);

  for (const k of [...p.added, ...p.changed]) {
    const r = p.a.get(k)!;
    if (!r["secdef"]) continue;
    if (!/search_path=/.test(String(r["config"]))) { console.log(`  PROBLEM ${k}: SECURITY DEFINER without a pinned search_path`); problems++; }
    if (r["anon"]) { console.log(`  PROBLEM ${k}: anon can execute it`); problems++; }
    if (String(r["acl"]).startsWith("(default") || /(^|[{,])=X/.test(String(r["acl"]))) { console.log(`  PROBLEM ${k}: PUBLIC can execute it`); problems++; }
  }
} catch (e) {
  console.error(`[dryrun] FAILED: ${(e as Error).message}`);
  problems++;
} finally {
  await client.query("ROLLBACK").catch(() => undefined);
  await client.end();
}
console.log(`\n[dryrun] rolled back after ${((Date.now() - t0) / 1000).toFixed(1)}s — ${problems ? `${problems} problem(s)` : "no problems"}`);
process.exit(problems ? 1 : 0);

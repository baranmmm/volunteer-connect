// Backfill: resized WebP copies (640 and 1280 px) for every event image stored before copies existed.
// Usage (see README.md): npx tsx scripts/backfill-image-copies/backfill.ts [--local] [--dry-run] [--limit N]
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { imageVariantPaths, makeImageCopies } from "./copies";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "../..");
const PROD_REF = "kcxmjscxooqqhsgrhknb";
const BUCKET = "event-media";
const PAGE = 200;

type Options = { prod: boolean; dryRun: boolean; limit: number };

function parseArgs(argv: string[]): Options {
  const opts: Options = { prod: false, dryRun: false, limit: Number.POSITIVE_INFINITY };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--local") continue;
    else if (a === "--prod") opts.prod = true;
    else if (a === "--dry-run") opts.dryRun = true;
    else if (a === "--limit") {
      const n = Number(argv[++i]);
      if (!Number.isInteger(n) || n < 1) throw new Error("--limit must be a positive integer");
      opts.limit = n;
    } else throw new Error(`Unknown option: ${a}`);
  }
  return opts;
}

// ─── Target and credentials (keys are never printed): the same rules as the past-events import ─────────────────

function readEnvFile(path: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m?.[1]) out[m[1]] = (m[2] ?? "").replace(/^(['"])(.*)\1$/, "$2");
  }
  return out;
}

function resolveTarget(opts: Options) {
  const prodConfirmed = opts.prod && process.env["IMPORT_PROD_CONFIRM"] === "yes";
  if (opts.prod && !prodConfirmed)
    throw new Error("--prod needs IMPORT_PROD_CONFIRM=yes in the environment. Refusing.");
  let url: string | undefined;
  let key: string | undefined;
  if (opts.prod) {
    url = process.env["SUPABASE_URL"];
    key = process.env["SUPABASE_SERVICE_ROLE_KEY"];
  } else {
    // Local: the file `npm run local:up` writes (default local keys only).
    const file = join(REPO_ROOT, "e2e/.env.local");
    const local = existsSync(file) ? readEnvFile(file) : {};
    url = local["SUPABASE_URL"] ?? process.env["SUPABASE_URL"];
    key = local["SUPABASE_SERVICE_ROLE_KEY"] ?? process.env["SUPABASE_SERVICE_ROLE_KEY"];
    const mentionsProd = [url ?? "", ...Object.values(process.env).map((v) => v ?? "")].some((v) =>
      v.includes(PROD_REF),
    );
    if (mentionsProd)
      throw new Error("The production project ref is in the environment. Refusing a local run.");
  }
  if (!url || !key) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.");
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    throw new Error("SUPABASE_URL is not a valid URL.");
  }
  const isLocal = host === "127.0.0.1" || host === "localhost" || host === "[::1]";
  if (!opts.prod && !isLocal)
    throw new Error(`Refusing non-local target ${host} (use --prod with confirmation).`);
  if (url.includes(PROD_REF) && !prodConfirmed)
    throw new Error("Production target without confirmation. Refusing.");
  return { label: opts.prod ? "prod" : "local", url, key };
}

// ─── Work ────────────────────────────────────────────────────────────────────────────────────────────────────────

type Row = { id: string; storage_path: string; width: number | null; height: number | null };
type Counts = {
  candidates: number;
  created: number;
  flaggedOnly: number;
  missingOriginal: number;
  failed: number;
  planned: number;
};

/** Whether an object exists (Storage first; never SQL on storage.objects). */
async function exists(db: SupabaseClient, path: string): Promise<boolean> {
  // storage-js answers "not found" as { data: false, error }; anything else it throws.
  const { data } = await db.storage.from(BUCKET).exists(path);
  return data === true;
}

async function upload(db: SupabaseClient, path: string, body: Buffer) {
  const { error } = await db.storage
    .from(BUCKET)
    .upload(path, body, { contentType: "image/webp", upsert: false });
  // A copy stored by a concurrent or earlier run is kept as it is.
  if (error && !/exists|duplicate/i.test(error.message)) throw new Error("Copy upload failed");
}

async function backfillRow(db: SupabaseClient, row: Row, opts: Options, counts: Counts) {
  if (!(await exists(db, row.storage_path))) {
    // An archived event's files sit under deleted/; they get copies once restored and the backfill is run again.
    counts.missingOriginal++;
    return;
  }
  const copies = imageVariantPaths(row.storage_path);
  const [has640, has1280] = [await exists(db, copies.w640), await exists(db, copies.w1280)];
  if (opts.dryRun) {
    if (has640 && has1280) counts.flaggedOnly++;
    else counts.planned++;
    return;
  }
  const patch: { has_variants: boolean; width?: number; height?: number } = { has_variants: true };
  if (!(has640 && has1280)) {
    const { data, error } = await db.storage.from(BUCKET).download(row.storage_path);
    if (error || !data) throw new Error("Original download failed");
    const made = await makeImageCopies(Buffer.from(await data.arrayBuffer()));
    if (!has640) await upload(db, copies.w640, made.w640);
    if (!has1280) await upload(db, copies.w1280, made.w1280);
    if (row.width === null && made.width && made.height) {
      patch.width = made.width;
      patch.height = made.height;
    }
  }
  const { error } = await db.from("event_media").update(patch).eq("id", row.id);
  if (error) throw new Error("Flag update failed");
  if (has640 && has1280) counts.flaggedOnly++;
  else counts.created++;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const target = resolveTarget(opts);
  const db = createClient(target.url, target.key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  console.log(
    `Target: ${target.label} (${new URL(target.url).host})${opts.dryRun ? " — DRY RUN, no writes" : ""}`,
  );
  const head = { count: "exact" as const, head: true };
  const before = await db
    .from("event_media")
    .select("id", head)
    .eq("kind", "image")
    .eq("has_variants", true);
  const total = await db.from("event_media").select("id", head).eq("kind", "image");
  if (before.error || total.error) throw new Error("Count failed");

  const counts: Counts = {
    candidates: 0,
    created: 0,
    flaggedOnly: 0,
    missingOriginal: 0,
    failed: 0,
    planned: 0,
  };
  // Keyset paging by id: rows flagged on the way drop out of the filter without shifting the pages.
  let last = "00000000-0000-0000-0000-000000000000";
  for (;;) {
    if (counts.candidates >= opts.limit) break;
    const { data, error } = await db
      .from("event_media")
      .select("id, storage_path, width, height")
      .eq("kind", "image")
      .eq("has_variants", false)
      .gt("id", last)
      .order("id")
      .limit(Math.min(PAGE, opts.limit - counts.candidates));
    if (error) throw new Error("Listing images failed");
    if (!data.length) break;
    for (const row of data as Row[]) {
      last = row.id;
      counts.candidates++;
      try {
        await backfillRow(db, row, opts, counts);
      } catch (e) {
        counts.failed++;
        console.warn(`  failed ${row.id}: ${e instanceof Error ? e.message : "error"}`);
      }
    }
    console.log(`  … ${counts.candidates} checked`);
  }
  const after = await db
    .from("event_media")
    .select("id", head)
    .eq("kind", "image")
    .eq("has_variants", true);

  console.log("");
  console.log(
    `Images: ${total.count ?? 0} total, ${before.count ?? 0} with copies before, ${after.count ?? 0} after`,
  );
  console.log(
    `Without copies: ${counts.candidates} checked — ${counts.created} copies created, ` +
      `${counts.flaggedOnly} copies already stored (flag set), ${counts.planned} planned, ` +
      `${counts.missingOriginal} original not stored, ${counts.failed} failed`,
  );
  if (counts.failed) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : "Backfill failed");
  process.exit(1);
});

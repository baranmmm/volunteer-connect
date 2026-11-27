// One-off import of Medway past events with their chosen photos (a prepared folder on disk) into the Volunteer Hub.
// Usage (see README.md): npx tsx scripts/import-medway-past-events/import.ts --dir <folder> [--dry-run] [--prod]
import { createHash, randomUUID } from "node:crypto";
import { existsSync, lstatSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import sharp from "sharp";
import { imageVariantPaths, makeImageCopies } from "../backfill-image-copies/copies";
import { acquireLocalStackLock } from "../../e2e/setup/local-lock";
import {
  ORGANIZER,
  PHOTOS_PER_EVENT,
  PHOTO_FILES,
  checkFolderFiles,
  describe,
  parseEventsJson,
  type EventInput,
} from "./plan";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "../..");
const PROD_REF = "kcxmjscxooqqhsgrhknb";
const BUCKET = "event-media";
const BRANCH_NAME = "Medway";
const MAX_LONG_SIDE = 1920;
const WEBP_QUALITY = 80;
const MAX_FILE_BYTES = 40 * 1024 * 1024;

// ─── CLI ──────────────────────────────────────────────────────────────────────────────────────────────────────────

type Options = {
  prod: boolean;
  dryRun: boolean;
  dir: string;
  createdBy: string | null;
  localEnv: string;
  updateText: boolean;
};

function parseArgs(argv: string[]): Options {
  const opts: Options = {
    prod: false,
    dryRun: false,
    dir: join(homedir(), "Downloads/ds-media/selected"),
    createdBy: null,
    localEnv: join(REPO_ROOT, "e2e/.env.local"),
    updateText: false,
  };
  const value = (i: number, name: string) => {
    const v = argv[i];
    if (!v || v.startsWith("--")) throw new Error(`${name} needs a value`);
    return v;
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case "--local":
        break;
      case "--prod":
        opts.prod = true;
        break;
      case "--dry-run":
        opts.dryRun = true;
        break;
      case "--update-text":
        opts.updateText = true;
        break;
      case "--dir":
        opts.dir = resolve(value(++i, a));
        break;
      case "--created-by":
        opts.createdBy = value(++i, a).trim().toLowerCase();
        break;
      case "--local-env":
        opts.localEnv = resolve(value(++i, a));
        break;
      default:
        throw new Error(`Unknown option: ${a}`);
    }
  }
  if (opts.prod && !opts.createdBy)
    throw new Error("--prod needs --created-by <email of the Medway Branch Manager account>.");
  return opts;
}

// ─── Target and credentials (keys are never printed) ─────────────────────────────────────────────────────────────

function readEnvFile(path: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m?.[1]) out[m[1]] = (m[2] ?? "").replace(/^(['"])(.*)\1$/, "$2");
  }
  return out;
}

type Target = { label: "local" | "prod"; url: string; key: string };

function resolveTarget(opts: Options): Target {
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
    const local = existsSync(opts.localEnv) ? readEnvFile(opts.localEnv) : {};
    url = local["SUPABASE_URL"] ?? process.env["SUPABASE_URL"];
    key = local["SUPABASE_SERVICE_ROLE_KEY"] ?? process.env["SUPABASE_SERVICE_ROLE_KEY"];
    if (
      [url ?? "", ...Object.values(process.env).map((v) => v ?? "")].some((v) =>
        v.includes(PROD_REF),
      )
    )
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
  if (opts.prod && isLocal) throw new Error("--prod with a local URL. Refusing.");
  return { label: opts.prod ? "prod" : "local", url, key };
}

// ─── Reading the prepared folder ─────────────────────────────────────────────────────────────────────────────────

function londonToday(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

type Photo = {
  name: string; // 01.jpg … 12.jpg
  index: number; // 0-based, also the event_media position
  bytes: Buffer;
  hash: string; // SHA-256 of the chosen file (event_media.content_hash, as the app's upload): the re-run marker
  webp: { data: Buffer; width: number; height: number };
};

type Planned = { input: EventInput; description: string; photos: Photo[]; ignored: string[] };

async function toWebp(input: Buffer) {
  const { data, info } = await sharp(input, { failOn: "error" })
    .rotate() // apply EXIF orientation before the metadata is dropped
    .resize({
      width: MAX_LONG_SIDE,
      height: MAX_LONG_SIDE,
      fit: "inside",
      withoutEnlargement: true,
    })
    .webp({ quality: WEBP_QUALITY }) // sharp writes no metadata unless asked: EXIF/GPS are stripped
    .toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

async function readPrepared(dir: string): Promise<Planned[]> {
  const events = parseEventsJson(readFileSync(join(dir, "events.json"), "utf8"), londonToday());
  const problems: string[] = [];
  const planned: Planned[] = [];
  const seenHashes = new Map<string, string>();
  for (const input of events) {
    const folder = join(dir, input.folder);
    if (!existsSync(folder) || !lstatSync(folder).isDirectory()) {
      problems.push(`${input.folder}: folder not found`);
      continue;
    }
    const { missing, ignored } = checkFolderFiles(readdirSync(folder));
    if (missing.length > 0) {
      problems.push(`${input.folder}: missing ${missing.join(", ")}`);
      continue;
    }
    const photos: Photo[] = [];
    for (const [index, name] of PHOTO_FILES.entries()) {
      const file = join(folder, name);
      const st = lstatSync(file);
      if (!st.isFile() || st.size === 0 || st.size > MAX_FILE_BYTES) {
        problems.push(`${input.folder}/${name}: not a regular file of 1 byte–40 MB`);
        continue;
      }
      const bytes = readFileSync(file);
      const hash = createHash("sha256").update(bytes).digest("hex");
      const dup = seenHashes.get(hash);
      if (dup) problems.push(`${input.folder}/${name}: the same file as ${dup}`);
      seenHashes.set(hash, `${input.folder}/${name}`);
      try {
        photos.push({ name, index, bytes, hash, webp: await toWebp(bytes) });
      } catch (e) {
        problems.push(
          `${input.folder}/${name}: not a readable image (${e instanceof Error ? e.message : String(e)})`,
        );
      }
    }
    planned.push({ input, description: describe(input), photos, ignored });
  }
  if (problems.length > 0) throw new Error(`Prepared folder ${dir}:\n  ${problems.join("\n  ")}`);
  return planned;
}

// ─── Database ────────────────────────────────────────────────────────────────────────────────────────────────────

type Branch = { id: string; name: string; region_id: string };
type Creator = { id: string; full_name: string };

async function findBranch(db: SupabaseClient): Promise<Branch> {
  const { data, error } = await db
    .from("branches")
    .select("id, name, region_id")
    .ilike("name", BRANCH_NAME)
    .is("deleted_at", null);
  if (error) throw new Error(`branches: ${error.message}`);
  if (data?.length !== 1)
    throw new Error(`Expected exactly one ${BRANCH_NAME} branch, found ${data?.length ?? 0}.`);
  return data[0] as Branch;
}

/** The Medway Branch Manager account the records are created by (given by email, or the only one there is). */
async function findCreator(
  db: SupabaseClient,
  branch: Branch,
  email: string | null,
): Promise<Creator> {
  const { data: roles, error: rErr } = await db
    .from("user_roles")
    .select("user_id")
    .eq("role", "branch_manager");
  if (rErr) throw new Error(`user_roles: ${rErr.message}`);
  const managerIds = (roles ?? []).map((r) => r.user_id as string);
  let query = db
    .from("profiles")
    .select("id, full_name, email")
    .eq("branch_id", branch.id)
    .eq("status", "active")
    .is("deleted_at", null)
    .in("id", managerIds.length > 0 ? managerIds : ["00000000-0000-0000-0000-000000000000"]);
  // Case-insensitive exact match: escape the LIKE wildcards (an email may contain "_").
  if (email) query = query.ilike("email", email.replace(/[\\%_]/g, "\\$&"));
  const { data, error } = await query;
  if (error) throw new Error(`profiles: ${error.message}`);
  const found = (data ?? []) as Array<Creator & { email: string | null }>;
  if (email && found.length !== 1)
    throw new Error(`--created-by: no active Branch Manager of ${branch.name} has that email.`);
  if (!email && found.length !== 1)
    throw new Error(
      `Found ${found.length} active Branch Managers of ${branch.name}; pass --created-by <email> to choose one.`,
    );
  const c = found[0]!;
  return { id: c.id, full_name: c.full_name };
}

type Existing = { id: string; title: string; description: string };

/** 1) Marker: one of the event's photo hashes on a live Medway past record. 2) Fallback: the same title and date. */
async function findExisting(
  db: SupabaseClient,
  branch: Branch,
  ev: Planned,
): Promise<Existing | null> {
  const records = () =>
    db
      .from("events")
      .select("id, title, description")
      .eq("past_record", true)
      .eq("branch_id", branch.id)
      .is("deleted_at", null);
  const { data: media, error: mErr } = await db
    .from("event_media")
    .select("event_id")
    .in(
      "content_hash",
      ev.photos.map((p) => p.hash),
    );
  if (mErr) throw new Error(mErr.message);
  const ids = [...new Set((media ?? []).map((m) => m.event_id as string))];
  if (ids.length > 0) {
    const { data, error } = await records().in("id", ids).order("created_at").limit(1);
    if (error) throw new Error(error.message);
    if (data?.[0]) return data[0] as Existing;
  }
  const { data, error } = await records()
    .eq("title", ev.input.title)
    .eq("start_date", ev.input.date)
    .order("created_at")
    .limit(1);
  if (error) throw new Error(error.message);
  return (data?.[0] as Existing | undefined) ?? null;
}

async function uploadPhoto(db: SupabaseClient, eventId: string, photo: Photo): Promise<void> {
  const mediaId = randomUUID();
  const path = `${eventId}/${mediaId}.webp`;
  const up = await db.storage
    .from(BUCKET)
    .upload(path, photo.webp.data, { contentType: "image/webp", upsert: false });
  if (up.error) throw new Error(`upload: ${up.error.message}`);
  // The 640/1280 px copies for the public pages; without them the row keeps has_variants = false (see the backfill).
  const copies = imageVariantPaths(path);
  let hasVariants = false;
  try {
    const made = await makeImageCopies(photo.webp.data);
    for (const [target, body] of [
      [copies.w640, made.w640],
      [copies.w1280, made.w1280],
    ] as const) {
      const stored = await db.storage
        .from(BUCKET)
        .upload(target, body, { contentType: "image/webp", upsert: false });
      if (stored.error) throw new Error(`copy upload: ${stored.error.message}`);
    }
    hasVariants = true;
  } catch (e) {
    console.warn(
      `  ${photo.name}: photo copies skipped: ${e instanceof Error ? e.message : String(e)}`,
    );
    await db.storage.from(BUCKET).remove([copies.w640, copies.w1280]);
  }
  const { error } = await db.from("event_media").insert({
    id: mediaId,
    event_id: eventId,
    storage_path: path,
    kind: "image",
    position: photo.index,
    uploaded_by: null, // imported (the prelaunch rule: NULL = imported)
    original_name: photo.name,
    in_gallery: true,
    source_url: null,
    content_hash: photo.hash,
    width: photo.webp.width,
    height: photo.webp.height,
    has_variants: hasVariants,
  });
  if (error) {
    await db.storage.from(BUCKET).remove([path, copies.w640, copies.w1280]);
    throw new Error(`media row: ${error.message}`);
  }
}

type Result = {
  ev: Planned;
  status: "planned" | "existing" | "new" | "updated" | "failed";
  eventId: string | null;
  present: number; // of the 12 files, already stored
  added: number;
  cover: "ok" | "wrong" | "-";
  error?: string;
};

async function mediaOf(db: SupabaseClient, eventId: string) {
  const { data, error } = await db
    .from("event_media")
    .select("content_hash, kind, position, created_at")
    .eq("event_id", eventId)
    .order("position")
    .order("created_at");
  if (error) throw new Error(error.message);
  return (data ?? []) as Array<{ content_hash: string | null; kind: string; position: number }>;
}

async function removeEvent(db: SupabaseClient, eventId: string) {
  // Files first (with their copies), then the rows.
  const { data: left } = await db
    .from("event_media")
    .select("storage_path")
    .eq("event_id", eventId);
  const paths = (left ?? []).flatMap((r) => {
    const copies = imageVariantPaths(r.storage_path as string);
    return [r.storage_path as string, copies.w640, copies.w1280];
  });
  if (paths.length > 0) await db.storage.from(BUCKET).remove(paths);
  await db.from("event_media").delete().eq("event_id", eventId);
  await db.from("events").delete().eq("id", eventId);
}

async function importEvent(
  db: SupabaseClient,
  branch: Branch,
  creator: Creator,
  ev: Planned,
  opts: Options,
): Promise<Result> {
  const result: Result = {
    ev,
    status: "existing",
    eventId: null,
    present: 0,
    added: 0,
    cover: "-",
  };
  const existing = await findExisting(db, branch, ev);
  let created = false;
  if (existing) {
    result.eventId = existing.id;
    if (opts.updateText && existing.description !== ev.description) {
      const { error } = await db
        .from("events")
        .update({ description: ev.description })
        .eq("id", existing.id);
      if (error) throw new Error(error.message);
      result.status = "updated";
    }
  } else {
    const { data, error } = await db
      .from("events")
      .insert({
        title: ev.input.title,
        description: ev.description,
        location: ev.input.venue,
        location_type: "in_person",
        organizer: ORGANIZER,
        category: "other",
        scope: "branch",
        branch_id: branch.id,
        region_id: branch.region_id,
        status: "published",
        audience: "public",
        all_day: true,
        start_date: ev.input.date,
        end_date: ev.input.date,
        registration_enabled: false,
        past_record: true,
        created_by: creator.id,
      })
      .select("id")
      .single();
    if (error || !data) throw new Error(`event row: ${error?.message ?? "no id"}`);
    result.eventId = data.id as string;
    result.status = "new";
    created = true;
  }
  const eventId = result.eventId as string;

  const rows = await mediaOf(db, eventId);
  const present = new Set(rows.map((r) => r.content_hash).filter(Boolean));
  result.present = ev.photos.filter((p) => present.has(p.hash)).length;
  // Never above the past-record cap, even if photos were added in the app meanwhile.
  const room = Math.max(0, PHOTOS_PER_EVENT - rows.length);
  const missing = ev.photos.filter((p) => !present.has(p.hash)).slice(0, room);
  const errors: string[] = [];
  for (const photo of missing) {
    try {
      await uploadPhoto(db, eventId, photo);
      result.added++;
    } catch (e) {
      errors.push(`${photo.name}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  const after = await mediaOf(db, eventId);
  const first = after.find((r) => r.kind === "image");
  result.cover = first?.content_hash === ev.photos[0]?.hash ? "ok" : "wrong";
  if (created && !after.some((r) => r.content_hash === ev.photos[0]?.hash)) {
    // A new public record without its cover is not kept: remove its files first, then the rows.
    await removeEvent(db, eventId);
    return {
      ...result,
      status: "failed",
      eventId: null,
      added: 0,
      error: errors.join("; ") || "cover not stored",
    };
  }
  if (errors.length > 0) result.error = errors.join("; ");
  if (missing.length < ev.photos.length - result.present)
    result.error = [
      result.error,
      `no room for ${ev.photos.length - result.present - missing.length} photo(s)`,
    ]
      .filter(Boolean)
      .join("; ");
  return result;
}

async function counts(db: SupabaseClient, branch: Branch) {
  const { data, error } = await db
    .from("events")
    .select("id")
    .eq("past_record", true)
    .eq("branch_id", branch.id)
    .is("deleted_at", null);
  if (error) throw new Error(error.message);
  const ids = (data ?? []).map((r) => r.id as string);
  let photos = 0;
  if (ids.length > 0) {
    const { count, error: mErr } = await db
      .from("event_media")
      .select("id", { count: "exact", head: true })
      .in("event_id", ids);
    if (mErr) throw new Error(mErr.message);
    photos = count ?? 0;
  }
  return { records: ids.length, photos };
}

// ─── Main ────────────────────────────────────────────────────────────────────────────────────────────────────────

const kb = (n: number) => `${Math.round(n / 1024)} KB`;

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const target = resolveTarget(opts);
  // Local writes share the one Docker stack with every session's e2e runs: take the machine-wide lock.
  const release =
    target.label === "local" && !opts.dryRun
      ? acquireLocalStackLock("import-medway-past-events")
      : null;
  try {
    const db = createClient(target.url, target.key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    console.log(
      `Target: ${target.label} (${new URL(target.url).host})${opts.dryRun ? " — DRY RUN, no writes" : ""}`,
    );
    console.log(`Folder: ${opts.dir}`);

    const planned = await readPrepared(opts.dir);
    const branch = await findBranch(db);
    const creator = await findCreator(db, branch, opts.createdBy);
    console.log(
      `Branch: ${branch.name}; created_by: ${creator.full_name} (Branch Manager, id ${creator.id})`,
    );
    const before = await counts(db, branch);

    const results: Result[] = [];
    for (const ev of planned) {
      if (opts.dryRun) {
        const existing = await findExisting(db, branch, ev);
        const present = existing
          ? new Set((await mediaOf(db, existing.id)).map((r) => r.content_hash).filter(Boolean))
          : new Set();
        results.push({
          ev,
          status: existing ? "existing" : "planned",
          eventId: existing?.id ?? null,
          present: ev.photos.filter((p) => present.has(p.hash)).length,
          added: 0,
          cover: "-",
        });
        continue;
      }
      try {
        results.push(await importEvent(db, branch, creator, ev, opts));
      } catch (e) {
        results.push({
          ev,
          status: "failed",
          eventId: null,
          present: 0,
          added: 0,
          cover: "-",
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }
    const after = await counts(db, branch);

    const by = (s: Result["status"]) => results.filter((r) => r.status === s).length;
    const total = results.reduce((n, r) => n + r.ev.photos.length, 0);
    console.log("");
    console.log(
      `Events: ${results.length} — ${by("new")} new, ${by("existing")} existing, ${by("updated")} updated, ` +
        `${by("planned")} planned, ${by("failed")} failed`,
    );
    console.log(
      `Photos: ${total} files — ${results.reduce((n, r) => n + r.added, 0)} uploaded, ` +
        `${results.reduce((n, r) => n + r.present, 0)} already present`,
    );
    console.log(
      `${branch.name} past records before → after: ${before.records} → ${after.records}; ` +
        `their files ${before.photos} → ${after.photos}`,
    );
    console.log("");
    console.log("date | title | venue | files | status");
    for (const r of results) {
      console.log(
        `${r.ev.input.date} | ${r.ev.input.title} | ${r.ev.input.venue} | ${r.ev.photos.length} ` +
          `(${r.present} present${r.added ? `, +${r.added}` : ""}) | ${r.status}` +
          `${r.cover !== "-" ? `, cover ${r.cover}` : ""}${r.eventId ? ` ${r.eventId}` : ""}` +
          `${r.error ? ` (${r.error})` : ""}`,
      );
    }
    console.log("");
    console.log("Descriptions:");
    for (const r of results) console.log(`- ${r.ev.input.title}: ${r.ev.description}`);
    console.log("");
    console.log("Files (in order; the first is the cover) — source → WebP:");
    for (const r of results) {
      console.log(`${r.ev.input.folder}:`);
      for (const p of r.ev.photos)
        console.log(
          `  ${p.name}${p.index === 0 ? " (cover)" : ""}  ${kb(p.bytes.length)} → ${p.webp.width}×${p.webp.height} ${kb(p.webp.data.length)}`,
        );
      if (r.ev.ignored.length > 0)
        console.log(`  ignored (not 01–12.jpg): ${r.ev.ignored.join(", ")}`);
    }
    // A cover changed later in the app is reported, not an error; a new record must have 01.jpg as its cover.
    if (
      results.some(
        (r) => r.status === "failed" || r.error || (r.status === "new" && r.cover === "wrong"),
      )
    )
      process.exitCode = 1;
  } finally {
    release?.();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});

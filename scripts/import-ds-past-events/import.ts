// One-time import of recent Dialogue Society past events (photos) and channel highlight videos into the Volunteer Hub.
// Usage (see README.md): npx tsx scripts/import-ds-past-events/import.ts [--local] [--dry-run] [--limit 15]
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import sharp from "sharp";
import {
  EVENTS_LIST_URL,
  cleanTitle,
  isChildrenEvent,
  mapScope,
  parseEventPage,
  parseEventsList,
  selectPhotos,
  type BranchRow,
  type RegionRow,
  type EventPage,
  type GalleryImage,
} from "./parse";
import { summarize } from "./summarize";
import { CHANNEL_FEED_URL, parseChannelFeed, posterUrl, type FeedVideo } from "./youtube";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "../..");
const PROD_REF = "kcxmjscxooqqhsgrhknb";
const BUCKET = "event-media";
const USER_AGENT =
  "VolunteerHub-PastEventsImport/1.0 (one-time import of public event pages; sequential, cached, 1 req/s)";
const ALLOWED_HOSTS = new Set(["www.dialoguesociety.org", "www.youtube.com", "i.ytimg.com"]);
const MIN_PHOTOS = 3;
const MAX_PHOTOS = 6;
const MAX_LONG_SIDE = 1920;
const WEBP_QUALITY = 80;

// ─── CLI ──────────────────────────────────────────────────────────────────────────────────────────────────────────

type Options = {
  prod: boolean;
  dryRun: boolean;
  limit: number;
  videos: number;
  maxPages: number;
  cacheDir: string;
  refresh: boolean;
  updateText: boolean;
};

function parseArgs(argv: string[]): Options {
  const opts: Options = {
    prod: false,
    dryRun: false,
    limit: 15,
    videos: 6,
    maxPages: 8,
    cacheDir: join(tmpdir(), "ds-past-events-import-cache"),
    refresh: false,
    updateText: false,
  };
  const num = (v: string | undefined, name: string, max: number) => {
    const n = Number(v);
    if (!Number.isInteger(n) || n < 0 || n > max)
      throw new Error(`${name} must be an integer 0..${max}`);
    return n;
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
      case "--refresh":
        opts.refresh = true;
        break;
      case "--update-text":
        opts.updateText = true;
        break;
      case "--limit":
        opts.limit = num(argv[++i], "--limit", 50);
        break;
      case "--videos":
        opts.videos = num(argv[++i], "--videos", 15);
        break;
      case "--max-pages":
        opts.maxPages = num(argv[++i], "--max-pages", 30);
        break;
      case "--cache-dir":
        opts.cacheDir = resolve(argv[++i] ?? "");
        break;
      default:
        throw new Error(`Unknown option: ${a}`);
    }
  }
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
  if (opts.prod && !prodConfirmed) {
    throw new Error("--prod needs IMPORT_PROD_CONFIRM=yes in the environment. Refusing.");
  }
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

// ─── Polite cached fetching ──────────────────────────────────────────────────────────────────────────────────────

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

class Fetcher {
  private last = 0;
  network = 0;
  cached = 0;
  constructor(
    private readonly dir: string,
    private readonly refresh: boolean,
  ) {
    mkdirSync(dir, { recursive: true });
  }

  async get(url: string, kind: "text" | "binary", { cacheable = true } = {}): Promise<Buffer> {
    const u = new URL(url);
    if (u.protocol !== "https:" || !ALLOWED_HOSTS.has(u.hostname))
      throw new Error(`Host not allowed: ${u.hostname}`);
    const file = join(
      this.dir,
      `${createHash("sha256").update(url).digest("hex")}.${kind === "text" ? "txt" : "bin"}`,
    );
    if (cacheable && !this.refresh && existsSync(file)) {
      this.cached++;
      return readFileSync(file);
    }
    let lastError: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      const wait = this.last + 1000 * (attempt + 1) - Date.now();
      if (wait > 0) await sleep(wait);
      this.last = Date.now();
      this.network++;
      try {
        const res = await fetch(url, {
          headers: {
            "User-Agent": USER_AGENT,
            Accept: kind === "text" ? "text/html,application/xml" : "image/*",
          },
          redirect: "follow",
          signal: AbortSignal.timeout(30_000),
        });
        if (res.status === 404) throw new Error(`404 ${url}`);
        if (!res.ok) {
          lastError = new Error(`HTTP ${res.status} ${url}`);
          if (res.status >= 500 || res.status === 429) continue;
          throw lastError;
        }
        const body = Buffer.from(await res.arrayBuffer());
        if (cacheable) writeFileSync(file, body);
        return body;
      } catch (e) {
        lastError = e;
        if (e instanceof Error && /^(404|HTTP 4)/.test(e.message)) throw e;
      }
    }
    throw lastError instanceof Error ? lastError : new Error(`Fetch failed ${url}`);
  }

  async text(url: string): Promise<string> {
    return (await this.get(url, "text")).toString("utf8");
  }
}

// ─── Planning ────────────────────────────────────────────────────────────────────────────────────────────────────

type PlannedEvent = {
  url: string;
  page: EventPage;
  title: string;
  date: string;
  siteBranch: string | null;
  branch: BranchRow | null;
  region: RegionRow | null;
  description: string;
  photos: GalleryImage[];
};

type Skip = { url: string; title: string; date: string | null; reason: string };

function londonToday(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

async function plan(fetcher: Fetcher, opts: Options, branches: BranchRow[], regions: RegionRow[]) {
  const today = londonToday();
  const picked: PlannedEvent[] = [];
  const skipped: Skip[] = [];
  const seen = new Set<string>();
  let pageUrl: string | null = EVENTS_LIST_URL;
  for (let n = 0; pageUrl && n < opts.maxPages && picked.length < opts.limit; n++) {
    const list = parseEventsList(await fetcher.text(pageUrl));
    for (const item of list.items) {
      if (picked.length >= opts.limit) break;
      if (seen.has(item.url)) continue;
      seen.add(item.url);
      if (!item.date || item.date >= today) {
        skipped.push({
          url: item.url,
          title: item.title,
          date: item.date,
          reason: "not in the past",
        });
        continue;
      }
      let page: EventPage;
      try {
        page = parseEventPage(await fetcher.text(item.url));
      } catch (e) {
        skipped.push({
          url: item.url,
          title: item.title,
          date: item.date,
          reason: `page error: ${String(e)}`,
        });
        continue;
      }
      const date = page.date ?? item.date;
      const title = cleanTitle(page.title || item.title);
      const dupKey = `${title.toLowerCase()}|${date}`;
      if (seen.has(dupKey)) {
        skipped.push({ url: item.url, title, date, reason: "duplicate" });
        continue;
      }
      seen.add(dupKey);
      if (date >= today) {
        skipped.push({ url: item.url, title, date, reason: "not in the past" });
        continue;
      }
      const photos = selectPhotos(page, MIN_PHOTOS, MAX_PHOTOS);
      if (photos.length < MIN_PHOTOS) {
        skipped.push({ url: item.url, title, date, reason: `fewer than ${MIN_PHOTOS} photos` });
        continue;
      }
      const siteBranches = page.branches.length > 0 ? page.branches : item.branches;
      const { branch, region } = mapScope(siteBranches, branches, regions);
      const pageForSummary: EventPage = {
        ...page,
        branch: branch?.name ?? region?.name ?? null,
        title,
      };
      picked.push({
        url: item.url,
        page,
        title,
        date,
        siteBranch: siteBranches[0] ?? null,
        branch,
        region,
        description: summarize(pageForSummary, date),
        photos,
      });
    }
    pageUrl = list.nextUrl;
  }
  picked.sort((a, b) => b.date.localeCompare(a.date));
  const videos =
    opts.videos > 0 ? parseChannelFeed(await fetcher.text(CHANNEL_FEED_URL), opts.videos) : [];
  return { picked, skipped, videos };
}

// ─── Writes ──────────────────────────────────────────────────────────────────────────────────────────────────────

async function toWebp(input: Buffer) {
  const { data, info } = await sharp(input, { failOn: "error" })
    .rotate() // apply EXIF orientation before the metadata is dropped
    .resize({
      width: MAX_LONG_SIDE,
      height: MAX_LONG_SIDE,
      fit: "inside",
      withoutEnlargement: true,
    })
    .webp({ quality: WEBP_QUALITY })
    .toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

function originalName(url: string): string {
  const name = decodeURIComponent(new URL(url).pathname.split("/").pop() ?? "photo");
  return name.slice(0, 255) || "photo";
}

type EventResult = {
  planned: PlannedEvent;
  status: "new" | "existing" | "updated" | "rescoped" | "failed" | "planned";
  eventId: string | null;
  photosAdded: number;
  photosPresent: number;
  error?: string;
};

async function findExisting(
  db: SupabaseClient,
  ev: PlannedEvent,
): Promise<{ id: string; description: string; scope: string; title: string } | null> {
  // 1) Marker: an imported photo's source URL. 2) Fallback: the same past record title and date.
  const { data: media, error: mErr } = await db
    .from("event_media")
    .select("event_id")
    .in(
      "source_url",
      ev.photos.map((p) => p.originalUrl),
    )
    .limit(1);
  if (mErr) throw new Error(mErr.message);
  const ids = (media ?? []).map((m) => m.event_id as string);
  const query = db
    .from("events")
    .select("id, description, scope, title")
    .eq("past_record", true)
    .is("deleted_at", null);
  const { data, error } = ids[0]
    ? await query.eq("id", ids[0]).limit(1)
    : await query
        .in("title", [ev.title, ev.page.title || ev.title])
        .eq("start_date", ev.date)
        .limit(1);
  if (error) throw new Error(error.message);
  const row = data?.[0];
  return row
    ? {
        id: row.id as string,
        description: (row.description as string) ?? "",
        scope: row.scope as string,
        title: (row.title as string) ?? "",
      }
    : null;
}

async function uploadPhoto(
  db: SupabaseClient,
  fetcher: Fetcher,
  eventId: string,
  photo: GalleryImage,
  position: number,
  inGallery: boolean,
): Promise<void> {
  const webp = await toWebp(await fetcher.get(photo.downloadUrl, "binary"));
  const mediaId = randomUUID();
  const path = `${eventId}/${mediaId}.webp`;
  const up = await db.storage
    .from(BUCKET)
    .upload(path, webp.data, { contentType: "image/webp", upsert: false });
  if (up.error) throw new Error(`upload: ${up.error.message}`);
  const { error } = await db.from("event_media").insert({
    id: mediaId,
    event_id: eventId,
    storage_path: path,
    kind: "image",
    position,
    uploaded_by: null,
    original_name: originalName(photo.originalUrl),
    in_gallery: inGallery,
    source_url: photo.originalUrl,
    width: webp.width,
    height: webp.height,
  });
  if (error) {
    await db.storage.from(BUCKET).remove([path]);
    throw new Error(`media row: ${error.message}`);
  }
}

async function importEvent(
  db: SupabaseClient,
  fetcher: Fetcher,
  ev: PlannedEvent,
  opts: Options,
): Promise<EventResult> {
  const result: EventResult = {
    planned: ev,
    status: "existing",
    eventId: null,
    photosAdded: 0,
    photosPresent: 0,
  };
  const existing = await findExisting(db, ev);
  let created = false;
  if (existing) {
    result.eventId = existing.id;
    // Records imported as national before regions were mapped become region records of the matching region.
    if (existing.scope === "national" && ev.region) {
      const { error } = await db
        .from("events")
        .update({ scope: "region", branch_id: null, region_id: ev.region.id })
        .eq("id", existing.id);
      if (error) throw new Error(error.message);
      result.status = "rescoped";
    }
    // A record imported before a title fix (TITLE_FIXES) gets the fixed title; other titles are left as edited.
    if (existing.title !== ev.title && cleanTitle(existing.title) === ev.title) {
      const { error } = await db.from("events").update({ title: ev.title }).eq("id", existing.id);
      if (error) throw new Error(error.message);
      result.status = "updated";
    }
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
        title: ev.title,
        description: ev.description,
        location: "",
        location_type: "in_person",
        organizer: "Dialogue Society",
        category: "other",
        scope: ev.branch ? "branch" : ev.region ? "region" : "national",
        branch_id: ev.branch?.id ?? null,
        region_id: ev.branch?.region_id ?? ev.region?.id ?? null,
        status: "published",
        audience: "public",
        all_day: true,
        start_date: ev.date,
        end_date: ev.date,
        registration_enabled: false,
        past_record: true,
        created_by: null,
      })
      .select("id")
      .single();
    if (error || !data) throw new Error(`event row: ${error?.message ?? "no id"}`);
    result.eventId = data.id as string;
    result.status = "new";
    created = true;
  }
  const eventId = result.eventId as string;

  const { data: rows, error: rowsErr } = await db
    .from("event_media")
    .select("source_url, position")
    .eq("event_id", eventId);
  if (rowsErr) throw new Error(rowsErr.message);
  const present = new Set((rows ?? []).map((r) => r.source_url as string | null).filter(Boolean));
  let position = Math.max(-1, ...(rows ?? []).map((r) => r.position as number)) + 1;
  result.photosPresent = ev.photos.filter((p) => present.has(p.originalUrl)).length;
  // Children/youth events: imported photos stay out of the public gallery (also on re-runs; never switched back on).
  if (isChildrenEvent(ev.title)) {
    const { error: hideErr } = await db
      .from("event_media")
      .update({ in_gallery: false })
      .eq("event_id", eventId)
      .not("source_url", "is", null)
      .eq("in_gallery", true);
    if (hideErr) throw new Error(hideErr.message);
  }
  const room = Math.max(0, MAX_PHOTOS - (rows ?? []).length);
  const missing = ev.photos.filter((p) => !present.has(p.originalUrl)).slice(0, room);
  const errors: string[] = [];
  for (const photo of missing) {
    try {
      await uploadPhoto(db, fetcher, eventId, photo, position, !isChildrenEvent(ev.title));
      position++;
      result.photosAdded++;
    } catch (e) {
      errors.push(e instanceof Error ? e.message : String(e));
    }
  }
  if (created && result.photosAdded < MIN_PHOTOS) {
    // A record without enough photos is not worth keeping: remove its files first, then the rows.
    const { data: left } = await db
      .from("event_media")
      .select("storage_path")
      .eq("event_id", eventId);
    const paths = (left ?? []).map((r) => r.storage_path as string);
    if (paths.length > 0) await db.storage.from(BUCKET).remove(paths);
    await db.from("event_media").delete().eq("event_id", eventId);
    await db.from("events").delete().eq("id", eventId);
    return {
      ...result,
      status: "failed",
      eventId: null,
      photosAdded: 0,
      error: errors.join("; ") || "too few photos",
    };
  }
  if (errors.length > 0) result.error = errors.join("; ");
  return result;
}

type VideoResult = {
  video: FeedVideo;
  status: "new" | "existing" | "failed" | "planned";
  error?: string;
};

async function importVideo(
  db: SupabaseClient,
  fetcher: Fetcher,
  video: FeedVideo,
  position: number,
): Promise<VideoResult> {
  const { data: found, error: findErr } = await db
    .from("event_videos")
    .select("id, thumb_path")
    .is("event_id", null)
    .eq("youtube_id", video.id)
    .limit(1);
  if (findErr) throw new Error(findErr.message);
  let row = found?.[0] as { id: string; thumb_path: string | null } | undefined;
  let status: VideoResult["status"] = "existing";
  if (!row) {
    const insert: Record<string, unknown> = {
      event_id: null,
      youtube_id: video.id,
      title: video.title,
      position,
    };
    // The landing page lists highlights newest first by created_at: keep the channel's publish order.
    if (video.published) insert["created_at"] = video.published;
    const { data, error } = await db
      .from("event_videos")
      .insert(insert)
      .select("id, thumb_path")
      .single();
    if (error || !data) throw new Error(`video row: ${error?.message ?? "no id"}`);
    row = data as { id: string; thumb_path: string | null };
    status = "new";
  }
  if (!row.thumb_path) {
    const path = `videos/${row.id}.jpg`;
    const jpg = await sharp(await fetcher.get(posterUrl(video.id), "binary"))
      .jpeg({ quality: 82 })
      .toBuffer();
    const up = await db.storage
      .from(BUCKET)
      .upload(path, jpg, { contentType: "image/jpeg", upsert: true });
    if (up.error) throw new Error(`poster upload: ${up.error.message}`);
    const { error } = await db.from("event_videos").update({ thumb_path: path }).eq("id", row.id);
    if (error) {
      await db.storage.from(BUCKET).remove([path]);
      throw new Error(`poster path: ${error.message}`);
    }
  }
  return { video, status };
}

// ─── Main ────────────────────────────────────────────────────────────────────────────────────────────────────────

async function counts(db: SupabaseClient) {
  const head = { count: "exact" as const, head: true };
  const [e, m, v] = await Promise.all([
    db.from("events").select("id", head).eq("past_record", true).is("deleted_at", null),
    db.from("event_media").select("id", head).not("source_url", "is", null),
    db.from("event_videos").select("id", head).is("event_id", null),
  ]);
  return { pastEvents: e.count ?? 0, importedPhotos: m.count ?? 0, highlightVideos: v.count ?? 0 };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const target = resolveTarget(opts);
  const db = createClient(target.url, target.key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const host = new URL(target.url).host;
  console.log(`Target: ${target.label} (${host})${opts.dryRun ? " — DRY RUN, no writes" : ""}`);

  const { data: branchRows, error: bErr } = await db
    .from("branches")
    .select("id, name, region_id")
    .is("deleted_at", null);
  if (bErr) throw new Error(`branches: ${bErr.message}`);
  const branches = (branchRows ?? []) as BranchRow[];
  const { data: regionRows, error: rErr } = await db
    .from("regions")
    .select("id, name")
    .is("deleted_at", null);
  if (rErr) throw new Error(`regions: ${rErr.message}`);
  const regions = (regionRows ?? []) as RegionRow[];

  const fetcher = new Fetcher(opts.cacheDir, opts.refresh);
  const before = await counts(db);
  const { picked, skipped, videos } = await plan(fetcher, opts, branches, regions);

  const results: EventResult[] = [];
  for (const ev of picked) {
    if (opts.dryRun) {
      const existing = await findExisting(db, ev);
      results.push({
        planned: ev,
        status: existing ? "existing" : "planned",
        eventId: existing?.id ?? null,
        photosAdded: 0,
        photosPresent: 0,
      });
      continue;
    }
    try {
      results.push(await importEvent(db, fetcher, ev, opts));
    } catch (e) {
      results.push({
        planned: ev,
        status: "failed",
        eventId: null,
        photosAdded: 0,
        photosPresent: 0,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }
  const videoResults: VideoResult[] = [];
  for (const [i, video] of videos.entries()) {
    if (opts.dryRun) {
      videoResults.push({ video, status: "planned" });
      continue;
    }
    try {
      videoResults.push(await importVideo(db, fetcher, video, i));
    } catch (e) {
      videoResults.push({
        video,
        status: "failed",
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }
  const after = await counts(db);

  const by = (s: string) => results.filter((r) => r.status === s).length;
  const vby = (s: string) => videoResults.filter((r) => r.status === s).length;
  console.log("");
  console.log(
    `Events: ${results.length} selected — ${by("new")} new, ${by("existing")} existing, ${by("updated")} updated, ${by("rescoped")} rescoped, ` +
      `${by("planned")} planned, ${by("failed")} failed`,
  );
  console.log(
    `Photos: ${results.reduce((n, r) => n + r.planned.photos.length, 0)} selected — ` +
      `${results.reduce((n, r) => n + r.photosAdded, 0)} uploaded, ` +
      `${results.reduce((n, r) => n + r.photosPresent, 0)} already present`,
  );
  console.log(
    `Videos: ${videoResults.length} selected — ${vby("new")} new, ${vby("existing")} existing, ` +
      `${vby("planned")} planned, ${vby("failed")} failed`,
  );
  console.log(`Skipped pages: ${skipped.length}`);
  console.log(
    `Fetches: ${fetcher.network} network, ${fetcher.cached} from cache (${opts.cacheDir})`,
  );
  console.log(
    `Database totals before → after: past events ${before.pastEvents} → ${after.pastEvents}, ` +
      `imported photos ${before.importedPhotos} → ${after.importedPhotos}, ` +
      `highlight videos ${before.highlightVideos} → ${after.highlightVideos}`,
  );
  console.log("");
  console.log("date | scope | title | photos | gallery | source URL | status");
  const regionName = new Map(regions.map((r) => [r.id, r.name]));
  for (const r of results) {
    const branch = r.planned.branch
      ? `branch ${r.planned.branch.name} (region ${regionName.get(r.planned.branch.region_id) ?? "?"})`
      : r.planned.region
        ? `region ${r.planned.region.name}`
        : `national${r.planned.siteBranch ? ` (site: ${r.planned.siteBranch})` : ""}`;
    console.log(
      `${r.planned.date} | ${branch} | ${r.planned.title} | ${r.planned.photos.length} | ` +
        `${isChildrenEvent(r.planned.title) ? "OFF (children/youth)" : "on"} | ${r.planned.url} | ` +
        `${r.status}${r.photosAdded ? ` +${r.photosAdded}` : ""}${r.error ? ` (${r.error})` : ""}`,
    );
  }
  console.log("");
  console.log("Descriptions:");
  for (const r of results) console.log(`- ${r.planned.title}: ${r.planned.description}`);
  console.log("");
  console.log("Videos (youtube id | published | title | status):");
  for (const v of videoResults) {
    console.log(
      `${v.video.id} | ${v.video.published?.slice(0, 10) ?? "-"} | ${v.video.title} | ${v.status}` +
        `${v.error ? ` (${v.error})` : ""}`,
    );
  }
  if (skipped.length > 0) {
    console.log("");
    console.log("Skipped (date | title | reason | URL):");
    for (const s of skipped) console.log(`${s.date ?? "-"} | ${s.title} | ${s.reason} | ${s.url}`);
  }
  if (
    results.some((r) => r.status === "failed") ||
    videoResults.some((v) => v.status === "failed")
  ) {
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});

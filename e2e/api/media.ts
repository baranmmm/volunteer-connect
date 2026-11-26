// Media tab test data: placeholder photos (colour gradients, made with sharp) stored like the app stores them — a WebP
// original at <branch>/<id>.webp with its .w640.webp and .w1280.webp copies — and the rows behind them. Uploads and
// rows use the app's own RPCs where a test checks permissions; the sample seed and cleanup use the service role.
import { createHash } from "node:crypto";
import sharp from "sharp";
import { adminClient, clientAs } from "./SupabaseClient";

export const MEDIA_BUCKET = "media-library";
type Rgb = [number, number, number];

/** Warm and cool gradient pairs, like the mockups' placeholders. */
export const PALETTE: [Rgb, Rgb][] = [
  [[240, 156, 88], [44, 22, 36]],
  [[226, 160, 108], [62, 36, 52]],
  [[252, 214, 150], [96, 56, 30]],
  [[226, 208, 168], [80, 62, 40]],
  [[132, 182, 222], [24, 52, 92]],
  [[168, 214, 226], [24, 66, 82]],
  [[204, 194, 232], [44, 36, 82]],
  [[196, 224, 188], [38, 72, 52]],
  [[246, 196, 132], [150, 80, 36]],
  [[214, 120, 96], [70, 28, 40]],
];

export type TestPhoto = { original: Buffer; w640: Buffer; w1280: Buffer; width: number; height: number; hash: string };

/** A gradient photo (top-left → bottom-right) with its two WebP copies; `seed` varies the angle so hashes differ. */
export async function gradientPhoto(colors: [Rgb, Rgb], seed = 0, width = 1600, height = 1067): Promise<TestPhoto> {
  const raw = Buffer.alloc(width * height * 3);
  const [a, b] = colors;
  const tilt = 0.35 + ((seed * 37) % 50) / 100;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const t = Math.min(1, Math.max(0, (y / height) * (1 - tilt) + (x / width) * tilt));
      const i = (y * width + x) * 3;
      raw[i] = Math.round(a[0] + (b[0] - a[0]) * t);
      raw[i + 1] = Math.round(a[1] + (b[1] - a[1]) * t);
      raw[i + 2] = Math.round(a[2] + (b[2] - a[2]) * t);
    }
  const image = sharp(raw, { raw: { width, height, channels: 3 } });
  const original = await image.clone().webp({ quality: 85 }).toBuffer();
  const w1280 = await image.clone().resize({ width: 1280, height: 1280, fit: "inside" }).webp({ quality: 80 }).toBuffer();
  const w640 = await image.clone().resize({ width: 640, height: 640, fit: "inside" }).webp({ quality: 80 }).toBuffer();
  return { original, w640, w1280, width, height, hash: createHash("sha256").update(original).digest("hex") };
}

export const copyPaths = (path: string): [string, string] => {
  const base = path.replace(/\.[A-Za-z0-9]+$/, "");
  return [`${base}.w640.webp`, `${base}.w1280.webp`];
};

/** Uploads an original and its copies to a bucket with the given client (Storage policies apply to users). */
export async function storePhoto(
  db: Awaited<ReturnType<typeof clientAs>>,
  bucket: string,
  path: string,
  photo: TestPhoto,
): Promise<void> {
  const [w640, w1280] = copyPaths(path);
  for (const [name, body] of [
    [path, photo.original],
    [w640, photo.w640],
    [w1280, photo.w1280],
  ] as const) {
    const { error } = await db.storage.from(bucket).upload(name, body, { contentType: "image/webp", upsert: false });
    if (error) throw new Error(`upload ${bucket}/${name}: ${error.message}`);
  }
}

/** A photo on an event's own page (event_media) through the app's RPCs, as a manager of the event. */
export async function addEventPagePhotoAs(email: string, eventId: string, photo: TestPhoto): Promise<string> {
  const db = await clientAs(email);
  const { data: id, error } = await db.rpc("add_event_media", { _event: eventId, _kind: "image", _extension: "webp", _original_name: "photo.webp" });
  if (error || !id) throw new Error(`add_event_media: ${error?.message ?? "no id"}`);
  await storePhoto(db, "event-media", `${eventId}/${String(id)}.webp`, photo);
  const variants = await db.rpc("set_event_media_variants", { p_media: String(id) });
  if (variants.error) throw new Error(`set_event_media_variants: ${variants.error.message}`);
  const size = await db.rpc("set_event_media_size", { p_media: String(id), p_width: photo.width, p_height: photo.height });
  if (size.error) throw new Error(`set_event_media_size: ${size.error.message}`);
  return String(id);
}

/** A direct upload into an album or event chapter as a manager (reserve → store → finish). */
export async function addLibraryPhotoAs(
  email: string,
  branchId: string,
  target: { album_id: string } | { event_id: string },
  photo: TestPhoto,
): Promise<string> {
  const db = await clientAs(email);
  const { data, error } = await db.rpc("add_media_photo", {
    p_branch: branchId,
    p_target: target,
    p_extension: "webp",
    p_original_name: "photo.webp",
    p_hash: photo.hash,
  });
  if (error) throw new Error(`add_media_photo: ${error.message}`);
  const slot = data as { duplicate: boolean; id?: string; path?: string };
  if (slot.duplicate || !slot.id || !slot.path) throw new Error("add_media_photo: duplicate");
  await storePhoto(db, MEDIA_BUCKET, slot.path, photo);
  const done = await db.rpc("finish_media_photo", { p_id: slot.id, p_width: photo.width, p_height: photo.height });
  if (done.error) throw new Error(`finish_media_photo: ${done.error.message}`);
  return slot.id;
}

/**
 * A past event record of a branch (all-day, `daysAgo` days back) through create_past_event, as a manager. Past
 * records are always public (validate_event): they show on the public events page, map and gallery, so only the
 * local sample seed uses them (specs use members-only events: other specs count public events).
 */
export async function createPastEventAs(email: string, branchId: string, title: string, daysAgo: number, location?: string): Promise<string> {
  const db = await clientAs(email);
  const date = new Date(Date.now() - daysAgo * 86_400_000).toISOString().slice(0, 10);
  const { data, error } = await db.rpc("create_past_event", { p_title: title, p_date: date, p_branch: branchId, p_description: "" });
  if (error || !data) throw new Error(`create_past_event "${title}": ${error?.message ?? "no id"}`);
  if (location) await adminClient().from("events").update({ location }).eq("id", String(data));
  return String(data);
}

export async function createAlbumAs(email: string, branchId: string, title: string, date?: string): Promise<string> {
  const db = await clientAs(email);
  const { data, error } = await db.rpc("create_media_album", { p_branch: branchId, p: { title, date: date ?? null } });
  if (error || !data) throw new Error(`create_media_album: ${error?.message ?? "no id"}`);
  return String(data);
}

/** A volunteer's submitted upload request with `photos` (create → reserve → store → finish → submit). */
export async function uploadRequestAs(
  email: string,
  target: { album_id: string } | { event_id: string } | { proposed_title: string },
  photos: TestPhoto[],
  note = "",
): Promise<{ id: string; files: string[] }> {
  const db = await clientAs(email);
  const created = await db.rpc("create_media_upload_request", { p: { ...target, note } });
  if (created.error || !created.data) throw new Error(`create_media_upload_request: ${created.error?.message ?? "no id"}`);
  const id = String(created.data);
  const files: string[] = [];
  for (const photo of photos) {
    const r = await db.rpc("add_media_upload_file", { p_request: id, p_extension: "webp", p_original_name: "mine.webp", p_hash: photo.hash });
    if (r.error) throw new Error(`add_media_upload_file: ${r.error.message}`);
    const slot = r.data as { duplicate: boolean; id: string; path: string };
    if (slot.duplicate) continue;
    await storePhoto(db, MEDIA_BUCKET, slot.path, photo);
    const f = await db.rpc("finish_media_upload_file", { p_id: slot.id, p_width: photo.width, p_height: photo.height });
    if (f.error) throw new Error(`finish_media_upload_file: ${f.error.message}`);
    files.push(slot.id);
  }
  const sent = await db.rpc("submit_media_upload_request", { p_id: id });
  if (sent.error) throw new Error(`submit_media_upload_request: ${sent.error.message}`);
  return { id, files };
}

/** media-library objects whose name contains one of the ids (service role, read only). */
export async function storedMediaObjects(branchId: string, ids: string[]): Promise<string[]> {
  const { data, error } = await adminClient().storage.from(MEDIA_BUCKET).list(branchId, { limit: 1000 });
  if (error) throw new Error(`list ${branchId}: ${error.message}`);
  return data.map((o) => o.name).filter((n) => ids.some((id) => n.startsWith(id))).sort();
}

/** Removes albums (with their photos and files) and library photos of events (service role; test cleanup). */
export async function deleteMediaData(branchId: string, albumIds: string[], eventIds: string[] = []): Promise<void> {
  const admin = adminClient();
  const photos = await admin
    .from("media_photos")
    .select("id, storage_path")
    .or([albumIds.length ? `album_id.in.(${albumIds.join(",")})` : "", eventIds.length ? `event_id.in.(${eventIds.join(",")})` : ""].filter(Boolean).join(",") || "id.is.null");
  const paths = (photos.data ?? []).flatMap((p) => [p.storage_path as string, ...copyPaths(p.storage_path as string)]);
  if (paths.length) await admin.storage.from(MEDIA_BUCKET).remove(paths);
  if (photos.data?.length) await admin.from("media_photos").delete().in("id", photos.data.map((p) => p.id as string));
  if (albumIds.length) await admin.from("media_albums").delete().in("id", albumIds);
  void branchId;
}

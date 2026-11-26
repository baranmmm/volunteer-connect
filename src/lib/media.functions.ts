import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { requireMember } from "@/lib/require-member";
import {
  MEDIA_BUCKET,
  MEDIA_SOURCES,
  mediaChapterRow,
  mediaDownloadRequestRow,
  mediaHighlightRow,
  mediaHome,
  mediaPhotoRow,
  mediaTargets,
  mediaUploadRequestRow,
  moveResult,
  storagePaths,
  type MediaChapter,
  type MediaDownloadFiles,
  type MediaDownloadRequest,
  type MediaPhoto,
  type MediaPhotoRow,
  type MediaUploadRequest,
} from "./media";

// Media tab. Every read and write is a SECURITY DEFINER RPC that checks the branch (members of the branch, the
// region's RDs; managers for writes). Photos are signed here with the member's own token, so the Storage policies
// decide again (volunteers and trustees get only the copies of library photos). Deleting files after a delete,
// decision or move uses the service role, only for the paths the RPC just returned for this caller.

const SIGNED_SECONDS = 600;
const fail = (error: { message: string } | null) => {
  if (error) throw new Error(error.message);
};
const flushNoticeEmails = async () =>
  (await import("@/lib/notice-emails.server")).flushNoticeEmails();
const admin = async () => (await import("@/integrations/supabase/client.server")).supabaseAdmin;

/** Signed links for paths of one bucket (missing = not allowed or not stored). */
async function signPaths(supabase: SupabaseClient, bucket: string, paths: string[]) {
  const unique = [...new Set(paths)];
  const result = new Map<string, string>();
  if (!unique.length) return result;
  const { data } = await supabase.storage.from(bucket).createSignedUrls(unique, SIGNED_SECONDS);
  const origin = import.meta.env["VITE_SUPABASE_URL"] ?? process.env["SUPABASE_URL"];
  for (const item of data ?? []) {
    if (item.error || !item.signedUrl || !item.path) continue;
    const raw = new URL(item.signedUrl);
    result.set(item.path, `${origin}${raw.pathname}${raw.search}`);
  }
  return result;
}

/** Replaces paths with signed links (the 640 and 1280 copies; the original only when there are no copies). */
async function signPhotos(supabase: SupabaseClient, rows: MediaPhotoRow[]): Promise<MediaPhoto[]> {
  const byBucket = new Map<string, string[]>();
  for (const r of rows) {
    const list = byBucket.get(r.bucket) ?? [];
    if (r.w640) list.push(r.w640);
    if (r.w1280) list.push(r.w1280);
    if (!r.w640 && r.original) list.push(r.original);
    byBucket.set(r.bucket, list);
  }
  const signed = new Map<string, Map<string, string>>();
  for (const [bucket, paths] of byBucket)
    signed.set(bucket, await signPaths(supabase, bucket, paths));
  return rows.map(({ original, w640, w1280, bucket, ...rest }) => {
    const urls = signed.get(bucket)!;
    const fallback = !w640 && original ? (urls.get(original) ?? null) : null;
    return {
      ...rest,
      thumb: (w640 && urls.get(w640)) || fallback,
      src: (w1280 && urls.get(w1280)) || fallback,
    };
  });
}

async function signChapters(supabase: SupabaseClient, rows: z.infer<typeof mediaChapterRow>[]) {
  const photos = await signPhotos(
    supabase,
    rows.flatMap((c) => c.photos),
  );
  const byId = new Map(photos.map((p) => [p.id, p]));
  return rows.map((c): MediaChapter => ({
    ...c,
    photos: c.photos.map((p) => byId.get(p.id)!).filter(Boolean),
  }));
}

/** Deletes files through Storage (service role), then the rows whose files are gone. */
async function removeMediaFiles(paths: string[]) {
  if (!paths.length) return;
  const db = await admin();
  for (let i = 0; i < paths.length; i += 100) {
    const { error } = await db.storage.from(MEDIA_BUCKET).remove(paths.slice(i, i + 100));
    // The rows stay marked; the scheduled sweep (media_cleanup_paths) tries again.
    if (error)
      console.error("[media] storage removal failed; the cleanup will retry", error.message);
  }
  const cleared = await db.rpc("clear_deleted_media");
  if (cleared.error) console.error("[media] clear_deleted_media failed", cleared.error.message);
}

// ---------------------------------------------------------------------------------------------------------------
// Reads

const branchInput = z.object({ branchId: z.string().uuid().nullable().optional() });
const filterInput = z.object({
  branchId: z.string().uuid(),
  source: z.enum(MEDIA_SOURCES).default("all"),
  year: z.number().int().min(2000).max(2100).nullable().optional(),
  search: z.string().max(100).optional(),
  beforeAt: z.string().max(40).nullable().optional(),
  beforeId: z.string().uuid().nullable().optional(),
});

export const getMediaHome = createServerFn({ method: "GET" })
  .middleware([requireMember])
  .inputValidator(branchInput)
  .handler(async ({ data, context }) => {
    const r = await context.supabase.rpc(
      "get_media_home",
      data.branchId ? { p_branch: data.branchId } : {},
    );
    if (r.error?.message === "Not allowed") return null;
    fail(r.error);
    return mediaHome.parse(r.data);
  });

export const getMediaChapters = createServerFn({ method: "GET" })
  .middleware([requireMember])
  .inputValidator(filterInput)
  .handler(async ({ data, context }) => {
    const r = await context.supabase.rpc("get_media_chapters", {
      p_branch: data.branchId,
      p_source: data.source,
      ...(data.year ? { p_year: data.year } : {}),
      ...(data.search ? { p_search: data.search } : {}),
      ...(data.beforeAt ? { p_before_at: data.beforeAt } : {}),
      ...(data.beforeId ? { p_before_id: data.beforeId } : {}),
      p_limit: 6,
    });
    fail(r.error);
    const rows = z.object({ chapters: z.array(mediaChapterRow) }).parse(r.data).chapters;
    return signChapters(context.supabase, rows);
  });

export const getMediaChapter = createServerFn({ method: "GET" })
  .middleware([requireMember])
  .inputValidator(z.object({ kind: z.enum(["event", "album"]), id: z.string().uuid() }))
  .handler(async ({ data, context }) => {
    const r = await context.supabase.rpc("get_media_chapter", { p_kind: data.kind, p_id: data.id });
    if (r.error?.message === "Chapter not found") return null;
    fail(r.error);
    return (await signChapters(context.supabase, [mediaChapterRow.parse(r.data)]))[0]!;
  });

export const getMediaPhotos = createServerFn({ method: "GET" })
  .middleware([requireMember])
  .inputValidator(filterInput.omit({ search: true }))
  .handler(async ({ data, context }) => {
    const r = await context.supabase.rpc("get_media_photos", {
      p_branch: data.branchId,
      p_source: data.source,
      ...(data.year ? { p_year: data.year } : {}),
      ...(data.beforeAt ? { p_before_at: data.beforeAt } : {}),
      ...(data.beforeId ? { p_before_id: data.beforeId } : {}),
      p_limit: 60,
    });
    fail(r.error);
    const rows = z.object({ photos: z.array(mediaPhotoRow) }).parse(r.data).photos;
    return signPhotos(context.supabase, rows);
  });

export const listMediaTargets = createServerFn({ method: "GET" })
  .middleware([requireMember])
  .inputValidator(z.object({ branchId: z.string().uuid() }))
  .handler(async ({ data, context }) => {
    const r = await context.supabase.rpc("list_media_targets", { p_branch: data.branchId });
    fail(r.error);
    return mediaTargets.parse(r.data);
  });

export const markMediaChapterViewed = createServerFn({ method: "POST" })
  .middleware([requireMember])
  .inputValidator(z.object({ kind: z.enum(["event", "album"]), id: z.string().uuid() }))
  .handler(async ({ data, context }) => {
    fail(
      (
        await context.supabase.rpc("mark_media_chapter_viewed", {
          p_kind: data.kind,
          p_id: data.id,
        })
      ).error,
    );
  });

// ---------------------------------------------------------------------------------------------------------------
// Albums and photos (Branch Managers, Regional Directors)

const albumFields = z.object({
  title: z.string().trim().min(1).max(120),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional(),
  description: z.string().max(500).nullable().optional(),
});
const target = z.union([
  z.object({ album_id: z.string().uuid() }),
  z.object({ event_id: z.string().uuid() }),
]);
const hash = z.string().regex(/^[0-9a-f]{64}$/);
const extension = z.enum(["jpg", "png", "webp"]);
const reserved = z.union([
  z.object({ duplicate: z.literal(true) }),
  z.object({ duplicate: z.literal(false), id: z.string().uuid(), path: z.string() }),
]);

export const createMediaAlbum = createServerFn({ method: "POST" })
  .middleware([requireMember])
  .inputValidator(z.object({ branchId: z.string().uuid(), album: albumFields }))
  .handler(async ({ data, context }) => {
    const r = await context.supabase.rpc("create_media_album", {
      p_branch: data.branchId,
      p: data.album,
    });
    fail(r.error);
    return z.string().uuid().parse(r.data);
  });

export const updateMediaAlbum = createServerFn({ method: "POST" })
  .middleware([requireMember])
  .inputValidator(z.object({ id: z.string().uuid(), album: albumFields }))
  .handler(async ({ data, context }) => {
    fail(
      (await context.supabase.rpc("update_media_album", { p_id: data.id, p: data.album })).error,
    );
  });

export const setMediaAlbumCover = createServerFn({ method: "POST" })
  .middleware([requireMember])
  .inputValidator(z.object({ albumId: z.string().uuid(), photoId: z.string().uuid().nullable() }))
  .handler(async ({ data, context }) => {
    fail(
      (
        await context.supabase.rpc("set_media_album_cover", {
          p_album: data.albumId,
          p_photo: data.photoId,
        })
      ).error,
    );
  });

/** Hard delete (the typed title confirms it): hidden at once, files through Storage, then the rows. */
export const deleteMediaAlbum = createServerFn({ method: "POST" })
  .middleware([requireMember])
  .inputValidator(z.object({ id: z.string().uuid(), title: z.string().max(200) }))
  .handler(async ({ data, context }) => {
    const r = await context.supabase.rpc("delete_media_album", {
      p_id: data.id,
      p_title: data.title,
    });
    fail(r.error);
    await removeMediaFiles(storagePaths.parse(r.data).paths);
  });

export const deleteMediaPhotos = createServerFn({ method: "POST" })
  .middleware([requireMember])
  .inputValidator(z.object({ ids: z.array(z.string().uuid()).min(1).max(200) }))
  .handler(async ({ data, context }) => {
    const r = await context.supabase.rpc("delete_media_photos", { p_ids: data.ids });
    fail(r.error);
    await removeMediaFiles(storagePaths.parse(r.data).paths);
  });

export const reorderMediaPhotos = createServerFn({ method: "POST" })
  .middleware([requireMember])
  .inputValidator(
    z.object({ albumId: z.string().uuid(), ids: z.array(z.string().uuid()).max(5000) }),
  )
  .handler(async ({ data, context }) => {
    fail(
      (
        await context.supabase.rpc("reorder_media_photos", {
          p_album: data.albumId,
          p_ids: data.ids,
        })
      ).error,
    );
  });

/** Reserves one direct upload; the browser then stores the original and both copies and calls finishMediaPhoto. */
export const addMediaPhoto = createServerFn({ method: "POST" })
  .middleware([requireMember])
  .inputValidator(
    z.object({
      branchId: z.string().uuid(),
      target,
      extension,
      name: z.string().max(255),
      hash,
    }),
  )
  .handler(async ({ data, context }) => {
    const r = await context.supabase.rpc("add_media_photo", {
      p_branch: data.branchId,
      p_target: data.target,
      p_extension: data.extension,
      p_original_name: data.name,
      p_hash: data.hash,
    });
    fail(r.error);
    return reserved.parse(r.data);
  });

const finishInput = z.object({
  id: z.string().uuid(),
  width: z.number().int().min(1).max(20000),
  height: z.number().int().min(1).max(20000),
});
export const finishMediaPhoto = createServerFn({ method: "POST" })
  .middleware([requireMember])
  .inputValidator(finishInput)
  .handler(async ({ data, context }) => {
    fail(
      (
        await context.supabase.rpc("finish_media_photo", {
          p_id: data.id,
          p_width: data.width,
          p_height: data.height,
        })
      ).error,
    );
  });

/**
 * Moves photos to another album or event chapter of the same branch. The database plans it (what to copy), the
 * server copies event page photos into the media library, then the database commits only if every copy is stored;
 * when a copy or the commit fails, the copies made are removed again and nothing has changed.
 */
export const moveMediaPhotos = createServerFn({ method: "POST" })
  .middleware([requireMember])
  .inputValidator(
    z.object({
      items: z
        .array(z.object({ source: z.enum(["library", "event"]), id: z.string().uuid() }))
        .min(1)
        .max(200),
      target,
    }),
  )
  .handler(async ({ data, context }) => {
    const args = { p_items: data.items, p_target: data.target };
    const plan = await context.supabase.rpc("move_media_photos", { ...args, p_commit: false });
    fail(plan.error);
    const copies = moveResult.parse(plan.data).copies;
    const made: string[] = [];
    const db = await admin();
    const undo = async () => {
      if (made.length) await db.storage.from(MEDIA_BUCKET).remove(made);
    };
    try {
      for (const c of copies) {
        // Storage copies only inside one bucket: download and upload the bytes.
        const file = await db.storage.from(c.from_bucket).download(c.from);
        if (file.error || !file.data) throw new Error("Moving the photo failed");
        const up = await db.storage.from(c.to_bucket).upload(c.to, file.data, {
          contentType: file.data.type || undefined,
          upsert: false,
        });
        if (up.error) throw new Error("Moving the photo failed");
        made.push(c.to);
      }
    } catch (e) {
      await undo();
      throw e;
    }
    const commit = await context.supabase.rpc("move_media_photos", { ...args, p_commit: true });
    if (commit.error) {
      await undo();
      throw new Error(commit.error.message);
    }
    const result = moveResult.parse(commit.data);
    const old = new Map<string, string[]>();
    for (const r of result.remove) old.set(r.bucket, [...(old.get(r.bucket) ?? []), r.path]);
    for (const [bucket, paths] of old) {
      const { error } = await db.storage.from(bucket).remove(paths);
      if (error) console.error("[media] old event photo files were not removed", error.message);
    }
    return { moved: result.moved, skipped: result.skipped };
  });

// ---------------------------------------------------------------------------------------------------------------
// Upload requests (volunteers → the branch's BM / the region's RD)

async function signRequest(
  supabase: SupabaseClient,
  row: z.infer<typeof mediaUploadRequestRow>,
): Promise<MediaUploadRequest> {
  const urls = await signPaths(
    supabase,
    MEDIA_BUCKET,
    row.files.flatMap((f) => [f.w640, f.w1280]),
  );
  return {
    ...row,
    files: row.files.map(({ path: _path, w640, w1280, ...f }) => ({
      ...f,
      thumb: urls.get(w640) ?? null,
      src: urls.get(w1280) ?? null,
    })),
  };
}

export const createMediaUploadRequest = createServerFn({ method: "POST" })
  .middleware([requireMember])
  .inputValidator(
    z.object({
      target: z.union([target, z.object({ proposed_title: z.string().trim().min(1).max(120) })]),
      note: z.string().max(500).optional(),
    }),
  )
  .handler(async ({ data, context }) => {
    const r = await context.supabase.rpc("create_media_upload_request", {
      p: { ...data.target, note: data.note ?? "" },
    });
    fail(r.error);
    return z.string().uuid().parse(r.data);
  });

export const addMediaUploadFile = createServerFn({ method: "POST" })
  .middleware([requireMember])
  .inputValidator(
    z.object({ requestId: z.string().uuid(), extension, name: z.string().max(255), hash }),
  )
  .handler(async ({ data, context }) => {
    const r = await context.supabase.rpc("add_media_upload_file", {
      p_request: data.requestId,
      p_extension: data.extension,
      p_original_name: data.name,
      p_hash: data.hash,
    });
    fail(r.error);
    return reserved.parse(r.data);
  });

export const finishMediaUploadFile = createServerFn({ method: "POST" })
  .middleware([requireMember])
  .inputValidator(finishInput)
  .handler(async ({ data, context }) => {
    fail(
      (
        await context.supabase.rpc("finish_media_upload_file", {
          p_id: data.id,
          p_width: data.width,
          p_height: data.height,
        })
      ).error,
    );
  });

export const removeMediaUploadFile = createServerFn({ method: "POST" })
  .middleware([requireMember])
  .inputValidator(z.object({ id: z.string().uuid() }))
  .handler(async ({ data, context }) => {
    const r = await context.supabase.rpc("remove_media_upload_file", { p_id: data.id });
    fail(r.error);
    await removeMediaFiles(storagePaths.parse(r.data).paths);
  });

export const submitMediaUploadRequest = createServerFn({ method: "POST" })
  .middleware([requireMember])
  .inputValidator(z.object({ id: z.string().uuid() }))
  .handler(async ({ data, context }) => {
    const r = await context.supabase.rpc("submit_media_upload_request", { p_id: data.id });
    fail(r.error);
    await removeMediaFiles(storagePaths.parse(r.data).paths);
    await flushNoticeEmails();
  });

export const withdrawMediaUploadRequest = createServerFn({ method: "POST" })
  .middleware([requireMember])
  .inputValidator(z.object({ id: z.string().uuid() }))
  .handler(async ({ data, context }) => {
    const r = await context.supabase.rpc("withdraw_media_upload_request", { p_id: data.id });
    fail(r.error);
    await removeMediaFiles(storagePaths.parse(r.data).paths);
  });

export const listMediaUploadRequests = createServerFn({ method: "GET" })
  .middleware([requireMember])
  .inputValidator(z.object({ box: z.enum(["mine", "review"]) }))
  .handler(async ({ data, context }) => {
    const r = await context.supabase.rpc("list_media_upload_requests", { p_box: data.box });
    fail(r.error);
    const rows = z.array(mediaUploadRequestRow).parse(r.data ?? []);
    return Promise.all(rows.map((row) => signRequest(context.supabase, row)));
  });

export const getMediaUploadRequest = createServerFn({ method: "GET" })
  .middleware([requireMember])
  .inputValidator(z.object({ id: z.string().uuid() }))
  .handler(async ({ data, context }) => {
    const r = await context.supabase.rpc("get_media_upload_request", { p_id: data.id });
    if (r.error?.message === "Request not found") return null;
    fail(r.error);
    return signRequest(context.supabase, mediaUploadRequestRow.parse(r.data));
  });

/** Approve all or some: the other files are deleted from Storage straight away. */
export const approveMediaUploadRequest = createServerFn({ method: "POST" })
  .middleware([requireMember])
  .inputValidator(
    z.object({
      id: z.string().uuid(),
      fileIds: z.array(z.string().uuid()).min(1).max(20),
      albumTitle: z.string().trim().max(120).optional(),
    }),
  )
  .handler(async ({ data, context }) => {
    const r = await context.supabase.rpc("approve_media_upload_request", {
      p_id: data.id,
      p_file_ids: data.fileIds,
      ...(data.albumTitle ? { p_album_title: data.albumTitle } : {}),
    });
    fail(r.error);
    const result = z
      .object({
        album_id: z.string().uuid().nullable(),
        event_id: z.string().uuid().nullable(),
        added: z.number(),
        skipped: z.number(),
        paths: z.array(z.string()),
      })
      .parse(r.data);
    await removeMediaFiles(result.paths);
    await flushNoticeEmails();
    return {
      albumId: result.album_id,
      eventId: result.event_id,
      added: result.added,
      skipped: result.skipped,
    };
  });

export const declineMediaUploadRequest = createServerFn({ method: "POST" })
  .middleware([requireMember])
  .inputValidator(z.object({ id: z.string().uuid(), reason: z.string().max(500).optional() }))
  .handler(async ({ data, context }) => {
    const r = await context.supabase.rpc("decline_media_upload_request", {
      p_id: data.id,
      ...(data.reason?.trim() ? { p_reason: data.reason.trim() } : {}),
    });
    fail(r.error);
    await removeMediaFiles(storagePaths.parse(r.data).paths);
    await flushNoticeEmails();
  });

// ---------------------------------------------------------------------------------------------------------------
// Part 2: highlights, direct full-size downloads (managers), download requests (volunteers and trustees)

export const getMediaHighlights = createServerFn({ method: "GET" })
  .middleware([requireMember])
  .inputValidator(z.object({ branchId: z.string().uuid() }))
  .handler(async ({ data, context }) => {
    const r = await context.supabase.rpc("get_media_highlights", { p_branch: data.branchId, p_limit: 30 });
    fail(r.error);
    const rows = z.object({ photos: z.array(mediaHighlightRow) }).parse(r.data).photos;
    const signed = await signPhotos(context.supabase, rows);
    return signed.map((p, i) => ({
      ...p,
      chapter_venue: rows[i]!.chapter_venue ?? null,
      chapter_photo_count: rows[i]!.chapter_photo_count,
    }));
  });

export const setMediaHighlight = createServerFn({ method: "POST" })
  .middleware([requireMember])
  .inputValidator(z.object({ source: z.enum(["library", "event"]), id: z.string().uuid(), on: z.boolean() }))
  .handler(async ({ data, context }) => {
    fail(
      (await context.supabase.rpc("set_media_highlight", { p_source: data.source, p_id: data.id, p_on: data.on }))
        .error,
    );
  });

/**
 * A Branch Manager's / Regional Director's full-size download of one photo: the photo is looked up in its chapter as
 * the caller (managers get the original path) and signed with the caller's token (Storage checks again) for a
 * minute, as a download with the original name.
 */
export const getMediaOriginalUrl = createServerFn({ method: "POST" })
  .middleware([requireMember])
  .inputValidator(
    z.object({
      chapterKind: z.enum(["event", "album"]),
      chapterId: z.string().uuid(),
      photoId: z.string().uuid(),
    }),
  )
  .handler(async ({ data, context }) => {
    const r = await context.supabase.rpc("get_media_chapter", { p_kind: data.chapterKind, p_id: data.chapterId });
    fail(r.error);
    const chapter = mediaChapterRow.parse(r.data);
    const manager = await context.supabase.rpc("can_manage_media", { _branch: chapter.branch_id! });
    if (manager.error || !manager.data) throw new Error("Not allowed");
    const photo = chapter.photos.find((p) => p.id === data.photoId);
    if (!photo?.original) throw new Error("Not allowed");
    const name = `${chapter.title.replace(/[^\p{L}\p{N} _-]+/gu, "").trim() || "photo"}-${photo.id.slice(0, 8)}.${photo.original.split(".").pop()}`;
    const signed = await context.supabase.storage.from(photo.bucket).createSignedUrl(photo.original, 60, { download: name });
    if (signed.error || !signed.data) throw new Error("Not allowed");
    const raw = new URL(signed.data.signedUrl);
    return { url: `${import.meta.env["VITE_SUPABASE_URL"] ?? process.env["SUPABASE_URL"]}${raw.pathname}${raw.search}` };
  });

async function signDownloadRequest(
  supabase: SupabaseClient,
  row: z.infer<typeof mediaDownloadRequestRow>,
): Promise<MediaDownloadRequest> {
  const byBucket = new Map<string, string[]>();
  for (const i of row.items) byBucket.set(i.bucket, [...(byBucket.get(i.bucket) ?? []), i.w640]);
  const urls = new Map<string, string>();
  for (const [bucket, paths] of byBucket)
    for (const [k, v] of await signPaths(supabase, bucket, paths)) urls.set(`${bucket}:${k}`, v);
  return {
    ...row,
    items: row.items.map((i) => ({
      id: i.id,
      source: i.source,
      photo_id: i.photo_id,
      thumb: urls.get(`${i.bucket}:${i.w640}`) ?? null,
    })),
  };
}

const itemRefs = z
  .array(z.object({ source: z.enum(["library", "event"]), id: z.string().uuid() }))
  .min(1)
  .max(50);

export const requestMediaDownload = createServerFn({ method: "POST" })
  .middleware([requireMember])
  .inputValidator(z.object({ items: itemRefs, reason: z.string().max(500).optional() }))
  .handler(async ({ data, context }) => {
    const r = await context.supabase.rpc("request_media_download", {
      p_items: data.items,
      ...(data.reason?.trim() ? { p_reason: data.reason.trim() } : {}),
    });
    fail(r.error);
    await flushNoticeEmails();
    return z.string().uuid().parse(r.data);
  });

export const listMediaDownloadRequests = createServerFn({ method: "GET" })
  .middleware([requireMember])
  .inputValidator(z.object({ box: z.enum(["mine", "review"]) }))
  .handler(async ({ data, context }) => {
    const r = await context.supabase.rpc("list_media_download_requests", { p_box: data.box });
    fail(r.error);
    const rows = z.array(mediaDownloadRequestRow).parse(r.data ?? []);
    return Promise.all(rows.map((row) => signDownloadRequest(context.supabase, row)));
  });

export const withdrawMediaDownloadRequest = createServerFn({ method: "POST" })
  .middleware([requireMember])
  .inputValidator(z.object({ id: z.string().uuid() }))
  .handler(async ({ data, context }) => {
    fail((await context.supabase.rpc("withdraw_media_download_request", { p_id: data.id })).error);
  });

export const approveMediaDownloadRequest = createServerFn({ method: "POST" })
  .middleware([requireMember])
  .inputValidator(z.object({ id: z.string().uuid() }))
  .handler(async ({ data, context }) => {
    fail((await context.supabase.rpc("approve_media_download_request", { p_id: data.id })).error);
    await flushNoticeEmails();
  });

export const declineMediaDownloadRequest = createServerFn({ method: "POST" })
  .middleware([requireMember])
  .inputValidator(z.object({ id: z.string().uuid(), reason: z.string().max(500).optional() }))
  .handler(async ({ data, context }) => {
    fail(
      (
        await context.supabase.rpc("decline_media_download_request", {
          p_id: data.id,
          ...(data.reason?.trim() ? { p_reason: data.reason.trim() } : {}),
        })
      ).error,
    );
    await flushNoticeEmails();
  });

/** The download page: the request (previews only), or null when it is not the caller's to see. */
export const getMediaDownload = createServerFn({ method: "GET" })
  .middleware([requireMember])
  .inputValidator(z.object({ id: z.string().uuid() }))
  .handler(async ({ data, context }) => {
    const r = await context.supabase.rpc("get_media_download", { p_id: data.id });
    if (r.error?.message === "Request not found") return null;
    fail(r.error);
    return signDownloadRequest(context.supabase, mediaDownloadRequestRow.parse(r.data));
  });

/**
 * The full-size files of an approved request, for its requester inside the 24-hour window: the database checks the
 * requester, the approval and the window (media_download_files, service role); the files are then signed with the
 * service role for five minutes as downloads. Never anyone else's request.
 */
export const getMediaDownloadFiles = createServerFn({ method: "POST" })
  .middleware([requireMember])
  .inputValidator(z.object({ id: z.string().uuid() }))
  .handler(async ({ data, context }): Promise<MediaDownloadFiles> => {
    const db = await admin();
    const r = await db.rpc("media_download_files", { p_id: data.id, p_user: context.userId });
    fail(r.error);
    const result = z
      .object({
        state: z.enum(["ready", "expired", "submitted", "approved", "declined", "withdrawn", "not_found"]),
        expires_at: z.string().nullable().optional(),
        files: z
          .array(z.object({ item_id: z.string(), bucket: z.string(), path: z.string(), name: z.string().nullable() }))
          .optional(),
      })
      .parse(r.data);
    if (result.state === "expired") return { state: "expired", expires_at: result.expires_at ?? null };
    if (result.state !== "ready") return { state: result.state === "approved" ? "not_found" : result.state };
    const origin = import.meta.env["VITE_SUPABASE_URL"] ?? process.env["SUPABASE_URL"];
    const files: { item_id: string; url: string; name: string }[] = [];
    for (const [n, f] of (result.files ?? []).entries()) {
      const ext = f.path.split(".").pop() ?? "webp";
      const name = `photo-${String(n + 1).padStart(2, "0")}.${ext}`;
      const signed = await db.storage.from(f.bucket).createSignedUrl(f.path, 300, { download: name });
      if (signed.error || !signed.data) continue;
      const raw = new URL(signed.data.signedUrl);
      files.push({ item_id: f.item_id, url: `${origin}${raw.pathname}${raw.search}`, name });
    }
    return { state: "ready", expires_at: result.expires_at ?? "", files };
  });

/** The dashboard's "Latest photos": the newest photos of the member's branch (events and albums), or none. */
export const getLatestMediaPhotos = createServerFn({ method: "GET" })
  .middleware([requireMember])
  .handler(async ({ context }) => {
    const home = await context.supabase.rpc("get_media_home", {});
    if (home.error) return null; // not a branch member (followers, NCs): no strip
    const branch = mediaHome.parse(home.data).branch;
    const r = await context.supabase.rpc("get_media_photos", { p_branch: branch.id, p_limit: 12 });
    fail(r.error);
    const rows = z.object({ photos: z.array(mediaPhotoRow) }).parse(r.data).photos;
    return { branchId: branch.id, photos: await signPhotos(context.supabase, rows) };
  });

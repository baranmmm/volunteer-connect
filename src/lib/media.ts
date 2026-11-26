import { z } from "zod";

// The Media tab (members-only branch gallery): shapes of the get_media_* RPCs and pure helpers shared by the
// server functions, the pages and the tests. Paths never reach the browser: the server signs every photo.

export const MEDIA_BUCKET = "media-library";
export const MEDIA_SOURCES = ["all", "events", "albums"] as const;
export type MediaSource = (typeof MEDIA_SOURCES)[number];
export type ChapterKind = "event" | "album";
/** At most this many photos in one upload request (the database enforces the same). */
export const MAX_REQUEST_PHOTOS = 20;

/** One photo as the database returns it (storage paths; the server replaces them with signed links). */
export const mediaPhotoRow = z.object({
  id: z.string().uuid(),
  source: z.enum(["library", "event"]),
  bucket: z.enum(["media-library", "event-media"]),
  original: z.string().nullable(),
  w640: z.string().nullable(),
  w1280: z.string().nullable(),
  width: z.number().nullable(),
  height: z.number().nullable(),
  created_at: z.string(),
  chapter_kind: z.enum(["event", "album"]).optional(),
  chapter_id: z.string().uuid().optional(),
  chapter_title: z.string().optional(),
  chapter_date: z.string().nullable().optional(),
});
export type MediaPhotoRow = z.infer<typeof mediaPhotoRow>;

/** A photo with signed links: `thumb` (640 copy) for tiles, `src` (1280 copy) for the viewers. */
export type MediaPhoto = Omit<MediaPhotoRow, "original" | "w640" | "w1280" | "bucket"> & {
  thumb: string | null;
  src: string | null;
};

export const mediaChapterRow = z.object({
  kind: z.enum(["event", "album"]),
  id: z.string().uuid(),
  title: z.string(),
  date: z.string().nullable(),
  venue: z.string().nullable(),
  description: z.string().nullable(),
  photo_count: z.number(),
  last_added_at: z.string().nullable(),
  cover_photo_id: z.string().uuid().nullable(),
  is_new: z.boolean().nullable(),
  unseen: z.boolean(),
  photos: z.array(mediaPhotoRow),
  sort_at: z.string().optional(),
  branch_id: z.string().uuid().optional(),
});
export type MediaChapter = Omit<z.infer<typeof mediaChapterRow>, "photos"> & {
  photos: MediaPhoto[];
};

export const mediaHome = z.object({
  branches: z.array(z.object({ id: z.string().uuid(), name: z.string() })),
  branch: z.object({ id: z.string().uuid(), name: z.string() }),
  can_manage: z.boolean(),
  can_request: z.boolean(),
  is_trustee: z.boolean(),
  photo_count: z.number(),
  years: z.array(
    z.object({
      year: z.number(),
      chapters: z.array(
        z.object({ kind: z.enum(["event", "album"]), id: z.string().uuid(), title: z.string() }),
      ),
    }),
  ),
  albums: z.array(z.object({ id: z.string().uuid(), title: z.string(), photo_count: z.number() })),
});
export type MediaHome = z.infer<typeof mediaHome>;

export const mediaTargets = z.object({
  albums: z.array(
    z.object({ id: z.string().uuid(), title: z.string(), date: z.string().nullable() }),
  ),
  events: z.array(
    z.object({ id: z.string().uuid(), title: z.string(), date: z.string().nullable() }),
  ),
});
export type MediaTargets = z.infer<typeof mediaTargets>;

export const UPLOAD_REQUEST_STATUSES = [
  "uploading",
  "submitted",
  "approved",
  "declined",
  "withdrawn",
] as const;
export const mediaRequestFileRow = z.object({
  id: z.string().uuid(),
  path: z.string(),
  w640: z.string(),
  w1280: z.string(),
  original_name: z.string().nullable(),
  width: z.number().nullable(),
  height: z.number().nullable(),
  ready: z.boolean(),
  duplicate: z.boolean(),
});
export const mediaUploadRequestRow = z.object({
  id: z.string().uuid(),
  branch_id: z.string().uuid(),
  branch_name: z.string().nullable(),
  status: z.enum(UPLOAD_REQUEST_STATUSES),
  note: z.string().nullable(),
  decline_reason: z.string().nullable(),
  album_id: z.string().uuid().nullable(),
  event_id: z.string().uuid().nullable(),
  proposed_title: z.string().nullable(),
  target_title: z.string().nullable(),
  target_kind: z.enum(["event", "album"]),
  result_album_id: z.string().uuid().nullable(),
  result_event_id: z.string().uuid().nullable(),
  added_count: z.number().nullable(),
  skipped_count: z.number().nullable(),
  requester_name: z.string().nullable(),
  reviewer_name: z.string().nullable(),
  reviewed_at: z.string().nullable(),
  submitted_at: z.string().nullable(),
  created_at: z.string(),
  file_count: z.number(),
  is_own: z.boolean(),
  can_edit: z.boolean(),
  can_withdraw: z.boolean(),
  can_review: z.boolean(),
  files: z.array(mediaRequestFileRow),
});
export type MediaRequestFile = Omit<
  z.infer<typeof mediaRequestFileRow>,
  "path" | "w640" | "w1280"
> & {
  thumb: string | null;
  src: string | null;
};
export type MediaUploadRequest = Omit<z.infer<typeof mediaUploadRequestRow>, "files"> & {
  files: MediaRequestFile[];
};

/** What a delete, decision or move returns for the server to remove through Storage. */
export const storagePaths = z.object({
  bucket: z.literal("media-library"),
  paths: z.array(z.string()),
});

export const moveResult = z.object({
  album_id: z.string().uuid().nullable(),
  event_id: z.string().uuid().nullable(),
  moved: z.number(),
  skipped: z.array(z.object({ id: z.string().uuid(), reason: z.enum(["duplicate", "unchanged"]) })),
  copies: z.array(
    z.object({ from_bucket: z.string(), from: z.string(), to_bucket: z.string(), to: z.string() }),
  ),
  remove: z.array(z.object({ bucket: z.string(), path: z.string() })),
  committed: z.boolean(),
});
export type MoveResult = z.infer<typeof moveResult>;

export type MediaTarget = { album_id: string } | { event_id: string };
export type MediaItemRef = { source: "library" | "event"; id: string };

// ---------------------------------------------------------------------------------------------------------------
// Pure helpers

/** The timeline dot: amber for the newest chapter and for chapters with photos added in the last 7 days. */
export function chapterAccent(
  chapter: Pick<MediaChapter, "is_new">,
  newest: boolean,
): "amber" | "primary" {
  return newest || chapter.is_new ? "amber" : "primary";
}

/** The collage's large photo alternates sides: left on the first chapter, right on the next, and so on. */
export function collageLargeSide(index: number): "left" | "right" {
  return index % 2 === 0 ? "left" : "right";
}

/**
 * The four tiles of a chapter's collage (one large + three small) and the "+N" on the last tile when the chapter has
 * more photos than are shown.
 */
export function collageTiles<T>(photos: T[], total: number): { tiles: T[]; more: number } {
  const tiles = photos.slice(0, 4);
  return { tiles, more: Math.max(0, total - tiles.length) };
}

/** Years for the filter chips and the rail, newest first, without duplicates. */
export function mediaYears(years: { year: number }[]): number[] {
  return [...new Set(years.map((y) => y.year))].sort((a, b) => b - a);
}

/** "venue · 24 photos" / "Album · 24 photos" pieces (the caller translates them). */
export function chapterMetaParts(chapter: Pick<MediaChapter, "kind" | "venue">) {
  return chapter.kind === "album"
    ? { place: null, album: true }
    : { place: chapter.venue, album: false };
}

/** The next index in a slideshow: in order, or from a shuffled order. */
export function nextSlide(current: number, count: number, step: 1 | -1 = 1): number {
  if (count <= 0) return 0;
  return (current + step + count) % count;
}

/** A shuffled order of 0..count-1 (Fisher–Yates) with `first` kept at the start, so the photo shown stays. */
export function shuffledOrder(
  count: number,
  first = 0,
  random: () => number = Math.random,
): number[] {
  const rest = Array.from({ length: count }, (_, i) => i).filter((i) => i !== first);
  for (let i = rest.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [rest[i], rest[j]] = [rest[j]!, rest[i]!];
  }
  return count > 0 ? [first, ...rest] : [];
}

export const SLIDESHOW_INTERVALS = [5, 10, 20] as const;
export type SlideshowInterval = (typeof SLIDESHOW_INTERVALS)[number];

/** Whether a move includes event page photos (they leave the event page and become members-only). */
export function movesEventPagePhotos(items: MediaItemRef[]) {
  return items.some((i) => i.source === "event");
}

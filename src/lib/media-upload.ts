import { supabase } from "@/integrations/supabase/client";
import { imageDimensions, MAX_FILE_BYTES } from "./event-rules";
import { imageVariantPaths } from "./image-variants";
import { makeImageVariants } from "./event-files";
import { MEDIA_BUCKET } from "./media";

// Browser side of Media uploads (direct uploads and upload requests). Like event photos: the image is re-encoded on a
// canvas (WebP, long side at most 2000 px), so EXIF/GPS metadata is never stored, and the 640/1280 WebP copies are
// made next to it. The duplicate check uses a SHA-256 of the file the member chose (the same photo chosen twice has
// the same hash even though every re-encode differs).

/** Photos only: JPG, PNG, WebP. */
export const MEDIA_ACCEPT = "image/jpeg,image/png,image/webp";
/** A chosen photo may be larger than the stored one (phones); the re-encoded original must fit the bucket's limit. */
export const MAX_CHOSEN_BYTES = 40 * 1024 * 1024;

export class MediaFileError extends Error {
  constructor(public readonly code: "type" | "size" | "decode") {
    super(`media-file-${code}`);
  }
}

export function checkMediaFile(file: { type: string; size: number }) {
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type))
    throw new MediaFileError("type");
  if (file.size > MAX_CHOSEN_BYTES) throw new MediaFileError("size");
}

export async function sha256Hex(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export type PreparedPhoto = {
  name: string;
  hash: string;
  original: Blob;
  w640: Blob;
  w1280: Blob;
  width: number;
  height: number;
};

export async function prepareMediaPhoto(file: File): Promise<PreparedPhoto> {
  checkMediaFile(file);
  const hash = await sha256Hex(file);
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    throw new MediaFileError("decode");
  }
  try {
    const size = imageDimensions(bitmap.width, bitmap.height);
    const canvas = document.createElement("canvas");
    canvas.width = size.width;
    canvas.height = size.height;
    const context = canvas.getContext("2d");
    if (!context) throw new MediaFileError("decode");
    context.drawImage(bitmap, 0, 0, size.width, size.height);
    const original = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (b) => (b && b.type === "image/webp" ? resolve(b) : reject(new MediaFileError("decode"))),
        "image/webp",
        0.88,
      ),
    );
    if (original.size > MAX_FILE_BYTES) throw new MediaFileError("size");
    const copies = await makeImageVariants(
      new File([original], "photo.webp", { type: "image/webp" }),
    );
    return { name: file.name, hash, original, ...copies, ...size };
  } finally {
    bitmap.close();
  }
}

/** Stores the original and both copies at a reserved path; removes what it stored when one upload fails. */
export async function storeMediaPhoto(path: string, photo: PreparedPhoto) {
  const copies = imageVariantPaths(path);
  const done: string[] = [];
  try {
    for (const [target, blob] of [
      [path, photo.original],
      [copies.w640, photo.w640],
      [copies.w1280, photo.w1280],
    ] as const) {
      const { error } = await supabase.storage
        .from(MEDIA_BUCKET)
        .upload(target, blob, { contentType: "image/webp", upsert: false });
      if (error) throw error;
      done.push(target);
    }
  } catch (e) {
    if (done.length)
      await supabase.storage
        .from(MEDIA_BUCKET)
        .remove(done)
        .catch(() => undefined);
    throw e;
  }
}

export type UploadOutcome = {
  name: string;
  status: "added" | "duplicate" | "failed";
  error?: unknown;
};

/**
 * Uploads photos one after another: reserve (server) → store (browser, Storage policy checks the reservation) →
 * finish (server). Duplicates are reported, never stored. `onProgress` gets the number of photos handled.
 */
export async function uploadMediaPhotos(
  files: File[],
  steps: {
    reserve: (
      p: PreparedPhoto,
    ) => Promise<{ duplicate: true } | { duplicate: false; id: string; path: string }>;
    finish: (id: string, p: PreparedPhoto) => Promise<unknown>;
  },
  onProgress?: (handled: number) => void,
): Promise<UploadOutcome[]> {
  const outcomes: UploadOutcome[] = [];
  for (const file of files) {
    try {
      const photo = await prepareMediaPhoto(file);
      const slot = await steps.reserve(photo);
      if (slot.duplicate) outcomes.push({ name: file.name, status: "duplicate" });
      else {
        await storeMediaPhoto(slot.path, photo);
        await steps.finish(slot.id, photo);
        outcomes.push({ name: file.name, status: "added" });
      }
    } catch (error) {
      outcomes.push({ name: file.name, status: "failed", error });
    }
    onProgress?.(outcomes.length);
  }
  return outcomes;
}

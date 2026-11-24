import { supabase } from "@/integrations/supabase/client";
import {
  EVENT_FILE_MIMES,
  eventFileExtension,
  eventUploadError,
  imageDimensions,
  validateEventFile,
} from "./event-rules";
import {
  IMAGE_VARIANT_QUALITY,
  imageVariantPathList,
  imageVariantPaths,
  imageVariantSize,
} from "./image-variants";

const preparedSizes = new WeakMap<File, { width: number; height: number }>();
/** The pixel size of an image prepared by prepareEventFile (null for other files). */
export function preparedImageSize(file: File) {
  return preparedSizes.get(file) ?? null;
}
/** Canvas encoding creates new pixels-only images: metadata, including EXIF/GPS, is not copied. */
export async function prepareEventFile(file: File, count: number): Promise<File> {
  validateEventFile(file, count);
  const extension0 = eventFileExtension(file.type, file.name);
  if (extension0 === "pdf") return file;
  // Office files keep their bytes; give them the exact MIME the bucket allows when the browser left it empty.
  if (extension0 === "docx" || extension0 === "pptx")
    return file.type
      ? file
      : new File([file], file.name, { type: EVENT_FILE_MIMES[extension0] ?? "" });
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  try {
    const dimensions = imageDimensions(bitmap.width, bitmap.height);
    const canvas = document.createElement("canvas");
    canvas.width = dimensions.width;
    canvas.height = dimensions.height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Invalid event file");
    context.drawImage(bitmap, 0, 0, dimensions.width, dimensions.height);
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error("Invalid event file"))),
        file.type,
        0.88,
      ),
    );
    const extension = eventFileExtension(blob.type);
    const prepared = new File([blob], `${file.name.replace(/\.[^.]+$/, "")}.${extension}`, {
      type: blob.type,
    });
    validateEventFile(prepared, count);
    preparedSizes.set(prepared, dimensions);
    return prepared;
  } finally {
    bitmap.close();
  }
}
export async function uploadEventFile(path: string, file: File) {
  const { error } = await supabase.storage
    .from("event-media")
    .upload(path, file, { contentType: file.type, upsert: false });
  if (error) throw eventUploadError(error);
}
/** Removes a stored event file; for an image also its resized copies (Storage before the row, copies included). */
export async function removeStoredEventFile(path: string) {
  const paths = /\.(jpe?g|png|webp)$/i.test(path) ? [path, ...imageVariantPathList(path)] : [path];
  const { error } = await supabase.storage.from("event-media").remove(paths);
  if (error) throw error;
}

/** A WebP copy of a bitmap with its long side at most `side` px (never upscaled). */
async function webpCopy(bitmap: ImageBitmap, side: number): Promise<Blob> {
  const size = imageVariantSize(bitmap.width, bitmap.height, side);
  const canvas = document.createElement("canvas");
  canvas.width = size.width;
  canvas.height = size.height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Image copy failed");
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(bitmap, 0, 0, size.width, size.height);
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/webp", IMAGE_VARIANT_QUALITY),
  );
  // Browsers without a WebP encoder fall back to PNG: no copies then (the original is used).
  if (!blob || blob.type !== "image/webp") throw new Error("Image copy failed");
  return blob;
}

/** The 640 and 1280 px WebP copies of a prepared (already re-encoded, metadata-free) image. */
export async function makeImageVariants(file: File): Promise<{ w640: Blob; w1280: Blob }> {
  const bitmap = await createImageBitmap(file);
  try {
    return { w640: await webpCopy(bitmap, 640), w1280: await webpCopy(bitmap, 1280) };
  } finally {
    bitmap.close();
  }
}

/**
 * Stores the resized copies of an uploaded image next to it, then `confirm` (set_event_media_variants) marks the row.
 * Never throws: without copies the pages use the original, so a failure only logs a warning and returns false.
 */
export async function uploadImageVariants(
  path: string,
  file: File,
  confirm: () => Promise<unknown>,
): Promise<boolean> {
  const paths = imageVariantPaths(path);
  try {
    const copies = await makeImageVariants(file);
    for (const [target, blob] of [
      [paths.w640, copies.w640],
      [paths.w1280, copies.w1280],
    ] as const) {
      const { error } = await supabase.storage
        .from("event-media")
        .upload(target, blob, { contentType: "image/webp", upsert: false });
      if (error) throw error;
    }
  } catch (e) {
    console.warn("Image copies were not stored; the original image is used.", e);
    await supabase.storage
      .from("event-media")
      .remove([paths.w640, paths.w1280])
      .catch(() => undefined);
    return false;
  }
  try {
    await confirm();
    return true;
  } catch (e) {
    console.warn("Image copies were stored but not confirmed; the original image is used.", e);
    return false;
  }
}

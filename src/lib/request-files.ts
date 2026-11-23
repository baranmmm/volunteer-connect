import { supabase } from "@/integrations/supabase/client";
import { prepareEventFile } from "./event-files";
import { eventFileExtension, eventUploadError, MAX_FILE_BYTES } from "./event-rules";
import { MAX_REQUEST_FILES } from "./event-requests";

const BUCKET = "event-request-files";

/**
 * Leaflet / invitation files: JPG, PNG, WebP or PDF, at most 10 MB and 3 per request. Images are re-encoded in the
 * browser (EXIF/GPS removed) exactly like event media; the bucket enforces MIME and size again on upload.
 */
export async function prepareRequestFile(
  file: File,
  count: number,
): Promise<{ file: File; kind: "image" | "pdf"; extension: "jpg" | "png" | "webp" | "pdf" }> {
  if (count >= MAX_REQUEST_FILES) throw new Error("Maximum 3 files per request");
  const extension = eventFileExtension(file.type, file.name);
  if (extension !== "jpg" && extension !== "png" && extension !== "webp" && extension !== "pdf")
    throw new Error("Invalid request file");
  if (file.size > MAX_FILE_BYTES) throw new Error("Event file exceeds 10 MB");
  const prepared = await prepareEventFile(file, 0);
  const final = eventFileExtension(prepared.type, prepared.name);
  if (final !== "jpg" && final !== "png" && final !== "webp" && final !== "pdf")
    throw new Error("Invalid request file");
  return { file: prepared, kind: final === "pdf" ? "pdf" : "image", extension: final };
}
export async function uploadRequestFile(path: string, file: File) {
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, file, { contentType: file.type, upsert: false });
  if (error) throw eventUploadError(error);
}
export async function removeStoredRequestFile(path: string) {
  const { error } = await supabase.storage.from(BUCKET).remove([path]);
  if (error) throw error;
}

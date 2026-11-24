import { supabase } from "@/integrations/supabase/client";
import {
  EVENT_FILE_MIMES,
  eventFileExtension,
  eventUploadError,
  imageDimensions,
  validateEventFile,
} from "./event-rules";

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
export async function removeStoredEventFile(path: string) {
  const { error } = await supabase.storage.from("event-media").remove([path]);
  if (error) throw error;
}

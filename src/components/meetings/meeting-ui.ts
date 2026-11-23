import { formatInTimeZone } from "date-fns-tz";
import { imageDimensions, LONDON } from "@/lib/event-rules";
import { dateLocale } from "@/lib/i18n";
import type { Meeting } from "@/lib/meetings";

// Meeting display helpers (London time, like events) and the browser-side image re-encoding for uploads.

/** "Mon, 24 Nov 2026, 18:00–19:30" in London time; a second date is shown when the meeting ends on another day. */
export function meetingWhen(m: Pick<Meeting, "starts_at" | "ends_at">) {
  const locale = dateLocale();
  const day = new Intl.DateTimeFormat(locale, {
    timeZone: LONDON,
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  const time = new Intl.DateTimeFormat(locale, {
    timeZone: LONDON,
    hour: "2-digit",
    minute: "2-digit",
  });
  const start = new Date(m.starts_at),
    end = new Date(m.ends_at);
  const sameDay =
    formatInTimeZone(start, LONDON, "yyyy-MM-dd") === formatInTimeZone(end, LONDON, "yyyy-MM-dd");
  return sameDay
    ? `${day.format(start)}, ${time.format(start)}–${time.format(end)}`
    : `${day.format(start)}, ${time.format(start)} – ${day.format(end)}, ${time.format(end)}`;
}

/** Images are redrawn on a canvas so EXIF/GPS metadata is never uploaded; other files keep their bytes. */
export async function prepareMeetingFile(
  file: File,
  ext: string,
  contentType: string,
): Promise<File> {
  if (!["jpg", "png", "webp"].includes(ext))
    return file.type ? file : new File([file], file.name, { type: contentType });
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  try {
    const size = imageDimensions(bitmap.width, bitmap.height);
    const canvas = document.createElement("canvas");
    canvas.width = size.width;
    canvas.height = size.height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Invalid meeting file");
    context.drawImage(bitmap, 0, 0, size.width, size.height);
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error("Invalid meeting file"))),
        contentType,
        0.88,
      ),
    );
    return new File([blob], file.name, { type: contentType });
  } finally {
    bitmap.close();
  }
}

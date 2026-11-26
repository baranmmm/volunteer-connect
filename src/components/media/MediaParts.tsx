import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { ImageOff } from "lucide-react";
import { formatDate } from "@/lib/i18n";
import type { MediaChapter, MediaPhoto } from "@/lib/media";
import { cn } from "@/lib/utils";

/** "11 Mar 2026" for a London calendar date ("2026-03-11"). */
export function chapterDate(date: string | null) {
  return date
    ? formatDate(`${date}T12:00:00Z`, { day: "numeric", month: "short", year: "numeric" })
    : "";
}

/** "Rochester Cathedral · 24 photos" / "Album · 24 photos". */
export function useChapterMeta() {
  const { t } = useTranslation();
  return (c: Pick<MediaChapter, "kind" | "venue" | "photo_count">) =>
    [
      c.kind === "album" ? t("media.album") : c.venue,
      t("media.photoCount", { count: c.photo_count }),
    ]
      .filter(Boolean)
      .join(" · ");
}

/** The alt text of a photo: its chapter and position ("Iftar Dinner, photo 3 of 24"). */
export function photoAlt(t: TFunction, title: string, index: number, count: number) {
  return t("media.photoAlt", { title, n: index + 1, count });
}

/** A photo tile image: the 640 copy, cropped to fill, lazy. Shows a quiet placeholder when it cannot be signed. */
export function MediaThumb({
  photo,
  alt,
  className,
  eager = false,
  large = false,
}: {
  photo: MediaPhoto;
  alt: string;
  className?: string;
  eager?: boolean;
  /** Large tiles use the 1280 copy. */
  large?: boolean;
}) {
  const src = large ? (photo.src ?? photo.thumb) : (photo.thumb ?? photo.src);
  if (!src)
    return (
      <span
        className={cn("flex items-center justify-center bg-muted text-muted-foreground", className)}
      >
        <ImageOff className="size-6" aria-hidden />
        <span className="sr-only">{alt}</span>
      </span>
    );
  return (
    <img
      src={src}
      alt={alt}
      loading={eager ? "eager" : "lazy"}
      decoding="async"
      draggable={false}
      className={cn("h-full w-full object-cover", className)}
    />
  );
}

/** A full-screen-viewer image: the 1280 copy, contained. */
export function MediaFull({
  photo,
  alt,
  className,
}: {
  photo: MediaPhoto;
  alt: string;
  className?: string;
}) {
  const src = photo.src ?? photo.thumb;
  if (!src) return null;
  return (
    <img
      src={src}
      alt={alt}
      decoding="async"
      draggable={false}
      className={cn("max-h-full max-w-full select-none object-contain", className)}
    />
  );
}

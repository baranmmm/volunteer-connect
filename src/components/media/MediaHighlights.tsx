import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Play, Star } from "lucide-react";
import type { MediaHighlight } from "@/lib/media";
import { cn } from "@/lib/utils";
import { MediaThumb } from "./MediaParts";

const landscape = (p: MediaHighlight) => !!p.width && !!p.height && p.width / p.height >= 1.25;

/** Desktop: one horizontal row of starred photos (landscape and square widths), scrolling sideways. */
export function HighlightsStrip({
  photos,
  onOpen,
  onPlay,
}: {
  photos: MediaHighlight[];
  onOpen: (index: number) => void;
  onPlay: () => void;
}) {
  const { t } = useTranslation();
  if (!photos.length) return null;
  return (
    <section
      data-testid="media-highlights"
      aria-labelledby="media-highlights-h"
      className="min-w-0 space-y-3"
    >
      <div className="flex items-center justify-between gap-3">
        <h2
          id="media-highlights-h"
          className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.14em] text-media-amber-text"
        >
          <Star className="size-3.5 fill-current" aria-hidden />
          {t("media.highlights.title")}
        </h2>
        <button
          type="button"
          data-testid="media-highlights-play"
          onClick={onPlay}
          className="inline-flex min-h-11 items-center gap-1.5 rounded-full px-3 text-sm font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Play className="size-4" aria-hidden />
          {t("media.highlights.play")}
        </button>
      </div>
      <ul className="flex gap-2.5 overflow-x-auto pb-2 [scrollbar-width:thin]">
        {photos.map((p, i) => (
          <li key={p.id} className="shrink-0">
            <button
              type="button"
              data-testid="media-highlight"
              data-photo-id={p.id}
              onClick={() => onOpen(i)}
              aria-label={t("media.highlights.open", { title: p.chapter_title ?? "" })}
              className={cn(
                "block h-[180px] overflow-hidden rounded-xl bg-muted shadow-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                landscape(p) ? "w-[270px]" : "w-[180px]",
              )}
            >
              <MediaThumb photo={p} alt="" eager={i < 4} />
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * Phones: a 220 px card with a starred photo, a dark gradient at the bottom, the eyebrow "Highlight", the chapter
 * title, "venue · N photos" and page dots; swipe through the highlights.
 */
export function HighlightCard({
  photos,
  onOpen,
  meta,
}: {
  photos: MediaHighlight[];
  onOpen: (index: number) => void;
  meta: (p: MediaHighlight) => string;
}) {
  const { t } = useTranslation();
  const list = useRef<HTMLUListElement>(null);
  const [active, setActive] = useState(0);
  if (!photos.length) return null;
  return (
    <section
      data-testid="media-highlight-card"
      aria-label={t("media.highlights.title")}
      className="relative mb-3"
    >
      <ul
        ref={list}
        onScroll={(e) => {
          const el = e.currentTarget;
          setActive(Math.round(el.scrollLeft / Math.max(1, el.clientWidth)));
        }}
        className="flex snap-x snap-mandatory overflow-x-auto rounded-2xl [scrollbar-width:none]"
      >
        {photos.map((p, i) => (
          <li key={p.id} className="w-full shrink-0 snap-start">
            <button
              type="button"
              data-testid="media-highlight-card-item"
              data-photo-id={p.id}
              onClick={() => onOpen(i)}
              className="relative block h-[220px] w-full overflow-hidden rounded-2xl bg-muted text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
            >
              <MediaThumb photo={p} alt="" large eager={i === 0} />
              <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/45 to-transparent px-4 pb-4 pt-14 text-white">
                <span className="block text-xs font-semibold uppercase tracking-[0.14em] text-media-amber">
                  {t("media.highlights.eyebrow")}
                </span>
                <span className="mt-0.5 block truncate text-xl font-semibold leading-tight">
                  {p.chapter_title}
                </span>
                <span className="block truncate pr-16 text-sm text-white/85">{meta(p)}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
      {photos.length > 1 && (
        <span aria-hidden className="pointer-events-none absolute bottom-5 right-4 flex gap-1.5">
          {photos.slice(0, 8).map((p, i) => (
            <span
              key={p.id}
              className={cn(
                "h-1.5 rounded-full transition-all",
                i === Math.min(active, 7) ? "w-4 bg-white" : "w-1.5 bg-white/55",
              )}
            />
          ))}
        </span>
      )}
    </section>
  );
}

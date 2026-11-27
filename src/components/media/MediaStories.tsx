import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { MoreHorizontal, Play, Plus, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  mediaYears,
  type MediaChapter,
  type MediaHighlight,
  type MediaHome,
  type MediaPhoto,
} from "@/lib/media";
import { HighlightCard } from "./MediaHighlights";
import { cn } from "@/lib/utils";
import { MediaThumb, photoAlt } from "./MediaParts";
import { FilterChip } from "./MediaTimeline";
import type { MediaFilters } from "./use-media";

/** Mobile (< 1024 px) "Stories": compact header, stories row, filter chips and an edge-to-edge 3-column grid. */
export function MediaStories({
  home,
  chapters,
  photos,
  filters,
  onFilters,
  hasMore,
  loadingMore,
  onLoadMore,
  onOpenStory,
  onOpenGridPhoto,
  onSlideshow,
  onAdd,
  onNewAlbum,
  highlights,
  onOpenHighlight,
  menuOpen,
  onMenuOpenChange,
  loading,
}: {
  home: MediaHome;
  chapters: MediaChapter[];
  photos: MediaPhoto[];
  filters: MediaFilters;
  onFilters: (f: MediaFilters) => void;
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
  onOpenStory: (index: number) => void;
  onOpenGridPhoto: (index: number) => void;
  onSlideshow: () => void;
  onAdd: (() => void) | null;
  onNewAlbum: (() => void) | null;
  highlights: MediaHighlight[];
  onOpenHighlight: (index: number) => void;
  /** The ⋯ menu (controlled: the page keeps it in the URL, so Back closes it). */
  menuOpen: boolean;
  onMenuOpenChange: (open: boolean) => void;
  loading: boolean;
}) {
  const { t } = useTranslation();
  const [searching, setSearching] = useState(!!filters.search);
  const sentinel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = sentinel.current;
    if (!el || !hasMore) return;
    const io = new IntersectionObserver(
      (entries) => entries.some((e) => e.isIntersecting) && !loadingMore && onLoadMore(),
      { rootMargin: "400px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [hasMore, loadingMore, onLoadMore]);
  const years = mediaYears(home.years);
  const storyChapters = chapters.filter((c) => c.photo_count > 0);
  const highlightMeta = (p: MediaHighlight) =>
    [p.chapter_kind === "album" ? t("media.album") : p.chapter_venue, t("media.photoCount", { count: p.chapter_photo_count ?? 0 })]
      .filter(Boolean)
      .join(" · ");
  return (
    <div data-testid="media-mobile" className="min-w-0">
      <header className="flex items-center gap-2 pb-3">
        <h1 className="min-w-0 flex-1 truncate text-[1.75rem] font-bold leading-tight">
          {t("navigation.media")}
        </h1>
        <Button
          data-testid="media-slideshow"
          variant="outline"
          size="icon"
          className="size-11 rounded-full bg-card"
          aria-label={t("media.slideshow.open")}
          disabled={home.photo_count === 0}
          onClick={onSlideshow}
        >
          <Play className="size-5" aria-hidden />
        </Button>
        <DropdownMenu open={menuOpen} onOpenChange={onMenuOpenChange}>
          <DropdownMenuTrigger asChild>
            <Button
              data-testid="media-more"
              variant="outline"
              size="icon"
              className="size-11 rounded-full bg-card"
              aria-label={t("media.moreActions")}
            >
              <MoreHorizontal className="size-5" aria-hidden />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-52">
            <DropdownMenuItem
              data-testid="media-more-search"
              className="min-h-11"
              onSelect={() => setSearching(true)}
            >
              {t("media.search")}
            </DropdownMenuItem>
            {onAdd && (
              <DropdownMenuItem data-testid="media-more-add" className="min-h-11" onSelect={onAdd}>
                {home.can_manage ? t("media.addPhotos") : t("media.requestUpload")}
              </DropdownMenuItem>
            )}
            {onNewAlbum && (
              <DropdownMenuItem
                data-testid="media-more-new-album"
                className="min-h-11"
                onSelect={onNewAlbum}
              >
                {t("media.newAlbum")}
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </header>

      {searching && (
        <label className="relative mb-3 block">
          <span className="sr-only">{t("media.search")}</span>
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            data-testid="media-search"
            type="search"
            autoFocus
            value={filters.search}
            placeholder={t("media.search")}
            onChange={(e) => onFilters({ ...filters, search: e.target.value.slice(0, 100) })}
            className="h-11 rounded-full bg-card pl-9"
          />
        </label>
      )}

      {/* Stories: newest first; amber ring = photos the member has not viewed yet. */}
      <ul
        data-testid="media-stories"
        aria-label={t("media.stories")}
        className="-mx-4 flex gap-3.5 overflow-x-auto px-4 pb-3 [scrollbar-width:none]"
      >
        {storyChapters.map((c, i) => {
          const cover = c.photos[0];
          return (
            <li key={`${c.kind}-${c.id}`} className="w-[72px] shrink-0">
              <button
                type="button"
                data-testid="media-story"
                data-chapter-id={c.id}
                data-unseen={c.unseen}
                onClick={() => onOpenStory(i)}
                aria-label={t(c.unseen ? "media.storyUnseen" : "media.story", { title: c.title })}
                className="flex w-full flex-col items-center gap-1.5 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span
                  className={cn(
                    "flex size-[72px] items-center justify-center rounded-full border-[3px] bg-background p-[3px]",
                    c.unseen ? "border-media-amber" : "border-border",
                  )}
                >
                  <span className="block size-16 overflow-hidden rounded-full bg-muted">
                    {cover && <MediaThumb photo={cover} alt="" />}
                  </span>
                </span>
                <span className="w-full truncate text-center text-[11px] leading-tight">
                  {c.title}
                </span>
              </button>
            </li>
          );
        })}
        {onAdd && (
          <li className="w-[72px] shrink-0">
            <button
              type="button"
              data-testid="media-story-add"
              onClick={onAdd}
              className="flex w-full flex-col items-center gap-1.5 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span className="flex size-[72px] items-center justify-center rounded-full border-2 border-dashed border-muted-foreground/50 text-primary">
                <Plus className="size-6" aria-hidden />
              </span>
              <span className="w-full truncate text-center text-[11px] leading-tight">
                {home.can_manage ? t("media.add") : t("media.request")}
              </span>
            </button>
          </li>
        )}
      </ul>

      <HighlightCard photos={highlights} onOpen={onOpenHighlight} meta={highlightMeta} />

      <div
        role="group"
        aria-label={t("media.filters.label")}
        className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-3 [scrollbar-width:none]"
      >
        {(["all", "events", "albums"] as const).map((s) => (
          <FilterChip
            key={s}
            testId={`media-filter-${s}`}
            className="min-h-11 px-4"
            active={filters.source === s && filters.year === null}
            onClick={() => onFilters({ ...filters, source: s, year: null })}
          >
            {t(`media.filters.${s}`)}
          </FilterChip>
        ))}
        {years.map((y) => (
          <FilterChip
            key={y}
            testId={`media-filter-year-${y}`}
            className="min-h-11 px-4"
            active={filters.year === y}
            onClick={() => onFilters({ ...filters, year: filters.year === y ? null : y })}
          >
            {y}
          </FilterChip>
        ))}
      </div>

      {loading ? (
        <p className="py-6 text-muted-foreground">{t("common.loading")}</p>
      ) : photos.length === 0 ? (
        <p data-testid="media-empty" className="py-10 text-center text-muted-foreground">
          {t(filters.source !== "all" || filters.year ? "media.emptyFiltered" : "media.empty")}
        </p>
      ) : (
        <ul
          data-testid="media-grid"
          aria-label={t("media.allPhotos")}
          className="-mx-4 grid grid-cols-3 gap-0.5"
        >
          {photos.map((p, i) => (
            <li key={p.id} className="aspect-square">
              <button
                type="button"
                data-testid="media-grid-photo"
                data-photo-id={p.id}
                onClick={() => onOpenGridPhoto(i)}
                aria-label={photoAlt(t, p.chapter_title ?? "", i, photos.length)}
                className="block size-full overflow-hidden bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
              >
                <MediaThumb photo={p} alt="" eager={i < 9} />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div ref={sentinel} aria-hidden className="h-px" />
    </div>
  );
}

import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  chapterAccent,
  collageLargeSide,
  collageTiles,
  mediaYears,
  MEDIA_SOURCES,
  type MediaChapter,
  type MediaHome,
  type MediaPhoto,
} from "@/lib/media";
import { cn } from "@/lib/utils";
import { chapterDate, MediaThumb, photoAlt, useChapterMeta } from "./MediaParts";
import type { MediaFilters } from "./use-media";

export type OpenPhoto = (chapter: Pick<MediaChapter, "kind" | "id">, photoId: string) => void;
export type OpenChapter = (chapter: Pick<MediaChapter, "kind" | "id">) => void;

/** Desktop (>= 1024 px) "Story chapters": header, a vertical timeline of chapters and the sticky right rail. */
export function MediaTimeline({
  home,
  chapters,
  filters,
  onFilters,
  hasMore,
  loadingMore,
  onLoadMore,
  onOpenPhoto,
  onOpenChapter,
  onSlideshow,
  onAdd,
  loading,
}: {
  home: MediaHome;
  chapters: MediaChapter[];
  filters: MediaFilters;
  onFilters: (f: MediaFilters) => void;
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
  onOpenPhoto: OpenPhoto;
  onOpenChapter: OpenChapter;
  onSlideshow: () => void;
  onAdd: (() => void) | null;
  loading: boolean;
}) {
  const { t } = useTranslation();
  const sentinel = useRef<HTMLDivElement>(null);
  // Load the next chapters as the member scrolls near the end.
  useEffect(() => {
    const el = sentinel.current;
    if (!el || !hasMore) return;
    const io = new IntersectionObserver(
      (entries) => entries.some((e) => e.isIntersecting) && !loadingMore && onLoadMore(),
      { rootMargin: "600px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [hasMore, loadingMore, onLoadMore]);
  const newestId = chapters[0]?.id;
  return (
    <div data-testid="media-desktop" className="min-w-0 space-y-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <p
            data-testid="media-eyebrow"
            className="text-xs font-semibold uppercase tracking-[0.14em] text-primary"
          >
            {t("media.eyebrow", { branch: home.branch.name })}
          </p>
          <h1 className="mt-2 text-[2.625rem] font-semibold leading-tight tracking-tight">
            {t("media.title")}
          </h1>
        </div>
        <div className="flex flex-wrap gap-3">
          <Button
            data-testid="media-slideshow"
            variant="outline"
            className="h-11 rounded-full bg-card px-5"
            disabled={home.photo_count === 0}
            onClick={onSlideshow}
          >
            {t("media.slideshow.open")}
          </Button>
          {onAdd && (
            <Button data-testid="media-add" className="h-11 rounded-full px-5" onClick={onAdd}>
              {home.can_manage ? t("media.addPhotos") : t("media.requestUpload")}
            </Button>
          )}
        </div>
      </header>

      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_200px] gap-10">
        <main className="min-w-0">
          <MediaFilterBar home={home} filters={filters} onFilters={onFilters} />
          {loading ? (
            <p className="text-muted-foreground">{t("common.loading")}</p>
          ) : chapters.length === 0 ? (
            <EmptyGallery
              home={home}
              filtered={filters.source !== "all" || !!filters.year || !!filters.search}
            />
          ) : (
            <ol data-testid="media-timeline" className="relative space-y-12">
              {/* The 2 px line the chapter dots sit on. */}
              <span
                aria-hidden
                className="absolute bottom-0 left-[9px] top-3 w-0.5 rounded bg-border"
              />
              {chapters.map((c, i) => (
                <ChapterBlock
                  key={`${c.kind}-${c.id}`}
                  chapter={c}
                  index={i}
                  accent={chapterAccent(c, c.id === newestId)}
                  onOpenPhoto={onOpenPhoto}
                  onOpenChapter={onOpenChapter}
                />
              ))}
            </ol>
          )}
          <div ref={sentinel} aria-hidden className="h-px" />
          {hasMore && (
            <div className="mt-6 flex justify-center">
              <Button
                data-testid="media-load-more"
                variant="outline"
                className="h-11 rounded-full"
                disabled={loadingMore}
                onClick={onLoadMore}
              >
                {loadingMore ? t("common.loading") : t("media.loadMore")}
              </Button>
            </div>
          )}
        </main>
        <MediaRail home={home} onOpenChapter={onOpenChapter} />
      </div>
    </div>
  );
}

function EmptyGallery({ home, filtered }: { home: MediaHome; filtered: boolean }) {
  const { t } = useTranslation();
  return (
    <div
      data-testid="media-empty"
      className="rounded-2xl border border-dashed bg-card p-10 text-center"
    >
      <p className="text-lg font-semibold">{t(filtered ? "media.emptyFiltered" : "media.empty")}</p>
      {!filtered && (
        <p className="mt-2 text-muted-foreground">
          {t(
            home.can_manage
              ? "media.emptyManager"
              : home.can_request
                ? "media.emptyVolunteer"
                : "media.emptyTrustee",
          )}
        </p>
      )}
    </div>
  );
}

function ChapterBlock({
  chapter,
  index,
  accent,
  onOpenPhoto,
  onOpenChapter,
}: {
  chapter: MediaChapter;
  index: number;
  accent: "amber" | "primary";
  onOpenPhoto: OpenPhoto;
  onOpenChapter: OpenChapter;
}) {
  const { t } = useTranslation();
  const meta = useChapterMeta();
  const headingId = `media-chapter-${chapter.id}-title`;
  return (
    <li
      id={`media-chapter-${chapter.id}`}
      data-testid="media-chapter"
      data-chapter-id={chapter.id}
      data-chapter-kind={chapter.kind}
      data-accent={accent}
      aria-labelledby={headingId}
      className="relative scroll-mt-24 pl-9"
    >
      <span
        aria-hidden
        className={cn(
          "absolute left-0 top-1.5 size-5 rounded-md ring-4 ring-background",
          accent === "amber" ? "bg-media-amber" : "bg-primary",
        )}
      />
      <h2 id={headingId} className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
        {chapter.date && (
          <span
            className={cn(
              "text-sm font-bold",
              accent === "amber" ? "text-media-amber-text" : "text-primary",
            )}
          >
            {chapterDate(chapter.date)}
          </span>
        )}
        <button
          type="button"
          data-testid="media-chapter-open"
          onClick={() => onOpenChapter(chapter)}
          className="min-w-0 rounded text-left text-[1.4375rem] font-semibold leading-snug hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {chapter.title}
        </button>
        <span className="text-sm text-muted-foreground">{meta(chapter)}</span>
        {accent === "amber" && chapter.is_new && (
          <span className="sr-only">{t("media.newPhotos")}</span>
        )}
      </h2>
      {chapter.photos.length > 0 ? (
        <Collage
          chapter={chapter}
          side={collageLargeSide(index)}
          onOpenPhoto={onOpenPhoto}
          onOpenChapter={onOpenChapter}
        />
      ) : (
        <p className="mt-4 rounded-xl border border-dashed bg-card p-6 text-sm text-muted-foreground">
          {t("media.emptyAlbum")}
        </p>
      )}
    </li>
  );
}

/**
 * Two rows of 150 px: one large photo over both rows (2fr) and three small ones beside it (1fr each, the third across
 * the lower row); the last tile carries "+N" when the chapter has more photos. The large photo alternates sides.
 */
function Collage({
  chapter,
  side,
  onOpenPhoto,
  onOpenChapter,
}: {
  chapter: MediaChapter;
  side: "left" | "right";
  onOpenPhoto: OpenPhoto;
  onOpenChapter: OpenChapter;
}) {
  const { t } = useTranslation();
  const { tiles, more } = collageTiles(chapter.photos, chapter.photo_count);
  const n = tiles.length;
  const cols =
    n === 1
      ? "grid-cols-1"
      : n === 2
        ? "grid-cols-[2fr_1fr]"
        : side === "left"
          ? "grid-cols-[2fr_1fr_1fr]"
          : "grid-cols-[1fr_1fr_2fr]";
  const largeCol = side === "left" || n <= 2 ? "col-start-1" : "col-start-3";
  const smallCols =
    side === "left" ? ["col-start-2", "col-start-3"] : ["col-start-1", "col-start-2"];
  const place = (i: number) => {
    if (i === 0) return cn("row-span-2 row-start-1", largeCol);
    if (n === 2) return "row-span-2 row-start-1 col-start-2";
    if (n === 3) return cn(i === 1 ? "row-start-1" : "row-start-2", "col-span-2", smallCols[0]);
    if (i === 3) return cn("row-start-2 col-span-2", smallCols[0]);
    return cn("row-start-1", smallCols[i - 1]);
  };
  return (
    <div className={cn("mt-4 grid grid-rows-[150px_150px] gap-2.5", cols)}>
      {tiles.map((p: MediaPhoto, i) => {
        const last = i === n - 1 && more > 0;
        const alt = photoAlt(t, chapter.title, i, chapter.photo_count);
        return (
          <button
            key={p.id}
            type="button"
            data-testid={last ? "media-collage-more" : "media-collage-tile"}
            data-photo-id={p.id}
            aria-label={last ? t("media.morePhotos", { count: more, title: chapter.title }) : alt}
            onClick={() => (last ? onOpenChapter(chapter) : onOpenPhoto(chapter, p.id))}
            className={cn(
              "group relative min-w-0 overflow-hidden rounded-xl bg-muted shadow-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
              place(i),
            )}
          >
            <MediaThumb
              photo={p}
              alt=""
              large={i === 0}
              eager={i === 0}
              className="transition-transform duration-300 group-hover:scale-[1.02]"
            />
            {last && (
              <span className="absolute inset-0 flex items-center justify-center bg-black/45 text-lg font-semibold text-white">
                +{more}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/**
 * The sticky right rail, as in the "Story chapters" mockup: "Jump to" with each year as a large heading (the current
 * year dark, past years muted) and the chapter titles of that year (grouped by the chapter's date) as links, a divider,
 * then the album titles.
 */
function MediaRail({ home, onOpenChapter }: { home: MediaHome; onOpenChapter: OpenChapter }) {
  const { t } = useTranslation();
  const currentYear = new Date().getFullYear();
  const jump = (c: { kind: "event" | "album"; id: string }) => {
    const el = document.getElementById(`media-chapter-${c.id}`);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
    else onOpenChapter(c);
  };
  return (
    <aside
      data-testid="media-rail"
      aria-label={t("media.rail")}
      className="sticky top-[calc(var(--app-header-h,0px)+1.5rem)] mt-[4.25rem] max-h-[calc(100dvh-var(--app-header-h,0px)-3rem)] space-y-6 self-start overflow-y-auto pb-6"
    >
      {home.years.length > 0 && (
        <nav aria-labelledby="media-jump-h">
          <p
            id="media-jump-h"
            className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground"
          >
            {t("media.jumpTo")}
          </p>
          <ul className="mt-3 space-y-5">
            {home.years.map((y) => (
              <li key={y.year}>
                <p
                  className={cn(
                    "text-[1.875rem] font-semibold leading-none tracking-tight",
                    y.year === currentYear ? "text-foreground" : "text-muted-foreground",
                  )}
                >
                  {y.year}
                </p>
                <ul className="mt-2.5 space-y-0.5">
                  {y.chapters.map((c) => (
                    <li key={`${c.kind}-${c.id}`}>
                      <button
                        type="button"
                        data-testid="media-jump-link"
                        onClick={() => jump(c)}
                        className="w-full rounded py-0.5 text-left text-sm leading-snug hover:text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        {c.title}
                      </button>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </nav>
      )}
      {home.albums.length > 0 && (
        <nav aria-labelledby="media-albums-h" className="border-t pt-5">
          <p
            id="media-albums-h"
            className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground"
          >
            {t("media.albums")}
          </p>
          <ul className="mt-3 space-y-0.5">
            {home.albums.map((a) => (
              <li key={a.id}>
                <button
                  type="button"
                  data-testid="media-album-link"
                  onClick={() => onOpenChapter({ kind: "album", id: a.id })}
                  className="w-full rounded py-0.5 text-left text-sm leading-snug hover:text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {a.title}
                </button>
              </li>
            ))}
          </ul>
        </nav>
      )}
    </aside>
  );
}

/**
 * One slim row under the page header, aligned with the timeline column: the title search, then the chips All /
 * Events / Albums and the years (a year narrows the source; "All" clears both).
 */
function MediaFilterBar({
  home,
  filters,
  onFilters,
}: {
  home: MediaHome;
  filters: MediaFilters;
  onFilters: (f: MediaFilters) => void;
}) {
  const { t } = useTranslation();
  const years = mediaYears(home.years);
  return (
    <div data-testid="media-filter-bar" className="mb-8 flex flex-wrap items-center gap-2">
      <label className="relative block w-56 shrink-0">
        <span className="sr-only">{t("media.search")}</span>
        <Search
          className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <Input
          data-testid="media-search"
          type="search"
          value={filters.search}
          placeholder={t("media.search")}
          onChange={(e) => onFilters({ ...filters, search: e.target.value.slice(0, 100) })}
          className="h-9 rounded-full bg-card pl-9"
        />
      </label>
      <div role="group" aria-label={t("media.filters.label")} className="flex flex-wrap gap-1.5">
        {MEDIA_SOURCES.map((s) => (
          <FilterChip
            key={s}
            testId={`media-filter-${s}`}
            active={filters.source === s && (s !== "all" || filters.year === null)}
            onClick={() =>
              onFilters({ ...filters, source: s, year: s === "all" ? null : filters.year })
            }
          >
            {t(`media.filters.${s}`)}
          </FilterChip>
        ))}
        {years.map((y) => (
          <FilterChip
            key={y}
            testId={`media-filter-year-${y}`}
            active={filters.year === y}
            onClick={() => onFilters({ ...filters, year: filters.year === y ? null : y })}
          >
            {y}
          </FilterChip>
        ))}
      </div>
    </div>
  );
}

export function FilterChip({
  active,
  onClick,
  children,
  testId,
  className,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  testId: string;
  className?: string;
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "inline-flex min-h-9 shrink-0 items-center rounded-full border px-3.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        active
          ? "border-foreground bg-foreground text-background"
          : "border-transparent bg-muted text-foreground hover:bg-accent",
        className,
      )}
    >
      {children}
    </button>
  );
}

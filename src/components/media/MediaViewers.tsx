import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { useTranslation } from "react-i18next";
import { ChevronLeft, ChevronRight, Pause, Play, Settings2, Shuffle, X } from "lucide-react";
import {
  nextSlide,
  shuffledOrder,
  SLIDESHOW_INTERVALS,
  type MediaPhoto,
  type SlideshowInterval,
} from "@/lib/media";
import { cn } from "@/lib/utils";
import { chapterDate, MediaFull } from "./MediaParts";
import { useMediaChapter } from "./use-media";
import type { MediaChapter } from "@/lib/media";

/** A photo with what its caption needs. */
export type ViewerPhoto = MediaPhoto & {
  caption: { title: string; date: string | null; venue?: string | null };
};

/** Swipe direction from a pointer gesture (at least 50 px, mostly horizontal or vertical). */
function useSwipe(on: (dir: "left" | "right" | "up" | "down") => void) {
  const start = useRef<{ x: number; y: number } | null>(null);
  return {
    onPointerDown: (e: React.PointerEvent) => {
      start.current = { x: e.clientX, y: e.clientY };
    },
    onPointerUp: (e: React.PointerEvent) => {
      const s = start.current;
      start.current = null;
      if (!s) return;
      const dx = e.clientX - s.x,
        dy = e.clientY - s.y;
      if (Math.max(Math.abs(dx), Math.abs(dy)) < 50) return;
      if (Math.abs(dx) > Math.abs(dy)) on(dx < 0 ? "left" : "right");
      else on(dy > 0 ? "down" : "up");
    },
  };
}

const ROUND =
  "inline-flex size-11 items-center justify-center rounded-full text-white transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white";

function Fullscreen({
  label,
  testId,
  onClose,
  children,
  onKeyDown,
}: {
  label: string;
  testId: string;
  onClose: () => void;
  children: ReactNode;
  onKeyDown?: (e: React.KeyboardEvent) => void;
}) {
  return (
    <Dialog.Root open onOpenChange={(v) => !v && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[60] bg-black/95" />
        <Dialog.Content
          data-testid={testId}
          aria-describedby={undefined}
          onKeyDown={onKeyDown}
          className="fixed inset-0 z-[60] flex flex-col bg-black text-white outline-none"
        >
          <Dialog.Title className="sr-only">{label}</Dialog.Title>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Lightbox

/** Dark overlay, photo contained, swipe and arrow keys, caption with chapter title and date; role-based actions. */
export function Lightbox({
  photos,
  index,
  onIndex,
  onClose,
  actions,
}: {
  photos: ViewerPhoto[];
  index: number;
  onIndex: (i: number) => void;
  onClose: () => void;
  actions?: ((photo: ViewerPhoto) => ReactNode) | undefined;
}) {
  const { t } = useTranslation();
  const photo = photos[index];
  const go = useCallback(
    (step: 1 | -1) => onIndex(nextSlide(index, photos.length, step)),
    [index, photos.length, onIndex],
  );
  const swipe = useSwipe((d) =>
    d === "left" ? go(1) : d === "right" ? go(-1) : d === "down" ? onClose() : undefined,
  );
  if (!photo) return null;
  return (
    <Fullscreen
      label={t("media.lightbox.label", { title: photo.caption.title })}
      testId="media-lightbox"
      onClose={onClose}
      onKeyDown={(e) => {
        if (e.key === "ArrowRight") go(1);
        else if (e.key === "ArrowLeft") go(-1);
      }}
    >
      <div className="flex items-center justify-between gap-3 p-3 sm:p-4">
        <p data-testid="media-lightbox-counter" className="text-sm text-white/80">
          {index + 1} / {photos.length}
        </p>
        <Dialog.Close asChild>
          <button
            type="button"
            data-testid="media-lightbox-close"
            aria-label={t("media.close")}
            className={cn(ROUND, "bg-white/10 hover:bg-white/20")}
          >
            <X className="size-5" aria-hidden />
          </button>
        </Dialog.Close>
      </div>
      <div
        className="relative flex min-h-0 flex-1 touch-none items-center justify-center px-2 sm:px-16"
        {...swipe}
      >
        <MediaFull
          key={photo.id}
          photo={photo}
          alt={t("media.photoAlt", {
            title: photo.caption.title,
            n: index + 1,
            count: photos.length,
          })}
        />
        {photos.length > 1 && (
          <>
            <button
              type="button"
              data-testid="media-lightbox-prev"
              aria-label={t("media.previous")}
              onClick={() => go(-1)}
              className={cn(
                ROUND,
                "absolute left-2 top-1/2 hidden -translate-y-1/2 bg-white/10 hover:bg-white/20 sm:inline-flex",
              )}
            >
              <ChevronLeft className="size-6" aria-hidden />
            </button>
            <button
              type="button"
              data-testid="media-lightbox-next"
              aria-label={t("media.next")}
              onClick={() => go(1)}
              className={cn(
                ROUND,
                "absolute right-2 top-1/2 hidden -translate-y-1/2 bg-white/10 hover:bg-white/20 sm:inline-flex",
              )}
            >
              <ChevronRight className="size-6" aria-hidden />
            </button>
          </>
        )}
      </div>
      <div className="flex flex-wrap items-end justify-between gap-3 p-4 sm:px-6">
        <div className="min-w-0">
          <p data-testid="media-lightbox-caption" className="truncate text-lg font-semibold">
            {photo.caption.title}
          </p>
          {photo.caption.date && (
            <p className="text-sm text-white/75">{chapterDate(photo.caption.date)}</p>
          )}
        </div>
        {actions && <div className="flex flex-wrap gap-2">{actions(photo)}</div>}
      </div>
    </Fullscreen>
  );
}

/** A lightbox action button (white outline pill on the dark overlay, 44 px). */
export function LightboxAction({
  onClick,
  children,
  testId,
  icon,
}: {
  onClick: () => void;
  children: ReactNode;
  testId: string;
  icon?: ReactNode;
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      onClick={onClick}
      className="inline-flex min-h-11 items-center gap-2 rounded-full border border-white/30 px-4 text-sm font-medium hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
    >
      {icon}
      {children}
    </button>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Story viewer (mobile)

const STORY_SECONDS = 5;

/**
 * Full-screen stories: one chapter at a time (all its photos), progress segments at the top, tap right/left for the
 * next/previous photo, swipe left for the next chapter, swipe down to close. Opening a chapter marks it viewed.
 */
export function StoryViewer({
  chapters,
  index: ci,
  onIndex,
  onClose,
  onViewed,
}: {
  chapters: MediaChapter[];
  /** The chapter shown (controlled: the page keeps it in the URL, so Back closes the viewer). */
  index: number;
  /** Another chapter (the page replaces the history entry: one Back always closes the viewer). */
  onIndex: (i: number) => void;
  onClose: () => void;
  onViewed: (c: MediaChapter) => void;
}) {
  const { t } = useTranslation();
  const [pi, setPi] = useState(0);
  const setCi = (i: number) => onIndex(i);
  // A new chapter starts at its first photo.
  useEffect(() => setPi(0), [ci]);
  const preview = chapters[ci];
  const full = useMediaChapter(preview?.kind ?? null, preview?.id ?? null);
  const photos = full.data?.photos ?? preview?.photos ?? [];
  const viewed = useRef(new Set<string>());
  useEffect(() => {
    if (preview && !viewed.current.has(preview.id)) {
      viewed.current.add(preview.id);
      onViewed(preview);
    }
  }, [preview, onViewed]);
  const nextChapter = useCallback(() => {
    if (ci + 1 >= chapters.length) onClose();
    else {
      setCi(ci + 1);
      setPi(0);
    }
  }, [ci, chapters.length, onClose]);
  const step = useCallback(
    (d: 1 | -1) => {
      if (d === 1) {
        if (pi + 1 < photos.length) setPi(pi + 1);
        else nextChapter();
      } else if (pi > 0) setPi(pi - 1);
      else if (ci > 0) {
        setCi(ci - 1);
        setPi(0);
      }
    },
    [pi, photos.length, nextChapter, ci],
  );
  useEffect(() => {
    const id = window.setTimeout(() => step(1), STORY_SECONDS * 1000);
    return () => window.clearTimeout(id);
  }, [step, ci, pi]);
  const swipe = useSwipe((d) =>
    d === "down" ? onClose() : d === "left" ? nextChapter() : undefined,
  );
  if (!preview) return null;
  const photo = photos[Math.min(pi, photos.length - 1)];
  return (
    <Fullscreen
      label={t("media.storyViewer", { title: preview.title })}
      testId="media-story-viewer"
      onClose={onClose}
      onKeyDown={(e) => {
        if (e.key === "ArrowRight") step(1);
        else if (e.key === "ArrowLeft") step(-1);
      }}
    >
      <div className="absolute inset-x-0 top-0 z-10 space-y-3 bg-gradient-to-b from-black/70 to-transparent p-3 pb-8">
        <div data-testid="media-story-progress" className="flex gap-1" aria-hidden>
          {photos.map((p, i) => (
            <span key={p.id} className="h-0.5 flex-1 overflow-hidden rounded bg-white/35">
              <span
                className={cn(
                  "block h-full bg-white",
                  i < pi
                    ? "w-full"
                    : i > pi
                      ? "w-0"
                      : "w-0 animate-[media-story_5s_linear_forwards]",
                )}
              />
            </span>
          ))}
        </div>
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p data-testid="media-story-title" className="truncate font-semibold">
              {preview.title}
            </p>
            <p className="text-xs text-white/80">
              {[chapterDate(preview.date), t("media.photoOf", { n: pi + 1, count: photos.length })]
                .filter(Boolean)
                .join(" · ")}
            </p>
          </div>
          <Dialog.Close asChild>
            <button
              type="button"
              data-testid="media-story-close"
              aria-label={t("media.close")}
              className={cn(ROUND, "bg-white/15")}
            >
              <X className="size-5" aria-hidden />
            </button>
          </Dialog.Close>
        </div>
      </div>
      <div
        className="relative flex min-h-0 flex-1 touch-none items-center justify-center"
        {...swipe}
      >
        {photo && (
          <MediaFull
            key={photo.id}
            photo={photo}
            alt={t("media.photoAlt", { title: preview.title, n: pi + 1, count: photos.length })}
          />
        )}
        {/* Tap zones: left third = previous, the rest = next. */}
        <button
          type="button"
          data-testid="media-story-prev"
          aria-label={t("media.previous")}
          onClick={() => step(-1)}
          className="absolute inset-y-0 left-0 w-1/3 focus-visible:outline-none"
        />
        <button
          type="button"
          data-testid="media-story-next"
          aria-label={t("media.next")}
          onClick={() => step(1)}
          className="absolute inset-y-0 right-0 w-2/3 focus-visible:outline-none"
        />
      </div>
    </Fullscreen>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Slideshow

/** Keeps the screen awake while mounted (Wake Lock API where supported; re-acquired when the tab is visible again). */
function useWakeLock(active: boolean) {
  useEffect(() => {
    if (!active || !("wakeLock" in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    let stopped = false;
    const acquire = async () => {
      try {
        lock = await navigator.wakeLock.request("screen");
        if (stopped) void lock.release();
      } catch {
        // Not allowed (battery saver, background tab): the slideshow still runs.
      }
    };
    const onVisible = () => document.visibilityState === "visible" && void acquire();
    void acquire();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stopped = true;
      document.removeEventListener("visibilitychange", onVisible);
      void lock?.release().catch(() => undefined);
    };
  }, [active]);
}

/**
 * Full-screen slideshow for showing on a screen at events: black background, photo centred and contained, crossfade,
 * interval 5/10/20 s, shuffle, keyboard (Space, arrows, Esc) and tap controls; controls fade after 3 s without input.
 */
export function Slideshow({
  photos,
  branchName,
  onClose,
  start = 0,
}: {
  photos: ViewerPhoto[];
  branchName: string;
  onClose: () => void;
  start?: number;
}) {
  const { t } = useTranslation();
  const [playing, setPlaying] = useState(true);
  const [interval, setIntervalSeconds] = useState<SlideshowInterval>(10);
  const [shuffle, setShuffle] = useState(false);
  const [settings, setSettings] = useState(false);
  const [order, setOrder] = useState(() => photos.map((_, i) => i));
  const [pos, setPos] = useState(Math.min(start, Math.max(0, photos.length - 1)));
  const [controls, setControls] = useState(true);
  const [tick, setTick] = useState(0);
  const idle = useRef<number | null>(null);
  useWakeLock(true);

  const wake = useCallback(() => {
    setControls(true);
    if (idle.current) window.clearTimeout(idle.current);
    idle.current = window.setTimeout(() => setControls(false), 3000);
  }, []);
  useEffect(() => {
    wake();
    return () => {
      if (idle.current) window.clearTimeout(idle.current);
    };
  }, [wake]);

  const go = useCallback(
    (step: 1 | -1) => {
      setPos((p) => nextSlide(p, photos.length, step));
      setTick((n) => n + 1);
    },
    [photos.length],
  );
  useEffect(() => {
    if (!playing || photos.length < 2) return;
    const id = window.setTimeout(() => go(1), interval * 1000);
    return () => window.clearTimeout(id);
  }, [playing, interval, pos, tick, go, photos.length]);

  const toggleShuffle = () => {
    const current = order[pos] ?? 0;
    const next = !shuffle;
    setShuffle(next);
    const o = next ? shuffledOrder(photos.length, current) : photos.map((_, i) => i);
    setOrder(o);
    setPos(o.indexOf(current));
  };

  const index = order[pos] ?? 0;
  const photo = photos[index];
  // Crossfade: the previous photo stays underneath while the new one fades in.
  const [layers, setLayers] = useState<{ a: number; b: number | null }>({ a: index, b: null });
  useEffect(() => {
    setLayers((l) => (l.a === index ? l : { a: index, b: l.a }));
    const id = window.setTimeout(() => setLayers((l) => ({ ...l, b: null })), 900);
    return () => window.clearTimeout(id);
  }, [index]);

  const eyebrow = useMemo(
    () =>
      photo
        ? [chapterDate(photo.caption.date), photo.caption.venue].filter(Boolean).join(" · ")
        : "",
    [photo],
  );
  if (!photo) return null;
  const fade = cn(
    "transition-opacity duration-500",
    controls ? "opacity-100" : "pointer-events-none opacity-0",
  );
  return (
    <Fullscreen
      label={t("media.slideshow.label")}
      testId="media-slideshow-view"
      onClose={onClose}
      onKeyDown={(e) => {
        wake();
        if (e.key === " " || e.key === "k") {
          e.preventDefault();
          setPlaying((p) => !p);
        } else if (e.key === "ArrowRight") go(1);
        else if (e.key === "ArrowLeft") go(-1);
      }}
    >
      <div
        className={cn("relative flex-1 overflow-hidden bg-black", !controls && "cursor-none")}
        onPointerMove={wake}
        onClick={wake}
      >
        {[layers.b, layers.a].map((i, layer) =>
          i === null || !photos[i] ? null : (
            <div
              key={`${photos[i]!.id}-${layer}`}
              className={cn(
                "absolute inset-0 flex items-center justify-center p-0 sm:p-6",
                layer === 1 && layers.b !== null && "animate-[media-fade_0.9s_ease-out]",
              )}
            >
              <MediaFull
                photo={photos[i]!}
                alt={
                  layer === 1
                    ? t("media.photoAlt", {
                        title: photos[i]!.caption.title,
                        n: pos + 1,
                        count: photos.length,
                      })
                    : ""
                }
              />
            </div>
          ),
        )}

        <div
          className={cn(
            "absolute inset-x-0 top-0 flex items-start justify-between p-4 sm:p-6",
            fade,
          )}
        >
          <p
            data-testid="media-slideshow-mark"
            className="rounded-full bg-black/40 px-3 py-1.5 text-xs font-semibold tracking-wide"
          >
            {t("media.slideshow.mark", { branch: branchName })}
          </p>
          <Dialog.Close asChild>
            <button
              type="button"
              data-testid="media-slideshow-close"
              aria-label={t("media.slideshow.close")}
              className={cn(ROUND, "bg-white/15 hover:bg-white/25")}
            >
              <X className="size-5" aria-hidden />
            </button>
          </Dialog.Close>
        </div>

        <div
          className={cn(
            "absolute inset-x-0 bottom-0 flex flex-wrap items-end justify-between gap-4 bg-gradient-to-t from-black/80 via-black/40 to-transparent p-4 pb-6 sm:p-8 sm:pb-9",
            fade,
          )}
        >
          <div className="min-w-0 max-w-full sm:max-w-[60%]">
            {eyebrow && (
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-media-amber">
                {eyebrow}
              </p>
            )}
            <p
              data-testid="media-slideshow-title"
              className="mt-1.5 text-2xl font-semibold leading-tight sm:text-[2.5rem]"
            >
              {photo.caption.title}
            </p>
          </div>
          <div className="flex items-center gap-2 sm:gap-3">
            <span
              data-testid="media-slideshow-counter"
              className="min-w-14 text-sm tabular-nums text-white/85"
            >
              {pos + 1} / {photos.length}
            </span>
            <button
              type="button"
              data-testid="media-slideshow-prev"
              aria-label={t("media.previous")}
              onClick={() => {
                wake();
                go(-1);
              }}
              className={cn(ROUND, "bg-white/10 hover:bg-white/20")}
            >
              <ChevronLeft className="size-5" aria-hidden />
            </button>
            <button
              type="button"
              data-testid="media-slideshow-play"
              aria-label={t(playing ? "media.slideshow.pause" : "media.slideshow.play")}
              aria-pressed={!playing}
              onClick={() => {
                wake();
                setPlaying((p) => !p);
              }}
              className="inline-flex size-14 items-center justify-center rounded-full bg-white text-black transition-transform hover:scale-105 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-media-amber"
            >
              {playing ? (
                <Pause className="size-6" aria-hidden />
              ) : (
                <Play className="size-6 translate-x-px" aria-hidden />
              )}
            </button>
            <button
              type="button"
              data-testid="media-slideshow-next"
              aria-label={t("media.next")}
              onClick={() => {
                wake();
                go(1);
              }}
              className={cn(ROUND, "bg-white/10 hover:bg-white/20")}
            >
              <ChevronRight className="size-5" aria-hidden />
            </button>
            <div className="relative">
              <button
                type="button"
                data-testid="media-slideshow-settings"
                aria-expanded={settings}
                onClick={() => {
                  wake();
                  setSettings((s) => !s);
                }}
                className="inline-flex min-h-11 items-center gap-2 rounded-full bg-white/10 px-4 text-sm font-medium hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
              >
                <Settings2 className="size-4" aria-hidden />
                {/* Both settings at a glance: "10 s · Shuffle" / "10 s · In order". */}
                <span data-testid="media-slideshow-settings-label" aria-hidden>
                  {t(shuffle ? "media.slideshow.pillShuffle" : "media.slideshow.pillInOrder", {
                    count: interval,
                  })}
                </span>
                <span className="sr-only">
                  {t(
                    shuffle ? "media.slideshow.settingsShuffle" : "media.slideshow.settingsInOrder",
                    {
                      count: interval,
                    },
                  )}
                </span>
              </button>
              {settings && (
                <div
                  data-testid="media-slideshow-menu"
                  className="absolute bottom-full right-0 mb-2 w-56 space-y-3 rounded-2xl bg-neutral-900/95 p-3 shadow-xl"
                >
                  <div
                    role="radiogroup"
                    aria-label={t("media.slideshow.interval")}
                    className="flex gap-1.5"
                  >
                    {SLIDESHOW_INTERVALS.map((s) => (
                      <button
                        key={s}
                        type="button"
                        role="radio"
                        aria-checked={interval === s}
                        data-testid={`media-slideshow-interval-${s}`}
                        onClick={() => {
                          wake();
                          setIntervalSeconds(s);
                        }}
                        className={cn(
                          "min-h-11 flex-1 rounded-full text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white",
                          interval === s ? "bg-white text-black" : "bg-white/10 hover:bg-white/20",
                        )}
                      >
                        {t("media.slideshow.secondsShort", { count: s })}
                      </button>
                    ))}
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={shuffle}
                    data-testid="media-slideshow-shuffle"
                    onClick={() => {
                      wake();
                      toggleShuffle();
                    }}
                    className="flex min-h-11 w-full items-center justify-between rounded-full bg-white/10 px-4 text-sm font-medium hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
                  >
                    <span className="flex items-center gap-2">
                      <Shuffle className="size-4" aria-hidden />
                      {t("media.slideshow.shuffle")}
                    </span>
                    <span>{t(shuffle ? "media.slideshow.on" : "media.slideshow.off")}</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* A thin amber bar along the bottom edge for the current photo. */}
        <div className="absolute inset-x-0 bottom-0 h-1 bg-white/10" aria-hidden>
          <div
            key={`${pos}-${tick}-${interval}-${playing}`}
            data-testid="media-slideshow-progress"
            className={cn(
              "h-full bg-media-amber",
              playing && photos.length > 1 ? "animate-[media-progress_linear_forwards]" : "w-0",
            )}
            style={playing ? { animationDuration: `${interval}s` } : undefined}
          />
        </div>
      </div>
    </Fullscreen>
  );
}

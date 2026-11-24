import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { ResponsiveImage } from "@/components/public/ResponsiveImage";
import type { LandingGalleryGroup, LandingPhoto } from "@/lib/landing.server";
import { isoOf, longDate } from "./format";
import { Reveal } from "./Reveal";

const GROUPS = 4;

type Flat = LandingPhoto & { alt: string; title: string };

/** Every photo in display order, with alt text from its event title and position. */
function useFlat(groups: LandingGalleryGroup[]) {
  const { t } = useTranslation();
  return useMemo(
    () =>
      groups.flatMap((g) =>
        g.photos.map((p, i): Flat => ({
          ...p,
          title: g.title,
          alt: t("landing.gallery.photoAlt", { title: g.title, n: i + 1, total: g.photos.length }),
        })),
      ),
    [groups, t],
  );
}

function Lightbox({
  photos,
  openId,
  onChange,
}: {
  photos: Flat[];
  openId: string | null;
  onChange: (id: string | null) => void;
}) {
  const { t } = useTranslation();
  const index = photos.findIndex((p) => p.id === openId);
  const photo = index >= 0 ? photos[index] : undefined;
  const start = useRef<{ x: number; y: number } | null>(null);
  const lastShown = useRef<string | null>(null);
  if (photo) lastShown.current = photo.id;
  const go = (delta: number) => {
    if (index < 0 || !photos.length) return;
    onChange(photos[(index + delta + photos.length) % photos.length]!.id);
  };
  return (
    <DialogPrimitive.Root open={!!photo} onOpenChange={(open) => !open && onChange(null)}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/90" />
        <DialogPrimitive.Content
          data-testid="landing-lightbox"
          data-photo-id={photo?.id}
          onKeyDown={(e) => {
            if (e.key === "ArrowRight") {
              e.preventDefault();
              go(1);
            } else if (e.key === "ArrowLeft") {
              e.preventDefault();
              go(-1);
            }
          }}
          onCloseAutoFocus={(e) => {
            // Back to the photo last shown (the dialog was opened from state, not a Trigger).
            e.preventDefault();
            const last = lastShown.current;
            if (last)
              document
                .querySelector<HTMLElement>(
                  `[data-testid="landing-gallery-photo"][data-photo-id="${last}"]`,
                )
                ?.focus();
          }}
          className="fixed inset-0 z-50 flex flex-col text-white outline-none"
        >
          <div className="flex items-center justify-between gap-3 px-4 py-3">
            <div className="min-w-0">
              <DialogPrimitive.Title className="truncate text-base font-semibold">
                {photo?.title}
              </DialogPrimitive.Title>
              <DialogPrimitive.Description className="text-sm text-white/80">
                {t("landing.gallery.counter", { n: index + 1, total: photos.length })}
              </DialogPrimitive.Description>
            </div>
            <DialogPrimitive.Close
              data-testid="landing-lightbox-close"
              aria-label={t("landing.gallery.close")}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white/10 hover:bg-white/20"
            >
              <X aria-hidden className="h-6 w-6" />
            </DialogPrimitive.Close>
          </div>
          <div
            className="relative flex min-h-0 flex-1 touch-pan-y items-center justify-center px-2 pb-6 select-none"
            onPointerDown={(e) => {
              start.current = { x: e.clientX, y: e.clientY };
            }}
            onPointerUp={(e) => {
              const s = start.current;
              start.current = null;
              if (!s) return;
              const dx = e.clientX - s.x,
                dy = e.clientY - s.y;
              if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) go(dx < 0 ? 1 : -1);
            }}
            onPointerCancel={() => {
              start.current = null;
            }}
          >
            {photo && (
              <ResponsiveImage
                key={photo.id}
                image={photo}
                sizes="100vw"
                alt={photo.alt}
                draggable={false}
                className="max-h-full max-w-full object-contain"
              />
            )}
            {photos.length > 1 && (
              <>
                <button
                  type="button"
                  data-testid="landing-lightbox-prev"
                  aria-label={t("landing.gallery.prev")}
                  onClick={() => go(-1)}
                  className="absolute left-2 top-1/2 flex h-12 w-12 -translate-y-1/2 items-center justify-center rounded-full bg-black/50 hover:bg-black/70"
                >
                  <ChevronLeft aria-hidden className="h-7 w-7" />
                </button>
                <button
                  type="button"
                  data-testid="landing-lightbox-next"
                  aria-label={t("landing.gallery.next")}
                  onClick={() => go(1)}
                  className="absolute right-2 top-1/2 flex h-12 w-12 -translate-y-1/2 items-center justify-center rounded-full bg-black/50 hover:bg-black/70"
                >
                  <ChevronRight aria-hidden className="h-7 w-7" />
                </button>
              </>
            )}
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

/**
 * Photos marked "Show in public gallery", grouped by event in a CSS-columns masonry, with a lightbox (arrows,
 * Escape, swipe). `onStale` asks the page to re-sign the links when they may have expired.
 */
export function Gallery({
  groups,
  onStale,
}: {
  groups: LandingGalleryGroup[];
  onStale: () => void;
}) {
  const { t, i18n } = useTranslation();
  const [openId, setOpenId] = useState<string | null>(null);
  const [shownGroups, setShownGroups] = useState(GROUPS);
  const visible = useMemo(() => groups.slice(0, shownGroups), [groups, shownGroups]);
  const photos = useFlat(visible);
  // "/#gallery-<eventId>" (a past event's card on the map): show that group even when it is further down, then scroll.
  const [target, setTarget] = useState<string | null>(null);
  useEffect(() => {
    const read = () => {
      const m = /^#gallery-([0-9a-f-]{36})$/i.exec(window.location.hash);
      setTarget(m ? m[1]!.toLowerCase() : null);
    };
    read();
    window.addEventListener("hashchange", read);
    return () => window.removeEventListener("hashchange", read);
  }, []);
  useEffect(() => {
    if (!target) return;
    const index = groups.findIndex((g) => g.event_id === target);
    if (index < 0) return;
    if (index >= shownGroups) {
      setShownGroups(Math.ceil((index + 1) / GROUPS) * GROUPS);
      return;
    }
    document.getElementById(`gallery-${target}`)?.scrollIntoView({ block: "start" });
    setTarget(null);
  }, [target, groups, shownGroups]);
  if (!groups.length) return null;
  return (
    <Reveal
      data-testid="landing-gallery"
      aria-labelledby="landing-gallery-title"
      className="mx-auto max-w-6xl px-4 py-14 sm:px-6 sm:py-20"
    >
      <h2 id="landing-gallery-title" className="text-3xl font-bold sm:text-4xl">
        {t("landing.gallery.title")}
      </h2>
      <p className="mt-2 max-w-xl text-ds-muted">{t("landing.gallery.intro")}</p>
      <div className="mt-8 space-y-12">
        {visible.map((g) => (
          <article
            key={g.event_id}
            id={`gallery-${g.event_id}`}
            data-testid="landing-gallery-group"
            data-event-id={g.event_id}
            aria-labelledby={`gallery-${g.event_id}-title`}
            className="scroll-mt-20 space-y-4"
          >
            <header className="border-l-4 border-ds-blue pl-3">
              <h3 id={`gallery-${g.event_id}-title`} className="text-xl font-semibold break-words">
                {g.title}
              </h3>
              <p className="text-sm text-ds-muted">
                {g.date && <time dateTime={isoOf(g.date)}>{longDate(g.date, i18n.language)}</time>}
                {g.date && g.branch && <span aria-hidden> · </span>}
                {g.branch}
              </p>
            </header>
            <ul className="columns-2 gap-3 sm:columns-3 lg:columns-4">
              {g.photos.map((p) => {
                const flat = photos.find((f) => f.id === p.id)!;
                return (
                  <li key={p.id} className="mb-3 break-inside-avoid">
                    <button
                      type="button"
                      data-testid="landing-gallery-photo"
                      data-photo-id={p.id}
                      onClick={() => {
                        onStale();
                        setOpenId(p.id);
                      }}
                      className="block w-full overflow-hidden rounded-[5px] bg-ds-alt"
                    >
                      {/* Thumbnails use the 640 px copy (the original when there are no copies). */}
                      <img
                        src={p.small}
                        alt={flat.alt}
                        width={p.width ?? 800}
                        height={p.height ?? 600}
                        loading="lazy"
                        decoding="async"
                        onError={onStale}
                        className="h-auto w-full transition-transform duration-500 hover:scale-[1.03] motion-reduce:transition-none motion-reduce:hover:scale-100"
                      />
                    </button>
                  </li>
                );
              })}
            </ul>
          </article>
        ))}
      </div>
      {groups.length > shownGroups && (
        <button
          type="button"
          data-testid="landing-gallery-more"
          onClick={() => setShownGroups((n) => n + GROUPS)}
          className="mt-10 inline-flex min-h-11 items-center rounded-[3px] border-2 border-ds-slate px-5 font-semibold transition-colors hover:bg-ds-slate hover:text-ds-slate-fg"
        >
          {t("landing.gallery.more")}
        </button>
      )}
      <Lightbox photos={photos} openId={openId} onChange={setOpenId} />
    </Reveal>
  );
}

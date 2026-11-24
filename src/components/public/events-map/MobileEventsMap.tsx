// Phones (/events): a compact map strip (the static preview, no Leaflet) above the timeline and the list.
// Tapping the strip opens the full-screen interactive map with the timeline; marker cards open as a bottom sheet.
// Escape closes the card first, then the full-screen map (focus returns to the strip). A small modal of its own
// (focus kept inside, page scroll locked) rather than Radix Dialog, so this chunk shares no chunks with the landing page.
import { useCallback, useEffect, useRef, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { CloseIcon, ExpandIcon } from "./icons";
import { EventsMap } from "./EventsMap";
import { MapPreview } from "./MapPreview";
import { Legend } from "./parts";
import { Timeline } from "./Timeline";
import type { LabelledPlace } from "./types";
import type { EventsTimeline } from "./use-events-timeline";

const NONE: ReadonlySet<string> = new Set();
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])';

export function MobileEventsMap({
  timeline,
  places,
  selectedKey,
  onSelect,
  open,
  setOpen,
}: {
  timeline: EventsTimeline;
  places: LabelledPlace[];
  selectedKey: string | null;
  onSelect: (key: string | null) => void;
  /** The full-screen map (the page hides its own timeline meanwhile). */
  open: boolean;
  setOpen: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const count = places.reduce((n, p) => n + p.events.length, 0);
  const strip = useRef<HTMLButtonElement>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);

  const close = useCallback(() => {
    setOpen(false);
    onSelect(null);
    // Back to the strip once the dialog has gone.
    requestAnimationFrame(() => strip.current?.focus());
  }, [onSelect, setOpen]);
  const closeCard = useCallback(() => {
    const key = selectedKey;
    onSelect(null);
    if (key)
      dialog.current
        ?.querySelector<HTMLElement>(
          `[data-testid="events-map-marker"][data-place-key="${CSS.escape(key)}"]`,
        )
        ?.focus();
  }, [selectedKey, onSelect]);

  useEffect(() => {
    if (!open) return;
    closeButton.current?.focus();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = overflow;
    };
  }, [open]);

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === "Escape") {
      e.preventDefault();
      if (selectedKey) closeCard();
      else close();
      return;
    }
    if (e.key !== "Tab" || !dialog.current) return;
    // Focus stays inside the dialog.
    const nodes = [...dialog.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
      (n) => n.offsetParent !== null || n === document.activeElement,
    );
    const first = nodes[0],
      last = nodes[nodes.length - 1];
    if (!first || !last) return;
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  return (
    <>
      <button
        ref={strip}
        type="button"
        data-testid="events-map-strip"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
        className="relative block h-32 w-full overflow-hidden rounded-2xl border bg-[#dbe8f0] text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:bg-[#2b3340]"
      >
        <MapPreview places={places} />
        <span className="absolute bottom-2 right-2 inline-flex min-h-9 items-center gap-1.5 rounded-full bg-background/95 px-3 text-sm font-semibold text-foreground shadow">
          <ExpandIcon className="size-4" />
          {t("eventsMap.strip.open", { count })}
        </span>
      </button>
      {open &&
        createPortal(
          <div
            ref={dialog}
            role="dialog"
            aria-modal="true"
            aria-labelledby="events-map-fullscreen-title"
            aria-describedby="events-map-fullscreen-description"
            data-testid="events-map-fullscreen"
            onKeyDown={onKeyDown}
            className="fixed inset-0 z-50 flex flex-col bg-background outline-none"
          >
            <div className="flex items-center justify-between gap-2 border-b px-4 py-2">
              <h2 id="events-map-fullscreen-title" className="text-base font-semibold">
                {t("eventsMap.strip.title")}
              </h2>
              <p id="events-map-fullscreen-description" className="sr-only">
                {t("eventsMap.strip.description")}
              </p>
              <button
                ref={closeButton}
                type="button"
                data-testid="events-map-fullscreen-close"
                aria-label={t("eventsMap.strip.close")}
                onClick={close}
                className="flex size-11 items-center justify-center rounded-full hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <CloseIcon className="size-5" />
              </button>
            </div>
            <EventsMap
              places={places}
              hydrate="now"
              highlightIds={NONE}
              selectedKey={selectedKey}
              onSelect={onSelect}
              galleryIds={timeline.galleryIds}
              now={timeline.now}
              cardVariant="sheet"
              onSuspend={timeline.setSuspended}
              className="min-h-[50%] flex-1 rounded-none border-x-0"
            />
            <div className="max-h-[40%] shrink-0 space-y-2 overflow-y-auto p-3">
              <Legend withPast={timeline.withPast} />
              <Timeline timeline={timeline} idPrefix="events-fullscreen" />
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}

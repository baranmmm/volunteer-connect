// The map frame: the static preview at once, then the interactive Leaflet map (lazy chunk) once the page is idle
// ("idle"), once the frame is on screen and the page idle ("visible"), or straight away ("now"). The place card is
// drawn here, over the map; closing it returns focus to its marker.
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { MapPreview } from "./MapPreview";
import { PlaceCard } from "./PlaceCard";
import type { LabelledPlace } from "./types";
import { prefersReducedMotion } from "./use-events-timeline";

const EventsLeafletMap = lazy(() => import("./EventsLeafletMap"));

export type Hydrate = "idle" | "visible" | "now";

function whenIdle(run: () => void) {
  const w = window as Window & {
    requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number;
    cancelIdleCallback?: (id: number) => void;
  };
  if (w.requestIdleCallback) {
    const id = w.requestIdleCallback(run, { timeout: 4000 });
    return () => w.cancelIdleCallback?.(id);
  }
  const id = window.setTimeout(run, 1500);
  return () => window.clearTimeout(id);
}

/** True once the interactive map should load (see the header). */
function useHydrate(hydrate: Hydrate, frame: React.RefObject<HTMLElement | null>) {
  const [live, setLive] = useState(hydrate === "now");
  useEffect(() => {
    if (live) return;
    if (hydrate === "idle") return whenIdle(() => setLive(true));
    const node = frame.current;
    if (!node || typeof IntersectionObserver === "undefined") return whenIdle(() => setLive(true));
    let cancel: (() => void) | undefined;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        observer.disconnect();
        cancel = whenIdle(() => setLive(true));
      },
      { rootMargin: "200px 0px" },
    );
    observer.observe(node);
    return () => {
      observer.disconnect();
      cancel?.();
    };
  }, [hydrate, live, frame]);
  return live;
}

export function EventsMap({
  places,
  hydrate,
  highlightIds,
  selectedKey,
  onSelect,
  galleryIds,
  now,
  cardVariant = "overlay",
  onSuspend,
  className,
}: {
  places: LabelledPlace[];
  hydrate: Hydrate;
  highlightIds: ReadonlySet<string>;
  selectedKey: string | null;
  onSelect: (key: string | null) => void;
  galleryIds: ReadonlySet<string>;
  now: Date;
  cardVariant?: "overlay" | "sheet";
  /** Hover or focus inside the map pauses Play. */
  onSuspend?: (suspended: boolean) => void;
  className?: string;
}) {
  const { t } = useTranslation();
  const frame = useRef<HTMLDivElement>(null);
  const live = useHydrate(hydrate, frame);
  const [reducedMotion] = useState(prefersReducedMotion);
  const selected = places.find((p) => p.key === selectedKey) ?? null;
  // The selected place disappeared (another month): close its card.
  useEffect(() => {
    if (selectedKey && !selected) onSelect(null);
  }, [selectedKey, selected, onSelect]);
  const close = useCallback(() => {
    const key = selectedKey;
    onSelect(null);
    if (!key) return;
    const marker = frame.current?.querySelector<HTMLElement>(
      `[data-testid="events-map-marker"][data-place-key="${CSS.escape(key)}"]`,
    );
    marker?.focus();
  }, [selectedKey, onSelect]);
  return (
    <div
      ref={frame}
      data-testid="events-map"
      data-state={live ? "interactive" : "preview"}
      data-places={places.length}
      className={cn(
        "events-map-frame relative isolate overflow-hidden rounded-2xl border bg-[#dbe8f0] dark:bg-[#2b3340]",
        className,
      )}
      onPointerEnter={() => onSuspend?.(true)}
      onPointerLeave={() => onSuspend?.(false)}
      onFocus={() => onSuspend?.(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) onSuspend?.(false);
      }}
    >
      <MapPreview places={places} dots={!live} />
      {live && (
        <Suspense fallback={null}>
          <EventsLeafletMap
            places={places}
            highlightIds={highlightIds}
            selectedKey={selectedKey}
            onSelect={onSelect}
            reducedMotion={reducedMotion}
            label={t("eventsMap.label")}
          />
        </Suspense>
      )}
      {!live && <span className="sr-only">{t("eventsMap.loading")}</span>}
      {selected && (
        <PlaceCard
          place={selected}
          galleryIds={galleryIds}
          now={now}
          onClose={close}
          variant={cardVariant}
        />
      )}
    </div>
  );
}

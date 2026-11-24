// /events with the map always visible. Desktop: the list (or month) on the left, the map on the right (sticky) with
// its legend, timeline and the Online panel. Phones: a compact map strip and the timeline above the list (the strip
// opens the full-screen map). The list shows exactly the events of the map/timeline selection (its accessible
// alternative); hovering or focusing a list item highlights its marker, choosing a marker highlights the list item.
import { lazy, Suspense, useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { eventStartValue, isPastEvent, type MonthKey } from "@/lib/events-map";
import type { PublicEvent } from "@/lib/public-events";
import { useLabelledPlaces } from "./labels";
import { MapPreview } from "./MapPreview";
import { Legend, OnlinePanel } from "./parts";
import { Timeline } from "./Timeline";
import { useEventsTimeline, type EventsTimeline } from "./use-events-timeline";

const DESKTOP = "(min-width: 1024px)";
const MapPanels = lazy(() => import("./MapPanels"));

/** Desktop or phone, known only after mounting (null on the server and in the hydration render). */
function useDesktop() {
  const [desktop, setDesktop] = useState<boolean | null>(null);
  useEffect(() => {
    const mq = window.matchMedia?.(DESKTOP);
    if (!mq) return setDesktop(true);
    const on = () => setDesktop(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return desktop;
}

export type ListContext = {
  /** The events of the selection: coming ones first (soonest first), then past ones (latest first). */
  shown: PublicEvent[];
  /** Every loaded event (the Month view pages through months itself). */
  events: PublicEvent[];
  /** The event whose marker was chosen on the map. */
  highlightedId: string | null;
  /** Hover/focus on a list item (null when it leaves). */
  onHover: (id: string | null) => void;
  /** The timeline's (first) selected month, and moving it (Month view). */
  month: MonthKey;
  setMonthOffset: (delta: number) => void;
  timeline: EventsTimeline;
};

export function EventsMapLayout({
  upcoming,
  branch,
  region,
  children,
}: {
  upcoming: PublicEvent[];
  branch?: string | undefined;
  region?: string | undefined;
  children: (ctx: ListContext) => ReactNode;
}) {
  const { t } = useTranslation();
  const desktop = useDesktop();
  const keep = useCallback(
    (e: PublicEvent) => !region || e.scope === "national" || e.region_id === region,
    [region],
  );
  const timeline = useEventsTimeline(upcoming, { branch, keep });
  const places = useLabelledPlaces(timeline.shown, timeline.now);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  const highlightIds = useMemo(() => new Set(hoverId ? [hoverId] : []), [hoverId]);

  const onSelect = useCallback(
    (key: string | null) => {
      setSelectedKey(key);
      const place = key ? places.find((p) => p.key === key) : null;
      const first = place?.events[0];
      setHighlightedId(first?.id ?? null);
      // Desktop: bring the chosen event's list item into view (the map is sticky beside it).
      if (first && desktop) {
        const item = document.querySelector<HTMLElement>(
          `[data-testid="public-event-card"][data-event-id="${first.id}"]`,
        );
        item?.scrollIntoView({
          block: "nearest",
          behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
            ? "auto"
            : "smooth",
        });
      }
    },
    [places, desktop],
  );

  const ordered = useMemo(() => {
    const at = (e: PublicEvent) => Date.parse(eventStartValue(e) ?? "") || 0;
    const coming = timeline.shown.filter((e) => !isPastEvent(e, timeline.now));
    const past = timeline.shown.filter((e) => isPastEvent(e, timeline.now));
    return [...coming.sort((a, b) => at(a) - at(b)), ...past.sort((a, b) => at(b) - at(a))];
  }, [timeline.shown, timeline.now]);

  const { months, selection, setSelection } = timeline;
  const start = Math.min(selection.start, months.length - 1);
  const setMonthOffset = useCallback(
    (delta: number) =>
      setSelection({
        start: Math.min(Math.max(start + delta, 0), months.length - 1),
        span: 1,
      }),
    [setSelection, start, months.length],
  );
  const list = children({
    shown: ordered,
    events: timeline.events,
    highlightedId,
    onHover: setHoverId,
    month: months[start]!,
    setMonthOffset,
    timeline,
  });

  const [fullscreen, setFullscreen] = useState(false);
  // The static preview (server-rendered): the phone strip, or the map frame on desktop (same box as the live map).
  const shell = (
    <div
      aria-hidden
      data-testid="events-map-shell"
      className="relative h-32 overflow-hidden rounded-2xl border bg-[#dbe8f0] dark:bg-[#2b3340] lg:h-[min(440px,55vh)]"
    >
      <MapPreview places={places} />
    </div>
  );
  return (
    <div
      data-testid="events-map-layout"
      data-layout={desktop === null ? undefined : desktop ? "desktop" : "mobile"}
      className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:gap-6"
    >
      <div className="min-w-0 space-y-3 lg:sticky lg:top-4 lg:order-2 lg:max-h-[calc(100vh-2rem)] lg:overflow-y-auto lg:p-1">
        {desktop === null ? (
          shell
        ) : (
          <Suspense fallback={shell}>
            <MapPanels
              layout={desktop ? "desktop" : "mobile"}
              timeline={timeline}
              places={places}
              highlightIds={highlightIds}
              selectedKey={selectedKey}
              onSelect={onSelect}
              fullscreen={fullscreen}
              setFullscreen={setFullscreen}
            />
          </Suspense>
        )}
        <Legend withPast={timeline.withPast} className="hidden lg:flex" />
        {/* While the phone's full-screen map is open, its own timeline is the only one. */}
        {!fullscreen && <Timeline timeline={timeline} idPrefix="events" />}
        <OnlinePanel shown={timeline.shown} now={timeline.now} />
      </div>
      <section aria-label={t("eventsMap.listLabel")} className="min-w-0 lg:order-1">
        {list}
      </section>
    </div>
  );
}

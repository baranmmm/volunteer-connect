import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getPastPublicEvents } from "@/lib/events-map.functions";
import {
  currentMonthIndex,
  filterTimeline,
  monthCounts,
  playNext,
  playStart,
  timelineMonths,
  type TimelineSelection,
} from "@/lib/events-map";
import type { PublicEvent } from "@/lib/public-events";
import type { MapCardEvent } from "./types";

const STEP_MS = 1600;
const REDUCED_STEP_MS = 3200;

export function prefersReducedMotion() {
  return (
    typeof window !== "undefined" &&
    !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
  );
}

/**
 * The shared state of the map, its timeline, the Online panel and the list: the months, the selected month(s), the
 * "Past events" toggle (past events load only when it is turned on) and Play.
 */
export function useEventsTimeline<T extends MapCardEvent>(
  upcoming: T[],
  opts: { branch?: string | undefined; keep?: (e: T | PublicEvent) => boolean } = {},
) {
  const [now] = useState(() => new Date());
  const [withPast, setWithPast] = useState(false);
  const fetchPast = useServerFn(getPastPublicEvents);
  const past = useQuery({
    queryKey: ["public-past-events", opts.branch ?? ""],
    queryFn: () => fetchPast({ data: opts.branch ? { branch: opts.branch } : {} }),
    enabled: withPast,
    staleTime: 600_000,
  });
  const months = useMemo(() => timelineMonths(now, withPast), [now, withPast]);
  const [selection, setSelectionState] = useState<TimelineSelection>(() => ({
    start: currentMonthIndex(timelineMonths(now, false), now),
    span: "all",
  }));
  const [playing, setPlaying] = useState(false);
  const [suspended, setSuspended] = useState(false);

  const keep = opts.keep;
  const events = useMemo(() => {
    const all = new Map<string, T | PublicEvent>();
    if (withPast) for (const e of past.data?.events ?? []) all.set(e.id, e);
    for (const e of upcoming) all.set(e.id, e);
    const list = [...all.values()];
    return keep ? list.filter(keep) : list;
  }, [upcoming, past.data, withPast, keep]);

  const shown = useMemo(
    () => filterTimeline(events, { months, selection, withPast, now }),
    [events, months, selection, withPast, now],
  );
  const counts = useMemo(
    () => monthCounts(events, months, withPast, now),
    [events, months, withPast, now],
  );
  const galleryIds = useMemo(() => new Set(past.data?.galleryIds ?? []), [past.data]);

  /** A manual change stops Play. */
  const setSelection = useCallback((next: TimelineSelection) => {
    setPlaying(false);
    setSelectionState(next);
  }, []);

  const togglePast = useCallback((on: boolean) => {
    setPlaying(false);
    setWithPast(on);
    // The same month stays selected: the timeline gains (or loses) the 12 months before it.
    setSelectionState((s) => ({ ...s, start: Math.max(0, s.start + (on ? 12 : -12)) }));
  }, []);

  const togglePlay = useCallback(() => {
    if (playing) return setPlaying(false);
    setSelectionState((s) => playStart(s, months, now));
    setPlaying(true);
  }, [playing, months, now]);

  // Play: one month on every step (slower with reduced motion), paused while the map or timeline is hovered or
  // focused, and stopping at the last month.
  const latest = useRef({ months, selection });
  latest.current = { months, selection };
  useEffect(() => {
    if (!playing || suspended) return;
    const timer = window.setInterval(
      () => {
        const next = playNext(latest.current.selection, latest.current.months.length);
        if (!next) setPlaying(false);
        else setSelectionState(next);
      },
      prefersReducedMotion() ? REDUCED_STEP_MS : STEP_MS,
    );
    return () => window.clearInterval(timer);
  }, [playing, suspended]);

  return {
    now,
    months,
    selection,
    setSelection,
    withPast,
    togglePast,
    pastLoading: withPast && past.isLoading,
    pastError: withPast && past.isError,
    events,
    shown,
    counts,
    galleryIds,
    playing,
    togglePlay,
    setSuspended,
  };
}

export type EventsTimeline = ReturnType<typeof useEventsTimeline>;

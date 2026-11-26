// /events: the scroll-driven map story (past and coming events on the fixed map of England and Wales), then the Online
// panel and the list (or month) of the coming events. Everything here is server-rendered; no map library loads.
import { useCallback, useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  addMonths,
  eventStartValue,
  isPastEvent,
  londonDay,
  monthOf,
  type MonthKey,
} from "@/lib/events-map";
import type { BranchPoint } from "@/lib/events-story";
import type { PublicEvent } from "@/lib/public-events";
import { EventsStory } from "./EventsStory";
import { OnlinePanel } from "./parts";

export type ListContext = {
  /** The coming events, soonest first. */
  shown: PublicEvent[];
  /** The month the Month view shows, and moving it. */
  month: MonthKey;
  setMonthOffset: (delta: number) => void;
};

export function EventsMapLayout({
  upcoming,
  past,
  branches,
  children,
}: {
  upcoming: PublicEvent[];
  /** Past public events (the last 12 months, imported records included). */
  past: PublicEvent[];
  branches: BranchPoint[];
  children: (ctx: ListContext) => ReactNode;
}) {
  const { t } = useTranslation();
  const [now] = useState(() => new Date());
  const [month, setMonth] = useState<MonthKey>(() => monthOf(londonDay(now)));
  const setMonthOffset = useCallback((delta: number) => setMonth((m) => addMonths(m, delta)), []);
  const shown = useMemo(() => {
    const at = (e: PublicEvent) => Date.parse(eventStartValue(e) ?? "") || 0;
    return upcoming.filter((e) => !isPastEvent(e, now)).sort((a, b) => at(a) - at(b));
  }, [upcoming, now]);
  const story = useMemo(() => [...upcoming, ...past], [past, upcoming]);
  const online = shown.some((e) => e.is_online);
  return (
    <div data-testid="events-map-layout" className="space-y-6">
      <EventsStory events={story} branches={branches} />
      {online && <OnlinePanel shown={shown} now={now} />}
      <section
        id="events-list-start"
        aria-label={t("eventsStory.listLabel")}
        className="min-w-0 scroll-mt-4"
      >
        {children({ shown, month, setMonthOffset })}
      </section>
    </div>
  );
}

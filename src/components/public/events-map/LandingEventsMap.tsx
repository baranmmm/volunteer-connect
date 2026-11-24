// Landing page section "Our events across the UK": the map (static preview, interactive once the section is on screen),
// its legend and timeline, and the Online panel beside it (below it on phones). Its own list of the shown events is
// the accessible alternative to the map.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { isPastEvent, pastEventHref, mapWhen } from "@/lib/events-map";
import { EventsMap } from "./EventsMap";
import { Legend, OnlinePanel } from "./parts";
import { Timeline } from "./Timeline";
import { placeText, useLabelledPlaces } from "./labels";
import type { MapCardEvent } from "./types";
import { useEventsTimeline } from "./use-events-timeline";

const NONE: ReadonlySet<string> = new Set();

export default function LandingEventsMap({ upcoming }: { upcoming: MapCardEvent[] }) {
  const { t, i18n } = useTranslation();
  const timeline = useEventsTimeline(upcoming);
  const places = useLabelledPlaces(timeline.shown, timeline.now);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const inPerson = timeline.shown.filter((e) => !e.is_online);
  return (
    <section
      data-testid="landing-map"
      aria-labelledby="landing-map-title"
      className="mx-auto max-w-6xl px-4 py-14 sm:px-6 sm:py-20"
    >
      <h2 id="landing-map-title" className="text-3xl font-bold sm:text-4xl">
        {t("eventsMap.title")}
      </h2>
      <p className="mt-2 max-w-xl text-ds-muted">{t("eventsMap.intro")}</p>
      <div className="mt-8 grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="min-w-0 space-y-3">
          <EventsMap
            places={places}
            hydrate="visible"
            highlightIds={NONE}
            selectedKey={selectedKey}
            onSelect={setSelectedKey}
            galleryIds={timeline.galleryIds}
            now={timeline.now}
            onSuspend={timeline.setSuspended}
            className="h-[360px] sm:h-[440px]"
          />
          <Legend withPast={timeline.withPast} />
          <Timeline timeline={timeline} idPrefix="landing" />
        </div>
        <div className="min-w-0 space-y-3">
          <OnlinePanel shown={timeline.shown} now={timeline.now} headingLevel={3} />
          {/* The accessible alternative to the map: the same events as text links. */}
          <details
            data-testid="landing-map-list"
            className="rounded-2xl border bg-card p-3 text-card-foreground sm:p-4"
          >
            <summary className="min-h-9 cursor-pointer content-center text-sm font-semibold">
              {t("eventsMap.listToggle", { count: inPerson.length })}
            </summary>
            <ul className="mt-2 space-y-2">
              {inPerson.map((e) => (
                <li key={e.id} data-testid="landing-map-list-item" data-event-id={e.id}>
                  <a
                    href={
                      isPastEvent(e, timeline.now)
                        ? pastEventHref(e.id, timeline.galleryIds)
                        : `/events/${e.id}`
                    }
                    className="block rounded-lg px-1 py-1 hover:bg-muted"
                  >
                    <span className="block text-sm font-medium break-words">{e.title}</span>
                    <span className="block text-xs text-muted-foreground">
                      {[mapWhen(e, i18n.language), placeText(e, t)].filter(Boolean).join(" · ")}
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          </details>
        </div>
      </div>
    </section>
  );
}

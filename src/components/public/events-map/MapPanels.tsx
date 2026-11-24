// The map side of /events (a lazy chunk, so the list paints without it): the sticky desktop panel or the phone strip,
// with the legend, timeline and Online panel.
import { EventsMap } from "./EventsMap";
import { MobileEventsMap } from "./MobileEventsMap";
import { Legend, OnlinePanel } from "./parts";
import { Timeline } from "./Timeline";
import type { LabelledPlace } from "./types";
import type { EventsTimeline } from "./use-events-timeline";

export default function MapPanels({
  layout,
  timeline,
  places,
  highlightIds,
  selectedKey,
  onSelect,
}: {
  layout: "desktop" | "mobile";
  timeline: EventsTimeline;
  places: LabelledPlace[];
  highlightIds: ReadonlySet<string>;
  selectedKey: string | null;
  onSelect: (key: string | null) => void;
}) {
  if (layout === "mobile")
    return (
      <>
        <MobileEventsMap
          timeline={timeline}
          places={places}
          selectedKey={selectedKey}
          onSelect={onSelect}
        />
        <OnlinePanel shown={timeline.shown} now={timeline.now} />
      </>
    );
  return (
    <>
      <EventsMap
        places={places}
        hydrate="idle"
        highlightIds={highlightIds}
        selectedKey={selectedKey}
        onSelect={onSelect}
        galleryIds={timeline.galleryIds}
        now={timeline.now}
        onSuspend={timeline.setSuspended}
        className="h-[min(440px,55vh)]"
      />
      <Legend withPast={timeline.withPast} />
      <Timeline timeline={timeline} idPrefix="events" />
      <OnlinePanel shown={timeline.shown} now={timeline.now} />
    </>
  );
}

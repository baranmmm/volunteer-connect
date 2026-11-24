// The interactive part of the /events map (a lazy chunk, loaded after the page has mounted): the map frame on desktop
// (Leaflet once the page is idle), the strip with its full-screen map on phones. Legend, timeline and the Online panel
// are server-rendered by the layout.
import { EventsMap } from "./EventsMap";
import { MobileEventsMap } from "./MobileEventsMap";
import type { LabelledPlace } from "./types";
import type { EventsTimeline } from "./use-events-timeline";

export default function MapPanels({
  layout,
  timeline,
  places,
  highlightIds,
  selectedKey,
  onSelect,
  fullscreen,
  setFullscreen,
}: {
  layout: "desktop" | "mobile";
  timeline: EventsTimeline;
  places: LabelledPlace[];
  highlightIds: ReadonlySet<string>;
  selectedKey: string | null;
  onSelect: (key: string | null) => void;
  fullscreen: boolean;
  setFullscreen: (open: boolean) => void;
}) {
  if (layout === "mobile")
    return (
      <MobileEventsMap
        timeline={timeline}
        places={places}
        selectedKey={selectedKey}
        onSelect={onSelect}
        open={fullscreen}
        setOpen={setFullscreen}
      />
    );
  return (
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
  );
}

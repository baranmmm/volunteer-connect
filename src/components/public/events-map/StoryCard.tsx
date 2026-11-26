// The card of the active event: cover, title, date, branch or region and a Past / Upcoming label. The whole card is
// one link to the event page, so screen readers read its content as the link name. Covers are signed on demand (5-minute
// links) once the event has stayed active for a moment, so scrolling quickly past events loads nothing.
import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useTranslation } from "react-i18next";
import { getPublicEvent } from "@/lib/public-events.functions";
import { mapWhen } from "@/lib/events-map";
import type { StoryStep } from "@/lib/events-story";
import { ResponsiveImage } from "@/components/public/ResponsiveImage";
import { cn } from "@/lib/utils";
import type { MapCardEvent } from "./types";
import { storyPlace } from "./labels";

const SETTLE_MS = 300;

function Cover({ event, className }: { event: MapCardEvent; className?: string }) {
  const fetchEvent = useServerFn(getPublicEvent);
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    setSettled(false);
    const timer = window.setTimeout(() => setSettled(true), SETTLE_MS);
    return () => window.clearTimeout(timer);
  }, [event.id]);
  const lazy = useQuery({
    queryKey: ["public-event-cover", event.id],
    queryFn: async () => (await fetchEvent({ data: { id: event.id } }))?.image ?? null,
    enabled: settled && event.image === undefined && event.has_image,
    staleTime: 4 * 60_000,
  });
  const image = event.image ?? lazy.data ?? null;
  return (
    <div className={cn("overflow-hidden bg-muted", className)}>
      {image ? (
        <ResponsiveImage
          key={event.id}
          image={image}
          sizes="256px"
          width={640}
          height={360}
          decoding="async"
          data-testid="events-map-card-cover"
          className="h-full w-full object-cover"
        />
      ) : (
        <div aria-hidden className="h-full w-full bg-[linear-gradient(135deg,#008AC4,#28303D)]" />
      )}
    </div>
  );
}

export function StoryCard({
  step,
  variant,
  live,
  className,
  style,
}: {
  step: StoryStep<MapCardEvent>;
  /** "overlay": next to the dot on the map (desktop); "inline": below the map (phones). */
  variant: "overlay" | "inline";
  /** Announce changes to screen readers (off while playing). */
  live: boolean;
  className?: string;
  style?: React.CSSProperties | undefined;
}) {
  const { t, i18n } = useTranslation();
  const e = step.event;
  return (
    <div aria-live={live ? "polite" : "off"} className={className} style={style}>
      <Link
        to="/events/$id"
        params={{ id: e.id }}
        data-testid="events-map-card"
        data-variant={variant}
        data-event-id={e.id}
        data-past={step.past ? "true" : "false"}
        className={cn(
          "group flex overflow-hidden rounded-2xl border bg-popover text-popover-foreground shadow-lg outline-none transition-shadow hover:shadow-xl focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
          variant === "overlay" ? "w-64 flex-col" : "h-28 w-full flex-row",
        )}
      >
        <Cover
          event={e}
          className={variant === "overlay" ? "aspect-video w-full" : "h-full w-28 shrink-0"}
        />
        <div className="flex min-w-0 flex-1 flex-col gap-1 p-3">
          <span
            data-testid="events-map-card-label"
            className={cn(
              "self-start rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide",
              step.past ? "bg-[#28303D] text-white" : "bg-primary text-primary-foreground",
            )}
          >
            {step.past ? t("eventsStory.past") : t("eventsStory.upcoming")}
          </span>
          <span
            className={cn(
              "font-semibold break-words group-hover:underline",
              variant === "overlay" ? "text-base" : "line-clamp-2 text-sm",
            )}
          >
            {e.title}
          </span>
          <span className="truncate text-xs text-muted-foreground">
            {[mapWhen(e, i18n.language), storyPlace(e, t)].filter(Boolean).join(" · ")}
          </span>
        </div>
      </Link>
    </div>
  );
}

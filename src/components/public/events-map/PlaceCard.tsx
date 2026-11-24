// The card of a map place: every event at that point (cover, title, date, branch, place) with Register (coming
// events) or the photos / public page (past events). Focus moves into it when it opens; Escape or Close closes it and
// the parent returns focus to the marker.
import { useEffect, useRef, type KeyboardEvent } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useTranslation } from "react-i18next";
import { getPublicEvent } from "@/lib/public-events.functions";
import { isPastEvent, pastEventHref, mapWhen } from "@/lib/events-map";
import { ResponsiveImage } from "@/components/public/ResponsiveImage";
import { cn } from "@/lib/utils";
import { CloseIcon } from "./icons";
import type { LabelledPlace, MapCardEvent } from "./types";
import { placeText } from "./labels";

function Cover({ event, compact }: { event: MapCardEvent; compact: boolean }) {
  const fetchEvent = useServerFn(getPublicEvent);
  // Landing rows carry a signed cover; elsewhere it is signed when the card opens (5-minute links).
  const lazy = useQuery({
    queryKey: ["public-event-cover", event.id],
    queryFn: async () => (await fetchEvent({ data: { id: event.id } }))?.image ?? null,
    enabled: event.image === undefined && event.has_image,
    staleTime: 4 * 60_000,
  });
  const image = event.image ?? lazy.data ?? null;
  return (
    <div
      className={cn(
        "aspect-video overflow-hidden rounded-lg bg-muted",
        compact ? "w-28 shrink-0" : "w-full",
      )}
    >
      {image ? (
        <ResponsiveImage
          image={image}
          sizes="320px"
          width={640}
          height={360}
          decoding="async"
          className="h-full w-full object-cover"
        />
      ) : (
        <div aria-hidden className="h-full w-full bg-[linear-gradient(135deg,#008AC4,#28303D)]" />
      )}
    </div>
  );
}

export function PlaceCard({
  place,
  galleryIds,
  now,
  onClose,
  variant,
}: {
  place: LabelledPlace;
  galleryIds: ReadonlySet<string>;
  now: Date;
  onClose: () => void;
  /** "overlay": a panel over the map (desktop); "sheet": a bottom sheet (full-screen map on phones). */
  variant: "overlay" | "sheet";
}) {
  const { t, i18n } = useTranslation();
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    box.current?.focus({ preventScroll: true });
  }, [place.key]);
  const single = place.events.length === 1;
  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key !== "Escape") return;
    e.preventDefault();
    e.stopPropagation();
    onClose();
  }
  const titleId = `events-map-card-title-${place.key.replace(/[^0-9a-z]/gi, "")}`;
  return (
    <div
      ref={box}
      role="dialog"
      aria-modal="false"
      aria-labelledby={titleId}
      tabIndex={-1}
      data-testid="events-map-card"
      data-place-key={place.key}
      onKeyDown={onKeyDown}
      className={cn(
        "z-[1000] flex flex-col overflow-hidden border bg-popover text-popover-foreground shadow-xl outline-none focus-visible:ring-2 focus-visible:ring-ring",
        variant === "overlay"
          ? "absolute right-3 top-3 max-h-[calc(100%-1.5rem)] w-[min(20rem,calc(100%-1.5rem))] rounded-2xl"
          : "absolute inset-x-0 bottom-0 max-h-[60%] rounded-t-2xl",
      )}
    >
      <div className="flex items-start justify-between gap-2 border-b px-3 py-2">
        <h3 id={titleId} className="min-w-0 pt-1.5 text-sm font-semibold break-words">
          {single
            ? place.events[0]!.title
            : t("eventsMap.card.eventsHere", {
                count: place.events.length,
                place: placeText(place.events[0]!, t),
              })}
        </h3>
        <button
          type="button"
          data-testid="events-map-card-close"
          aria-label={t("eventsMap.card.close")}
          onClick={onClose}
          className="flex size-9 shrink-0 items-center justify-center rounded-full hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <CloseIcon className="size-4" />
        </button>
      </div>
      <ul className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
        {place.events.map((e) => {
          const past = isPastEvent(e, now);
          return (
            <li
              key={e.id}
              data-testid="events-map-card-item"
              data-event-id={e.id}
              data-past={past ? "true" : "false"}
              className={variant === "sheet" ? "flex gap-3" : "space-y-2"}
            >
              <Cover event={e} compact={variant === "sheet"} />
              <div className="min-w-0 space-y-1.5">
                {!single && <p className="text-sm font-semibold break-words">{e.title}</p>}
                <p className="text-sm">{mapWhen(e, i18n.language)}</p>
                <p className="text-xs text-muted-foreground break-words">
                  {[
                    e.branch ?? e.region,
                    e.location || e.location_tba || e.is_online ? placeText(e, t) : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
                {past ? (
                  <a
                    data-testid="events-map-card-past-link"
                    href={pastEventHref(e.id, galleryIds)}
                    className="inline-flex min-h-9 items-center rounded-lg border px-3 text-sm font-medium hover:bg-muted"
                  >
                    {galleryIds.has(e.id) ? t("eventsMap.card.photos") : t("eventsMap.card.view")}
                    <span className="sr-only">: {e.title}</span>
                  </a>
                ) : (
                  <Link
                    to="/events/$id"
                    params={{ id: e.id }}
                    data-testid="events-map-card-register"
                    className="inline-flex min-h-9 items-center rounded-lg bg-primary px-3 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
                  >
                    {t("eventsMap.card.register")}
                    <span className="sr-only">: {e.title}</span>
                  </Link>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

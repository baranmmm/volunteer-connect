// Small parts around the map: the legend and the Online panel.
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { VideoIcon } from "./icons";
import { isPastEvent, mapLocation, mapWhen } from "@/lib/events-map";
import { cn } from "@/lib/utils";
import type { MapCardEvent } from "./types";

function Swatch({ kind }: { kind: "event" | "tba" | "past" }) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-block shrink-0 rounded-full shadow-[0_0_0_1px_rgb(0_0_0/0.6)]",
        kind === "event" && "size-4 border-[3px] border-white bg-[#006d9c]",
        kind === "tba" && "size-4 border-[3px] border-dashed border-[#b45309] bg-white",
        kind === "past" && "size-3 border-2 border-white bg-[#6b7280]",
      )}
    />
  );
}

export function Legend({ withPast, className }: { withPast: boolean; className?: string }) {
  const { t } = useTranslation();
  return (
    <ul
      data-testid="events-map-legend"
      aria-label={t("eventsMap.legend.label")}
      className={cn("flex flex-wrap items-center gap-x-4 gap-y-1 text-xs", className)}
    >
      <li className="inline-flex items-center gap-1.5">
        <Swatch kind="event" />
        {t("eventsMap.legend.event")}
      </li>
      <li className="inline-flex items-center gap-1.5" data-testid="events-map-legend-tba">
        <Swatch kind="tba" />
        {t("eventsMap.legend.tba")}
      </li>
      {withPast && (
        <li className="inline-flex items-center gap-1.5" data-testid="events-map-legend-past">
          <Swatch kind="past" />
          {t("eventsMap.legend.past")}
        </li>
      )}
    </ul>
  );
}

/** Online events of the selection (they have no place on the map). */
export function OnlinePanel({
  shown,
  now,
  headingLevel = 2,
  className,
}: {
  shown: MapCardEvent[];
  now: Date;
  headingLevel?: 2 | 3;
  className?: string;
}) {
  const { t, i18n } = useTranslation();
  const Heading = headingLevel === 3 ? "h3" : "h2";
  const online = shown.filter((e) => e.is_online);
  // In-person events with no location at all (e.g. national ones without a branch) are in the list only.
  const elsewhere = shown.filter((e) => !e.is_online && !mapLocation(e)).length;
  return (
    <section
      data-testid="events-map-online"
      aria-labelledby="events-map-online-title"
      className={cn(
        "space-y-2 rounded-2xl border bg-card p-3 text-card-foreground sm:p-4",
        className,
      )}
    >
      <Heading
        id="events-map-online-title"
        className="flex items-center gap-2 text-base font-semibold"
      >
        <VideoIcon className="size-4" />
        {t("eventsMap.online.title")}
      </Heading>
      {online.length ? (
        <ul className="space-y-2">
          {online.map((e) => (
            <li key={e.id} data-testid="events-map-online-item" data-event-id={e.id}>
              <Link
                to="/events/$id"
                params={{ id: e.id }}
                className="block rounded-lg px-1 py-1 hover:bg-muted"
              >
                <span className="block text-sm font-medium break-words">{e.title}</span>
                <span className="block text-xs text-muted-foreground">
                  {mapWhen(e, i18n.language)}
                  {isPastEvent(e, now) && ` · ${t("eventsMap.card.past")}`}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">{t("eventsMap.online.empty")}</p>
      )}
      {elsewhere > 0 && (
        <p data-testid="events-map-unplaced" className="text-xs text-muted-foreground">
          {t("eventsMap.online.unplaced", { count: elsewhere })}
        </p>
      )}
    </section>
  );
}

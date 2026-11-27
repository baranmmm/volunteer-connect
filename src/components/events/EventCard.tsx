import { Link } from "@tanstack/react-router";
import {
  CalendarDays,
  MapPin,
  MessagesSquare,
  Utensils,
  HeartHandshake,
  Users,
  GraduationCap,
  Tag,
  Repeat,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { eventStart, isMeetingEvent } from "@/lib/event-rules";
import type { HubEvent } from "@/lib/event-rules";
import { eventDisplayStatus } from "@/lib/event-status";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { HappeningNowBadge } from "./HappeningNowBadge";
import { EventStatusBadge } from "./EventStatus";
import { ExternalBadge } from "./ExternalBadge";
import { PublicBadge } from "./PublicBadge";
import { STATUS_CARD, cancelledTitle } from "./event-status-styles";
import { eventDateText } from "./event-display";
import { RegistrationBadge } from "./RegistrationBadge";
import { MeetingBadge } from "./MeetingBadge";

export function CategoryIcon({ category, className }: { category: string; className?: string }) {
  const Icon =
    (
      {
        dialogue: MessagesSquare,
        dinner: Utensils,
        interfaith: HeartHandshake,
        community: Users,
        education: GraduationCap,
        meeting: Users,
      } as Record<string, typeof Tag>
    )[category] ?? Tag;
  return <Icon className={className} aria-hidden />;
}
export function EventCard({
  event,
  now = new Date(),
  coverUrl,
}: {
  event: HubEvent;
  now?: Date;
  /** The cover's signed link (useEventCovers); lists do not sign their media rows. */
  coverUrl?: string | null | undefined;
}) {
  const { t } = useTranslation();
  const cover = coverUrl ?? event.media.find((m) => m.kind === "image" && m.url)?.url ?? null;
  return (
    <Link
      to="/events/$id"
      params={{ id: event.id }}
      data-testid="event-card"
      data-event-id={event.id}
      data-start={eventStart(event)}
      data-status={event.status}
      data-category={event.category}
      className={cn(
        "group flex min-w-0 flex-col overflow-hidden rounded-lg border transition-colors hover:border-primary focus-visible:ring-2 focus-visible:ring-ring sm:flex-row",
        STATUS_CARD[eventDisplayStatus(event, now)],
      )}
    >
      <div
        data-testid="event-card-cover"
        className="flex aspect-[16/9] items-center justify-center overflow-hidden bg-secondary text-secondary-foreground sm:aspect-square sm:w-36 sm:shrink-0"
      >
        {cover ? (
          <img
            src={cover}
            alt={event.title}
            className="h-full w-full object-cover"
            loading="lazy"
          />
        ) : (
          <CategoryIcon category={event.category} className="size-12" />
        )}
      </div>
      <div className="min-w-0 flex-1 space-y-2 p-4">
        <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <CalendarDays className="size-4" />
          <span>{eventDateText(event, t)}</span>
          {event.series_id && (
            <span
              data-testid="event-recurring-icon"
              title={t("events.recurring.label")}
              className="inline-flex shrink-0 text-muted-foreground"
            >
              <Repeat className="size-4" aria-hidden />
              <span className="sr-only">{t("events.recurring.label")}</span>
            </span>
          )}
        </div>
        <h2
          className={cn(
            "break-words text-xl font-semibold group-hover:text-primary",
            cancelledTitle(event.status),
          )}
        >
          {event.title}
        </h2>
        <div className="flex flex-wrap items-center gap-2">
          {isMeetingEvent(event) && <MeetingBadge />}
          <EventStatusBadge status={event.status} />
          <HappeningNowBadge event={event} now={now} />
          <RegistrationBadge status={event.my_registration} />
          {event.audience === "public" && <PublicBadge />}
          {event.is_external && <ExternalBadge />}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="break-words text-sm">
            {event.is_external
              ? t("events.organisedBy", { organizer: event.organizer })
              : event.organizer}
          </span>
          <Badge variant="secondary">{t(`events.categories.${event.category}`)}</Badge>
        </div>
        {event.location_type === "online" ? (
          <p className="text-sm text-muted-foreground">{t("events.online")}</p>
        ) : (
          (event.location || event.location_tba) && (
            <p className="flex items-start gap-1 text-sm text-muted-foreground">
              <MapPin className="mt-0.5 size-4 shrink-0" />
              <span
                className="break-words"
                data-testid={event.location_tba ? "event-card-location-tba" : undefined}
              >
                {event.location_tba ? t("events.locationTba") : event.location}
              </span>
            </p>
          )
        )}
      </div>
    </Link>
  );
}

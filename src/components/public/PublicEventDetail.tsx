import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { getPublicEvent } from "@/lib/public-events.functions";
import { BranchName } from "@/components/app/BranchName";
import { useTranslation } from "react-i18next";
import { ArrowLeft, CalendarDays, MapPin, Video, Building2 } from "lucide-react";
import { eventWhen } from "@/lib/event-rules";
import { dateLocale } from "@/lib/i18n";
import type { PublicEvent } from "@/lib/public-events";
import type { SignedImage } from "@/lib/image-variants";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { GuestRegistrationForm } from "./GuestRegistrationForm";
import { ResponsiveImage } from "./ResponsiveImage";
import { PublicRegistrationState, publicWhere } from "./PublicEventBits";

type PublicEventData = { event: PublicEvent; image: SignedImage | null; signedAt: number } | null;

/** Signed image links last 5 minutes: the page data counts as fresh for 4 and is re-read before the links expire. */
const SIGNED_FRESH_MS = 4 * 60_000;

/**
 * The public page of a public event (signed out). Only the fields the get_public_event function returns. `initial`
 * comes from the route loader (server-rendered on the first visit); it is re-read once its signed links get old.
 */
export function PublicEventDetail({ id, initial }: { id: string; initial: PublicEventData }) {
  const { t, i18n } = useTranslation();
  const query = useQuery({
    queryKey: ["public-event", id],
    queryFn: (): Promise<PublicEventData> => getPublicEvent({ data: { id } }),
    initialData: initial,
    initialDataUpdatedAt: initial?.signedAt ?? 0,
    staleTime: SIGNED_FRESH_MS,
    refetchInterval: SIGNED_FRESH_MS,
    enabled: !!initial,
  });
  const data = query.data;
  if (!data) {
    return (
      <div data-testid="public-event-not-found" className="space-y-4">
        <p>{t("publicEvents.notFound")}</p>
        <Button asChild variant="outline">
          <Link to="/events">
            <ArrowLeft />
            {t("publicEvents.back")}
          </Link>
        </Button>
      </div>
    );
  }
  const { event, image } = data;
  const cancelled = event.status === "cancelled";
  const back = `/events/${id}`;
  return (
    <article
      data-testid="public-event-detail"
      data-event-id={event.id}
      data-status={event.status}
      className="space-y-6"
    >
      <Link
        to="/events"
        className="inline-flex min-h-11 items-center gap-2 text-sm text-muted-foreground hover:text-primary"
      >
        <ArrowLeft className="size-4" aria-hidden />
        {t("publicEvents.back")}
      </Link>
      <header className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary">{t(`events.categories.${event.category}`)}</Badge>
          {cancelled ? (
            <Badge data-testid="public-event-cancelled" variant="destructive">
              {t("events.cancelled")}
            </Badge>
          ) : (
            <PublicRegistrationState state={event.registration} />
          )}
        </div>
        <h1 className={`text-3xl font-bold ${cancelled ? "line-through decoration-2" : ""}`}>
          {event.title}
        </h1>
        {event.organizer && (
          <p data-testid="public-event-organizer" className="text-muted-foreground">
            {t("events.organisedBy", { name: event.organizer })}
          </p>
        )}
      </header>
      {image && (
        <ResponsiveImage
          data-testid="public-event-image"
          image={image}
          sizes="(min-width: 1024px) 944px, 100vw"
          className="h-auto max-h-96 w-full rounded-2xl object-cover"
        />
      )}
      <dl className="grid grid-cols-1 gap-3 rounded-2xl border bg-card p-5 text-sm sm:grid-cols-2">
        <div className="flex gap-2">
          <dt>
            <CalendarDays className="size-4 shrink-0" aria-hidden />
            <span className="sr-only">{t("publicEvents.when")}</span>
          </dt>
          <dd data-testid="public-event-when">
            {eventWhen(event, dateLocale(i18n.language))?.text}
          </dd>
        </div>
        {publicWhere(event) && (
          <div className="flex gap-2">
            <dt>
              <Building2 className="size-4 shrink-0" aria-hidden />
              <span className="sr-only">{t("publicEvents.branch")}</span>
            </dt>
            <dd data-testid="public-event-branch" className="min-w-0">
              <BranchName name={publicWhere(event)} />
            </dd>
          </div>
        )}
        {(event.location || event.location_tba) && (
          <div className="flex gap-2">
            <dt>
              <MapPin className="size-4 shrink-0" aria-hidden />
              <span className="sr-only">{t("publicEvents.location")}</span>
            </dt>
            <dd
              data-testid="public-event-location"
              data-tba={event.location_tba ? "true" : undefined}
            >
              {event.location_tba ? t("events.locationTba") : event.location}
            </dd>
          </div>
        )}
        {event.is_online && (
          <div className="flex gap-2">
            <dt>
              <Video className="size-4 shrink-0" aria-hidden />
              <span className="sr-only">{t("publicEvents.location")}</span>
            </dt>
            <dd data-testid="public-event-online">{t("publicEvents.online")}</dd>
          </div>
        )}
      </dl>
      {event.description && <p className="whitespace-pre-line">{event.description}</p>}
      {!cancelled && event.registration !== "closed" && <GuestRegistrationForm event={event} />}
      {!cancelled && event.registration !== "closed" && (
        <section className="space-y-3 rounded-2xl border bg-card p-5">
          <p className="text-sm text-muted-foreground">{t("guest.memberIntro")}</p>
          <div className="flex flex-wrap gap-2">
            <Button asChild className="h-11">
              <Link data-testid="public-event-register" to="/sign-in" search={{ redirect: back }}>
                {t("publicEvents.register")}
              </Link>
            </Button>
            <Button asChild variant="outline" className="h-11">
              <Link
                data-testid="public-event-create-account"
                to="/join"
                search={{ redirect: back }}
              >
                {t("publicEvents.createAccount")}
              </Link>
            </Button>
          </div>
        </section>
      )}
    </article>
  );
}

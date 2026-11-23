import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { ArrowLeft, CalendarDays, MapPin, Video, Building2 } from "lucide-react";
import { eventWhen } from "@/lib/event-rules";
import { dateLocale } from "@/lib/i18n";
import type { PublicEvent } from "@/lib/public-events";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

/** "Places available" / "Full" / "Registration closed" (never numbers). */
export function PublicRegistrationState({ state }: { state: PublicEvent["registration"] }) {
  const { t } = useTranslation();
  return (
    <Badge data-testid="public-event-registration" data-state={state} variant={state === "open" ? "secondary" : "outline"}>
      {t(`publicEvents.registration.${state}`)}
    </Badge>
  );
}

export function publicWhere(event: PublicEvent) {
  return [event.branch, event.region].filter(Boolean).join(", ");
}

/** The public page of a public event (signed out). Only the fields the get_public_event function returns. */
export function PublicEventDetail({ id, data }: { id: string; data: { event: PublicEvent; image: string | null } | null }) {
  const { t } = useTranslation();
  if (!data) {
    return (
      <div data-testid="public-event-not-found" className="space-y-4">
        <p>{t("publicEvents.notFound")}</p>
        <Button asChild variant="outline"><Link to="/events"><ArrowLeft />{t("publicEvents.back")}</Link></Button>
      </div>
    );
  }
  const { event, image } = data;
  const cancelled = event.status === "cancelled";
  const back = `/events/${id}`;
  return (
    <article data-testid="public-event-detail" data-event-id={event.id} data-status={event.status} className="space-y-6">
      <Link to="/events" className="inline-flex min-h-11 items-center gap-2 text-sm text-muted-foreground hover:text-primary">
        <ArrowLeft className="size-4" aria-hidden />{t("publicEvents.back")}
      </Link>
      <header className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary">{t(`events.categories.${event.category}`)}</Badge>
          {cancelled ? <Badge data-testid="public-event-cancelled" variant="destructive">{t("events.cancelled")}</Badge> : <PublicRegistrationState state={event.registration} />}
        </div>
        <h1 className={`text-3xl font-bold ${cancelled ? "line-through decoration-2" : ""}`}>{event.title}</h1>
        {event.organizer && <p data-testid="public-event-organizer" className="text-muted-foreground">{t("events.organisedBy", { name: event.organizer })}</p>}
      </header>
      {image && <img data-testid="public-event-image" src={image} alt="" className="max-h-96 w-full rounded-2xl object-cover" />}
      <dl className="grid gap-3 rounded-2xl border bg-card p-5 text-sm sm:grid-cols-2">
        <div className="flex gap-2"><CalendarDays className="size-4 shrink-0" aria-hidden /><div><dt className="sr-only">{t("publicEvents.when")}</dt><dd data-testid="public-event-when">{eventWhen(event, dateLocale())?.text}</dd></div></div>
        {publicWhere(event) && <div className="flex gap-2"><Building2 className="size-4 shrink-0" aria-hidden /><div><dt className="sr-only">{t("publicEvents.branch")}</dt><dd data-testid="public-event-branch">{publicWhere(event)}</dd></div></div>}
        {event.location && <div className="flex gap-2"><MapPin className="size-4 shrink-0" aria-hidden /><div><dt className="sr-only">{t("publicEvents.location")}</dt><dd data-testid="public-event-location">{event.location}</dd></div></div>}
        {event.is_online && <div className="flex gap-2"><Video className="size-4 shrink-0" aria-hidden /><div><dt className="sr-only">{t("publicEvents.location")}</dt><dd data-testid="public-event-online">{t("publicEvents.online")}</dd></div></div>}
      </dl>
      {event.description && <p className="whitespace-pre-line">{event.description}</p>}
      {!cancelled && event.registration === "open" && (
        <section className="space-y-3 rounded-2xl border bg-card p-5">
          <p className="text-sm text-muted-foreground">{t("publicEvents.registerIntro")}</p>
          <div className="flex flex-wrap gap-2">
            <Button asChild className="h-11"><Link data-testid="public-event-register" to="/auth" search={{ redirect: back }}>{t("publicEvents.register")}</Link></Button>
            <Button asChild variant="outline" className="h-11"><Link data-testid="public-event-create-account" to="/auth" search={{ redirect: back, mode: "signup" }}>{t("publicEvents.createAccount")}</Link></Button>
          </div>
        </section>
      )}
    </article>
  );
}

import { useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useTranslation } from "react-i18next";
import { CalendarDays, MapPin, Video } from "lucide-react";
import {
  cancelGuest,
  confirmGuest,
  getGuestRegistration,
  type GuestView,
} from "@/lib/public-guest.functions";
import { eventWhen } from "@/lib/event-rules";
import { dateLocale, translateError } from "@/lib/i18n";
import type { PublicEvent } from "@/lib/public-events";
import { Button } from "@/components/ui/button";
import { publicWhere } from "./PublicEventBits";

export { noReferrer, validateTokenSearch } from "./link-search";

/** The event's public summary on the email link pages. */
export function GuestEventSummary({ event }: { event: PublicEvent }) {
  const { t } = useTranslation();
  const where = publicWhere(event);
  return (
    <div
      data-testid="guest-link-event"
      data-event-id={event.id}
      className="space-y-2 rounded-2xl border bg-card p-5"
    >
      <h2 className="text-xl font-semibold">
        <Link
          to="/events/$id"
          params={{ id: event.id }}
          className="hover:text-primary"
          data-testid="guest-link-event-title"
        >
          {event.title}
        </Link>
      </h2>
      <p className="flex items-center gap-2 text-sm">
        <CalendarDays className="size-4 shrink-0" aria-hidden />
        <span className="sr-only">{t("publicEvents.when")}</span>
        {eventWhen(event, dateLocale())?.text ?? t("guest.dateTba")}
      </p>
      {(event.location || where) && (
        <p className="flex items-center gap-2 text-sm">
          <MapPin className="size-4 shrink-0" aria-hidden />
          <span className="sr-only">{t("publicEvents.location")}</span>
          {[event.location, where].filter(Boolean).join(" · ")}
        </p>
      )}
      {event.is_online && (
        <p className="flex items-center gap-2 text-sm">
          <Video className="size-4 shrink-0" aria-hidden />
          {t("publicEvents.online")}
        </p>
      )}
    </div>
  );
}

function StateMessage({ view }: { view: GuestView }) {
  const { t } = useTranslation();
  const tone =
    view.state === "registered" || view.state === "waitlisted"
      ? "text-foreground"
      : "text-muted-foreground";
  return (
    <p
      data-testid="guest-link-state"
      data-state={view.state}
      aria-live="polite"
      className={`text-base ${tone}`}
    >
      {t(`guest.state.${view.state}`, { position: view.position ?? "", count: view.places })}
    </p>
  );
}

function Frame({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div data-testid="guest-link-page" className="mx-auto max-w-2xl space-y-5">
      <h1 className="text-2xl font-bold">{title}</h1>
      {children}
    </div>
  );
}

/**
 * The guest's confirm or cancel page. Opening the link only reads the state: confirming or cancelling needs a click
 * (mail scanners open links), and the click is a POST.
 */
export function GuestLinkPage({
  mode,
  token,
}: {
  mode: "confirm" | "cancel";
  token: string | undefined;
}) {
  const { t } = useTranslation();
  const load = useServerFn(getGuestRegistration);
  const confirm = useServerFn(confirmGuest);
  const cancel = useServerFn(cancelGuest);
  const view = useQuery({
    queryKey: ["guest-link", mode, token],
    queryFn: () => load({ data: { token: token!, purpose: mode } }),
    enabled: !!token,
    staleTime: Infinity,
    retry: false,
  });
  const [result, setResult] = useState<GuestView | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const title = t(mode === "confirm" ? "guest.confirmTitle" : "guest.cancelTitle");

  if (!token) {
    return (
      <Frame title={title}>
        <StateMessage view={{ state: "invalid", position: null, places: 1, event: null }} />
      </Frame>
    );
  }
  if (view.isPending) {
    return (
      <Frame title={title}>
        <p className="text-muted-foreground">{t("common.loading")}</p>
      </Frame>
    );
  }
  if (view.isError) {
    return (
      <Frame title={title}>
        <p role="alert" data-testid="guest-link-error" className="text-destructive">
          {translateError(view.error)}
        </p>
      </Frame>
    );
  }
  const current = result ?? view.data;
  const actionable =
    !result &&
    (mode === "confirm"
      ? current.state === "pending"
      : current.state === "pending" ||
        current.state === "registered" ||
        current.state === "waitlisted");

  const act = async () => {
    setBusy(true);
    setError("");
    try {
      setResult(await (mode === "confirm" ? confirm : cancel)({ data: { token } }));
    } catch (e) {
      setError(translateError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Frame title={title}>
      {current.event && <GuestEventSummary event={current.event} />}
      {!result && current.onlineUrl && (
        <div data-testid="guest-link-online" className="space-y-2 rounded-2xl border bg-card p-5">
          <p className="font-medium">{t("guest.onlineTitle")}</p>
          <a
            data-testid="guest-link-online-url"
            href={current.onlineUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="break-all text-primary underline underline-offset-4"
          >
            {current.onlineUrl}
          </a>
          <p className="text-sm text-muted-foreground">{t("guest.onlineNote")}</p>
        </div>
      )}
      {actionable ? (
        <div className="space-y-3">
          <p className="text-muted-foreground">
            {t(mode === "confirm" ? "guest.confirmIntro" : "guest.cancelIntro", {
              count: current.places,
            })}
          </p>
          {error && (
            <p role="alert" data-testid="guest-link-error" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <Button
            data-testid={mode === "confirm" ? "guest-confirm-button" : "guest-cancel-button"}
            variant={mode === "confirm" ? "default" : "destructive"}
            className="h-11"
            disabled={busy}
            onClick={() => void act()}
          >
            {t(mode === "confirm" ? "guest.confirmButton" : "guest.cancelButton")}
          </Button>
        </div>
      ) : (
        <StateMessage view={current} />
      )}
    </Frame>
  );
}

import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { CalendarDays, MapPin, Video } from "lucide-react";
import type { LandingEvent } from "@/lib/landing.server";
import { isoOf, startOf, whenText } from "./format";

const OVERLAY =
  "absolute inset-0 bg-gradient-to-t from-[#171B21]/95 via-[#171B21]/60 to-[#171B21]/10 sm:bg-gradient-to-r sm:from-[#171B21]/90 sm:via-[#171B21]/55 sm:to-transparent";
const BRAND = "absolute inset-0 bg-[linear-gradient(135deg,#006D9C_0%,#28303D_70%)]";

function where(event: LandingEvent, t: (k: string) => string) {
  if (event.is_online) return { icon: Video, text: t("landing.place.online") };
  if (event.location_tba) return { icon: MapPin, text: t("landing.place.tba") };
  const text = event.location ?? event.branch ?? event.region;
  return text ? { icon: MapPin, text } : null;
}

function Frame({ children, image }: { children: ReactNode; image: ReactNode }) {
  return (
    <section
      data-testid="landing-hero"
      aria-labelledby="landing-hero-title"
      className="relative isolate flex min-h-[560px] items-end overflow-hidden bg-[#28303D] text-white sm:min-h-[600px] lg:min-h-[640px]"
    >
      {image}
      <div className="relative mx-auto w-full max-w-6xl px-4 pb-10 pt-32 sm:px-6 sm:pb-16">
        {children}
      </div>
    </section>
  );
}

/** The next public event as a full-bleed cover; without one, a highlight photo and the updates sign-up. */
export function Hero({
  event,
  fallbackPhoto,
  subscribe,
  onImageDone,
}: {
  event: LandingEvent | undefined;
  fallbackPhoto: string | null;
  subscribe: ReactNode;
  /** Called once the cover has loaded (or failed), so images further down start only after it. */
  onImageDone: () => void;
}) {
  const { t, i18n } = useTranslation();
  if (!event)
    return (
      <Frame
        image={
          <>
            {fallbackPhoto ? (
              <img
                src={fallbackPhoto}
                alt=""
                width={1600}
                height={900}
                fetchPriority="high"
                onLoad={onImageDone}
                onError={onImageDone}
                className="ds-hero-img absolute inset-0 -z-10 h-full w-full object-cover"
              />
            ) : (
              <div className={`${BRAND} -z-10`} />
            )}
            <div className={`${OVERLAY} -z-10`} />
          </>
        }
      >
        <div className="max-w-xl space-y-4">
          <h1
            id="landing-hero-title"
            className="ds-enter text-4xl font-bold leading-tight sm:text-5xl"
          >
            {t("landing.hero.emptyTitle")}
          </h1>
          <p className="ds-enter ds-enter-delay text-lg text-white/90">
            {t("landing.hero.emptyText")}
          </p>
          <div
            data-testid="landing-subscribe"
            className="ds-enter ds-enter-delay rounded-[5px] bg-white p-4 text-[#28303D] shadow-ds-card"
          >
            {subscribe}
          </div>
        </div>
      </Frame>
    );
  const start = startOf(event);
  const when = whenText(event, i18n.language, true);
  const place = where(event, t);
  return (
    <Frame
      image={
        <>
          {event.image ? (
            <img
              src={event.image}
              alt=""
              width={1600}
              height={900}
              fetchPriority="high"
              onLoad={onImageDone}
              onError={onImageDone}
              loading="eager"
              className="ds-hero-img absolute inset-0 -z-10 h-full w-full object-cover"
            />
          ) : (
            <div className={`${BRAND} -z-10`} />
          )}
          <div className={`${OVERLAY} -z-10`} />
        </>
      }
    >
      <div className="max-w-2xl space-y-4">
        <p className="ds-enter inline-flex items-center gap-2 rounded-full bg-[#006D9C] px-3 py-1 text-sm font-semibold text-white">
          {t("landing.hero.next")}
        </p>
        <h1
          id="landing-hero-title"
          className="ds-enter text-3xl font-bold leading-tight break-words sm:text-5xl"
        >
          {event.title}
        </h1>
        <ul className="ds-enter ds-enter-delay space-y-1.5 text-base text-white/90 sm:text-lg">
          {when && start && (
            <li className="flex items-start gap-2">
              <CalendarDays aria-hidden className="mt-1 h-5 w-5 shrink-0" />
              <time dateTime={isoOf(start)}>{when}</time>
            </li>
          )}
          {place && (
            <li className="flex min-w-0 items-start gap-2">
              <place.icon aria-hidden className="mt-1 h-5 w-5 shrink-0" />
              <span className="min-w-0 break-words">{place.text}</span>
            </li>
          )}
        </ul>
        <div className="ds-enter ds-enter-delay flex flex-wrap gap-3 pt-2">
          <Link
            to="/events/$id"
            params={{ id: event.id }}
            data-testid="landing-hero-register"
            className="inline-flex min-h-12 items-center rounded-[3px] bg-white px-6 text-base font-semibold text-[#28303D] transition-colors hover:bg-[#F0F0F0]"
          >
            {t("landing.hero.register")}
          </Link>
          <Link
            to="/events"
            className="inline-flex min-h-12 items-center rounded-[3px] border-2 border-white/80 px-6 text-base font-semibold text-white transition-colors hover:bg-white/10"
          >
            {t("landing.hero.allEvents")}
          </Link>
        </div>
      </div>
    </Frame>
  );
}

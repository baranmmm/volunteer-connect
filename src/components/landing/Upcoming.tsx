import { useId, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { MapPin, Users, Video } from "lucide-react";
import type { LandingEvent } from "@/lib/landing.server";
import { badgeParts, isoOf, startOf, whenText } from "./format";
import { Reveal } from "./Reveal";

const SHOWN = 9;

function Places({ event }: { event: LandingEvent }) {
  const { t } = useTranslation();
  if (event.registration === "full")
    return <span className="font-semibold text-ds-fg">{t("landing.upcoming.full")}</span>;
  if (event.registration === "open" && typeof event.spots_left === "number")
    return <span>{t("landing.upcoming.placesLeft", { count: event.spots_left })}</span>;
  return null;
}

function Card({
  event,
  lang,
  showImage,
}: {
  event: LandingEvent;
  lang: string;
  showImage: boolean;
}) {
  const { t } = useTranslation();
  const start = startOf(event);
  const badge = start ? badgeParts(start, lang) : null;
  const place = event.is_online
    ? { Icon: Video, text: t("landing.place.online") }
    : event.location_tba || !event.location
      ? { Icon: MapPin, text: t("landing.place.tba") }
      : { Icon: MapPin, text: event.location };
  const chip = event.branch ?? event.region ?? t("landing.upcoming.national");
  return (
    <li>
      <article
        data-testid="landing-upcoming-card"
        data-event-id={event.id}
        className="group relative flex h-full flex-col overflow-hidden rounded-[5px] bg-ds-surface shadow-ds-card transition-shadow hover:shadow-lg focus-within:ring-2 focus-within:ring-ds-blue"
      >
        <div className="relative aspect-video overflow-hidden bg-ds-alt">
          {event.image && showImage ? (
            <img
              src={event.image}
              alt=""
              width={640}
              height={360}
              loading="lazy"
              decoding="async"
              className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.03] motion-reduce:transition-none motion-reduce:group-hover:scale-100"
            />
          ) : (
            <div
              aria-hidden
              className="h-full w-full bg-[linear-gradient(135deg,#008AC4,#28303D)]"
            />
          )}
          {badge && start && (
            <time
              dateTime={isoOf(start)}
              className="absolute left-3 top-3 flex min-w-14 flex-col items-center rounded-[5px] bg-white px-2 py-1 text-center leading-none text-[#28303D] shadow"
            >
              <span className="text-xs font-semibold uppercase tracking-wide text-[#00648F]">
                {badge.month}
              </span>
              <span className="text-2xl font-bold">{badge.day}</span>
            </time>
          )}
          {/* Above the card link so the full name shows on hover; white on black/70 stays >= 7:1 over any photo. */}
          <span
            data-testid="landing-upcoming-chip"
            title={chip}
            className="absolute bottom-3 left-3 z-[1] max-w-[calc(100%-1.5rem)] truncate rounded-[3px] bg-black/70 px-2 py-1 text-xs font-semibold text-white"
          >
            {chip}
          </span>
        </div>
        <div className="flex flex-1 flex-col gap-2 p-4">
          <h3 className="text-lg font-semibold leading-snug break-words">
            <Link
              to="/events/$id"
              params={{ id: event.id }}
              className="after:absolute after:inset-0 focus-visible:outline-none"
            >
              {event.title}
            </Link>
          </h3>
          <p className="text-sm text-ds-muted">{whenText(event, lang)}</p>
          <p className="flex min-w-0 items-center gap-1.5 text-sm text-ds-muted">
            <place.Icon aria-hidden className="h-4 w-4 shrink-0" />
            <span className="truncate">{place.text}</span>
          </p>
          <p className="mt-auto flex items-center gap-1.5 pt-1 text-sm text-ds-muted empty:hidden">
            {(event.registration === "full" ||
              (event.registration === "open" && typeof event.spots_left === "number")) && (
              <>
                <Users aria-hidden className="h-4 w-4 shrink-0" />
                <Places event={event} />
              </>
            )}
          </p>
        </div>
      </article>
    </li>
  );
}

/** Upcoming public events as 16:9 cards with a region and branch filter over the loaded list. */
/** `imagesReady`: card images wait for the hero cover so they do not compete with it on slow connections. */
export function Upcoming({
  events,
  imagesReady,
}: {
  events: LandingEvent[];
  imagesReady: boolean;
}) {
  const { t, i18n } = useTranslation();
  const [region, setRegion] = useState("");
  const [branch, setBranch] = useState("");
  const [limit, setLimit] = useState(SHOWN);
  const ids = useId();
  const regions = useMemo(() => {
    const map = new Map<string, string>();
    for (const e of events) if (e.region_id && e.region) map.set(e.region_id, e.region);
    return [...map].sort((a, b) => a[1].localeCompare(b[1]));
  }, [events]);
  const branches = useMemo(() => {
    const map = new Map<string, string>();
    for (const e of events)
      if (e.branch_id && e.branch && (!region || e.region_id === region))
        map.set(e.branch_id, e.branch);
    return [...map].sort((a, b) => a[1].localeCompare(b[1]));
  }, [events, region]);
  const shown = events.filter(
    (e) =>
      (!region || e.region_id === region || e.scope === "national") &&
      (!branch || e.branch_id === branch),
  );
  const selectClass =
    "h-11 w-full min-w-0 rounded-[3px] border-2 border-ds-slate bg-ds-surface px-3 text-sm text-ds-fg sm:w-56";
  return (
    <Reveal
      id="upcoming"
      data-testid="landing-upcoming"
      aria-labelledby={`${ids}-title`}
      className="mx-auto max-w-6xl px-4 py-14 sm:px-6 sm:py-20"
    >
      <div className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-2">
          <h2 id={`${ids}-title`} className="text-3xl font-bold sm:text-4xl">
            {t("landing.upcoming.title")}
          </h2>
          <p className="max-w-xl text-ds-muted">{t("landing.upcoming.intro")}</p>
        </div>
        {events.length > 0 && (
          <div
            className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2 sm:flex"
            role="group"
            aria-label={t("landing.upcoming.filters")}
          >
            {regions.length > 1 && (
              <div className="flex min-w-0 flex-col gap-1">
                <label htmlFor={`${ids}-region`} className="text-sm font-medium">
                  {t("landing.upcoming.region")}
                </label>
                <select
                  id={`${ids}-region`}
                  data-testid="landing-filter-region"
                  value={region}
                  onChange={(e) => {
                    setRegion(e.target.value);
                    setBranch("");
                  }}
                  className={selectClass}
                >
                  <option value="">{t("landing.upcoming.allRegions")}</option>
                  {regions.map(([id, name]) => (
                    <option key={id} value={id}>
                      {name}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div className="flex min-w-0 flex-col gap-1">
              <label htmlFor={`${ids}-branch`} className="text-sm font-medium">
                {t("landing.upcoming.branch")}
              </label>
              <select
                id={`${ids}-branch`}
                data-testid="landing-filter-branch"
                value={branch}
                onChange={(e) => setBranch(e.target.value)}
                className={selectClass}
              >
                <option value="">{t("landing.upcoming.allBranches")}</option>
                {branches.map(([id, name]) => (
                  <option key={id} value={id}>
                    {name}
                  </option>
                ))}
              </select>
            </div>
          </div>
        )}
      </div>
      {shown.length ? (
        <ul className="mt-8 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {shown.slice(0, limit).map((event) => (
            <Card key={event.id} event={event} lang={i18n.language} showImage={imagesReady} />
          ))}
        </ul>
      ) : (
        <p
          data-testid="landing-upcoming-empty"
          className="mt-8 rounded-[5px] bg-ds-alt p-6 text-ds-muted"
        >
          {events.length ? t("landing.upcoming.emptyFilter") : t("landing.upcoming.none")}
        </p>
      )}
      <div className="mt-8 flex flex-wrap items-center gap-4">
        {shown.length > limit && (
          <button
            type="button"
            data-testid="landing-upcoming-more"
            onClick={() => setLimit((n) => n + SHOWN)}
            className="inline-flex min-h-11 items-center rounded-[3px] border-2 border-ds-slate px-5 font-semibold transition-colors hover:bg-ds-slate hover:text-ds-slate-fg"
          >
            {t("landing.upcoming.more")}
          </button>
        )}
        <Link
          to="/events"
          data-testid="landing-all-events"
          className="inline-flex min-h-11 items-center font-semibold text-ds-link underline-offset-4 hover:underline"
        >
          {t("landing.upcoming.seeAll")}{" "}
          <span aria-hidden className="ml-1">
            →
          </span>
        </Link>
      </div>
    </Reveal>
  );
}

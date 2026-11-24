import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { BranchName } from "@/components/app/BranchName";
import { queryOptions, useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameMonth,
  startOfWeek,
} from "date-fns";
import {
  CalendarPlus,
  ChevronLeft,
  ChevronRight,
  List,
  CalendarDays,
  MapPin,
  Video,
} from "lucide-react";
import { pageMeta, siteOrigin } from "@/lib/public-meta";
import { PublicShell } from "@/components/public/PublicShell";
import { PublicRegistrationState, publicWhere } from "@/components/public/PublicEventBits";
import { getPublicEvents, getPublicStructure } from "@/lib/public-events.functions";
import { branchSlug, type PublicEvent } from "@/lib/public-events";
import { eventOccursOn, eventWhen } from "@/lib/event-rules";
import { dateLocale } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { EventsMapLayout } from "@/components/public/events-map/EventsMapLayout";

type Search = { branch?: string; region?: string; view?: "list" | "month" };

/** Public, signed-out list of upcoming public events of every branch (/events?branch=medway,brighton). */
const structureQuery = queryOptions({
  queryKey: ["public-structure"],
  queryFn: () => getPublicStructure(),
  staleTime: 600_000,
});
const eventsQuery = (branch: string | undefined) =>
  queryOptions({
    queryKey: ["public-events", branch ?? ""],
    queryFn: () => getPublicEvents({ data: branch ? { branch } : {} }),
    staleTime: 300_000,
  });

// Server-rendered for signed-out visitors (and link previews). No signed links: the list has no images.
export const Route = createFileRoute("/events/")({
  validateSearch: (search: Record<string, unknown>): Search => ({
    ...(typeof search["branch"] === "string" && search["branch"].length <= 4000
      ? { branch: search["branch"] }
      : {}),
    ...(typeof search["region"] === "string" && /^[0-9a-f-]{36}$/i.test(search["region"])
      ? { region: search["region"] }
      : {}),
    ...(search["view"] === "month" ? { view: "month" as const } : {}),
  }),
  loaderDeps: ({ search }) => ({ branch: search.branch }),
  // Server: the list and filters go into the HTML. Browser: the page shows at once and the queries load as before.
  loader: async ({ context, deps }) => {
    const origin = await siteOrigin();
    if (typeof window !== "undefined")
      return { origin, branch: deps.branch, events: null, structure: null };
    const [events, structure] = await Promise.all([
      context.queryClient.ensureQueryData(eventsQuery(deps.branch)).catch(() => null),
      context.queryClient.ensureQueryData(structureQuery).catch(() => null),
    ]);
    return { origin, branch: deps.branch, events, structure };
  },
  headers: () => ({ "Cache-Control": "private, no-cache" }),
  head: ({ loaderData }) =>
    pageMeta({
      title: "Events · Dialogue Society",
      description: "Upcoming public events of the Dialogue Society, by branch and region.",
      url: `${loaderData?.origin ?? ""}/events`,
      image: `${loaderData?.origin ?? ""}/auth/join-1600.webp`,
      imageAlt: "Dialogue Society volunteers at an event",
    }),
  component: PublicEventsPage,
});

function PublicEventsPage() {
  const { t } = useTranslation();
  const search = Route.useSearch();
  const loaded = Route.useLoaderData();
  const navigate = useNavigate({ from: "/events/" });
  const structure = useQuery({
    ...structureQuery,
    ...(loaded.structure ? { initialData: loaded.structure } : {}),
  });
  const events = useQuery({
    ...eventsQuery(search.branch),
    ...(loaded.events && loaded.branch === search.branch ? { initialData: loaded.events } : {}),
  });
  const selected = new Set((search.branch ?? "").split(",").filter(Boolean));
  const view = search.view ?? "list";
  const shown = useMemo(
    () =>
      (events.data ?? []).filter(
        (e) => !search.region || e.scope === "national" || e.region_id === search.region,
      ),
    [events.data, search.region],
  );
  type Patch = { [K in keyof Search]?: Search[K] | undefined };
  const setSearch = (next: Patch) =>
    void navigate({
      search: (prev: Search) => {
        const merged: Record<string, unknown> = { ...prev, ...next };
        for (const key of Object.keys(merged)) if (merged[key] === undefined) delete merged[key];
        return merged as Search;
      },
      replace: true,
    });
  function toggleBranch(slug: string) {
    const next = new Set(selected);
    if (next.has(slug)) next.delete(slug);
    else next.add(slug);
    setSearch({ branch: [...next].join(",") || undefined });
  }
  const branches = (structure.data?.branches ?? []).filter(
    (b) => !search.region || b.region_id === search.region,
  );
  return (
    <PublicShell wide>
      <div data-testid="public-events-page" className="space-y-6">
        <header className="space-y-2">
          <h1 className="text-3xl font-bold">{t("publicEvents.title")}</h1>
          <p className="text-muted-foreground">{t("publicEvents.intro")}</p>
        </header>
        <section
          className="space-y-3 rounded-2xl border bg-card p-4"
          aria-label={t("publicEvents.filters")}
        >
          <div className="flex flex-wrap items-center gap-3">
            <label htmlFor="public-region" className="text-sm font-medium">
              {t("publicEvents.region")}
            </label>
            <select
              id="public-region"
              data-testid="public-events-region-filter"
              value={search.region ?? ""}
              onChange={(e) => setSearch({ region: e.target.value || undefined })}
              className="h-11 max-w-full rounded-xl border border-input bg-background px-3 text-sm"
            >
              <option value="">{t("publicEvents.allRegions")}</option>
              {(structure.data?.regions ?? []).map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </div>
          <fieldset data-testid="public-events-branch-filter" className="min-w-0">
            <legend className="mb-2 text-sm font-medium">{t("publicEvents.branches")}</legend>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                variant={selected.size ? "outline" : "default"}
                aria-pressed={!selected.size}
                data-testid="public-events-branch-all"
                onClick={() => setSearch({ branch: undefined })}
              >
                {t("publicEvents.allBranches")}
              </Button>
              {branches.map((b) => {
                const slug = branchSlug(b.name),
                  on = selected.has(slug);
                return (
                  <Button
                    key={b.id}
                    type="button"
                    size="sm"
                    variant={on ? "default" : "outline"}
                    aria-pressed={on}
                    data-testid="public-events-branch-option"
                    data-slug={slug}
                    data-branch-id={b.id}
                    title={b.name}
                    className="max-w-full"
                    onClick={() => toggleBranch(slug)}
                  >
                    <span className="min-w-0 truncate">{b.name}</span>
                  </Button>
                );
              })}
            </div>
          </fieldset>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div
              className="inline-flex rounded-xl border p-1"
              role="group"
              aria-label={t("publicEvents.view")}
            >
              <Button
                type="button"
                size="sm"
                variant={view === "list" ? "default" : "ghost"}
                aria-pressed={view === "list"}
                data-testid="public-events-view-list"
                onClick={() => setSearch({ view: undefined })}
              >
                <List />
                {t("publicEvents.list")}
              </Button>
              <Button
                type="button"
                size="sm"
                variant={view === "month" ? "default" : "ghost"}
                aria-pressed={view === "month"}
                data-testid="public-events-view-month"
                onClick={() => setSearch({ view: "month" })}
              >
                <CalendarDays />
                {t("publicEvents.month")}
              </Button>
            </div>
            <Subscribe branch={search.branch} />
          </div>
        </section>
        {events.isLoading ? (
          <p className="text-muted-foreground">{t("common.loading")}</p>
        ) : events.isError ? (
          <p role="alert" className="text-destructive">
            {t("publicEvents.loadError")}
          </p>
        ) : (
          <EventsMapLayout upcoming={shown} branch={search.branch} region={search.region}>
            {(ctx) =>
              view === "list" ? (
                <PublicList
                  events={ctx.shown}
                  highlightedId={ctx.highlightedId}
                  onHover={ctx.onHover}
                />
              ) : (
                <PublicMonth events={ctx.events} month={ctx.month} onMonth={ctx.setMonthOffset} />
              )
            }
          </EventsMapLayout>
        )}
      </div>
    </PublicShell>
  );
}

function PublicList({
  events,
  highlightedId,
  onHover,
}: {
  events: PublicEvent[];
  highlightedId: string | null;
  onHover: (id: string | null) => void;
}) {
  const { t, i18n } = useTranslation();
  if (!events.length)
    return (
      <p data-testid="public-events-empty" className="text-muted-foreground">
        {t("publicEvents.empty")}
      </p>
    );
  return (
    <ul
      data-testid="public-events-list"
      className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2"
    >
      {events.map((e) => (
        <li
          key={e.id}
          data-testid="public-event-card"
          data-event-id={e.id}
          data-highlighted={e.id === highlightedId ? "true" : undefined}
          onMouseEnter={() => onHover(e.id)}
          onMouseLeave={() => onHover(null)}
          onFocus={() => onHover(e.id)}
          onBlur={() => onHover(null)}
          className={`scroll-mt-4 rounded-2xl border bg-card p-4 ${e.id === highlightedId ? "ring-2 ring-primary" : ""}`}
        >
          <Link
            to="/events/$id"
            params={{ id: e.id }}
            className="block space-y-2 hover:text-primary"
          >
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="secondary">{t(`events.categories.${e.category}`)}</Badge>
              <PublicRegistrationState state={e.registration} />
            </div>
            <h2 className="text-lg font-semibold">{e.title}</h2>
            <p className="text-sm">{eventWhen(e, dateLocale(i18n.language))?.text}</p>
            <p className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
              {publicWhere(e) && <BranchName name={publicWhere(e)} />}
              {(e.location || e.location_tba) && (
                <span className="inline-flex items-center gap-1">
                  <MapPin className="size-3.5" aria-hidden />
                  {e.location_tba ? t("events.locationTba") : e.location}
                </span>
              )}
              {e.is_online && (
                <span className="inline-flex items-center gap-1">
                  <Video className="size-3.5" aria-hidden />
                  {t("publicEvents.online")}
                </span>
              )}
            </p>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function PublicMonth({
  events,
  month: monthKey,
  onMonth,
}: {
  events: PublicEvent[];
  month: string;
  onMonth: (delta: number) => void;
}) {
  const { t, i18n } = useTranslation();
  // The month follows the map's timeline (its first selected month); the arrows move the timeline.
  const month = new Date(`${monthKey}-01T12:00:00`);
  const days = eachDayOfInterval({
    start: startOfWeek(month, { weekStartsOn: 1 }),
    end: endOfWeek(endOfMonth(month), { weekStartsOn: 1 }),
  });
  return (
    <section data-testid="public-events-month" className="space-y-3">
      <div className="flex items-center justify-between">
        <Button
          variant="outline"
          size="icon"
          aria-label={t("publicEvents.previousMonth")}
          onClick={() => onMonth(-1)}
        >
          <ChevronLeft />
        </Button>
        <h2 className="text-lg font-semibold">
          {new Intl.DateTimeFormat(dateLocale(i18n.language), {
            month: "long",
            year: "numeric",
          }).format(month)}
        </h2>
        <Button
          variant="outline"
          size="icon"
          aria-label={t("publicEvents.nextMonth")}
          onClick={() => onMonth(1)}
        >
          <ChevronRight />
        </Button>
      </div>
      <ol className="grid grid-cols-1 gap-2 sm:grid-cols-7">
        {days.map((day) => {
          const key = format(day, "yyyy-MM-dd");
          const on = events.filter((e) => eventOccursOn(e, key));
          if (!isSameMonth(day, month) && !on.length)
            return <li key={key} className="hidden sm:block" aria-hidden />;
          return (
            <li
              key={key}
              className={`min-h-20 rounded-xl border p-2 text-xs ${isSameMonth(day, month) ? "bg-card" : "bg-muted/50"} ${on.length ? "" : "hidden sm:block"}`}
            >
              <span className="font-semibold">
                {new Intl.DateTimeFormat(dateLocale(i18n.language), {
                  weekday: "short",
                  day: "numeric",
                }).format(day)}
              </span>
              <ul className="mt-1 space-y-1">
                {on.map((e) => (
                  <li key={e.id} data-testid="public-event-month-entry" data-event-id={e.id}>
                    <Link
                      to="/events/$id"
                      params={{ id: e.id }}
                      className="block truncate rounded bg-secondary px-1 py-0.5 hover:underline"
                    >
                      {e.title}
                    </Link>
                  </li>
                ))}
              </ul>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/** webcal:// subscription (the same branch filter) and how to add it to Google or Outlook. */
function Subscribe({ branch }: { branch?: string | undefined }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  // A floating panel: Escape or a click outside closes it (Escape returns focus to the button).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      toggle.current?.focus();
    };
    const onPointer = (e: PointerEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [open]);
  const path = `/api/ics${branch ? `?branch=${encodeURIComponent(branch)}` : ""}`;
  // Only read in the open panel (never on the server, which has no window).
  const https = open ? `${window.location.origin}${path}` : path;
  const webcal = https.replace(/^https?:/, "webcal:");
  return (
    <div className="relative" ref={box}>
      <Button
        ref={toggle}
        type="button"
        variant="outline"
        size="sm"
        data-testid="public-events-subscribe"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <CalendarPlus />
        {t("publicEvents.subscribe")}
      </Button>
      {open && (
        <div
          data-testid="public-events-subscribe-panel"
          className="absolute left-0 top-full sm:left-auto sm:right-0 z-50 mt-2 w-[min(28rem,calc(100vw-4.5rem))] space-y-2 rounded-xl border bg-popover p-3 text-sm text-popover-foreground shadow-lg"
        >
          <Button asChild size="sm">
            <a data-testid="public-events-subscribe-webcal" href={webcal}>
              {t("publicEvents.subscribeApp")}
            </a>
          </Button>
          <p>
            {t("publicEvents.subscribeLink")}{" "}
            <code
              data-testid="public-events-subscribe-url"
              className="break-all rounded bg-muted px-1"
            >
              {https}
            </code>
          </p>
          <p className="text-muted-foreground">{t("publicEvents.subscribeGoogle")}</p>
          <p className="text-muted-foreground">{t("publicEvents.subscribeOutlook")}</p>
        </div>
      )}
    </div>
  );
}

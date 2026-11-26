import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useRef, useState } from "react";
import { CalendarDays, History, List, ListChecks, Plus, Send } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/lib/auth";
import { isFollowerRoles, isNationalCoordinator } from "@/lib/roles";
import { inFollowedBranches, useFollowedBranches } from "@/lib/followed-branches";
import { CALENDAR_CATEGORIES, filterEvents, isScheduled, londonInput } from "@/lib/event-rules";
import { listEvents } from "@/lib/events.functions";
import { pageHead } from "@/components/app/head";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { EventCard } from "@/components/events/EventCard";
import { MonthEvents } from "@/components/events/MonthEvents";
import { EventForm } from "@/components/events/EventForm";
import { PastEventDialog } from "@/components/events/PastEventDialog";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { CalendarLegend } from "@/components/events/EventStatus";
import { RequestEventButton, RequestEventDialog } from "@/components/requests/RequestEventButton";
import { useCanRequestEvents } from "@/lib/use-event-requests";
import { useNarrowScreen } from "@/hooks/use-narrow-screen";
import { calendarToolbarChanges } from "@/lib/compact-toolbar";
import { cn } from "@/lib/utils";
import {
  CompactHeader,
  FAB_CLEARANCE,
  FiltersSheet,
  FloatingActionButton,
  IconViewSwitch,
  OverflowMenu,
  OverflowMenuItem,
} from "@/components/app/CompactToolbar";

/** "Public events only" (managers): remembered on this device. */
const PUBLIC_ONLY_KEY = "calendar.publicOnly";
function readPublicOnly() {
  try {
    return window.localStorage.getItem(PUBLIC_ONLY_KEY) === "1";
  } catch {
    return false;
  }
}

export const Route = createFileRoute("/_app/calendar")({
  ssr: false,
  validateSearch: (search: Record<string, unknown>): { view?: "month" | "list" } =>
    search["view"] === "month" || search["view"] === "list" ? { view: search["view"] } : {},
  head: () =>
    pageHead(
      "Calendar & Events",
      "View Dialogue Society branch and regional events and manage your event calendar.",
    ),
  component: CalendarPage,
});
function CalendarPage() {
  const { t } = useTranslation();
  const { session, profile, roles, isManager } = useAuth();
  const follower = isFollowerRoles(roles),
    nc = isNationalCoordinator(roles),
    canCreate = isManager || nc;
  // Followed branches by default; National Coordinators see every branch by default.
  const defaultBranchScope = nc ? "all" : "followed";
  const [branchScope, setBranchScope] = useState<"followed" | "all">(defaultBranchScope);
  const followed = useFollowedBranches(session?.user.id);
  const fetch = useServerFn(listEvents),
    navigate = useNavigate();
  // `?view=list|month` (e.g. the dashboard's "View all") wins over the screen-size default.
  const { view: requested } = Route.useSearch();
  const [view, setView] = useState<"month" | "list">(requested ?? "list");
  useEffect(() => {
    if (!requested) setView(window.matchMedia("(max-width: 767px)").matches ? "list" : "month");
  }, [requested]);
  const [past, setPast] = useState(false),
    [category, setCategory] = useState("all"),
    [organizer, setOrganizer] = useState("all");
  const [month, setMonth] = useState(
    () => new Date(`${londonInput(new Date()).slice(0, 7)}-01T12:00:00`),
  );
  const [creating, setCreating] = useState(false),
    [addingPast, setAddingPast] = useState(false);
  const [publicOnly, setPublicOnlyState] = useState(readPublicOnly);
  function setPublicOnly(value: boolean) {
    setPublicOnlyState(value);
    try {
      window.localStorage.setItem(PUBLIC_ONLY_KEY, value ? "1" : "0");
    } catch {
      /* per-device convenience only */
    }
  }
  // The open form is not re-rendered by the clock tick (`now`), so its lists and pickers stay still while in use.
  const createForm = useMemo(
    () =>
      creating ? (
        <EventForm
          onClose={() => setCreating(false)}
          onSaved={(id) => {
            setCreating(false);
            void navigate({ to: "/events/$id", params: { id } });
          }}
        />
      ) : null,
    [creating, navigate],
  );
  const [now, setNow] = useState(() => new Date());
  // Advance cached events through start/end boundaries without another network read.
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const events = useQuery({
    queryKey: ["events", session?.user.id, profile?.status],
    queryFn: () => fetch(),
    enabled: profile?.status === "active",
    staleTime: 240000,
    refetchInterval: 240000,
  });
  const inScope = (events.data ?? []).filter(
    (e) =>
      (branchScope === "all" || inFollowedBranches(e, followed.data ?? [])) &&
      (!canCreate || !publicOnly || e.audience === "public"),
  );
  const filtered = filterEvents(inScope, view === "month" ? null : past, category, organizer, now);
  const organizers = [...new Set((events.data ?? []).map((e) => e.organizer))].sort();
  // Phones (< 640px): one slim header row, the filters in a bottom sheet, Create event as a floating button and the
  // other actions in one row below the header.
  const narrow = useNarrowScreen();
  const [sheetOpen, setSheetOpen] = useState(false);
  const changed = calendarToolbarChanges({
    view,
    past,
    publicOnly: canCreate ? publicOnly : null,
    branchScope,
    defaultBranchScope,
    category,
    organizer,
  });
  const resetFilters = () => {
    setPast(false);
    if (canCreate) setPublicOnly(false);
    setBranchScope(defaultBranchScope);
    setCategory("all");
    setOrganizer("all");
  };
  const myRequestsLink = !follower && !nc && (
    <Button asChild variant="link" className="h-11">
      <Link to="/requests" search={{ tab: "mine" }} data-testid="calendar-my-requests-link">
        {t("requests.myTitle")}
      </Link>
    </Button>
  );
  const addPastButton = canCreate && (
    <Button
      data-testid="calendar-add-past-event-button"
      variant="outline"
      className="h-11"
      onClick={() => setAddingPast(true)}
    >
      <History />
      {t("pastEvents.add")}
    </Button>
  );
  const publicOnlySwitch = canCreate && (
    <div className="flex min-h-11 items-center gap-2">
      <Switch
        id="calendar-filter-public-only"
        data-testid="calendar-filter-public-only"
        checked={publicOnly}
        onCheckedChange={setPublicOnly}
      />
      <Label htmlFor="calendar-filter-public-only">{t("events.publicOnly")}</Label>
    </div>
  );
  const whenButtons = view === "list" && (
    <div className="flex flex-wrap gap-2">
      <Button
        data-testid="calendar-filter-upcoming"
        variant={!past ? "default" : "outline"}
        aria-pressed={!past}
        className={cn(narrow && "h-11")}
        onClick={() => setPast(false)}
      >
        {t("events.upcoming")}
      </Button>
      <Button
        data-testid="calendar-filter-past"
        variant={past ? "default" : "outline"}
        aria-pressed={past}
        className={cn(narrow && "h-11")}
        onClick={() => setPast(true)}
      >
        {t("events.past")}
      </Button>
    </div>
  );
  const filterSelects = (
    <div className="grid gap-3 sm:grid-cols-3">
      <Select
        value={branchScope}
        onValueChange={(v) => setBranchScope(v === "all" ? "all" : "followed")}
      >
        <SelectTrigger
          data-testid="calendar-filter-branches"
          aria-label={t("events.branchScope")}
          className="h-11"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="followed" data-testid="calendar-filter-branches-option-followed">
            {t("events.followedBranches")}
          </SelectItem>
          <SelectItem value="all" data-testid="calendar-filter-branches-option-all">
            {t("events.allBranches")}
          </SelectItem>
        </SelectContent>
      </Select>
      <Select value={category} onValueChange={setCategory}>
        <SelectTrigger
          data-testid="calendar-filter-category"
          aria-label={t("events.category")}
          className="h-11"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">{t("events.allCategories")}</SelectItem>
          {CALENDAR_CATEGORIES.map((c) => (
            <SelectItem key={c} value={c}>
              {t(`events.categories.${c}`)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select value={organizer} onValueChange={setOrganizer}>
        <SelectTrigger
          data-testid="calendar-filter-organizer"
          aria-label={t("events.organizer")}
          className="h-11"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">{t("events.allOrganizers")}</SelectItem>
          {organizers.map((o) => (
            <SelectItem key={o} value={o}>
              {o}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
  const requestButton = !follower && !nc && (
    <RequestEventButton variant={isManager ? "outline" : "default"} />
  );
  // Phones: the same actions (same conditions) in the header's "More actions" menu.
  const canRequest = useCanRequestEvents();
  const [requesting, setRequesting] = useState(false);
  // The dialogs opened from the menu unmount on close, so focus is put back on ⋯ by hand.
  const moreButton = useRef<HTMLButtonElement>(null);
  const focusMore = () => window.setTimeout(() => moreButton.current?.focus(), 0);
  const showMyRequests = !follower && !nc;
  const showRequest = showMyRequests && canRequest;
  const moreActions = (showMyRequests || showRequest || canCreate) && (
    <OverflowMenu testId="calendar-more-actions" triggerRef={moreButton}>
      {showRequest && (
        <OverflowMenuItem
          data-testid="event-request-open-button"
          onAction={() => setRequesting(true)}
        >
          <Send aria-hidden />
          {t("requests.open")}
        </OverflowMenuItem>
      )}
      {canCreate && (
        <OverflowMenuItem
          data-testid="calendar-add-past-event-button"
          onAction={() => setAddingPast(true)}
        >
          <History aria-hidden />
          {t("pastEvents.add")}
        </OverflowMenuItem>
      )}
      {showMyRequests && (
        <OverflowMenuItem asChild>
          <Link to="/requests" search={{ tab: "mine" }} data-testid="calendar-my-requests-link">
            <ListChecks aria-hidden />
            {t("requests.myTitle")}
          </Link>
        </OverflowMenuItem>
      )}
    </OverflowMenu>
  );
  return (
    <div className={narrow ? cn("space-y-4", canCreate && FAB_CLEARANCE) : "space-y-6"}>
      {narrow ? (
        <>
          <CompactHeader title={t("events.title")} testId="calendar-compact-header">
            <IconViewSwitch
              label={t("events.title")}
              testId="calendar-view-toggle"
              value={view}
              onChange={setView}
              options={[
                {
                  value: "month",
                  icon: CalendarDays,
                  label: t("events.month"),
                  testId: "calendar-view-month",
                },
                {
                  value: "list",
                  icon: List,
                  label: t("events.list"),
                  testId: "calendar-view-list",
                },
              ]}
            />
            <FiltersSheet
              testId="calendar-filters"
              count={changed}
              open={sheetOpen}
              onOpenChange={setSheetOpen}
              onReset={resetFilters}
            >
              {whenButtons}
              {publicOnlySwitch}
              {filterSelects}
            </FiltersSheet>
            {moreActions}
          </CompactHeader>
          <RequestEventDialog
            open={requesting}
            onClose={() => {
              setRequesting(false);
              focusMore();
            }}
          />
        </>
      ) : (
        <>
          <header className="flex flex-wrap items-center justify-between gap-4">
            <h1 className="text-3xl font-bold">{t("events.title")}</h1>
            <div className="flex flex-wrap items-center gap-2">
              {myRequestsLink}
              {requestButton}
              {addPastButton}
              {canCreate && (
                <Button
                  data-testid="calendar-create-event-button"
                  className="h-11"
                  onClick={() => setCreating(true)}
                >
                  <Plus />
                  {t("events.create")}
                </Button>
              )}
            </div>
          </header>
          <div className="flex flex-wrap items-center justify-between gap-3 border-b pb-4">
            <div
              data-testid="calendar-view-toggle"
              role="group"
              aria-label={t("events.title")}
              className="flex gap-1"
            >
              <Button
                variant={view === "month" ? "secondary" : "ghost"}
                aria-pressed={view === "month"}
                onClick={() => setView("month")}
              >
                <CalendarDays />
                {t("events.month")}
              </Button>
              <Button
                variant={view === "list" ? "secondary" : "ghost"}
                aria-pressed={view === "list"}
                onClick={() => setView("list")}
              >
                <List />
                {t("events.list")}
              </Button>
            </div>
            {publicOnlySwitch}
            {whenButtons}
          </div>
          {filterSelects}
        </>
      )}
      {events.isLoading ? (
        <p className="py-10 text-center text-muted-foreground">{t("common.loading")}</p>
      ) : events.isError ? (
        <div role="alert" className="space-y-3">
          <p className="text-destructive">{t("events.loadError")}</p>
          <Button variant="outline" onClick={() => events.refetch()}>
            {t("common.retry")}
          </Button>
        </div>
      ) : view === "month" ? (
        <MonthEvents month={month} onMonth={setMonth} events={filtered} now={now} />
      ) : (
        <section data-testid="calendar-list-view" className="space-y-3">
          {filtered.length ? (
            filtered.map((e) => <EventCard key={e.id} event={e} now={now} />)
          ) : (
            <p className="border-y py-12 text-center text-muted-foreground">{t("events.empty")}</p>
          )}
        </section>
      )}
      {narrow && canCreate && (
        <FloatingActionButton
          testId="calendar-create-event-button"
          label={t("events.create")}
          onClick={() => setCreating(true)}
        />
      )}
      {createForm}
      {addingPast && (
        <PastEventDialog
          onClose={() => {
            setAddingPast(false);
            // Opened from the phone menu: focus back on ⋯ (desktop keeps its behaviour).
            if (narrow) focusMore();
          }}
          onSaved={(id) => {
            setAddingPast(false);
            void navigate({ to: "/events/$id", params: { id } });
          }}
        />
      )}
      {view === "month" && filtered.some((e) => !isScheduled(e)) && (
        <section className="space-y-3">
          <h2 className="text-xl font-semibold">{t("events.unscheduled")}</h2>
          {filtered
            .filter((e) => !isScheduled(e))
            .map((e) => (
              <EventCard key={e.id} event={e} now={now} />
            ))}
        </section>
      )}
      {!events.isLoading && !events.isError && <CalendarLegend showDraft={isManager} />}
    </div>
  );
}

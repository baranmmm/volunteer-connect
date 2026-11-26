import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { CalendarDays, MapPin, Pencil, PencilLine, Plus, Repeat, Video } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { primaryRole, isFollowerRoles, isNationalCoordinator } from "@/lib/roles";
import {
  FollowerCards,
  FollowerStrip,
  NcDashboard,
  WelcomeScreen,
} from "@/components/app/RoleDashboards";
import { inFollowedBranches, useFollowedBranches } from "@/lib/followed-branches";
import { useTranslation } from "react-i18next";
import { listEvents } from "@/lib/events.functions";
import { eventDisplayStatus, ownDrafts, upcomingDashboardEvents } from "@/lib/event-status";
import { isMeetingEvent, type HubEvent } from "@/lib/event-rules";
import { formatDate } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { pageHead } from "@/components/app/head";
import { MyTasksCard } from "@/components/tasks/MyTasksCard";
import { UpcomingMeetingsCard } from "@/components/meetings/UpcomingMeetingsCard";
import { Button } from "@/components/ui/button";
import { EventForm } from "@/components/events/EventForm";
import { eventDateText } from "@/components/events/event-display";
import { EventStatusBadge } from "@/components/events/EventStatus";
import { STATUS_CARD, cancelledTitle } from "@/components/events/event-status-styles";
import { HappeningNowBadge } from "@/components/events/HappeningNowBadge";
import { MyRegistrationsCard } from "@/components/events/MyRegistrations";
import { RequestNotices, WaitingForYouCard } from "@/components/requests/RequestDashboard";

export const Route = createFileRoute("/_app/dashboard")({
  head: () => pageHead("Dashboard", "Your volunteer dashboard."),
  component: Dashboard,
});

function Dashboard() {
  const { profile, roles, session, isManager } = useAuth();
  const { t } = useTranslation();
  const first = profile?.full_name.split(" ")[0];
  // Same query and cache key as the calendar: RLS decides which events (and drafts) come back.
  const fetch = useServerFn(listEvents);
  const events = useQuery({
    queryKey: ["events", session?.user.id, profile?.status],
    queryFn: () => fetch(),
    enabled: profile?.status === "active",
    staleTime: 240000,
    refetchInterval: 240000,
  });
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30000);
    return () => window.clearInterval(timer);
  }, []);
  const follower = isFollowerRoles(roles),
    nc = isNationalCoordinator(roles);
  // Upcoming events of followed branches (members: their own scope plus followed public events).
  const followed = useFollowedBranches(session?.user.id);
  // Meetings have their own card ("Upcoming meetings"), so their calendar entries are left out here.
  const upcoming = (
    nc
      ? (events.data ?? [])
      : (events.data ?? []).filter((e) => inFollowedBranches(e, followed.data ?? []))
  ).filter((e) => !isMeetingEvent(e));
  const drafts = isManager || nc ? ownDrafts(events.data ?? [], session?.user.id) : [];
  // Followers see the welcome screen once (after sign-up / the first sign-in), then the status strip.
  const welcome = follower && !!profile && !profile.welcome_seen_at;
  return (
    <div className="space-y-8">
      {welcome ? (
        <WelcomeScreen />
      ) : (
        <section className="rounded-3xl bg-hero p-7 text-primary-foreground shadow-soft sm:p-10">
          <p className="text-sm font-medium opacity-90">{t("dashboard.welcomeBack")}</p>
          <h1 data-testid="dashboard-welcome" className="mt-1 text-3xl font-bold sm:text-4xl">
            {first ? t("dashboard.hello", { name: first }) : t("dashboard.helloNoName")}
          </h1>
          <p className="mt-3 opacity-90 [overflow-wrap:anywhere]">
            <span data-testid="dashboard-user-role">{t(`common.roles.${primaryRole(roles)}`)}</span>
            {profile?.branches && (
              <>
                {" "}
                ·{" "}
                <span data-testid="dashboard-user-branch">
                  {t("dashboard.branchLine", { branch: profile.branches.name })}
                </span>
                {profile.branches.regions && <>, {profile.branches.regions.name}</>}
              </>
            )}
          </p>
        </section>
      )}
      {follower && !welcome && <FollowerStrip />}
      <div data-testid="dashboard-grid" className="grid gap-5 lg:grid-cols-2">
        {!follower && <WaitingForYouCard />}
        {nc && <NcDashboard />}
        {follower && (
          <div data-testid="follower-dashboard" className="grid gap-5 lg:col-span-2 lg:grid-cols-2">
            <FollowerCards />
          </div>
        )}
        {!follower && !nc && <RequestNotices />}
        {/* Reading order: meetings, events, tasks, then registrations (followers have no meetings or tasks). */}
        {!follower && <UpcomingMeetingsCard />}
        <UpcomingEventsCard
          events={upcoming}
          loading={events.isLoading}
          error={events.isError}
          onRetry={() => void events.refetch()}
          now={now}
          canCreate={isManager || nc}
        />
        {!follower && <MyTasksCard />}
        <MyRegistrationsCard />
        {drafts.length > 0 && <DraftsCard drafts={drafts} />}
      </div>
    </div>
  );
}

function CardHeader({
  icon: Icon,
  title,
  id,
  action,
}: {
  icon: typeof CalendarDays;
  title: string;
  id?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex items-center gap-3">
        <span className="rounded-xl bg-secondary p-2.5 text-primary">
          <Icon className="h-5 w-5" aria-hidden />
        </span>
        <h2 id={id} className="text-xl font-semibold">
          {title}
        </h2>
      </div>
      {action}
    </div>
  );
}

function UpcomingEventsCard({
  events,
  loading,
  error,
  onRetry,
  now,
  canCreate,
}: {
  events: HubEvent[];
  loading: boolean;
  error: boolean;
  onRetry: () => void;
  now: Date;
  canCreate: boolean;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);
  const upcoming = upcomingDashboardEvents(events, now);
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
  return (
    <section
      data-testid="dashboard-upcoming-events"
      aria-labelledby="dashboard-upcoming-title"
      className="rounded-2xl border bg-card p-6 shadow-soft"
    >
      <CardHeader
        icon={CalendarDays}
        title={t("dashboard.upcomingTitle")}
        id="dashboard-upcoming-title"
        action={
          <Link
            data-testid="dashboard-view-all-events"
            to="/calendar"
            search={{ view: "list" }}
            className="text-sm font-medium text-primary underline-offset-4 hover:underline"
          >
            {t("dashboard.viewAll")}
          </Link>
        }
      />
      {loading ? (
        <p className="mt-6 text-muted-foreground">{t("common.loading")}</p>
      ) : error ? (
        <div role="alert" className="mt-6 space-y-3">
          <p className="text-destructive">{t("events.loadError")}</p>
          <Button variant="outline" onClick={onRetry}>
            {t("common.retry")}
          </Button>
        </div>
      ) : upcoming.length === 0 ? (
        <div data-testid="dashboard-upcoming-events-empty" className="mt-6 space-y-4">
          <p className="text-muted-foreground">{t("dashboard.upcomingEmpty")}</p>
          {canCreate && (
            <Button
              data-testid="dashboard-create-event"
              className="h-11"
              onClick={() => setCreating(true)}
            >
              <Plus />
              {t("events.create")}
            </Button>
          )}
        </div>
      ) : (
        <ul className="mt-5 space-y-2">
          {upcoming.map((event) => (
            <li key={event.id}>
              <Link
                to="/events/$id"
                params={{ id: event.id }}
                data-testid="dashboard-upcoming-event-item"
                data-event-id={event.id}
                data-status={event.status}
                className={cn(
                  "block rounded-lg border p-3 transition-colors hover:border-primary focus-visible:ring-2 focus-visible:ring-ring",
                  STATUS_CARD[eventDisplayStatus(event, now)],
                )}
              >
                <p className="flex items-center gap-1 text-sm text-muted-foreground">
                  {eventDateText(event, t)}
                  {event.series_id && (
                    <span
                      data-testid="event-recurring-icon"
                      title={t("events.recurring.label")}
                      className="inline-flex"
                    >
                      <Repeat className="size-3.5" aria-hidden />
                      <span className="sr-only">{t("events.recurring.label")}</span>
                    </span>
                  )}
                </p>
                <p className={cn("mt-0.5 break-words font-semibold", cancelledTitle(event.status))}>
                  {event.title}
                </p>
                <div className="mt-1.5 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                  {event.location_type === "online" ? (
                    <span className="inline-flex items-center gap-1">
                      <Video className="size-4" aria-hidden />
                      {t("events.online")}
                    </span>
                  ) : (
                    (event.location || event.location_tba) && (
                      <span className="inline-flex min-w-0 items-center gap-1">
                        <MapPin className="size-4 shrink-0" aria-hidden />
                        <span className="break-words">
                          {event.location_tba ? t("events.locationTba") : event.location}
                        </span>
                      </span>
                    )
                  )}
                  <EventStatusBadge status={event.status} />
                  <HappeningNowBadge event={event} now={now} />
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {createForm}
    </section>
  );
}

function DraftsCard({ drafts }: { drafts: HubEvent[] }) {
  const { t } = useTranslation();
  return (
    <section
      data-testid="dashboard-your-drafts"
      aria-labelledby="dashboard-drafts-title"
      className="rounded-2xl border bg-card p-6 shadow-soft"
    >
      <CardHeader
        icon={PencilLine}
        title={t("dashboard.draftsTitle")}
        id="dashboard-drafts-title"
      />
      <ul className="mt-5 space-y-2">
        {drafts.map((draft) => (
          <li
            key={draft.id}
            data-testid="dashboard-draft-item"
            data-event-id={draft.id}
            className={cn(
              "flex items-center justify-between gap-3 rounded-lg border p-3",
              STATUS_CARD.draft,
            )}
          >
            <Link
              to="/events/$id"
              params={{ id: draft.id }}
              className="min-w-0 flex-1 focus-visible:ring-2 focus-visible:ring-ring"
            >
              {/* A div, not a p: the status badge is a div, which a paragraph may not contain. */}
              <div className="flex flex-wrap items-center gap-2 break-words font-semibold">
                {draft.title}
                <EventStatusBadge status="draft" />
              </div>
              <p className="mt-0.5 text-sm text-muted-foreground">
                {draft.start_at || draft.start_date
                  ? eventDateText(draft, t)
                  : t("dashboard.draftSaved", { date: formatDate(draft.created_at) })}
              </p>
            </Link>
            <Button asChild variant="outline" size="sm">
              <Link
                data-testid="dashboard-draft-edit"
                to="/events/$id"
                params={{ id: draft.id }}
                search={{ edit: true }}
              >
                <Pencil />
                {t("dashboard.editDraft")}
              </Link>
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}

import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Plus, Inbox } from "lucide-react";
import { pageHead } from "@/components/app/head";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { EventDialog } from "@/components/events/EventDialog";
import { EventRequestForm } from "@/components/requests/EventRequestForm";
import { useAuth } from "@/lib/auth";
import { isFollowerRoles, isNationalCoordinator } from "@/lib/roles";
import {
  REVIEW_WAITING_KEY,
  useMarkNoticesRead,
  useRequestTargets,
  useReviewWaiting,
  useWorkRequestCount,
} from "@/lib/use-work-notices";
import { MeetingRequestForm, TaskRequestForm } from "@/components/requests/WorkRequestForms";
import { MyWorkRequests, ReviewWorkRequests } from "@/components/requests/WorkRequestLists";
import {
  MyVolunteerApplications,
  ReviewVolunteerApplications,
  VolunteerApplicationForm,
} from "@/components/requests/VolunteerApplications";
import { useMyApplications } from "@/lib/volunteer-applications";
import { requestViewSearch, resolveRequestView } from "@/lib/request-view";
import { ManagerEventRequests } from "@/components/requests/ManagerEventRequests";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { MyEventRequests } from "@/components/requests/MyEventRequests";
import {
  REQUEST_KINDS,
  REQUEST_LIST_FILTERS,
  type RequestListFilter,
} from "@/components/requests/request-kinds";
import { useCanRequestEvents, usePendingRequestCount } from "@/lib/use-event-requests";

// The Requests badge counts these notices; opening the page marks them read.
const REQUEST_NOTICES: { entityType: "task_request" | "meeting_request" }[] = [
  { entityType: "task_request" },
  { entityType: "meeting_request" },
];
// The grouped "N requests are waiting for you" notice; opening To review marks it read.
const REVIEW_NOTICES: { entityType: "review" }[] = [{ entityType: "review" }];

export const Route = createFileRoute("/_app/requests")({
  ssr: false,
  validateSearch: requestViewSearch,
  head: () => pageHead("Requests", "Submit and review Dialogue Society volunteer requests."),
  component: RequestsPage,
});

/** Shared request workspace; existing lists retain their own actions and permissions. */
function RequestsPage() {
  const { t } = useTranslation();
  const canRequestEvents = useCanRequestEvents();
  const { isManager, roles, session } = useAuth();
  // Followers apply to become volunteers (one open application at a time); members request events.
  const follower = isFollowerRoles(roles);
  const applications = useMyApplications(session?.user.id, follower);
  const hasOpenApplication = !!applications.data?.some((a) => a.status === "submitted");
  // National Coordinators only review task and meeting requests (nobody above them to ask). Regional Directors
  // create events directly but may ask a National Coordinator for a task or meeting.
  const nc = isNationalCoordinator(roles);
  const director = roles.includes("regional_director") && !nc;
  const reviewer = isManager || nc;
  const pending = usePendingRequestCount();
  const workPending = useWorkRequestCount(reviewer);
  const targets = useRequestTargets(!follower && !nc);
  // One count everywhere: the same get_review_waiting() as the Requests badge, the dashboard card and the grouped
  // "waiting for you" notice (task/meeting requests, event requests and volunteer applications).
  const waiting = useReviewWaiting();
  const reviewTotal = reviewer ? (waiting.data?.total ?? 0) : 0;
  const { tab: requested } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const view = resolveRequestView(requested, reviewer, nc, reviewTotal);
  // Opening Requests marks the task and meeting request notices read (the menu badge).
  useMarkNoticesRead(REQUEST_NOTICES, "requests", !follower);
  useMarkNoticesRead(REVIEW_NOTICES, "review", reviewer && view === "review");
  // A decision here changes what waits (menu badges, dashboard card).
  const qc = useQueryClient();
  const listsChanged = `${pending.data?.total ?? 0}:${workPending.data ?? 0}`;
  useEffect(() => {
    void qc.invalidateQueries({ queryKey: [REVIEW_WAITING_KEY] });
  }, [listsChanged, qc]);
  const selectView = (tab: string) => {
    if (tab === "review" || tab === "mine" || tab === "decided")
      void navigate({ to: "/requests", search: { tab }, replace: true, resetScroll: false });
  };
  const [choosing, setChoosing] = useState(false),
    [form, setForm] = useState<"event" | "volunteer" | "task" | "meeting" | null>(null),
    [filter, setFilter] = useState<RequestListFilter>("all");
  function mineList() {
    return (
      <>
        <div
          role="group"
          aria-label={t("requests.filterLabel")}
          className="flex flex-wrap gap-2 border-b pb-3"
        >
          {REQUEST_LIST_FILTERS.map((value) => (
            <Button
              key={value}
              data-testid={`my-requests-filter-${value}`}
              variant={filter === value ? "default" : "outline"}
              aria-pressed={filter === value}
              onClick={() => setFilter(value)}
            >
              {t(`requests.filters.${value}`)}
            </Button>
          ))}
        </div>
        {!follower && !director && <MyEventRequests filter={filter} />}
        {!follower && <MyWorkRequests filter={filter} showEmpty={director} />}
        <MyVolunteerApplications />
      </>
    );
  }
  return (
    <div data-testid="my-requests-page" className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="flex items-center gap-3 text-3xl font-bold">
          <Inbox className="size-7 text-primary" aria-hidden />
          {t("navigation.requests")}
        </h1>
        {!nc && (
          <Button data-testid="my-requests-new" className="h-11" onClick={() => setChoosing(true)}>
            <Plus />
            {t("requests.newRequest")}
          </Button>
        )}
      </header>
      {reviewer && !requested && waiting.data === undefined ? (
        // The default tab depends on what waits: decide once the count is known (no flash of another tab).
        <p data-testid="requests-loading" className="text-muted-foreground">
          {t("common.loading")}
        </p>
      ) : reviewer ? (
        <Tabs value={view} onValueChange={selectView} className="min-w-0 space-y-5">
          <TabsList
            aria-label={t("navigation.requests")}
            className="h-auto w-full justify-start gap-1 sm:w-auto"
          >
            <TabsTrigger
              value="review"
              data-testid="requests-tab-review"
              className="min-h-11 flex-1 gap-2 px-2 sm:px-3"
            >
              <span data-testid="manager-requests-tab-pending">{t("requests.toReview")}</span>
              <Badge variant="secondary" data-testid="manager-requests-tab-review">
                {reviewTotal}
              </Badge>
            </TabsTrigger>
            {!nc && (
              <TabsTrigger
                value="mine"
                data-testid="requests-tab-mine"
                className="min-h-11 flex-1 px-2 sm:px-3"
              >
                {t("requests.myTitle")}
              </TabsTrigger>
            )}
            <TabsTrigger
              value="decided"
              data-testid="requests-tab-decided"
              className="min-h-11 flex-1 px-2 sm:px-3"
            >
              <span data-testid="manager-requests-tab-decided">{t("requests.tabs.decided")}</span>
            </TabsTrigger>
          </TabsList>
          <TabsContent value="review" className="space-y-6">
            {isManager && (
              <>
                <ReviewVolunteerApplications filter="open" />
                <ManagerEventRequests group="review" />
              </>
            )}
            <ReviewWorkRequests filter="open" showEmpty={nc} />
          </TabsContent>
          {!nc && <TabsContent value="mine">{mineList()}</TabsContent>}
          <TabsContent value="decided" className="space-y-6">
            {isManager && (
              <>
                <ReviewVolunteerApplications filter="decided" />
                <ManagerEventRequests group="decided" />
              </>
            )}
            <ReviewWorkRequests filter="decided" showEmpty={nc} />
          </TabsContent>
        </Tabs>
      ) : (
        mineList()
      )}
      <EventDialog
        open={choosing}
        onClose={() => setChoosing(false)}
        title={t("requests.newRequest")}
      >
        <ul className="grid gap-3 sm:grid-cols-2">
          {REQUEST_KINDS.map((kind) => {
            const work = kind.id === "task" || kind.id === "meeting";
            const hasTargets = (targets.data?.length ?? 0) > 0;
            const available =
              kind.id === "volunteer"
                ? follower && !hasOpenApplication
                : kind.enabled &&
                  !follower &&
                  !nc &&
                  (work ? hasTargets : kind.id !== "event" || canRequestEvents);
            const hint =
              kind.id === "volunteer"
                ? follower
                  ? "applications.alreadyOpen"
                  : "applications.onlyFollowers"
                : follower
                  ? "applications.followersApply"
                  : !work
                    ? "requests.errors.directorsCreate"
                    : targets.isLoading
                      ? "common.loading"
                      : "workRequests.noTargets";
            const Icon = kind.icon;
            return (
              <li key={kind.id}>
                <Button
                  variant="outline"
                  data-testid={`request-type-card-${kind.id}`}
                  aria-disabled={!available}
                  onClick={() => {
                    if (!available) return;
                    setChoosing(false);
                    setForm(kind.id);
                  }}
                  className="flex h-auto min-h-28 w-full flex-col items-start gap-2 whitespace-normal rounded-lg bg-card p-4 text-left aria-disabled:cursor-not-allowed aria-disabled:opacity-60"
                >
                  <Icon className="size-6 text-primary" aria-hidden />
                  <span className="font-semibold">{t(`requests.kinds.${kind.id}`)}</span>
                  {!available && (
                    <span
                      data-testid={`request-type-card-${kind.id}-hint`}
                      className="text-xs text-muted-foreground"
                    >
                      {t(kind.enabled ? hint : "requests.comingSoon")}
                    </span>
                  )}
                </Button>
              </li>
            );
          })}
        </ul>
      </EventDialog>
      {form === "volunteer" && (
        <VolunteerApplicationForm onClose={() => setForm(null)} onSaved={() => setForm(null)} />
      )}
      {form === "task" && (
        <TaskRequestForm
          onClose={() => setForm(null)}
          onSaved={() => {
            setForm(null);
            setFilter("all");
            selectView("mine");
          }}
        />
      )}
      {form === "meeting" && (
        <MeetingRequestForm
          onClose={() => setForm(null)}
          onSaved={() => {
            setForm(null);
            setFilter("all");
            selectView("mine");
          }}
        />
      )}
      {form === "event" && (
        <EventRequestForm
          onClose={() => setForm(null)}
          onSaved={() => {
            setForm(null);
            selectView("mine");
          }}
        />
      )}
    </div>
  );
}

import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Plus, Inbox } from "lucide-react";
import { pageHead } from "@/components/app/head";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { EventDialog } from "@/components/events/EventDialog";
import { EventRequestForm } from "@/components/requests/EventRequestForm";
import { useAuth } from "@/lib/auth";
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
  const { isManager, roles } = useAuth();
  const director = roles.includes("regional_director");
  const pending = usePendingRequestCount();
  const { tab: requested } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const view = resolveRequestView(requested, isManager, director, pending.data?.total ?? 0);
  const selectView = (tab: string) => {
    if (tab === "review" || tab === "mine" || tab === "decided")
      void navigate({ to: "/requests", search: { tab }, replace: true, resetScroll: false });
  };
  const [choosing, setChoosing] = useState(false),
    [form, setForm] = useState<"event" | null>(null),
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
        <MyEventRequests filter={filter} />
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
        <Button data-testid="my-requests-new" className="h-11" onClick={() => setChoosing(true)}>
          <Plus />
          {t("requests.newRequest")}
        </Button>
      </header>
      {isManager ? (
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
                {pending.data?.total ?? 0}
              </Badge>
            </TabsTrigger>
            {!director && (
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
          <TabsContent value="review">
            <ManagerEventRequests group="review" />
          </TabsContent>
          {!director && <TabsContent value="mine">{mineList()}</TabsContent>}
          <TabsContent value="decided">
            <ManagerEventRequests group="decided" />
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
        <ul className="grid gap-3 sm:grid-cols-3">
          {REQUEST_KINDS.map((kind) => {
            const available = kind.enabled && (kind.id !== "event" || canRequestEvents);
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
                    if (kind.id === "event") setForm("event");
                  }}
                  className="flex h-auto min-h-28 w-full flex-col items-start gap-2 whitespace-normal rounded-lg bg-card p-4 text-left aria-disabled:cursor-not-allowed aria-disabled:opacity-60"
                >
                  <Icon className="size-6 text-primary" aria-hidden />
                  <span className="font-semibold">{t(`requests.kinds.${kind.id}`)}</span>
                  {!kind.enabled ? (
                    <Badge variant="secondary">{t("requests.comingSoon")}</Badge>
                  ) : !available ? (
                    <span className="text-xs text-muted-foreground">
                      {t("requests.errors.directorsCreate")}
                    </span>
                  ) : null}
                </Button>
              </li>
            );
          })}
        </ul>
      </EventDialog>
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

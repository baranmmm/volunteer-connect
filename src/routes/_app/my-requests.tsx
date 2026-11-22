import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Plus, Send } from "lucide-react";
import { pageHead } from "@/components/app/head";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { EventDialog } from "@/components/events/EventDialog";
import { EventRequestForm } from "@/components/requests/EventRequestForm";
import { MyEventRequests } from "@/components/requests/MyEventRequests";
import {
  REQUEST_KINDS,
  REQUEST_LIST_FILTERS,
  type RequestListFilter,
} from "@/components/requests/request-kinds";
import { useCanRequestEvents } from "@/lib/use-event-requests";

export const Route = createFileRoute("/_app/my-requests")({
  ssr: false,
  head: () => pageHead("My requests", "Your requests to add or organise Dialogue Society events."),
  component: MyRequestsPage,
});

/** Every member's own requests. "New request" offers the request kinds; the list below shows all of them. */
function MyRequestsPage() {
  const { t } = useTranslation();
  const canRequestEvents = useCanRequestEvents();
  const [choosing, setChoosing] = useState(false),
    [form, setForm] = useState<"event" | null>(null),
    [filter, setFilter] = useState<RequestListFilter>("all");
  return (
    <div data-testid="my-requests-page" className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="flex items-center gap-3 text-3xl font-bold">
          <Send className="size-7 text-primary" aria-hidden />
          {t("requests.myTitle")}
        </h1>
        <Button data-testid="my-requests-new" className="h-11" onClick={() => setChoosing(true)}>
          <Plus />
          {t("requests.newRequest")}
        </Button>
      </header>
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
                <button
                  type="button"
                  data-testid={`request-type-card-${kind.id}`}
                  aria-disabled={!available}
                  onClick={() => {
                    if (!available) return;
                    setChoosing(false);
                    if (kind.id === "event") setForm("event");
                  }}
                  className="flex min-h-28 w-full flex-col items-start gap-2 rounded-lg border bg-card p-4 text-left transition-colors enabled:hover:border-primary focus-visible:ring-2 focus-visible:ring-ring aria-disabled:cursor-not-allowed aria-disabled:opacity-60"
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
                </button>
              </li>
            );
          })}
        </ul>
      </EventDialog>
      {form === "event" && (
        <EventRequestForm onClose={() => setForm(null)} onSaved={() => setForm(null)} />
      )}
    </div>
  );
}

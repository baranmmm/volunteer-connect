import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, ChevronUp, Plus } from "lucide-react";
import { pageHead } from "@/components/app/head";
import { Button } from "@/components/ui/button";
import { MeetingCard } from "@/components/meetings/MeetingCard";
import { MeetingFormDialog } from "@/components/meetings/MeetingFormDialog";
import { useAuth } from "@/lib/auth";
import { meetingTimeline, type Meeting } from "@/lib/meetings";
import { listMeetings } from "@/lib/meetings.functions";
import { cn } from "@/lib/utils";
import { useWorkScopes } from "@/components/work/use-work-scopes";

export const Route = createFileRoute("/_app/meetings")({
  ssr: false,
  // The old ?tab=past link still opens the page (one timeline now, so the tab is ignored).
  validateSearch: (): Record<string, never> => ({}),
  head: () =>
    pageHead(
      "Meetings",
      "Dialogue Society meetings: agenda, decisions, files and follow-up tasks.",
    ),
  component: MeetingsPage,
});

function MeetingsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { scopes } = useWorkScopes();
  const [creating, setCreating] = useState(false);
  const canCreate = scopes.length > 0;
  return (
    <div className="min-w-0 space-y-6">
      <header className="flex min-w-0 flex-wrap items-center justify-between gap-3">
        <h1 className="text-3xl font-bold">{t("navigation.meetings")}</h1>
        {canCreate && (
          <Button data-testid="meetings-new" className="h-11" onClick={() => setCreating(true)}>
            <Plus />
            {t("meetings.new")}
          </Button>
        )}
      </header>
      <MeetingTimeline />
      <MeetingFormDialog
        open={creating}
        mode="create"
        onClose={() => setCreating(false)}
        onSaved={(id) => void navigate({ to: "/meetings/$id", params: { id } })}
      />
    </div>
  );
}

/** Past meetings: a quieter card (dashed border, muted background, no shadow). */
const FADED = "[&_a]:border-dashed [&_a]:bg-muted/40 [&_a]:shadow-none";

/**
 * One timeline, oldest at the top: older past meetings behind "Show earlier meetings", the two most recent past
 * meetings (faded), the next three upcoming meetings (prominent), then the later ones behind "Show more upcoming".
 */
function MeetingTimeline() {
  const { t } = useTranslation();
  const { session } = useAuth();
  const uid = session?.user.id;
  const fetch = useServerFn(listMeetings);
  const upcoming = useQuery({
    queryKey: ["meetings", uid, "upcoming"],
    queryFn: () => fetch({ data: { when: "upcoming" } }),
    enabled: !!uid,
  });
  const past = useQuery({
    queryKey: ["meetings", uid, "past"],
    queryFn: () => fetch({ data: { when: "past" } }),
    enabled: !!uid,
  });
  const [showEarlier, setShowEarlier] = useState(false);
  const [showLater, setShowLater] = useState(false);
  if (upcoming.isLoading || past.isLoading)
    return <p className="text-muted-foreground">{t("common.loading")}</p>;
  if (upcoming.isError || past.isError)
    return (
      <div role="alert" className="space-y-3">
        <p className="text-destructive">{t("meetings.loadError")}</p>
        <Button
          variant="outline"
          data-testid="meetings-retry"
          onClick={() => {
            void upcoming.refetch();
            void past.refetch();
          }}
        >
          {t("common.retry")}
        </Button>
      </div>
    );
  const line = meetingTimeline(upcoming.data ?? [], past.data ?? []);
  const total = line.earlier.length + line.recent.length + line.next.length + line.later.length;
  if (!total)
    return (
      <p
        data-testid="meetings-empty"
        className="rounded-lg border border-dashed p-6 text-center text-muted-foreground"
      >
        {t("meetings.empty")}
      </p>
    );
  const items = (list: Meeting[], part: string, className?: string) =>
    list.map((m) => (
      <li key={m.id} className={cn("min-w-0", className)} data-part={part}>
        <MeetingCard meeting={m} />
      </li>
    ));
  return (
    <div className="min-w-0 space-y-3" data-testid="meetings-timeline">
      {line.earlier.length > 0 && (
        <Button
          variant="ghost"
          className="h-11"
          data-testid="meetings-show-earlier"
          aria-expanded={showEarlier}
          aria-controls="meetings-earlier"
          data-count={line.earlier.length}
          onClick={() => setShowEarlier((v) => !v)}
        >
          {showEarlier ? <ChevronUp /> : <ChevronDown />}
          {showEarlier
            ? t("meetings.timeline.hideEarlier")
            : t("meetings.timeline.showEarlier", { count: line.earlier.length })}
        </Button>
      )}
      <ol className="grid min-w-0 grid-cols-1 gap-3" data-testid="meetings-list">
        {showEarlier && (
          <li id="meetings-earlier" className="min-w-0" data-testid="meetings-earlier">
            <ol className={cn("grid min-w-0 grid-cols-1 gap-3", FADED)}>
              {items(line.earlier, "earlier")}
            </ol>
          </li>
        )}
        {line.recent.length > 0 && (
          <li className="min-w-0" data-testid="meetings-recent">
            <h2 className="mb-2 text-sm font-semibold text-muted-foreground">
              {t("meetings.timeline.recent")}
            </h2>
            {/* Faded: these are over. No opacity (it would take the muted text below 4.5:1 contrast). */}
            <ol className={cn("grid min-w-0 grid-cols-1 gap-3", FADED)}>
              {items(line.recent, "recent")}
            </ol>
          </li>
        )}
        <li className="min-w-0" data-testid="meetings-next">
          <h2 className="mb-2 text-lg font-semibold">{t("meetings.timeline.next")}</h2>
          {line.next.length === 0 ? (
            <p
              data-testid="meetings-empty-upcoming"
              className="rounded-lg border border-dashed p-4 text-center text-muted-foreground"
            >
              {t("meetings.emptyUpcoming")}
            </p>
          ) : (
            <ol className="grid min-w-0 grid-cols-1 gap-3 [&_a]:shadow-soft [&_a]:ring-1 [&_a]:ring-primary/30">
              {items(line.next, "next")}
            </ol>
          )}
        </li>
        {showLater && (
          <li id="meetings-later" className="min-w-0" data-testid="meetings-later">
            <ol className="grid min-w-0 grid-cols-1 gap-3">{items(line.later, "later")}</ol>
          </li>
        )}
      </ol>
      {line.later.length > 0 && (
        <Button
          variant="ghost"
          className="h-11"
          data-testid="meetings-show-later"
          aria-expanded={showLater}
          aria-controls="meetings-later"
          data-count={line.later.length}
          onClick={() => setShowLater((v) => !v)}
        >
          {showLater ? <ChevronUp /> : <ChevronDown />}
          {showLater
            ? t("meetings.timeline.hideLater")
            : t("meetings.timeline.showLater", { count: line.later.length })}
        </Button>
      )}
    </div>
  );
}

import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useTranslation } from "react-i18next";
import { Bell, Inbox, X } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { dismissEventRequestNotice, myEventRequests } from "@/lib/event-requests.functions";
import { useReviewWaiting } from "@/lib/use-work-notices";
import { branchList } from "@/lib/notification-text";
import { translateError } from "@/lib/i18n";
import { Button } from "@/components/ui/button";

/**
 * Dashboard, at the top: what waits for my decision (task/meeting requests, event requests, volunteer applications),
 * with a link to Requests > To review. Hidden when nothing waits. Replaces the former "Pending requests" card.
 */
export function WaitingForYouCard() {
  const { t } = useTranslation();
  const waiting = useReviewWaiting();
  const w = waiting.data;
  if (!w || w.total === 0) return null;
  const parts = [
    { key: "work", count: w.work },
    { key: "eventRequests", count: w.event_requests },
    { key: "applications", count: w.applications },
  ].filter((p) => p.count > 0);
  return (
    <section
      data-testid="dashboard-waiting"
      aria-labelledby="dashboard-waiting-title"
      className="rounded-2xl border border-primary/40 bg-primary/5 p-6 shadow-soft lg:col-span-2"
    >
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3">
          <span className="rounded-xl bg-secondary p-2.5 text-primary">
            <Inbox className="h-5 w-5" aria-hidden />
          </span>
          <div className="min-w-0 space-y-1">
            <h2 id="dashboard-waiting-title" className="text-xl font-semibold">
              {t("dashboard.waiting.title")}
            </h2>
            <p
              data-testid="dashboard-waiting-count"
              data-count={w.total}
              className="font-medium [overflow-wrap:anywhere]"
            >
              {t("dashboard.waiting.total", { count: w.total })}
            </p>
            {parts.length > 0 && (
              <p className="text-sm text-muted-foreground">
                {parts.map((p) => t(`dashboard.waiting.${p.key}`, { count: p.count })).join(" · ")}
              </p>
            )}
            {w.branches.length > 0 && (
              <p className="text-sm text-muted-foreground [overflow-wrap:anywhere]">
                {t("dashboard.waiting.branches", { branches: branchList(w.branches) })}
              </p>
            )}
          </div>
        </div>
        <Button asChild className="h-11">
          <Link to="/requests" search={{ tab: "review" }} data-testid="dashboard-waiting-link">
            {t("dashboard.waiting.link")}
          </Link>
        </Button>
      </div>
    </section>
  );
}

/** Status changes of the viewer's own requests (under review / approved / declined) until dismissed. */
export function RequestNotices() {
  const { t } = useTranslation();
  const { session, profile, roles } = useAuth();
  const fetch = useServerFn(myEventRequests),
    dismiss = useServerFn(dismissEventRequestNotice),
    qc = useQueryClient();
  const query = useQuery({
    queryKey: ["my-event-requests", session?.user.id],
    queryFn: () => fetch(),
    enabled: profile?.status === "active" && !roles.includes("regional_director"),
    staleTime: 30000,
    refetchInterval: 240000,
  });
  const [error, setError] = useState("");
  const notices = (query.data ?? []).filter((r) => r.notice);
  if (!notices.length) return null;
  async function close(id: string) {
    setError("");
    try {
      await dismiss({ data: { id } });
      await qc.invalidateQueries({ queryKey: ["my-event-requests"] });
    } catch (e) {
      setError(translateError(e));
    }
  }
  return (
    <section aria-label={t("requests.noticesTitle")} className="space-y-2 lg:col-span-2">
      {notices.map((r) => (
        <div
          key={r.id}
          data-testid={`dashboard-request-notice-${r.id}`}
          data-notice={r.notice}
          role="status"
          className="flex items-start gap-3 rounded-xl border border-primary/30 bg-primary/5 p-4"
        >
          <Bell className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden />
          <div className="min-w-0 flex-1 break-words">
            <p>{t(`requests.notice.${r.notice}`, { title: r.title })}</p>
            {r.notice === "declined" && r.decline_reason && (
              <p className="mt-1 text-sm text-muted-foreground">
                {t("requests.declinedBecause", { reason: r.decline_reason })}
              </p>
            )}
            <Link
              to="/requests"
              search={{ tab: "mine" }}
              className="mt-1 inline-block text-sm font-medium text-primary underline-offset-4 hover:underline"
            >
              {t("requests.viewRequests")}
            </Link>
          </div>
          <Button
            data-testid={`dashboard-request-notice-dismiss-${r.id}`}
            variant="ghost"
            size="icon"
            aria-label={t("requests.dismiss")}
            title={t("requests.dismiss")}
            onClick={() => void close(r.id)}
          >
            <X />
          </Button>
        </div>
      ))}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </section>
  );
}

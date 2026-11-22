import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useTranslation } from "react-i18next";
import { Bell, Inbox, X } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { dismissEventRequestNotice, myEventRequests } from "@/lib/event-requests.functions";
import { usePendingRequestCount } from "@/lib/use-event-requests";
import { translateError } from "@/lib/i18n";
import { Button } from "@/components/ui/button";

export function PendingRequestsCard() {
  const { t } = useTranslation();
  const count = usePendingRequestCount();
  const total = count.data?.total ?? 0;
  return (
    <section
      data-testid="dashboard-pending-requests"
      data-count={count.data ? total : undefined}
      aria-labelledby="dashboard-pending-requests-title"
      className="rounded-2xl border bg-card p-6 shadow-soft"
    >
      <div className="flex items-center gap-3">
        <span className="rounded-xl bg-secondary p-2.5 text-primary">
          <Inbox className="h-5 w-5" aria-hidden />
        </span>
        <h2 id="dashboard-pending-requests-title" className="text-xl font-semibold">
          {t("requests.pendingTitle", { count: total })}
        </h2>
      </div>
      {count.isLoading ? (
        <p className="mt-6 text-muted-foreground">{t("common.loading")}</p>
      ) : count.isError ? (
        <p role="alert" className="mt-6 text-destructive">
          {t("requests.loadError")}
        </p>
      ) : (
        <>
          <p className="mt-5 text-muted-foreground">
            {total
              ? t("requests.pendingText", {
                  submitted: count.data?.submitted ?? 0,
                  review: count.data?.under_review ?? 0,
                })
              : t("requests.pendingNone")}
          </p>
          <Button asChild variant="outline" className="mt-4">
            <Link to="/requests" data-testid="dashboard-pending-requests-link">
              {t("requests.review")}
            </Link>
          </Button>
        </>
      )}
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

import { Link } from "@tanstack/react-router";
import { Users } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { useDashboardWork } from "@/lib/use-dashboard-work";
import { MeetingCard } from "./MeetingCard";

/** Dashboard card: the next three meetings the user can see (the database decides which). */
export function UpcomingMeetingsCard() {
  const { t } = useTranslation();
  const query = useDashboardWork();
  const meetings = query.data?.meetings ?? [];
  const failed = query.isError || query.data?.meetings === null;
  return (
    <section
      data-testid="dashboard-upcoming-meetings"
      aria-labelledby="dashboard-upcoming-meetings-title"
      className="min-w-0 rounded-2xl border bg-card p-6 shadow-soft"
    >
      <div className="flex min-w-0 items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="rounded-xl bg-secondary p-2.5 text-primary">
            <Users className="h-5 w-5" aria-hidden />
          </span>
          <h2 id="dashboard-upcoming-meetings-title" className="min-w-0 text-xl font-semibold">
            {t("meetings.dashboard.title")}
          </h2>
        </div>
        <Link
          data-testid="dashboard-upcoming-meetings-link"
          to="/meetings"
          className="shrink-0 text-sm font-medium text-primary underline-offset-4 hover:underline"
        >
          {t("meetings.dashboard.viewAll")}
        </Link>
      </div>
      {query.isLoading ? (
        <p className="mt-6 text-muted-foreground">{t("common.loading")}</p>
      ) : failed ? (
        <div role="alert" className="mt-6 space-y-3">
          <p className="text-destructive">{t("meetings.loadError")}</p>
          <Button
            variant="outline"
            data-testid="dashboard-upcoming-meetings-retry"
            onClick={() => void query.refetch()}
          >
            {t("common.retry")}
          </Button>
        </div>
      ) : meetings.length === 0 ? (
        <p data-testid="dashboard-upcoming-meetings-empty" className="mt-6 text-muted-foreground">
          {t("meetings.dashboard.empty")}
        </p>
      ) : (
        <ul className="mt-5 grid min-w-0 grid-cols-1 gap-2">
          {meetings.map((m) => (
            <li key={m.id} className="min-w-0">
              <MeetingCard meeting={m} testId="dashboard-upcoming-meeting-item" compact />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

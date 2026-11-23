import { Link } from "@tanstack/react-router";
import { CalendarDays, MailOpen, MapPin, Repeat, Video } from "lucide-react";
import { useTranslation } from "react-i18next";
import { BranchName } from "@/components/app/BranchName";
import { Badge } from "@/components/ui/badge";
import { cancelledTitle } from "@/components/events/event-status-styles";
import { cn } from "@/lib/utils";
import type { Meeting } from "@/lib/meetings";
import { MeetingStatusBadge } from "./MeetingStatusBadge";
import { meetingWhen } from "./meeting-ui";

/** Scope text of a meeting: "National", or the region/branch name (one line, cut with a tooltip). */
export function MeetingScope({ meeting, className }: { meeting: Meeting; className?: string }) {
  const { t } = useTranslation();
  if (meeting.scope === "national")
    return <span className={className}>{t("work.scope.national")}</span>;
  const name = (meeting.scope === "branch" ? meeting.branch : meeting.region) ?? "—";
  return <BranchName name={name} {...(className ? { className } : {})} />;
}

/** One meeting in a list. Online meetings only say "Online": the link is shown on the detail page only. */
export function MeetingCard({
  meeting,
  testId = "meeting-card",
  compact = false,
}: {
  meeting: Meeting;
  testId?: string;
  compact?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <Link
      to="/meetings/$id"
      params={{ id: meeting.id }}
      data-testid={testId}
      data-meeting-id={meeting.id}
      data-status={meeting.status}
      className={cn(
        "block min-w-0 rounded-lg border bg-card p-3 transition-colors hover:border-primary focus-visible:ring-2 focus-visible:ring-ring sm:p-4",
        meeting.status === "cancelled"
          ? "border-l-4 border-l-status-cancelled"
          : meeting.status === "completed"
            ? "border-l-4 border-l-status-live"
            : "border-l-4 border-l-status-published",
      )}
    >
      <p className="flex min-w-0 items-center gap-1.5 text-sm text-muted-foreground">
        <CalendarDays className="size-4 shrink-0" aria-hidden />
        <span className="min-w-0 [overflow-wrap:anywhere]">{meetingWhen(meeting)}</span>
      </p>
      <p
        className={cn("mt-0.5 truncate font-semibold", cancelledTitle(meeting.status))}
        title={meeting.title}
        data-testid={`${testId}-title`}
      >
        {meeting.title}
      </p>
      <div className="mt-1.5 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5 text-sm text-muted-foreground">
        {meeting.location_type === "online" ? (
          <span className="inline-flex shrink-0 items-center gap-1">
            <Video className="size-4" aria-hidden />
            {t("meetings.place.online")}
          </span>
        ) : (
          meeting.location && (
            <span className="inline-flex min-w-0 max-w-full items-center gap-1">
              <MapPin className="size-4 shrink-0" aria-hidden />
              <span className="min-w-0 truncate" title={meeting.location}>
                {meeting.location}
              </span>
            </span>
          )
        )}
        <MeetingStatusBadge status={meeting.status} testId={`${testId}-status`} />
        {meeting.series_id && (
          <span
            data-testid="meeting-card-recurring"
            className="inline-flex shrink-0 items-center gap-1"
            title={t("meetings.series.recurring")}
          >
            <Repeat className="size-4" aria-hidden />
            <span className={compact ? "sr-only" : undefined}>
              {meeting.series_position && meeting.series_count
                ? t("meetings.series.position", {
                    n: meeting.series_position,
                    total: meeting.series_count,
                  })
                : t("meetings.series.recurring")}
            </span>
          </span>
        )}
        {meeting.invited && (
          <Badge variant="secondary" data-testid={`${testId}-invited`} className="shrink-0 gap-1">
            <MailOpen className="size-3.5" aria-hidden />
            {t("meetings.invited")}
          </Badge>
        )}
        {!compact && (
          <span className="flex min-w-0 max-w-full" data-testid={`${testId}-scope`}>
            <MeetingScope meeting={meeting} />
          </span>
        )}
      </div>
    </Link>
  );
}

import { Ban, CalendarClock, CircleCheck } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { MeetingStatus } from "@/lib/meetings";

const STYLE: Record<MeetingStatus, string> = {
  scheduled: "border-status-published bg-status-published-bg text-status-published",
  completed: "border-status-live bg-status-live-bg text-status-live",
  cancelled: "border-status-cancelled bg-status-cancelled-bg text-status-cancelled",
};
const ICON = { scheduled: CalendarClock, completed: CircleCheck, cancelled: Ban } as const;

/** The written meeting status (never colour alone). */
export function MeetingStatusBadge({
  status,
  testId = "meeting-status-badge",
  className,
}: {
  status: MeetingStatus;
  testId?: string;
  className?: string;
}) {
  const { t } = useTranslation();
  const Icon = ICON[status];
  return (
    <Badge
      variant="outline"
      data-testid={testId}
      data-status={status}
      className={cn("shrink-0 gap-1 font-medium", STYLE[status], className)}
    >
      <Icon className="size-3.5" aria-hidden />
      {t(`meetings.status.${status}`)}
    </Badge>
  );
}

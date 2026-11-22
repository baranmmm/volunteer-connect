import { useTranslation } from "react-i18next";
import { Ban, CircleCheck, Clock, Search, Undo2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { RequestStatus } from "@/lib/event-requests";

// Same --status-* tokens as event statuses: submitted ~ draft, under review ~ live, approved ~ published,
// declined ~ cancelled; withdrawn is neutral.
const STYLE: Record<RequestStatus, string> = {
  submitted: "border-dashed border-status-draft-border bg-status-draft-bg text-status-draft",
  under_review: "border-status-live bg-status-live-bg text-status-live",
  approved: "border-status-published bg-status-published-bg text-status-published",
  declined: "border-status-cancelled bg-status-cancelled-bg text-status-cancelled",
  withdrawn: "border-border bg-muted text-muted-foreground",
};
const ICON = {
  submitted: Clock,
  under_review: Search,
  approved: CircleCheck,
  declined: Ban,
  withdrawn: Undo2,
} as const;

/** Written status label with icon (never colour alone). */
export function RequestStatusBadge({
  status,
  testId,
  className,
}: {
  status: RequestStatus;
  testId?: string;
  className?: string;
}) {
  const { t } = useTranslation();
  const Icon = ICON[status];
  return (
    <Badge
      data-testid={testId}
      data-status={status}
      variant="outline"
      className={cn("gap-1", STYLE[status], className)}
    >
      <Icon className="size-3.5 shrink-0" aria-hidden />
      {t(`requests.status.${status}`)}
    </Badge>
  );
}

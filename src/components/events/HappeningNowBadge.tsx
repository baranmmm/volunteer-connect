import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import { eventTimeState } from "@/lib/event-rules";
import type { HubEvent } from "@/lib/event-rules";
import { STATUS_ICON } from "./event-status-styles";

export function HappeningNowBadge({
  event,
  now,
  compact = false,
}: {
  event: HubEvent;
  now: Date;
  compact?: boolean;
}) {
  const { t } = useTranslation();
  if (event.status !== "published" || !eventTimeState(event, now).happeningNow) return null;
  const Icon = STATUS_ICON.live;
  return (
    <Badge
      data-testid="event-badge-happening-now"
      variant="outline"
      className={`gap-1 border-status-live bg-status-live-bg text-status-live ${compact ? "max-w-full px-1 py-0.5 text-[11px] leading-tight @min-[6rem]:px-1.5" : ""}`}
    >
      <Icon className={`shrink-0 ${compact ? "size-3" : "size-3.5"}`} aria-hidden />
      {compact ? (
        <span className="sr-only @min-[6rem]:not-sr-only">{t("events.happeningNow")}</span>
      ) : (
        t("events.happeningNow")
      )}
    </Badge>
  );
}

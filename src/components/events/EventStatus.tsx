import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { EventDisplayStatus } from "@/lib/event-status";
import {
  LEGEND_SWATCH,
  STATUS_BADGE,
  STATUS_ICON,
  STATUS_TEXT,
  storedStatus,
} from "./event-status-styles";

/**
 * The written status label (never colour alone). `compact` (month grid, an @container) shows the icon plus the
 * label when the entry is at least 6rem wide and the icon with a screen-reader label below that (phones);
 * published is always icon-only there, because every grid entry is published unless marked otherwise.
 */
export function EventStatusBadge({
  status,
  compact = false,
  className,
}: {
  status: string;
  compact?: boolean;
  className?: string;
}) {
  const { t } = useTranslation();
  const value = storedStatus(status);
  const Icon = STATUS_ICON[value];
  const label = t(`events.${value}`);
  if (compact && value === "published") {
    return (
      <span
        data-testid="event-status-badge"
        data-status={value}
        title={label}
        className="inline-flex text-status-published"
      >
        <Icon className="size-3.5" aria-hidden />
        <span className="sr-only">{label}</span>
      </span>
    );
  }
  return (
    <Badge
      data-testid="event-status-badge"
      data-status={value}
      variant="outline"
      className={cn(
        "gap-1",
        STATUS_BADGE[value],
        compact && "max-w-full px-1 py-0.5 text-[11px] leading-tight @min-[6rem]:px-1.5",
        className,
      )}
    >
      <Icon className={cn("shrink-0", compact ? "size-3" : "size-3.5")} aria-hidden />
      {compact ? <span className="sr-only @min-[6rem]:not-sr-only">{label}</span> : label}
    </Badge>
  );
}

/** Shown under the calendar. Volunteers never see drafts, so the draft entry is for managers only. */
export function CalendarLegend({ showDraft }: { showDraft: boolean }) {
  const { t } = useTranslation();
  const items: { status: EventDisplayStatus; label: string }[] = [
    { status: "published", label: t("events.published") },
    { status: "live", label: t("events.happeningNow") },
    { status: "cancelled", label: t("events.cancelled") },
    ...(showDraft ? [{ status: "draft" as const, label: t("events.draft") }] : []),
  ];
  return (
    <section
      data-testid="calendar-legend"
      aria-label={t("events.legend")}
      className="border-t pt-4"
    >
      <h2 className="mb-2 text-sm font-semibold">{t("events.legend")}</h2>
      <ul className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
        {items.map(({ status, label }) => {
          const Icon = STATUS_ICON[status];
          return (
            <li
              key={status}
              data-testid="calendar-legend-item"
              data-status={status}
              className="flex items-center gap-2"
            >
              <span
                aria-hidden
                className={cn("inline-block h-4 w-6 rounded-sm", LEGEND_SWATCH[status])}
              />
              <Icon aria-hidden className={cn("size-4", STATUS_TEXT[status])} />
              <span>{label}</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

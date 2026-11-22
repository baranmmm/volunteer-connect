import type { TFunction } from "i18next";
import { formatDate } from "@/lib/i18n";
import type { HubEvent } from "@/lib/event-rules";

/** "12 Dec 2026 · 18:30", or the date range plus "All day"; London time. */
export function eventDateText(event: HubEvent, t: TFunction) {
  if (event.all_day && event.start_date) {
    const range =
      event.end_date && event.end_date !== event.start_date
        ? ` – ${formatDate(`${event.end_date}T12:00:00Z`, { dateStyle: "medium" })}`
        : "";
    return `${formatDate(`${event.start_date}T12:00:00Z`, { dateStyle: "medium" })}${range} · ${t("events.allDay")}`;
  }
  return event.start_at
    ? `${formatDate(event.start_at, { dateStyle: "medium" })} · ${formatDate(event.start_at, { timeStyle: "short" })}`
    : t("events.unscheduled");
}

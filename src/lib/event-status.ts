import { eventStart, eventTimeState, isScheduled, londonDate } from "@/lib/event-rules";
import type { HubEvent } from "@/lib/event-rules";

/** What the UI shows. `live` is a published event that is happening now. */
export type EventDisplayStatus = "draft" | "published" | "cancelled" | "live";
type StatusEvent = Pick<
  HubEvent,
  "status" | "start_at" | "end_at" | "all_day" | "start_date" | "end_date"
>;

export function eventDisplayStatus(event: StatusEvent, now = new Date()): EventDisplayStatus {
  if (event.status === "draft") return "draft";
  if (event.status === "cancelled") return "cancelled";
  return eventTimeState(event, now).happeningNow ? "live" : "published";
}

export const DASHBOARD_LIMIT = 5;
export const CANCELLED_WINDOW_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** Start as a sortable instant; all-day dates sort at the start of their day, as in the calendar list. */
function startMs(event: StatusEvent) {
  const start = eventStart(event);
  if (!start) return Number.POSITIVE_INFINITY;
  return DATE_ONLY.test(start) ? Date.parse(`${start}T00:00:00Z`) : Date.parse(start);
}

/** Cancelled events stay on the dashboard only when they start within the next 7 days (or are still running). */
function cancelledInWindow(event: StatusEvent, now: Date) {
  const start = eventStart(event);
  if (!start) return false;
  const limit = new Date(now.getTime() + CANCELLED_WINDOW_DAYS * DAY_MS);
  if (DATE_ONLY.test(start)) return londonDate(start) <= londonDate(limit);
  return Date.parse(start) <= limit.getTime();
}

/**
 * Dashboard "Upcoming events": the nearest published events the user can see (RLS already filters what is
 * returned), plus cancelled ones within the next 7 days. Events happening now come first, then by start.
 */
export function upcomingDashboardEvents<T extends StatusEvent & { id: string }>(
  events: T[],
  now = new Date(),
  limit = DASHBOARD_LIMIT,
): T[] {
  return events
    .filter(
      (e) =>
        isScheduled(e) &&
        !eventTimeState(e, now).past &&
        (e.status === "published" || (e.status === "cancelled" && cancelledInWindow(e, now))),
    )
    .map((e) => ({ e, live: eventTimeState(e, now).happeningNow, start: startMs(e) }))
    .sort(
      (a, b) =>
        Number(b.live) - Number(a.live) || a.start - b.start || a.e.id.localeCompare(b.e.id),
    )
    .slice(0, limit)
    .map((x) => x.e);
}

/** Dashboard "Your drafts": drafts the user created, newest first. */
export function ownDrafts<
  T extends { id: string; status: string; created_by: string | null; created_at: string },
>(events: T[], userId: string | undefined, limit = DASHBOARD_LIMIT): T[] {
  if (!userId) return [];
  return events
    .filter((e) => e.status === "draft" && e.created_by === userId)
    .sort((a, b) => b.created_at.localeCompare(a.created_at) || a.id.localeCompare(b.id))
    .slice(0, limit);
}

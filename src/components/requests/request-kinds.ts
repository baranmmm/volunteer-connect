import { CalendarDays, HandHeart, ListChecks, Users2, type LucideIcon } from "lucide-react";
import { isOpenRequest, type RequestStatus } from "@/lib/event-requests";

/**
 * What a member can request from /my-requests. Only events exist today; tasks and meetings are listed as
 * "Coming soon" and will plug in here with their own form and list.
 */
/** volunteer: a follower's application to become a volunteer (the only kind available to followers). */
export type RequestKind = { id: "event" | "task" | "meeting" | "volunteer"; icon: LucideIcon; enabled: boolean };
export const REQUEST_KINDS: RequestKind[] = [
  { id: "event", icon: CalendarDays, enabled: true },
  { id: "task", icon: ListChecks, enabled: false },
  { id: "meeting", icon: Users2, enabled: false },
  { id: "volunteer", icon: HandHeart, enabled: true },
];

export const REQUEST_LIST_FILTERS = ["all", "open", "decided"] as const;
export type RequestListFilter = (typeof REQUEST_LIST_FILTERS)[number];
/** Open = submitted or under review; decided = approved, declined or withdrawn. */
export function matchesFilter(status: RequestStatus, filter: RequestListFilter) {
  return filter === "all" || (filter === "open") === isOpenRequest(status);
}

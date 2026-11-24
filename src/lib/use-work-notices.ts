import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useAuth } from "@/lib/auth";
import { isFollowerRoles } from "@/lib/roles";
import type { NotificationCounts } from "@/lib/notifications";
import {
  getNotificationCounts,
  getReviewWaiting,
  markNotificationsRead,
} from "@/lib/notifications.functions";
import { listRequestTargets, workRequestCount } from "@/lib/work-requests.functions";

/** Active members and National Coordinators (followers have no tasks, meetings or their requests). */
export function useWorkMember() {
  const { profile, roles } = useAuth();
  return profile?.status === "active" && !isFollowerRoles(roles);
}

/** Unread in-app notices by area (menu badges). */
export function useNotificationCounts() {
  const { session } = useAuth();
  const member = useWorkMember();
  const fetch = useServerFn(getNotificationCounts);
  return useQuery({
    queryKey: ["notification-counts", session?.user.id],
    queryFn: () => fetch(),
    enabled: member,
    staleTime: 30000,
    refetchInterval: 120000,
  });
}

/** Query key of the "waiting for your review" counts (Requests badge, mobile More badge, dashboard card). */
export const REVIEW_WAITING_KEY = "review-waiting";

/**
 * What waits for the signed-in person's decision: task/meeting requests, event requests and volunteer applications
 * (the database decides what each person reviews).
 */
export function useReviewWaiting() {
  const { session } = useAuth();
  const member = useWorkMember();
  const fetch = useServerFn(getReviewWaiting);
  return useQuery({
    queryKey: [REVIEW_WAITING_KEY, session?.user.id],
    queryFn: () => fetch(),
    enabled: member,
    staleTime: 15000,
    refetchInterval: 120000,
  });
}

/** Open task and meeting requests waiting for the signed-in person's decision (the "To review" tab count). */
export function useWorkRequestCount(enabled = true) {
  const { session } = useAuth();
  const member = useWorkMember();
  const fetch = useServerFn(workRequestCount);
  return useQuery({
    queryKey: ["work-request-count", session?.user.id],
    queryFn: () => fetch(),
    enabled: member && enabled,
    staleTime: 30000,
    refetchInterval: 120000,
  });
}

/** People the signed-in member may send a task or meeting request to (the database decides). */
export function useRequestTargets(enabled = true) {
  const { session } = useAuth();
  const member = useWorkMember();
  const fetch = useServerFn(listRequestTargets);
  return useQuery({
    queryKey: ["request-targets", session?.user.id],
    queryFn: () => fetch(),
    enabled: member && enabled,
    staleTime: 60000,
  });
}

type NoticeTarget = {
  entityType: "task" | "meeting" | "task_request" | "meeting_request" | "review";
  entityId?: string;
};

/**
 * "Opening an item marks its notices read": marks the notices about `targets` read, but only while the menu counts
 * show unread notices in `area`, and refreshes the counts only when something was marked. Nothing is sent when there
 * is nothing to mark (most page visits).
 */
export function useMarkNoticesRead(
  targets: NoticeTarget[],
  area: keyof NotificationCounts | "review",
  enabled = true,
) {
  const counts = useNotificationCounts();
  const waiting = useReviewWaiting();
  const qc = useQueryClient();
  const markRead = useServerFn(markNotificationsRead);
  // The grouped "waiting for you" notice is not in the area counts: it exists while something waits.
  const pending =
    enabled && (area === "review" ? (waiting.data?.total ?? 0) : (counts.data?.[area] ?? 0)) > 0;
  const key = JSON.stringify(targets);
  useEffect(() => {
    if (!pending) return;
    const list = JSON.parse(key) as NoticeTarget[];
    void Promise.all(list.map((target) => markRead({ data: target })))
      .then((results) =>
        results.some((r) => r.marked > 0)
          ? Promise.all(
              ["notification-counts", "dashboard-work"].map((k) =>
                qc.invalidateQueries({ queryKey: [k] }),
              ),
            )
          : undefined,
      )
      .catch(() => undefined);
  }, [pending, key, markRead, qc]);
}

/** Query keys refreshed after any task or meeting request change. */
export const WORK_REQUEST_KEYS = [
  "my-work-requests",
  "work-requests-review",
  "work-request-count",
  "notification-counts",
  REVIEW_WAITING_KEY,
  "dashboard-work",
] as const;

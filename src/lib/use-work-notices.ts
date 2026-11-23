import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useAuth } from "@/lib/auth";
import { isFollowerRoles } from "@/lib/roles";
import { getNotificationCounts } from "@/lib/notifications.functions";
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

/** Query keys refreshed after any task or meeting request change. */
export const WORK_REQUEST_KEYS = [
  "my-work-requests",
  "work-requests-review",
  "work-request-count",
  "notification-counts",
  "notifications",
] as const;

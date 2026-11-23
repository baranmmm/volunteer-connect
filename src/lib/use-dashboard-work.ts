import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useAuth } from "@/lib/auth";
import { getDashboardWork } from "@/lib/dashboard-work.functions";
import { useWorkMember } from "@/lib/use-work-notices";

/** Query key of the dashboard work cards; refresh it after marking notices read on the dashboard. */
export const DASHBOARD_WORK_KEY = "dashboard-work";

/**
 * Shared by the My tasks, Upcoming meetings and Notifications cards: one request for all three. It refetches each
 * time the dashboard mounts (no staleTime), so changes made on other pages show when the user comes back.
 */
export function useDashboardWork() {
  const { session } = useAuth();
  const member = useWorkMember();
  const fetch = useServerFn(getDashboardWork);
  return useQuery({
    queryKey: [DASHBOARD_WORK_KEY, session?.user.id],
    queryFn: () => fetch(),
    enabled: member,
    refetchInterval: 120000,
  });
}

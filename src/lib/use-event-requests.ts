import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useAuth } from "@/lib/auth";
import { pendingEventRequestCount } from "@/lib/event-requests.functions";

/** Volunteers (branch) and branch managers (region) may request events; regional directors create them directly. */
export function useCanRequestEvents() {
  const { roles, profile } = useAuth();
  return profile?.status === "active" && !roles.includes("regional_director");
}

/** Counts only: open requests the signed-in reviewer may see (menu badge and dashboard card share this query). */
export function usePendingRequestCount() {
  const { session, profile, isManager } = useAuth();
  const fetch = useServerFn(pendingEventRequestCount);
  return useQuery({
    queryKey: ["pending-event-requests", session?.user.id],
    queryFn: () => fetch(),
    enabled: isManager && profile?.status === "active",
    staleTime: 30000,
    refetchInterval: 120000,
  });
}

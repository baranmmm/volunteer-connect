import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { countPendingDeletionRequests, countPendingMembers } from "@/lib/members";
import { approvalWaitingTotal } from "@/lib/request-view";
import { useReviewWaiting, useWorkMember } from "@/lib/use-work-notices";

/**
 * Everything waiting for the signed-in person's approval: the shared review count (task/meeting requests, event
 * requests, volunteer applications) plus, for Branch Managers and Regional Directors, pending sign-ups and account
 * deletion requests. One number for the menu's Requests badge and the "Waiting for my approval" tab.
 *
 * The extra two are head-only counts (no rows). Their keys sit under the lists' prefixes (["members"],
 * ["deletion-requests"]), so approving, rejecting or processing an item there refreshes the badge too.
 */
export function useApprovalWaiting() {
  const { session, isManager } = useAuth();
  const uid = session?.user.id ?? "";
  const member = useWorkMember();
  const shared = useReviewWaiting();
  const managed = member && isManager && !!uid;
  const pending = useQuery({
    queryKey: ["members", "pending-count", uid],
    queryFn: () => countPendingMembers(uid),
    enabled: managed,
    staleTime: 15000,
    refetchInterval: 120000,
  });
  const deletions = useQuery({
    queryKey: ["deletion-requests", "count", uid],
    queryFn: () => countPendingDeletionRequests(uid),
    enabled: managed,
    staleTime: 15000,
    refetchInterval: 120000,
  });
  return {
    shared,
    total: approvalWaitingTotal({
      shared: shared.data?.total,
      pendingMembers: managed ? pending.data : 0,
      deletionRequests: managed ? deletions.data : 0,
    }),
    /** Every count has loaded (or failed): the Requests page waits for it to choose its first tab. */
    settled:
      (shared.data !== undefined || shared.isError) &&
      (!managed || (!pending.isPending && !deletions.isPending)),
  };
}

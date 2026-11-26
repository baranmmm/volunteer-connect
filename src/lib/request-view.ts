export type RequestView = "review" | "mine" | "decided";

/** Query key of the "waiting for your review" counts (Requests badge, mobile More badge, dashboard card). */
export const REVIEW_WAITING_KEY = "review-waiting";

export function requestViewSearch(search: Record<string, unknown>): { tab?: RequestView } {
  const tab = search["tab"];
  return tab === "review" || tab === "mine" || tab === "decided" ? { tab } : {};
}

/**
 * `isReviewer`: the page has the review/decided tabs (managers, National Coordinators). `reviewOnly`: no "mine" tab
 * (National Coordinators: nobody above them to ask).
 */
export function resolveRequestView(
  requested: RequestView | undefined,
  isReviewer: boolean,
  reviewOnly: boolean,
  pending: number,
): RequestView {
  if (!isReviewer) return "mine";
  if (requested && (requested !== "mine" || !reviewOnly)) return requested;
  if (pending > 0) return "review";
  return reviewOnly ? "decided" : "mine";
}

/**
 * "Waiting for my approval" (the Requests tab badge and the menu's Requests badge): the shared review count
 * (get_review_waiting: task/meeting requests, event requests and volunteer applications) plus, for Branch Managers and
 * Regional Directors, pending sign-ups and account deletion requests. Unknown (still loading) counts add nothing;
 * negative or fractional input never shows.
 */
export function approvalWaitingTotal(counts: {
  shared?: number | null | undefined;
  pendingMembers?: number | null | undefined;
  deletionRequests?: number | null | undefined;
}): number {
  const n = (value: number | null | undefined) =>
    typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
  return n(counts.shared) + n(counts.pendingMembers) + n(counts.deletionRequests);
}

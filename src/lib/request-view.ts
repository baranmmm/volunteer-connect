export type RequestView = "review" | "mine" | "decided";

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

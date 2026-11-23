export type RequestView = "review" | "mine" | "decided";

export function requestViewSearch(search: Record<string, unknown>): { tab?: RequestView } {
  const tab = search["tab"];
  return tab === "review" || tab === "mine" || tab === "decided" ? { tab } : {};
}

export function resolveRequestView(
  requested: RequestView | undefined,
  isManager: boolean,
  isDirector: boolean,
  pending: number,
): RequestView {
  if (!isManager) return "mine";
  if (requested && (requested !== "mine" || !isDirector)) return requested;
  if (pending > 0) return "review";
  return isDirector ? "decided" : "mine";
}

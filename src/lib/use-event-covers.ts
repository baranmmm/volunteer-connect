import { useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getEventCovers } from "@/lib/events.functions";
import { isScheduled, type HubEvent } from "@/lib/event-rules";

// Event card covers, signed only for the cards a page shows (listEvents signs nothing). Each cover is cached per
// event for as long as its link is fresh (links last 10 minutes; reused for 4), so switching views or coming back
// to the page signs nothing again; only covers not yet cached are asked for, in one batch.

export const COVER_FRESH = 4 * 60_000;
const BATCH = 100; // getEventCovers' input limit

/** Events whose card shows a cover: those with an image (series occurrences carry their holder's media rows). */
export function coverCandidates(events: Pick<HubEvent, "id" | "media">[]): string[] {
  return [
    ...new Set(events.filter((e) => e.media.some((m) => m.kind === "image")).map((e) => e.id)),
  ];
}

/** The Calendar's event cards: every listed event in List; in Month only the unscheduled section (the grid has none). */
export function cardEvents<E extends HubEvent>(view: "month" | "list", events: E[]): E[] {
  return view === "list" ? events : events.filter((e) => !isScheduled(e));
}

const coverKey = (uid: string | undefined, id: string) => ["event-cover", uid ?? null, id] as const;

/** Signed cover links by event id for the events shown (events without a cover are missing). */
export function useEventCovers(events: Pick<HubEvent, "id" | "media">[], uid: string | undefined) {
  const qc = useQueryClient();
  const fetchCovers = useServerFn(getEventCovers);
  const ids = useMemo(() => coverCandidates(events).sort(), [events]);
  const fresh = (id: string) => {
    const state = qc.getQueryState(coverKey(uid, id));
    return state?.status === "success" && Date.now() - state.dataUpdatedAt < COVER_FRESH;
  };
  const missing = ids.filter((id) => !fresh(id)).slice(0, BATCH);
  useQuery({
    queryKey: ["event-covers", uid ?? null, missing],
    enabled: missing.length > 0,
    staleTime: COVER_FRESH,
    gcTime: 0,
    queryFn: async () => {
      const urls = await fetchCovers({ data: { ids: missing } });
      // Kept by the cache's default gcTime (5 minutes), longer than COVER_FRESH.
      for (const id of missing) qc.setQueryData(coverKey(uid, id), urls[id] ?? null);
      return urls;
    },
  });
  // Read from the cache on every render (a few map lookups): the batch's query re-renders when its covers are stored
  // and then switches to an empty key, so a memo keyed on it would miss them.
  const covers = new Map<string, string>();
  for (const id of ids) {
    const url = qc.getQueryData<string | null>(coverKey(uid, id));
    if (url) covers.set(id, url);
  }
  return covers;
}

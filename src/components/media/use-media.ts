import { useEffect, useState } from "react";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  getMediaChapter,
  getMediaChapters,
  getMediaHome,
  getMediaPhotos,
  listMediaTargets,
  listMediaUploadRequests,
} from "@/lib/media.functions";
import type { ChapterKind, MediaSource } from "@/lib/media";

// Signed links last 10 minutes: data is refreshed well before that.
const FRESH = 4 * 60_000;
export const MEDIA_KEY = "media";

export type MediaFilters = { source: MediaSource; year: number | null; search: string };

export function useMediaHome(branchId: string | null) {
  const fetch = useServerFn(getMediaHome);
  return useQuery({
    queryKey: [MEDIA_KEY, "home", branchId],
    queryFn: () => fetch({ data: { branchId } }),
    staleTime: FRESH,
  });
}

export function useMediaChapters(branchId: string | undefined, filters: MediaFilters) {
  const fetch = useServerFn(getMediaChapters);
  return useInfiniteQuery({
    queryKey: [MEDIA_KEY, "chapters", branchId, filters],
    enabled: !!branchId,
    initialPageParam: null as { at: string; id: string } | null,
    queryFn: ({ pageParam }) =>
      fetch({
        data: {
          branchId: branchId!,
          source: filters.source,
          year: filters.year,
          search: filters.search || undefined,
          beforeAt: pageParam?.at ?? null,
          beforeId: pageParam?.id ?? null,
        },
      }),
    getNextPageParam: (last) => {
      const c = last.at(-1);
      return last.length === 6 && c?.sort_at ? { at: c.sort_at, id: c.id } : undefined;
    },
    staleTime: FRESH,
  });
}

export function useMediaPhotos(
  branchId: string | undefined,
  filters: Omit<MediaFilters, "search">,
) {
  const fetch = useServerFn(getMediaPhotos);
  return useInfiniteQuery({
    queryKey: [MEDIA_KEY, "photos", branchId, filters],
    enabled: !!branchId,
    initialPageParam: null as { at: string; id: string } | null,
    queryFn: ({ pageParam }) =>
      fetch({
        data: {
          branchId: branchId!,
          source: filters.source,
          year: filters.year,
          beforeAt: pageParam?.at ?? null,
          beforeId: pageParam?.id ?? null,
        },
      }),
    getNextPageParam: (last) => {
      const p = last.at(-1);
      return last.length === 60 && p ? { at: p.created_at, id: p.id } : undefined;
    },
    staleTime: FRESH,
  });
}

export function useMediaChapter(kind: ChapterKind | null, id: string | null) {
  const fetch = useServerFn(getMediaChapter);
  return useQuery({
    queryKey: [MEDIA_KEY, "chapter", kind, id],
    enabled: !!kind && !!id,
    queryFn: () => fetch({ data: { kind: kind!, id: id! } }),
    staleTime: FRESH,
  });
}

export function useMediaTargets(branchId: string | undefined, enabled = true) {
  const fetch = useServerFn(listMediaTargets);
  return useQuery({
    queryKey: [MEDIA_KEY, "targets", branchId],
    enabled: !!branchId && enabled,
    queryFn: () => fetch({ data: { branchId: branchId! } }),
    staleTime: 60_000,
  });
}

export function useMediaRequests(box: "mine" | "review", enabled = true) {
  const fetch = useServerFn(listMediaUploadRequests);
  return useQuery({
    queryKey: [MEDIA_KEY, "requests", box],
    enabled,
    queryFn: () => fetch({ data: { box } }),
    staleTime: 60_000,
  });
}

/** Everything Media shows may change after a write. */
export function useMediaRefresh() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: [MEDIA_KEY] });
}

/** Desktop layout ("Story chapters") from 1024 px; below it the mobile "Stories" layout. */
export function useMediaDesktop() {
  const [desktop, setDesktop] = useState<boolean | null>(null);
  useEffect(() => {
    const mql = window.matchMedia("(min-width: 1024px)");
    const update = () => setDesktop(mql.matches);
    update();
    mql.addEventListener("change", update);
    return () => mql.removeEventListener("change", update);
  }, []);
  return desktop;
}

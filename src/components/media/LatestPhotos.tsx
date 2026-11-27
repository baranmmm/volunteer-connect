import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useTranslation } from "react-i18next";
import { ChevronRight, Images } from "lucide-react";
import { chapterRef } from "@/lib/media";
import { getLatestMediaPhotos } from "@/lib/media.functions";
import { MediaThumb } from "./MediaParts";
import { MEDIA_KEY } from "./use-media";

/**
 * Dashboard "Latest photos": the newest photos of the member's branch (events and albums) in one horizontal strip;
 * a photo opens in the Media tab's lightbox. Hidden when there are none (and for people without a branch gallery).
 * While it loads, the strip shows skeleton tiles; the rest of the dashboard never waits for it.
 */
export function LatestPhotos() {
  const { t } = useTranslation();
  const fetch = useServerFn(getLatestMediaPhotos);
  const latest = useQuery({
    queryKey: [MEDIA_KEY, "latest"],
    queryFn: () => fetch(),
    staleTime: 4 * 60_000,
  });
  const photos = latest.data?.photos ?? [];
  const loading = latest.isPending;
  if (!loading && !photos.length) return null;
  return (
    <section
      data-testid="dashboard-latest-photos"
      aria-labelledby="dashboard-latest-photos-h"
      className="min-w-0 rounded-2xl border bg-card p-5 shadow-soft"
    >
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2
          id="dashboard-latest-photos-h"
          className="flex items-center gap-2 text-lg font-semibold"
        >
          <Images className="size-5 text-primary" aria-hidden />
          {t("media.latest.title")}
        </h2>
        <Link
          to="/media"
          data-testid="dashboard-latest-photos-all"
          className="inline-flex min-h-11 items-center gap-1 text-sm font-medium text-primary hover:underline"
        >
          {t("media.latest.all")}
          <ChevronRight className="size-4" aria-hidden />
        </Link>
      </div>
      <ul
        className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:thin]"
        aria-busy={loading || undefined}
      >
        {loading &&
          Array.from({ length: 12 }, (_, i) => (
            <li
              key={i}
              data-testid="dashboard-latest-photo-skeleton"
              aria-hidden
              className="size-24 shrink-0 animate-pulse rounded-xl bg-muted sm:size-28"
            />
          ))}
        {photos.map((p, i) =>
          p.chapter_kind && p.chapter_id ? (
            <li key={p.id} className="shrink-0">
              <Link
                to="/media"
                search={{ photo: p.id, pc: chapterRef({ kind: p.chapter_kind, id: p.chapter_id }) }}
                data-testid="dashboard-latest-photo"
                data-photo-id={p.id}
                aria-label={t("media.photoAlt", {
                  title: p.chapter_title ?? "",
                  n: i + 1,
                  count: photos.length,
                })}
                className="block size-24 overflow-hidden rounded-xl bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 sm:size-28"
              >
                <MediaThumb photo={p} alt="" eager={i < 6} />
              </Link>
            </li>
          ) : null,
        )}
      </ul>
    </section>
  );
}

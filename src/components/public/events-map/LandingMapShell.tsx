// The server-rendered first form of the landing section "Our events across the UK": its heading and the static map
// preview with the coming events' dots (no Leaflet, no timeline code). The interactive section replaces it when it
// nears the screen (Landing.tsx).
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { groupPlaces, isPastEvent } from "@/lib/events-map";
import { MapPreview } from "./MapPreview";
import type { MapCardEvent } from "./types";

export function LandingMapShell({ upcoming }: { upcoming: MapCardEvent[] }) {
  const { t } = useTranslation();
  const places = useMemo(() => {
    const now = new Date();
    return groupPlaces(
      upcoming.filter((e) => !isPastEvent(e, now)),
      now,
    );
  }, [upcoming]);
  return (
    <section
      data-testid="landing-map-shell"
      aria-labelledby="landing-map-title"
      className="mx-auto max-w-6xl px-4 py-14 sm:px-6 sm:py-20"
    >
      <h2 id="landing-map-title" className="text-3xl font-bold sm:text-4xl">
        {t("eventsMap.title")}
      </h2>
      <p className="mt-2 max-w-xl text-ds-muted">{t("eventsMap.intro")}</p>
      <div className="mt-8 grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div
          aria-hidden
          className="relative h-[360px] overflow-hidden rounded-2xl border bg-[#dbe8f0] dark:bg-[#2b3340] sm:h-[440px]"
        >
          <MapPreview places={places} />
        </div>
      </div>
    </section>
  );
}

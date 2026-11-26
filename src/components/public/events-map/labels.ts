import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { groupPlaces, type MapPlace, mapWhen } from "@/lib/events-map";
import type { LabelledPlace, MapCardEvent } from "./types";

/** Where the event is, in words: the venue, "Venue to be announced", or the branch's area. */
export function placeText(e: MapCardEvent, t: TFunction) {
  if (e.is_online) return t("publicEvents.online");
  if (e.location_tba) return t("eventsMap.placeTba");
  if (e.location) return e.location;
  return e.branch ? t("eventsMap.branchArea", { branch: e.branch }) : "";
}

/** The story card's place: the branch, or "<region> region" for a region-wide event. */
export function storyPlace(e: MapCardEvent & { scope?: string | undefined }, t: TFunction) {
  if (e.scope === "region" && e.region) return t("eventsStory.regionWide", { region: e.region });
  return e.branch ?? e.region ?? "";
}

/** The marker's accessible name: "<title>, <date>, <place>" (several events at one point: their count and titles). */
export function labelPlaces(
  places: MapPlace<MapCardEvent>[],
  t: TFunction,
  lang: string,
): LabelledPlace[] {
  return places.map((p) => {
    const first = p.events[0]!;
    const label =
      p.events.length === 1
        ? [first.title, mapWhen(first, lang), placeText(first, t)].filter(Boolean).join(", ")
        : t("eventsMap.markerGroup", {
            count: p.events.length,
            place: first.branch ?? placeText(first, t),
            titles: p.events.map((e) => e.title).join("; "),
          });
    return { ...p, label };
  });
}

/** The places of the shown events, with their marker names. */
export function useLabelledPlaces(shown: MapCardEvent[], now: Date) {
  const { t, i18n } = useTranslation();
  return useMemo(
    () => labelPlaces(groupPlaces(shown, now), t, i18n.language),
    [shown, now, t, i18n.language],
  );
}

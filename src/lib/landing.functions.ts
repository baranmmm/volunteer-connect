import { queryOptions } from "@tanstack/react-query";
import { createServerFn } from "@tanstack/react-start";
import type { LandingData } from "@/lib/landing.server";

// The signed-out landing page (/): no auth middleware on purpose. The server reads public_landing_data with the
// service role, signs every image path for 5 minutes and returns no storage paths.
export const getLanding = createServerFn({ method: "POST" }).handler(async () => {
  const { fetchLanding } = await import("@/lib/landing.server");
  return fetchLanding();
});

/** The GET twin of getLanding (src/routes/api/public/landing.ts): a plain request when the browser refreshes it. */
export const LANDING_URL = "/api/public/landing";

/** The hero cover is drawn full width (the `sizes` of its image). */
export const HERO_SIZES = "100vw";

/** The server renders "/" with this data (route loader); the browser re-reads it when the signed links get old. */
async function loadLanding(): Promise<LandingData> {
  if (typeof window === "undefined") return getLanding();
  const res = await fetch(LANDING_URL, { credentials: "same-origin" }).catch(() => null);
  if (res?.ok) return (await res.json()) as LandingData;
  return getLanding();
}

/** Signed links last 5 minutes: the data is fresh for 4 (older links are re-signed before a lightbox opens). */
export const LANDING_STALE_MS = 4 * 60_000;
export const landingQuery = queryOptions({
  queryKey: ["landing"],
  queryFn: loadLanding,
  staleTime: LANDING_STALE_MS,
});

/** The hero: the next event with a cover (else the next event); without one, the newest gallery photo. */
export function landingHero(data: LandingData) {
  const event = data.upcoming.find((e) => e.image) ?? data.upcoming[0];
  const fallbackPhoto = data.gallery[0]?.photos[0] ?? null;
  return { event, fallbackPhoto, image: event ? event.image : fallbackPhoto };
}

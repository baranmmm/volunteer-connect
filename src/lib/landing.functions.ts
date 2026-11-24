import { queryOptions } from "@tanstack/react-query";
import { createServerFn } from "@tanstack/react-start";
import type { LandingData } from "@/lib/landing.server";

// The signed-out landing page (/): no auth middleware on purpose. The server reads public_landing_data with the
// service role, signs every image path for 5 minutes and returns no storage paths.
export const getLanding = createServerFn({ method: "POST" }).handler(async () => {
  const { fetchLanding } = await import("@/lib/landing.server");
  return fetchLanding();
});

/** The GET twin of getLanding (src/routes/api/public/landing.ts), fetched early by the HTML shell of "/". */
export const LANDING_URL = "/api/public/landing";

/** The hero cover is drawn full width (the `sizes` of its image and of the early preload). */
export const HERO_SIZES = "100vw";

type EarlyWindow = { __dsLanding?: Promise<LandingData | null> };

/**
 * Inline script in the head of "/" (plain ES5, no imports): fetches the landing data at once and, when it arrives,
 * preloads the hero image with high priority (with the same srcset/sizes as the hero, so the browser fetches the copy
 * the hero will use), so both download while the app's JavaScript is still loading.
 * The promise is handed to the first loadLanding() call. Mirrors landingHero below.
 */
export const LANDING_EARLY_SCRIPT = `(function(){try{var p=fetch(${JSON.stringify(LANDING_URL)},{credentials:"same-origin"}).then(function(r){return r.ok?r.json():null}).catch(function(){return null});window.__dsLanding=p;p.then(function(d){if(!d||!d.upcoming)return;var e=null,i;for(i=0;i<d.upcoming.length;i++){if(d.upcoming[i].image){e=d.upcoming[i];break}}e=e||d.upcoming[0];var g=d.gallery&&d.gallery[0]&&d.gallery[0].photos[0];var s=e?e.image:(g||null);if(!s||!s.src)return;var l=document.createElement("link");l.rel="preload";l.as="image";l.href=s.src;if(s.srcSet){l.setAttribute("imagesrcset",s.srcSet);l.setAttribute("imagesizes",${JSON.stringify(HERO_SIZES)})}l.setAttribute("fetchpriority","high");document.head.appendChild(l)})}catch(x){}})();`;

async function loadLanding(): Promise<LandingData> {
  const w = typeof window === "undefined" ? null : (window as unknown as EarlyWindow);
  const early = w?.__dsLanding;
  if (w) delete w.__dsLanding;
  const ready = early ? await early : null;
  if (ready) return ready;
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

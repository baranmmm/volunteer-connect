// The public Events page (/events) around its list and map: the top bar, the next event as the hero, then (below the
// list) the counters, YouTube highlights, the past-events gallery and the updates sign-up, and the footer. These were
// the landing page's sections; the home page (/) is now the join page.
import { lazy, Suspense, useCallback, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { LANDING_STALE_MS as STALE, landingHero, landingQuery } from "@/lib/landing.functions";
import { Counters } from "./Counters";
import { Gallery } from "./Gallery";
import { Hero } from "./Hero";
import { Highlights } from "./Highlights";
import { LandingFooter } from "./LandingFooter";
import { PublicTopBar } from "@/components/public/PublicTopBar";
import { useSeen } from "./motion";
import type { LandingData } from "@/lib/landing.server";

// The form (and its config/branch reads) stays off the first paint's critical path.
const LazySubscribeForm = lazy(() =>
  import("@/components/public/SubscribeForm").then((m) => ({ default: m.SubscribeForm })),
);
function SubscribeForm() {
  return (
    <Suspense fallback={<div className="min-h-[300px]" />}>
      <LazySubscribeForm source="landing" compact />
    </Suspense>
  );
}

function SubscribeCard() {
  return (
    <div className="rounded-[5px] bg-white p-5 text-[#28303D] shadow-ds-card sm:p-6">
      <SubscribeForm />
    </div>
  );
}

/** "Get event updates": the form mounts when the section nears the screen (its config and branch reads wait too). */
function Updates() {
  const { t } = useTranslation();
  const [ref, seen] = useSeen<HTMLElement>("400px 0px");
  return (
    <section
      ref={ref}
      data-testid="landing-subscribe"
      aria-labelledby="landing-subscribe-title"
      className="bg-[linear-gradient(135deg,#006D9C,#28303D)] text-white"
    >
      <div className="mx-auto grid max-w-6xl gap-8 px-4 py-14 sm:px-6 sm:py-20 lg:grid-cols-2 lg:items-center">
        <div className="space-y-3">
          <h2 id="landing-subscribe-title" className="text-3xl font-bold sm:text-4xl">
            {t("landing.subscribe.title")}
          </h2>
          <p className="text-lg text-white/90">{t("landing.subscribe.text")}</p>
        </div>
        <div className="min-h-[340px]">{seen && <SubscribeCard />}</div>
      </div>
    </section>
  );
}

/** The landing data (hero, counters, highlights, gallery): server-rendered first, re-signed when its links get old. */
export function useLanding(initial?: LandingData | null) {
  const query = useQuery({
    ...landingQuery,
    ...(initial ? { initialData: initial, initialDataUpdatedAt: initial.signedAt } : {}),
  });
  const { dataUpdatedAt, refetch } = query;
  // Re-sign when the links are older than 4 minutes (lightbox open, or an image failed to load).
  const refreshIfStale = useCallback(() => {
    if (Date.now() - dataUpdatedAt > STALE) void refetch();
  }, [dataUpdatedAt, refetch]);
  return { query, refreshIfStale };
}
export type Landing = ReturnType<typeof useLanding>;

/** The page frame: skip link, top bar, main and (once the landing data is in, so it never jumps: CLS) the footer. */
export function LandingFrame({ landing, children }: { landing: Landing; children: ReactNode }) {
  const { t } = useTranslation();
  return (
    <div data-testid="landing-page" className="landing min-h-screen font-sans">
      <a
        href="#landing-main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded focus:bg-white focus:px-4 focus:py-2 focus:text-[#28303D]"
      >
        {t("landing.skip")}
      </a>
      <PublicTopBar />
      <main id="landing-main">{children}</main>
      {!landing.query.isPending && <LandingFooter />}
    </div>
  );
}

/**
 * The next public event as a full-bleed cover (its title is the page's h1); without one, a highlight photo and the
 * updates sign-up. While loading or after an error the page still has its h1 (screen readers), and the list works.
 */
export function LandingHero({ landing }: { landing: Landing }) {
  const { t } = useTranslation();
  const { data, isPending } = landing.query;
  if (isPending)
    return (
      <div
        aria-busy="true"
        className="min-h-[560px] bg-[linear-gradient(135deg,#006D9C_0%,#28303D_70%)] sm:min-h-[600px] lg:min-h-[640px]"
      >
        <h1 className="sr-only">{t("publicEvents.title")}</h1>
        <span className="sr-only">{t("common.loading")}</span>
      </div>
    );
  if (!data) return <h1 className="sr-only">{t("publicEvents.title")}</h1>;
  const hero = landingHero(data);
  return (
    <Hero
      event={hero.event}
      fallbackPhoto={hero.fallbackPhoto}
      subscribe={<SubscribeForm />}
      allEventsHref="#events-list"
    />
  );
}

/** Below the list: counters, highlights, gallery (anchors #gallery-<eventId>) and the updates sign-up. */
export function LandingSections({ landing }: { landing: Landing }) {
  const { t } = useTranslation();
  const { data, isError, refetch } = landing.query;
  if (isError || (!data && !landing.query.isPending))
    return (
      <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6">
        <p data-testid="landing-error" role="alert" className="text-ds-muted">
          {t("landing.loadError")}
        </p>
        <button
          type="button"
          onClick={() => void refetch()}
          className="mt-4 inline-flex min-h-11 items-center rounded-[3px] bg-ds-slate px-5 font-semibold text-ds-slate-fg"
        >
          {t("common.retry")}
        </button>
      </div>
    );
  if (!data) return null;
  const next = landingHero(data).event;
  return (
    <>
      <Counters stats={data.stats} />
      <Highlights videos={data.highlights} />
      <Gallery groups={data.gallery} onStale={landing.refreshIfStale} />
      {next && <Updates />}
    </>
  );
}

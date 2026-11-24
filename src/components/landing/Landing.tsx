import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { LANDING_STALE_MS as STALE, landingHero, landingQuery } from "@/lib/landing.functions";
import { Counters } from "./Counters";
import { Gallery } from "./Gallery";
import { Hero } from "./Hero";
import { Highlights } from "./Highlights";
import { LandingFooter } from "./LandingFooter";
import { LandingHeader } from "./LandingHeader";
import { useSeen } from "./motion";
import { Upcoming } from "./Upcoming";

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

export function Landing() {
  const { t } = useTranslation();
  const query = useQuery(landingQuery);
  const [heroDone, setHeroDone] = useState(false);
  const { data, dataUpdatedAt, refetch } = query;
  // Re-sign when the links are older than 4 minutes (lightbox open, or an image failed to load).
  const refreshIfStale = useCallback(() => {
    if (Date.now() - dataUpdatedAt > STALE) void refetch();
  }, [dataUpdatedAt, refetch]);
  const hero = data ? landingHero(data) : null;
  const next = hero?.event;
  const fallbackPhoto = hero?.fallbackPhoto ?? null;
  const heroImage = hero?.image ?? null;
  // No cover to wait for, or a slow one: let the other images load anyway.
  useEffect(() => {
    if (!data) return;
    if (!heroImage) return setHeroDone(true);
    const timer = setTimeout(() => setHeroDone(true), 3000);
    return () => clearTimeout(timer);
  }, [data, heroImage]);
  return (
    <div data-testid="landing-page" className="landing min-h-screen font-sans">
      <a
        href="#landing-main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded focus:bg-white focus:px-4 focus:py-2 focus:text-[#28303D]"
      >
        {t("landing.skip")}
      </a>
      <LandingHeader />
      <main id="landing-main">
        {query.isPending ? (
          <div
            aria-busy="true"
            className="min-h-[560px] bg-[linear-gradient(135deg,#006D9C_0%,#28303D_70%)] sm:min-h-[600px] lg:min-h-[640px]"
          >
            <span className="sr-only">{t("common.loading")}</span>
          </div>
        ) : query.isError || !data ? (
          <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
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
        ) : (
          <>
            <Hero
              event={next}
              fallbackPhoto={fallbackPhoto}
              subscribe={<SubscribeForm />}
              onImageDone={() => setHeroDone(true)}
            />
            <Counters stats={data.stats} />
            <Upcoming events={data.upcoming} imagesReady={heroDone} />
            <Highlights videos={data.highlights} />
            <Gallery groups={data.gallery} onStale={refreshIfStale} />
            {next && <Updates />}
          </>
        )}
      </main>
      {/* The footer waits for the content so it never jumps down (CLS). */}
      {!query.isPending && <LandingFooter />}
    </div>
  );
}

// The /events map as a scroll-driven story. A tall section holds a sticky panel: the month label, the fixed dotted
// map of England and Wales, the active event's card (next to its dot on desktop, below the map on phones) and the
// timeline. Scrolling through the section steps through the events in date order (past first, then upcoming); ticks,
// arrows, branch dots, swipes and Play jump by scrolling to that event's slice, so the scroll position and the
// active event never disagree. With prefers-reduced-motion the section is a static map with a plain list (CSS decides,
// so the server-rendered page is already right). The map itself never zooms, pans or re-centres.
import { useCallback, useEffect, useMemo, useRef, useState, type TouchEvent } from "react";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { dateLocale } from "@/lib/i18n";
import { mapWhen } from "@/lib/events-map";
import {
  clampStep,
  firstUpcomingIndex,
  framePosition,
  mapFrame,
  playStep,
  progressOfStep,
  stepAtProgress,
  stepHeightVh,
  storySteps,
  type BranchPoint,
  type StoryEvent,
} from "@/lib/events-story";
import { cn } from "@/lib/utils";
import { DotMap } from "./DotMap";
import { EW_BOUNDS } from "./england-wales-dots";
import { PauseIcon, PlayIcon } from "./icons";
import { storyPlace } from "./labels";
import { StoryCard } from "./StoryCard";
import { StoryTimeline } from "./StoryTimeline";
import type { MapCardEvent } from "./types";

const PLAY_MS = 2200;
/** The site's sticky top bar (LandingHeader): the panel sticks below it. Keep in step with `top-16` below. */
const TOP_PX = 64;
const SWIPE_PX = 40;

/** The OS "reduce motion" setting, known after mounting (CSS handles the server-rendered page). */
function useReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (!mq) return;
    const on = () => setReduced(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return reduced;
}

function monthYear(day: string, lang: string) {
  return new Intl.DateTimeFormat(dateLocale(lang), {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${day}T12:00:00Z`));
}

export type StoryCardEvent = MapCardEvent & StoryEvent;

export function EventsStory({
  events,
  branches,
}: {
  /** Coming and past events (duplicates are dropped). */
  events: StoryCardEvent[];
  branches: BranchPoint[];
}) {
  const { t, i18n } = useTranslation();
  const [now] = useState(() => new Date());
  const reduced = useReducedMotion();
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);

  const frame = useMemo(() => mapFrame(EW_BOUNDS, branches), [branches]);
  const steps = useMemo(() => storySteps(events, branches, now), [events, branches, now]);
  const n = steps.length;
  const [activeState, setActive] = useState(0);
  const active = clampStep(activeState, n);
  const [preview, setPreview] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const [suspended, setSuspended] = useState(false);
  const [listOpen, setListOpen] = useState(false);
  const section = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  /** The section's box and how far it scrolls while the panel is stuck (0 when it does not). */
  const measure = useCallback(() => {
    const el = section.current;
    if (!el) return null;
    const box = el.getBoundingClientRect();
    return { box, range: box.height - (panel.current?.offsetHeight ?? window.innerHeight) };
  }, []);

  // Reduced motion: the list is open and the card shows the next event (or the latest one).
  const featured = Math.min(firstUpcomingIndex(steps), n - 1);
  useEffect(() => {
    if (reduced) setListOpen(true);
  }, [reduced]);
  const shownIndex = preview ?? (reduced ? featured : active);
  const shown = n ? (steps[clampStep(shownIndex, n)] ?? null) : null;

  // Scrolling picks the step (one equal slice of the section each).
  useEffect(() => {
    if (reduced || !n) return;
    let raf = 0;
    const update = () => {
      raf = 0;
      const m = measure();
      if (!m) return;
      setActive(stepAtProgress(m.range > 0 ? (TOP_PX - m.box.top) / m.range : 0, n));
    };
    const schedule = () => {
      if (!raf) raf = window.requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      if (raf) window.cancelAnimationFrame(raf);
    };
  }, [reduced, n, measure]);

  /** Jumps to a step: scrolls to the middle of its slice (the map stays where it is). A manual jump stops Play. */
  const goTo = useCallback(
    (index: number, fromPlay = false) => {
      if (!n) return;
      const next = clampStep(index, n);
      if (!fromPlay) setPlaying(false);
      setActive(next);
      const m = reduced ? null : measure();
      if (!m || m.range <= 0) return;
      window.scrollTo({
        top: window.scrollY + m.box.top - TOP_PX + progressOfStep(next, n) * m.range,
        behavior: "instant",
      });
    },
    [n, reduced, measure],
  );

  // Play: one event on every step, paused while the map or card is hovered or focused, stopping at the last event.
  const latest = useRef({ active, goTo });
  latest.current = { active, goTo };
  useEffect(() => {
    if (!playing || suspended || reduced) return;
    const timer = window.setInterval(() => {
      const next = playStep(latest.current.active, n);
      if (next === null) setPlaying(false);
      else latest.current.goTo(next, true);
    }, PLAY_MS);
    return () => window.clearInterval(timer);
  }, [playing, suspended, reduced, n]);
  function togglePlay() {
    if (playing) return setPlaying(false);
    if (playStep(active, n) === null) goTo(0, true);
    setPlaying(true);
  }

  // Phones: a horizontal swipe on the map or card moves one event.
  const touch = useRef<{ x: number; y: number } | null>(null);
  const swipe = {
    onTouchStart: (e: TouchEvent) => {
      const p = e.touches[0];
      touch.current = p ? { x: p.clientX, y: p.clientY } : null;
    },
    onTouchEnd: (e: TouchEvent) => {
      const start = touch.current,
        p = e.changedTouches[0];
      touch.current = null;
      if (!start || !p) return;
      const dx = p.clientX - start.x,
        dy = p.clientY - start.y;
      if (Math.abs(dx) < SWIPE_PX || Math.abs(dx) < Math.abs(dy) * 1.5) return;
      goTo(active + (dx < 0 ? 1 : -1));
    },
  };
  const pause = {
    onPointerEnter: () => setSuspended(true),
    onPointerLeave: () => setSuspended(false),
    onFocus: () => setSuspended(true),
    onBlur: (e: React.FocusEvent<HTMLElement>) => {
      if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setSuspended(false);
    },
  };

  const pos = shown
    ? framePosition(frame, shown.target.point.latitude, shown.target.point.longitude)
    : null;
  const right = !pos || pos.left < 0.55;
  const overlayStyle: React.CSSProperties | undefined = pos
    ? {
        top: `${Math.min(Math.max(pos.top * 100, 25), 75)}%`,
        ...(right
          ? { left: `calc(${pos.left * 100}% + 18px)` }
          : { right: `calc(${(1 - pos.left) * 100}% + 18px)` }),
      }
    : undefined;

  const heading = (
    <header className="flex flex-wrap items-end justify-between gap-3">
      <div className="space-y-1">
        <h2 id="events-map-title" className="text-2xl font-bold sm:text-3xl">
          {t("eventsStory.title")}
        </h2>
        <p className="max-w-2xl text-sm text-muted-foreground">
          <span className="motion-reduce:hidden">{t("eventsStory.intro")}</span>
          <span className="hidden motion-reduce:inline">{t("eventsStory.introStatic")}</span>
        </p>
      </div>
      <a
        href="#events-list-start"
        data-testid="events-map-skip"
        className="rounded-md text-sm font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {t("eventsStory.skip")}
      </a>
    </header>
  );

  return (
    <section aria-labelledby="events-map-title" className="space-y-3">
      {heading}
      <div
        ref={section}
        data-testid="events-map"
        data-steps={n}
        data-active={n ? active : undefined}
        data-shown={shown ? shownIndex : undefined}
        data-mode={ready ? (reduced ? "static" : "story") : undefined}
        className="relative motion-reduce:h-auto!"
        style={{
          height: n > 1 ? `calc(100svh - ${TOP_PX}px + ${n * stepHeightVh(n)}svh)` : undefined,
        }}
      >
        <div
          ref={panel}
          role="group"
          aria-labelledby="events-map-title"
          onKeyDown={(e) => {
            if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
            e.preventDefault();
            goTo(active + (e.key === "ArrowRight" ? 1 : -1));
          }}
          className={cn(
            "flex flex-col gap-2 bg-background py-3",
            n > 1
              ? "sticky top-16 h-[calc(100svh-4rem)] motion-reduce:static motion-reduce:h-[min(80svh,720px)]"
              : "h-[min(80svh,720px)]",
          )}
        >
          <div className="flex items-end justify-between gap-3">
            <div className="min-w-0">
              <p
                data-testid="events-map-date"
                className="text-3xl font-bold leading-tight tracking-tight sm:text-5xl"
              >
                {shown ? monthYear(shown.day, i18n.language) : " "}
              </p>
              {n > 0 && (
                <p data-testid="events-map-position" className="text-xs text-muted-foreground">
                  {t("eventsStory.position", { current: shownIndex + 1, total: n })}
                </p>
              )}
            </div>
            {n > 1 && (
              <button
                type="button"
                data-testid="events-map-timeline-play"
                aria-pressed={playing}
                onClick={togglePlay}
                className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-xl border px-4 text-sm font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:hidden"
              >
                {playing ? <PauseIcon className="size-4" /> : <PlayIcon className="size-4" />}
                {playing ? t("eventsMap.timeline.pause") : t("eventsMap.timeline.play")}
              </button>
            )}
          </div>
          <div className="relative min-h-0 flex-1" {...pause} {...swipe}>
            <DotMap
              frame={frame}
              branches={branches}
              steps={steps}
              shown={shown}
              onPreview={setPreview}
              onPick={(i) => {
                setPreview(null);
                goTo(i);
              }}
            >
              {shown && (
                <StoryCard
                  step={shown}
                  variant="overlay"
                  live={!playing}
                  className="absolute z-30 hidden -translate-y-1/2 lg:block"
                  style={overlayStyle}
                />
              )}
            </DotMap>
            {!n && (
              <p
                data-testid="events-map-empty"
                className="absolute inset-x-0 bottom-2 text-center text-sm text-muted-foreground"
              >
                {t("eventsStory.empty")}
              </p>
            )}
          </div>
          {shown && (
            <div className="lg:hidden" {...pause} {...swipe}>
              <StoryCard step={shown} variant="inline" live={!playing} />
            </div>
          )}
          {n > 1 && (
            <div className="motion-reduce:hidden">
              <StoryTimeline
                steps={steps}
                active={active}
                onGo={(i) => goTo(i)}
                onSuspend={setSuspended}
              />
            </div>
          )}
        </div>
      </div>
      {n > 0 && (
        <details
          data-testid="events-map-list"
          open={listOpen}
          onToggle={(e) => setListOpen(e.currentTarget.open)}
          className="rounded-2xl border bg-card p-3 text-card-foreground sm:p-4"
        >
          <summary className="min-h-9 cursor-pointer content-center text-sm font-semibold">
            {t("eventsStory.listToggle", { count: n })}
          </summary>
          <ol className="mt-2 space-y-1">
            {steps.map((s) => (
              <li
                key={s.event.id}
                data-testid="events-map-list-item"
                data-event-id={s.event.id}
                data-past={s.past ? "true" : "false"}
              >
                <Link
                  to="/events/$id"
                  params={{ id: s.event.id }}
                  className="block rounded-lg px-2 py-1.5 hover:bg-muted"
                >
                  <span className="block text-sm font-medium break-words">{s.event.title}</span>
                  <span className="block text-xs text-muted-foreground">
                    {[
                      mapWhen(s.event, i18n.language),
                      storyPlace(s.event, t),
                      s.past ? t("eventsStory.past") : t("eventsStory.upcoming"),
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </Link>
              </li>
            ))}
          </ol>
        </details>
      )}
    </section>
  );
}

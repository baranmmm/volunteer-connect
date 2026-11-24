// The month slider under the map: one tick per month (a dot where there are events), a thumb for the selected month
// (or the start of a 3-month range), "1 month / 3 months / All", Play and the "Past events" switch.
// The slider is a single role="slider" element: arrows, Page Up/Down, Home and End; aria-valuetext is the month name.
import { useRef, type KeyboardEvent, type PointerEvent } from "react";
import { useTranslation } from "react-i18next";
import { PauseIcon, PlayIcon } from "./icons";
import { dateLocale } from "@/lib/i18n";
import { selectedMonths, sliderKey, type MonthKey } from "@/lib/events-map";
import { cn } from "@/lib/utils";
import type { EventsTimeline } from "./use-events-timeline";

const monthDate = (m: MonthKey) => new Date(`${m}-15T12:00:00Z`);
export function monthName(m: MonthKey, lang?: string) {
  return new Intl.DateTimeFormat(dateLocale(lang), {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(monthDate(m));
}
function shortMonth(m: MonthKey, lang?: string) {
  return new Intl.DateTimeFormat(dateLocale(lang), { month: "short", timeZone: "UTC" }).format(
    monthDate(m),
  );
}

export function Timeline({
  timeline,
  idPrefix,
  className,
}: {
  timeline: EventsTimeline;
  idPrefix: string;
  className?: string;
}) {
  const { t, i18n } = useTranslation();
  const { months, selection, setSelection, counts } = timeline;
  const track = useRef<HTMLDivElement>(null);
  const n = months.length;
  const start = Math.min(selection.start, n - 1);
  const span = selection.span;
  const chosen = selectedMonths(months, selection);
  const first = chosen[0],
    last = chosen[chosen.length - 1];
  const rangeText =
    first && last
      ? first === last
        ? monthName(first, i18n.language)
        : t("eventsMap.timeline.range", {
            from: monthName(first, i18n.language),
            to: monthName(last, i18n.language),
          })
      : "";
  const valueText = span === "all" ? `${t("eventsMap.timeline.all")}: ${rangeText}` : rangeText;
  const setStart = (index: number) =>
    setSelection({ start: index, span: span === "all" ? 1 : span });

  function indexAt(clientX: number) {
    const box = track.current?.getBoundingClientRect();
    if (!box || n <= 1) return 0;
    const ratio = (clientX - box.left) / box.width;
    return Math.min(n - 1, Math.max(0, Math.round(ratio * (n - 1))));
  }
  function onPointerDown(e: PointerEvent<HTMLDivElement>) {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    e.currentTarget.focus();
    setStart(indexAt(e.clientX));
  }
  function onPointerMove(e: PointerEvent<HTMLDivElement>) {
    if (!e.currentTarget.hasPointerCapture?.(e.pointerId)) return;
    const i = indexAt(e.clientX);
    if (i !== start || span === "all") setStart(i);
  }
  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const next = sliderKey(e.key, start, n);
    if (next === null) return;
    e.preventDefault();
    setStart(next);
  }
  const pos = (i: number) => (n <= 1 ? 50 : (i / (n - 1)) * 100);
  const spanEnd = span === "all" ? n - 1 : Math.min(n - 1, start + span - 1);
  const rangeFrom = span === "all" ? 0 : start;
  // Month labels: every month when there is room, otherwise every 2nd/3rd (always the selected one).
  const step = n <= 12 ? 2 : 3;
  const sliderLabelId = `${idPrefix}-timeline-label`;
  return (
    <div
      data-testid="events-map-timeline"
      className={cn(
        "space-y-3 rounded-2xl border bg-card p-3 text-card-foreground sm:p-4",
        className,
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p
          id={sliderLabelId}
          className="min-w-0 text-sm font-semibold"
          data-testid="events-map-timeline-value"
        >
          {valueText}
          <span className="ml-2 font-normal text-muted-foreground">
            {t("eventsMap.timeline.count", { count: timeline.shown.length })}
          </span>
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <div
            role="group"
            aria-label={t("eventsMap.timeline.spanLabel")}
            className="inline-flex rounded-xl border p-0.5"
          >
            {([1, 3, "all"] as const).map((s) => (
              <button
                key={s}
                type="button"
                data-testid={`events-map-timeline-span-${s}`}
                aria-pressed={span === s}
                onClick={() =>
                  setSelection(
                    s === "all"
                      ? { start, span: "all" }
                      : { start: Math.min(start, Math.max(0, n - s)), span: s },
                  )
                }
                className={cn(
                  "min-h-9 rounded-lg px-2.5 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  span === s ? "bg-primary text-primary-foreground" : "hover:bg-muted",
                )}
              >
                {t(`eventsMap.timeline.span.${s}`)}
              </button>
            ))}
          </div>
          <button
            type="button"
            data-testid="events-map-timeline-play"
            aria-pressed={timeline.playing}
            onClick={timeline.togglePlay}
            className="inline-flex min-h-9 items-center gap-1.5 rounded-xl border px-3 text-xs font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {timeline.playing ? (
              <PauseIcon className="size-3.5" />
            ) : (
              <PlayIcon className="size-3.5" />
            )}
            {timeline.playing ? t("eventsMap.timeline.pause") : t("eventsMap.timeline.play")}
          </button>
        </div>
      </div>
      <div className="px-2">
        <div
          ref={track}
          role="slider"
          tabIndex={0}
          data-testid="events-map-timeline-slider"
          aria-label={t("eventsMap.timeline.slider")}
          aria-valuemin={0}
          aria-valuemax={n - 1}
          aria-valuenow={start}
          aria-valuetext={valueText}
          data-month={months[start]}
          data-span={String(span)}
          onKeyDown={onKeyDown}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onFocus={() => timeline.setSuspended(true)}
          onBlur={() => timeline.setSuspended(false)}
          className="relative h-12 cursor-pointer touch-none select-none rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-4"
        >
          <div className="absolute inset-x-0 top-3 h-1.5 rounded-full bg-muted" aria-hidden />
          <div
            aria-hidden
            className="absolute top-3 h-1.5 rounded-full bg-primary/70"
            style={{
              left: `${pos(rangeFrom)}%`,
              width: `${Math.max(pos(spanEnd) - pos(rangeFrom), 0)}%`,
            }}
          />
          {months.map((m, i) => (
            <div
              key={m}
              aria-hidden
              className="absolute top-0 flex -translate-x-1/2 flex-col items-center"
              style={{ left: `${pos(i)}%` }}
            >
              <span
                className={cn(
                  "mt-2 block h-2.5 w-0.5 rounded",
                  i >= rangeFrom && i <= spanEnd ? "bg-primary" : "bg-muted-foreground/50",
                )}
              />
              <span
                className={cn(
                  "mt-0.5 block size-1.5 rounded-full",
                  counts[i] ? "bg-foreground" : "bg-transparent",
                )}
              />
              <span
                className={cn(
                  "mt-0.5 whitespace-nowrap text-[10px] leading-none text-muted-foreground",
                  i % step !== 0 && i !== start && "hidden",
                  i % step !== 0 && i !== start && n <= 12 && "sm:inline",
                )}
              >
                {shortMonth(m, i18n.language)}
              </span>
            </div>
          ))}
          <span
            aria-hidden
            className="absolute top-1.5 block -translate-x-1/2 rounded-full border-2 border-background bg-primary shadow ring-1 ring-primary"
            style={{ left: `${pos(start)}%`, width: 18, height: 18 }}
          />
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label className="inline-flex min-h-9 items-center gap-2 text-sm font-medium">
          {/* A plain switch (no Radix here: the landing page's first load shares no chunk with the map). */}
          <button
            type="button"
            role="switch"
            aria-checked={timeline.withPast}
            data-testid="events-map-past-toggle"
            onClick={() => timeline.togglePast(!timeline.withPast)}
            className={cn(
              "inline-flex h-5 w-9 shrink-0 items-center rounded-full border-2 border-transparent shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 motion-reduce:transition-none",
              timeline.withPast ? "bg-primary" : "bg-input",
            )}
          >
            <span
              className={cn(
                "block size-4 rounded-full bg-background shadow-lg transition-transform motion-reduce:transition-none",
                timeline.withPast ? "translate-x-4" : "translate-x-0",
              )}
            />
          </button>
          {t("eventsMap.timeline.past")}
        </label>
        {timeline.pastLoading && (
          <span className="text-xs text-muted-foreground">{t("common.loading")}</span>
        )}
        {timeline.pastError && (
          <span role="alert" className="text-xs text-destructive">
            {t("eventsMap.timeline.pastError")}
          </span>
        )}
      </div>
    </div>
  );
}

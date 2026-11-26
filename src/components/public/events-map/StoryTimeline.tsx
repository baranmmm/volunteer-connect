// The story's timeline: one tick per event (past ones dark, coming ones in the brand blue), a moving cursor and a
// "Today" marker. The bar is a single role="slider" (arrows, Home, End; the value text names the event), so a long
// list of events is one tab stop; clicking a tick (or near it) jumps to that event and dragging moves the cursor.
// Left of Today, "Past events" jumps to the earliest past event (scrolling only moves forward from Today).
import type { KeyboardEvent, PointerEvent } from "react";
import { useTranslation } from "react-i18next";
import { mapWhen } from "@/lib/events-map";
import { stepKey, tickPosition, todayPosition, type StoryStep } from "@/lib/events-story";
import { cn } from "@/lib/utils";

export function StoryTimeline({
  steps,
  active,
  onGo,
  onPast,
  onSuspend,
}: {
  steps: StoryStep[];
  active: number;
  onGo: (index: number) => void;
  /** Jump to the earliest past event. */
  onPast: () => void;
  onSuspend: (suspended: boolean) => void;
}) {
  const { t, i18n } = useTranslation();
  const n = steps.length;
  const current = steps[active];
  const valueText = current
    ? `${current.event.title}, ${mapWhen(current.event, i18n.language) ?? ""}`
    : "";

  function indexAt(e: PointerEvent<HTMLDivElement>, byPosition = false) {
    const tick = byPosition ? null : (e.target as HTMLElement).closest<HTMLElement>("[data-index]");
    if (tick) return Number(tick.dataset["index"]);
    const box = e.currentTarget.getBoundingClientRect();
    if (n <= 1 || !box.width) return 0;
    const ratio = (e.clientX - box.left) / box.width;
    return Math.min(n - 1, Math.max(0, Math.round(ratio * (n - 1))));
  }
  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const next = stepKey(e.key, active, n);
    if (next === null) return;
    e.preventDefault();
    e.stopPropagation();
    onGo(next);
  }
  const today = todayPosition(steps);
  const hasPast = steps.some((s) => s.past);
  return (
    <div
      data-testid="events-map-timeline"
      className="flex min-w-0 items-end gap-2 px-1 pb-1 pt-5 sm:px-3"
    >
      {hasPast && (
        <button
          type="button"
          data-testid="events-map-timeline-past"
          onClick={onPast}
          title={t("eventsStory.pastJump")}
          className="mb-1.5 inline-flex min-h-8 shrink-0 items-center gap-1 whitespace-nowrap rounded-full border bg-background px-2.5 text-xs font-semibold text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span aria-hidden>←</span>
          {t("eventsStory.pastButton")}
        </button>
      )}
      <div
        role="slider"
        tabIndex={0}
        data-testid="events-map-timeline-slider"
        aria-label={t("eventsStory.timeline")}
        aria-valuemin={0}
        aria-valuemax={Math.max(n - 1, 0)}
        aria-valuenow={active}
        aria-valuetext={valueText}
        onKeyDown={onKeyDown}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          e.currentTarget.setPointerCapture?.(e.pointerId);
          onGo(indexAt(e));
        }}
        onPointerMove={(e) => {
          // Dragging the cursor (the pointer was captured on the bar).
          if (!e.currentTarget.hasPointerCapture?.(e.pointerId)) return;
          const i = indexAt(e, true);
          if (i !== active) onGo(i);
        }}
        onFocus={() => onSuspend(true)}
        onBlur={() => onSuspend(false)}
        className="relative h-9 min-w-0 flex-1 cursor-pointer touch-pan-y select-none rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-4"
      >
        <div aria-hidden className="absolute inset-x-0 top-4 h-0.5 rounded-full bg-border" />
        <span
          aria-hidden
          data-testid="events-map-timeline-today"
          className="absolute -top-4 flex -translate-x-1/2 flex-col items-center"
          style={{ left: `${today}%` }}
        >
          <span className="whitespace-nowrap text-[10px] font-semibold uppercase leading-none tracking-wide text-foreground">
            {t("eventsStory.today")}
          </span>
          <span className="mt-0.5 block h-7 w-px bg-foreground/70" />
        </span>
        {steps.map((s, i) => (
          <span
            key={s.event.id}
            aria-hidden
            data-testid="events-map-timeline-tick"
            data-index={i}
            data-event-id={s.event.id}
            data-past={s.past ? "true" : "false"}
            className="absolute top-1 flex h-7 w-2 -translate-x-1/2 items-center justify-center"
            style={{ left: `${tickPosition(i, n)}%` }}
          >
            <span
              className={cn(
                "block w-0.5 rounded-full",
                i === active ? "h-6" : "h-3.5",
                s.past ? "bg-[#28303D]" : "bg-primary",
              )}
            />
          </span>
        ))}
        {n > 0 && (
          <span
            aria-hidden
            data-testid="events-map-timeline-cursor"
            className={cn(
              "pointer-events-none absolute top-2.5 block size-4 -translate-x-1/2 rounded-full border-2 border-background shadow ring-1 transition-[left] duration-300 motion-reduce:transition-none",
              current?.past ? "bg-[#28303D] ring-[#28303D]" : "bg-primary ring-primary",
            )}
            style={{ left: `${tickPosition(active, n)}%` }}
          />
        )}
      </div>
    </div>
  );
}

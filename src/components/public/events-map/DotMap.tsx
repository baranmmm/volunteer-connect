// The fixed dotted map of the United Kingdom: the land as halftone dots (generated SVG paths), every branch as a small
// dot, the active event's branch dot(s) larger and pulsing. The frame never changes for an event: no zoom, no pan, no
// re-centring. A size container keeps the map's aspect ratio, so dots and the card are placed in percent of it and
// the server-rendered HTML is already in place.
// Keyboard: the map is one tab stop (dense dots, e.g. London's, could never each be a 24 px target); Up and Down move a
// visible focus between the branches with events from north to south, the card shows that branch's event (and is read
// out), Enter jumps to it. With a pointer, hovering a dot previews and clicking it jumps.
import { useMemo, useState, type KeyboardEvent, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  branchEventIndex,
  framePosition,
  type BranchPoint,
  type Frame,
  type StoryStep,
} from "@/lib/events-story";
import { cn } from "@/lib/utils";
import { UK_SVG_BOX, UK_SVG_URL } from "./uk-dots";

export function DotMap({
  frame,
  branches,
  steps,
  shown,
  onPreview,
  onPick,
  children,
}: {
  frame: Frame;
  branches: BranchPoint[];
  steps: StoryStep[];
  /** The step whose dot(s) are highlighted (the active event, or the one a dot previews). */
  shown: StoryStep | null;
  /** Hover or focus on a branch dot (null when it leaves). */
  onPreview: (index: number | null) => void;
  /** A branch dot was chosen: jump to its event. */
  onPick: (index: number) => void;
  /** The desktop card, placed over the map. */
  children?: ReactNode;
}) {
  const { t } = useTranslation();
  const lit = new Set(shown?.target.branchIds ?? []);
  // Branches with an event, north to south (the keyboard order).
  const order = useMemo(
    () =>
      branches
        .filter((b) => branchEventIndex(steps, b.id) !== null)
        .sort((a, b) => b.latitude - a.latitude || a.name.localeCompare(b.name)),
    [branches, steps],
  );
  const [focused, setFocused] = useState<string | null>(null);
  function focusBranch(id: string | null) {
    setFocused(id);
    onPreview(id ? branchEventIndex(steps, id) : null);
  }
  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (!order.length) return;
    const at = order.findIndex((b) => b.id === focused);
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const next =
        at === -1
          ? e.key === "ArrowDown"
            ? 0
            : order.length - 1
          : Math.min(Math.max(at + (e.key === "ArrowDown" ? 1 : -1), 0), order.length - 1);
      focusBranch(order[next]!.id);
    } else if ((e.key === "Enter" || e.key === " ") && focused) {
      e.preventDefault();
      const index = branchEventIndex(steps, focused);
      focusBranch(null);
      if (index !== null) onPick(index);
    } else if (e.key === "Escape" && focused) {
      e.preventDefault();
      focusBranch(null);
    }
  }
  const venue = shown && !shown.target.branchIds.length ? shown.target.point : null;
  const ratio = frame.w / frame.h;
  return (
    <div
      tabIndex={order.length ? 0 : -1}
      role="group"
      aria-label={t("eventsStory.mapLabel")}
      aria-describedby={order.length ? "events-map-keys" : undefined}
      data-testid="events-map-keys-target"
      data-focused-branch={focused ?? undefined}
      onKeyDown={onKeyDown}
      onBlur={() => focused && focusBranch(null)}
      className="relative h-full w-full rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      style={{ containerType: "size" }}
    >
      <span id="events-map-keys" className="sr-only">
        {t("eventsStory.mapKeys")}
      </span>
      <div
        data-testid="events-map-canvas"
        data-frame={`${frame.x.toFixed(1)} ${frame.y.toFixed(1)} ${frame.w.toFixed(1)} ${frame.h.toFixed(1)}`}
        className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
        style={{
          width: `min(100cqw, calc(100cqh * ${ratio.toFixed(4)}))`,
          height: `min(100cqh, calc(100cqw / ${ratio.toFixed(4)}))`,
        }}
      >
        {/* The land: a static, cached SVG asset (not in the JS bundle or the HTML), placed in the same frame. */}
        <img
          data-testid="events-map-land"
          src={UK_SVG_URL}
          alt=""
          aria-hidden="true"
          width={Math.round(UK_SVG_BOX.w)}
          height={Math.round(UK_SVG_BOX.h)}
          decoding="async"
          draggable={false}
          className="pointer-events-none absolute max-w-none select-none"
          style={{
            left: `${((UK_SVG_BOX.x - frame.x) / frame.w) * 100}%`,
            top: `${((UK_SVG_BOX.y - frame.y) / frame.h) * 100}%`,
            width: `${(UK_SVG_BOX.w / frame.w) * 100}%`,
            height: `${(UK_SVG_BOX.h / frame.h) * 100}%`,
          }}
        />
        {branches.map((b) => {
          const pos = framePosition(frame, b.latitude, b.longitude);
          const on = lit.has(b.id);
          const index = branchEventIndex(steps, b.id);
          const step = index === null ? null : steps[index]!;
          return (
            <span
              key={b.id}
              aria-hidden
              data-testid="events-map-branch"
              data-branch-id={b.id}
              data-active={on ? "true" : "false"}
              data-focused={focused === b.id ? "true" : undefined}
              data-event-id={step?.event.id}
              title={step ? b.name : undefined}
              onPointerEnter={step ? () => onPreview(index) : undefined}
              onPointerLeave={step ? () => onPreview(null) : undefined}
              onClick={step ? () => onPick(index!) : undefined}
              className={cn(
                "absolute flex size-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full",
                step ? "cursor-pointer" : "pointer-events-none",
                focused === b.id && "ring-2 ring-[#28303D] ring-offset-2",
                on || focused === b.id ? "z-20" : "z-10",
              )}
              style={{ left: `${pos.left * 100}%`, top: `${pos.top * 100}%` }}
            >
              <BranchDot on={on} past={!!shown?.past && on} pulse={on} />
            </span>
          );
        })}
        {venue && (
          <span
            aria-hidden
            data-testid="events-map-venue"
            className="pointer-events-none absolute z-20 flex size-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center"
            style={(() => {
              const p = framePosition(frame, venue.latitude, venue.longitude);
              return { left: `${p.left * 100}%`, top: `${p.top * 100}%` };
            })()}
          >
            <BranchDot on past={!!shown?.past} pulse />
          </span>
        )}
        {children}
      </div>
    </div>
  );
}

function BranchDot({ on, past, pulse }: { on: boolean; past: boolean; pulse: boolean }) {
  const colour = !on ? "bg-[#5b6573]" : past ? "bg-[#28303D]" : "bg-primary";
  return (
    <span className="relative flex items-center justify-center">
      {pulse && (
        <span
          aria-hidden
          data-testid="events-map-pulse"
          className={cn(
            "absolute inline-flex size-4 rounded-full opacity-60 motion-safe:animate-ping",
            colour,
          )}
        />
      )}
      <span
        className={cn(
          "relative block rounded-full border-2 border-white shadow-[0_0_0_1px_rgb(0_0_0/0.35)] transition-[width,height] duration-300 motion-reduce:transition-none",
          on ? "size-4" : "size-2.5",
          colour,
        )}
      />
    </span>
  );
}

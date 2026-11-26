// The public events map as a scroll-driven story: pure helpers (no React, no DOM), so they are unit tested.
// One fixed map of the United Kingdom: the frame is computed once from the land and the branch points and never
// zooms, pans or re-centres on an event. Events step in date order (past first, then upcoming).
import {
  eventStartValue,
  isPastEvent,
  londonDay,
  mapLocation,
  type MapEvent,
} from "@/lib/events-map";

/** A branch as the map draws it (town-centre coordinates). */
export type BranchPoint = {
  id: string;
  name: string;
  region_id: string | null;
  latitude: number;
  longitude: number;
};

/** The fields the story reads besides the map's own. */
export type StoryEvent = MapEvent & {
  scope?: "branch" | "region" | "national" | undefined;
  branch_id?: string | null | undefined;
  region_id?: string | null | undefined;
};

const K = Math.cos((54.5 * Math.PI) / 180);
/**
 * Map units: 100 per degree of latitude, longitudes scaled by cos(54.5°) (the UK's middle). Must match
 * scripts/uk-map/generate.mjs, which drew the land dots with it.
 */
export function project(latitude: number, longitude: number): [number, number] {
  return [(longitude + 9) * K * 100, (61 - latitude) * 100];
}

export type Frame = { x: number; y: number; w: number; h: number };
type Bounds = { minX: number; minY: number; maxX: number; maxY: number };

/**
 * The fixed frame: the United Kingdom with a margin, extended once to take in any branch outside it. The same for
 * every event of the page (the map never moves).
 */
export function mapFrame(
  land: Bounds,
  branches: { latitude: number; longitude: number }[],
  pad = 16,
): Frame {
  let { minX, minY, maxX, maxY } = land;
  for (const b of branches) {
    const [x, y] = project(b.latitude, b.longitude);
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  return { x: minX - pad, y: minY - pad, w: maxX - minX + 2 * pad, h: maxY - minY + 2 * pad };
}

/** A point as fractions (0–1) of the frame. */
export function framePosition(frame: Frame, latitude: number, longitude: number) {
  const [x, y] = project(latitude, longitude);
  return { left: (x - frame.x) / frame.w, top: (y - frame.y) / frame.h };
}

/** Where an event lights up: its branch, every branch of its region (region events), or its venue (no branch). */
export type StoryTarget = { branchIds: string[]; point: { latitude: number; longitude: number } };

export function storyTarget(e: StoryEvent, branches: BranchPoint[]): StoryTarget | null {
  if (e.is_online) return null;
  const centre = (list: BranchPoint[]) => ({
    branchIds: list.map((b) => b.id),
    point: {
      latitude: list.reduce((s, b) => s + b.latitude, 0) / list.length,
      longitude: list.reduce((s, b) => s + b.longitude, 0) / list.length,
    },
  });
  if (e.scope === "region" && e.region_id) {
    const inRegion = branches.filter((b) => b.region_id === e.region_id);
    if (inRegion.length) return centre(inRegion);
  }
  const own = e.branch_id ? branches.find((b) => b.id === e.branch_id) : undefined;
  if (own) return centre([own]);
  const venue = mapLocation(e);
  return venue
    ? { branchIds: [], point: { latitude: venue.latitude, longitude: venue.longitude } }
    : null;
}

export type StoryStep<T extends StoryEvent = StoryEvent> = {
  event: T;
  target: StoryTarget;
  past: boolean;
  /** London "YYYY-MM-DD" of the start. */
  day: string;
};

const startTime = (e: StoryEvent) => {
  const v = eventStartValue(e);
  if (!v) return NaN;
  return /^\d{4}-\d{2}-\d{2}$/.test(v) ? Date.parse(`${v}T12:00:00Z`) : Date.parse(v);
};

/**
 * The story's steps: every scheduled event the map can place, once, in date order (so past events come first, then
 * the coming ones). Ties keep a stable order by title and id.
 */
export function storySteps<T extends StoryEvent>(
  events: T[],
  branches: BranchPoint[],
  now = new Date(),
): StoryStep<T>[] {
  const seen = new Set<string>();
  const steps: StoryStep<T>[] = [];
  for (const event of events) {
    if (seen.has(event.id)) continue;
    seen.add(event.id);
    const start = eventStartValue(event);
    if (!start || Number.isNaN(startTime(event))) continue;
    const target = storyTarget(event, branches);
    if (!target) continue;
    steps.push({ event, target, past: isPastEvent(event, now), day: londonDay(start) });
  }
  return steps.sort(
    (a, b) =>
      startTime(a.event) - startTime(b.event) ||
      a.event.title.localeCompare(b.event.title) ||
      a.event.id.localeCompare(b.event.id),
  );
}

/** The index of the first coming event (steps.length when every event is past). */
export function firstUpcomingIndex(steps: { past: boolean }[]) {
  const i = steps.findIndex((s) => !s.past);
  return i === -1 ? steps.length : i;
}

/**
 * Where the story starts ("Today"): the next coming event, or the most recent past one when nothing is coming. Scrolling
 * moves forward from here; past events are reached by the timeline (ticks, drag, keys, "Past events").
 */
export function startIndex(steps: { past: boolean }[]) {
  return Math.max(Math.min(firstUpcomingIndex(steps), steps.length - 1), 0);
}

export function clampStep(index: number, length: number) {
  return Math.min(Math.max(index, 0), Math.max(length - 1, 0));
}

/** Keyboard on the timeline: arrows ±1, Home and End; null for any other key. */
export function stepKey(key: string, index: number, length: number): number | null {
  switch (key) {
    case "ArrowLeft":
    case "ArrowUp":
      return clampStep(index - 1, length);
    case "ArrowRight":
    case "ArrowDown":
      return clampStep(index + 1, length);
    case "Home":
      return 0;
    case "End":
      return clampStep(length - 1, length);
    default:
      return null;
  }
}

/** Play: the next step, or null at the end (playing stops there). */
export function playStep(index: number, length: number): number | null {
  return index + 1 < length ? index + 1 : null;
}

/**
 * Scrolling through the sticky section covers the steps from `start` to the last one: `progress` (0 at its top, 1 when
 * its end reaches the bottom of the screen) picks the step; each owns an equal slice. Earlier (past) steps have no
 * slice: the section's top stands for `start`.
 */
export function stepAtProgress(progress: number, length: number, start = 0) {
  if (length <= 0) return 0;
  const from = clampStep(start, length);
  const span = length - from;
  return from + Math.min(Math.floor(Math.min(Math.max(progress, 0), 1) * span), span - 1);
}
/** The progress in the middle of a step's slice (where jumping to it scrolls); 0 for a step before `start`. */
export function progressOfStep(index: number, length: number, start = 0) {
  if (length <= 0) return 0;
  const from = clampStep(start, length);
  if (index < from) return 0;
  return (clampStep(index, length) - from + 0.5) / (length - from);
}

/** The scroll length of one step, in viewport heights: shorter with many events, at most about 6 screens in all. */
export function stepHeightVh(length: number) {
  return length <= 0 ? 0 : Math.max(8, Math.min(40, Math.round(600 / length)));
}

/** A tick's position on the bar in percent (evenly spaced, one per event). */
export function tickPosition(index: number, length: number) {
  return length <= 1 ? 50 : (index / (length - 1)) * 100;
}
/** Where "Today" sits: between the last past and the first coming tick (or at an end). */
export function todayPosition(steps: { past: boolean }[]) {
  const n = steps.length;
  const first = firstUpcomingIndex(steps);
  if (n <= 1) return first === 0 ? 0 : 100;
  if (first === 0) return 0;
  if (first === n) return 100;
  return ((first - 0.5) / (n - 1)) * 100;
}

/** The event a branch dot shows on hover or focus: its next coming event, else its latest past one. */
export function branchEventIndex(steps: StoryStep[], branchId: string): number | null {
  let latestPast: number | null = null;
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i]!;
    if (!s.target.branchIds.includes(branchId)) continue;
    if (!s.past) return i;
    latestPast = i;
  }
  return latestPast;
}

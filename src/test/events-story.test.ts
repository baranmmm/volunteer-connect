import { describe, expect, it } from "vitest";
import {
  branchEventIndex,
  clampStep,
  firstUpcomingIndex,
  framePosition,
  mapFrame,
  playStep,
  progressOfStep,
  project,
  stepAtProgress,
  stepHeightVh,
  startIndex,
  stepKey,
  storySteps,
  storyTarget,
  tickPosition,
  todayPosition,
  type BranchPoint,
  type StoryEvent,
} from "@/lib/events-story";
import { readFileSync } from "node:fs";
import { UK_BOUNDS, UK_DOT_COUNT, UK_SVG_BOX } from "@/components/public/events-map/uk-dots";

// The /events map story: event order, where an event lights up, stepping (keys, Play, scroll) and the fixed frame.
const NOW = new Date("2026-11-24T12:00:00Z");
const SOUTH = "11111111-1111-4111-8111-111111111111";
const NORTH = "22222222-2222-4222-8222-222222222222";
const BRANCHES: BranchPoint[] = [
  { id: "b-medway", name: "Medway", region_id: SOUTH, latitude: 51.3781, longitude: 0.528 },
  { id: "b-brighton", name: "Brighton", region_id: SOUTH, latitude: 50.8225, longitude: -0.1372 },
  { id: "b-leeds", name: "Leeds", region_id: NORTH, latitude: 53.8008, longitude: -1.5491 },
];

let n = 0;
function ev(over: Partial<StoryEvent> = {}): StoryEvent {
  n += 1;
  return {
    id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
    title: `Event ${n}`,
    all_day: false,
    start_at: "2026-12-05T18:30:00Z",
    end_at: "2026-12-05T20:30:00Z",
    start_date: null,
    end_date: null,
    branch: "Medway",
    region: "South",
    location: "Hall",
    is_online: false,
    has_image: false,
    registration: "open",
    scope: "branch",
    branch_id: "b-medway",
    region_id: SOUTH,
    map: null,
    ...over,
  };
}

describe("story order", () => {
  it("past events first, then upcoming, each in date order (all-day dates and instants mixed)", () => {
    const later = ev({ start_at: "2027-02-01T18:00:00Z", end_at: "2027-02-01T20:00:00Z" });
    const soon = ev({ start_at: "2026-11-30T18:00:00Z", end_at: "2026-11-30T20:00:00Z" });
    const oldPast = ev({
      all_day: true,
      start_at: null,
      end_at: null,
      start_date: "2026-01-10",
      end_date: "2026-01-10",
      past_record: true,
    });
    const recentPast = ev({ start_at: "2026-10-01T18:00:00Z", end_at: "2026-10-01T20:00:00Z" });
    const steps = storySteps([later, soon, recentPast, oldPast], BRANCHES, NOW);
    expect(steps.map((s) => s.event.id)).toEqual([oldPast.id, recentPast.id, soon.id, later.id]);
    expect(steps.map((s) => s.past)).toEqual([true, true, false, false]);
    expect(steps[0]!.day).toBe("2026-01-10");
    expect(firstUpcomingIndex(steps)).toBe(2);
  });

  it("an event ending today but started yesterday is still upcoming; an event over an hour ago is past", () => {
    const running = ev({ start_at: "2026-11-23T10:00:00Z", end_at: "2026-11-24T18:00:00Z" });
    const over = ev({ start_at: "2026-11-24T09:00:00Z", end_at: "2026-11-24T11:00:00Z" });
    const steps = storySteps([running, over], BRANCHES, NOW);
    expect(steps.find((s) => s.event.id === running.id)!.past).toBe(false);
    expect(steps.find((s) => s.event.id === over.id)!.past).toBe(true);
  });

  it("drops duplicates (the first copy wins), unscheduled, online and unplaceable events; ties keep a stable order", () => {
    const a = ev({ title: "B same time" });
    const b = ev({ title: "A same time" });
    const dup = { ...a, title: "stale copy" };
    const unscheduled = ev({ start_at: null, end_at: null });
    const online = ev({ is_online: true });
    const nowhere = ev({ scope: "national", branch_id: null, region_id: null, map: null });
    const steps = storySteps([a, b, dup, unscheduled, online, nowhere], BRANCHES, NOW);
    expect(steps.map((s) => s.event.title)).toEqual(["A same time", "B same time"]);
  });
});

describe("where an event lights up", () => {
  it("a branch event: its branch dot", () => {
    expect(storyTarget(ev(), BRANCHES)!.branchIds).toEqual(["b-medway"]);
  });
  it("a region event: every branch of the region, the card at their centre", () => {
    const t = storyTarget(ev({ scope: "region", branch_id: null }), BRANCHES)!;
    expect(t.branchIds).toEqual(["b-medway", "b-brighton"]);
    expect(t.point.latitude).toBeCloseTo((51.3781 + 50.8225) / 2, 5);
  });
  it("a region event of a region without located branches falls back to its branch, then its venue", () => {
    const other = "33333333-3333-4333-8333-333333333333";
    expect(storyTarget(ev({ scope: "region", region_id: other }), BRANCHES)!.branchIds).toEqual([
      "b-medway",
    ]);
    const venue = { latitude: 52.2, longitude: 0.12, precision: "venue" as const };
    const t = storyTarget(
      ev({ scope: "national", branch_id: null, region_id: null, map: venue }),
      BRANCHES,
    )!;
    expect(t.branchIds).toEqual([]);
    expect(t.point).toEqual({ latitude: 52.2, longitude: 0.12 });
  });
  it("online events are never placed", () => {
    expect(storyTarget(ev({ is_online: true }), BRANCHES)).toBeNull();
  });
  it("a branch dot previews its next coming event, else its latest past one, else nothing", () => {
    const past1 = ev({ start_at: "2026-05-01T18:00:00Z", end_at: "2026-05-01T20:00:00Z" });
    const past2 = ev({ start_at: "2026-09-01T18:00:00Z", end_at: "2026-09-01T20:00:00Z" });
    const next = ev({ start_at: "2026-12-01T18:00:00Z", end_at: "2026-12-01T20:00:00Z" });
    const brighton = ev({
      branch_id: "b-brighton",
      start_at: "2026-06-01T18:00:00Z",
      end_at: "2026-06-01T20:00:00Z",
    });
    const steps = storySteps([past1, past2, next, brighton], BRANCHES, NOW);
    expect(steps[branchEventIndex(steps, "b-medway")!]!.event.id).toBe(next.id);
    expect(steps[branchEventIndex(steps, "b-brighton")!]!.event.id).toBe(brighton.id);
    expect(branchEventIndex(steps, "b-leeds")).toBeNull();
    const pastOnly = storySteps([past1, past2], BRANCHES, NOW);
    expect(pastOnly[branchEventIndex(pastOnly, "b-medway")!]!.event.id).toBe(past2.id);
  });
});

describe("stepping", () => {
  it("arrows move one event (clamped), Home and End jump to the ends, other keys do nothing", () => {
    expect(stepKey("ArrowRight", 0, 5)).toBe(1);
    expect(stepKey("ArrowDown", 4, 5)).toBe(4);
    expect(stepKey("ArrowLeft", 0, 5)).toBe(0);
    expect(stepKey("ArrowUp", 3, 5)).toBe(2);
    expect(stepKey("Home", 3, 5)).toBe(0);
    expect(stepKey("End", 1, 5)).toBe(4);
    expect(stepKey("Enter", 1, 5)).toBeNull();
    expect(clampStep(7, 0)).toBe(0);
  });
  it("Play steps one event at a time and stops at the last one", () => {
    expect(playStep(0, 3)).toBe(1);
    expect(playStep(1, 3)).toBe(2);
    expect(playStep(2, 3)).toBeNull();
  });
  it("scroll progress picks a step; jumping to a step scrolls to the middle of its slice, which picks it again", () => {
    expect(stepAtProgress(-0.2, 4)).toBe(0);
    expect(stepAtProgress(0.24, 4)).toBe(0);
    expect(stepAtProgress(0.25, 4)).toBe(1);
    expect(stepAtProgress(1, 4)).toBe(3);
    expect(stepAtProgress(0.5, 0)).toBe(0);
    for (let i = 0; i < 9; i++) expect(stepAtProgress(progressOfStep(i, 9), 9)).toBe(i);
  });
  it("the story starts on Today: the next coming event, else the most recent past one", () => {
    expect(startIndex([{ past: true }, { past: true }, { past: false }, { past: false }])).toBe(2);
    expect(startIndex([{ past: false }, { past: false }])).toBe(0);
    expect(startIndex([{ past: true }, { past: true }, { past: true }])).toBe(2);
    expect(startIndex([])).toBe(0);
  });
  it("scrolling covers only Today onward; past steps map to the section's top", () => {
    // 6 steps, Today at 2: four slices (2, 3, 4, 5).
    expect(stepAtProgress(-1, 6, 2)).toBe(2);
    expect(stepAtProgress(0, 6, 2)).toBe(2);
    expect(stepAtProgress(0.25, 6, 2)).toBe(3);
    expect(stepAtProgress(0.99, 6, 2)).toBe(5);
    expect(stepAtProgress(1, 6, 2)).toBe(5);
    for (let i = 2; i < 6; i++) expect(stepAtProgress(progressOfStep(i, 6, 2), 6, 2)).toBe(i);
    expect(progressOfStep(0, 6, 2)).toBe(0);
    expect(progressOfStep(1, 6, 2)).toBe(0);
    // Every event past: a single slice for the most recent one.
    expect(stepAtProgress(0.7, 3, 2)).toBe(2);
  });
  it("Play from a past position walks forward through Today to the end", () => {
    const seen: number[] = [];
    for (let i: number | null = 0; i !== null; i = playStep(i, 4)) seen.push(i);
    expect(seen).toEqual([0, 1, 2, 3]);
  });
  it("each step scrolls a shorter way with many events, within 8–40% of a screen", () => {
    expect(stepHeightVh(3)).toBe(40);
    expect(stepHeightVh(30)).toBe(20);
    expect(stepHeightVh(200)).toBe(8);
  });
  it("ticks are evenly spaced; Today sits between the last past and the first coming tick", () => {
    expect(tickPosition(0, 5)).toBe(0);
    expect(tickPosition(4, 5)).toBe(100);
    expect(tickPosition(0, 1)).toBe(50);
    const mixed = [
      { past: true },
      { past: true },
      { past: false },
      { past: false },
      { past: false },
    ];
    expect(todayPosition(mixed)).toBeCloseTo(37.5);
    expect(todayPosition([{ past: false }, { past: false }])).toBe(0);
    expect(todayPosition([{ past: true }, { past: true }])).toBe(100);
  });
});

describe("the fixed map frame", () => {
  it("covers the United Kingdom and every branch inside them without changing", () => {
    const f = mapFrame(UK_BOUNDS, BRANCHES);
    expect(f).toEqual(mapFrame(UK_BOUNDS, []));
    for (const b of BRANCHES) {
      const p = framePosition(f, b.latitude, b.longitude);
      expect(p.left).toBeGreaterThan(0);
      expect(p.left).toBeLessThan(1);
      expect(p.top).toBeGreaterThan(0);
      expect(p.top).toBeLessThan(1);
    }
  });
  it("contains all four nations (capitals and Shetland) without any extension", () => {
    const f = mapFrame(UK_BOUNDS, []);
    const places: [string, number, number][] = [
      ["London", 51.5074, -0.1278],
      ["Cardiff", 51.4816, -3.1791],
      ["Edinburgh", 55.9533, -3.1883],
      ["Belfast", 54.5973, -5.9301],
      ["Lerwick", 60.155, -1.145],
      ["Glasgow", 55.8642, -4.2518],
    ];
    for (const [, lat, lon] of places) {
      const p = framePosition(f, lat, lon);
      expect(p.left).toBeGreaterThan(0);
      expect(p.left).toBeLessThan(1);
      expect(p.top).toBeGreaterThan(0);
      expect(p.top).toBeLessThan(1);
    }
    // A Scottish or Northern Irish branch does not change the frame.
    const glasgow = {
      id: "b-glasgow",
      name: "Glasgow",
      region_id: null,
      latitude: 55.8642,
      longitude: -4.2518,
    };
    expect(mapFrame(UK_BOUNDS, [...BRANCHES, glasgow])).toEqual(f);
  });
  it("is extended once to take in a branch outside the United Kingdom's box", () => {
    const outside = { id: "b-x", name: "Outside", region_id: null, latitude: 51.0, longitude: 2.6 };
    const base = mapFrame(UK_BOUNDS, BRANCHES);
    const f = mapFrame(UK_BOUNDS, [...BRANCHES, outside]);
    expect(f.w).toBeGreaterThan(base.w);
    const p = framePosition(f, outside.latitude, outside.longitude);
    expect(p.left).toBeGreaterThan(0);
    expect(p.left).toBeLessThan(1);
  });
  it("the land dots were generated with the same projection (the capitals inside the dotted bounds)", () => {
    for (const [lat, lon] of [
      [51.5074, -0.1278],
      [55.9533, -3.1883],
      [54.5973, -5.9301],
    ] as const) {
      const [x, y] = project(lat, lon);
      expect(x).toBeGreaterThan(UK_BOUNDS.minX);
      expect(x).toBeLessThan(UK_BOUNDS.maxX);
      expect(y).toBeGreaterThan(UK_BOUNDS.minY);
      expect(y).toBeLessThan(UK_BOUNDS.maxY);
    }
    // The dots are a static asset (out of the JS module graph) whose box frames the land bounds.
    const svg = readFileSync("public/maps/uk-dots.svg", "utf8");
    expect(svg.match(/h0/g)!.length).toBe(UK_DOT_COUNT);
    expect(UK_DOT_COUNT).toBeGreaterThan(1000);
    expect(svg).toContain(
      `viewBox="${UK_SVG_BOX.x} ${UK_SVG_BOX.y} ${UK_SVG_BOX.w} ${UK_SVG_BOX.h}"`,
    );
    expect(UK_SVG_BOX.x).toBeLessThan(UK_BOUNDS.minX);
    expect(UK_SVG_BOX.x + UK_SVG_BOX.w).toBeGreaterThan(UK_BOUNDS.maxX);
  });
});

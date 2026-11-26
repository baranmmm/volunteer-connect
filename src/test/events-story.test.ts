import { describe, expect, it } from "vitest";
import {
  branchEventIndex,
  clampStep,
  firstUpcomingIndex,
  framePosition,
  mapFrame,
  mapLayout,
  placePoint,
  targetPosition,
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
  const inside = (f: ReturnType<typeof mapFrame>, lat: number, lon: number) => {
    const p = framePosition(f, lat, lon);
    return p.left > 0 && p.left < 1 && p.top > 0 && p.top < 1;
  };
  it("is mainland Great Britain, Northern Ireland and the Hebrides; Orkney and Shetland are outside", () => {
    const f = mapFrame(UK_BOUNDS);
    for (const [lat, lon] of [
      [51.5074, -0.1278], // London
      [51.4816, -3.1791], // Cardiff
      [55.9533, -3.1883], // Edinburgh
      [54.5973, -5.9301], // Belfast
      [58.6373, -3.0689], // John o' Groats (the mainland's north)
      [58.209, -6.3849], // Stornoway (Outer Hebrides)
      [50.0657, -5.7132], // Land's End
    ] as const)
      expect(inside(f, lat, lon)).toBe(true);
    expect(inside(f, 58.9809, -2.9605)).toBe(false); // Kirkwall, Orkney
    expect(inside(f, 60.155, -1.145)).toBe(false); // Lerwick, Shetland
    // Tight: the frame is the land plus a small margin, no empty band.
    expect(f.y).toBeGreaterThan(UK_BOUNDS.minY - 10);
    expect(f.h).toBeLessThan(UK_BOUNDS.maxY - UK_BOUNDS.minY + 20);
  });
  it("never grows: branches on the mainland need no inset; a branch outside goes into a top-right inset", () => {
    const glasgow = {
      id: "b-glasgow",
      name: "Glasgow",
      region_id: null,
      latitude: 55.8642,
      longitude: -4.2518,
    };
    const lerwick = {
      id: "b-lerwick",
      name: "Lerwick",
      region_id: null,
      latitude: 60.155,
      longitude: -1.145,
    };
    const kirkwall = {
      id: "b-kirkwall",
      name: "Kirkwall",
      region_id: null,
      latitude: 58.9809,
      longitude: -2.9605,
    };
    expect(mapLayout(UK_BOUNDS, [...BRANCHES, glasgow]).inset).toBeNull();
    const layout = mapLayout(UK_BOUNDS, [...BRANCHES, glasgow, lerwick, kirkwall]);
    expect(layout.frame).toEqual(mapFrame(UK_BOUNDS));
    const inset = layout.inset!;
    expect(inset.branchIds.sort()).toEqual(["b-kirkwall", "b-lerwick"]);
    // Top-right corner, inside the map, at most a quarter wide.
    expect(inset.box.left + inset.box.width).toBeLessThanOrEqual(1);
    expect(inset.box.left).toBeGreaterThan(0.7);
    expect(inset.box.top).toBeLessThan(0.05);
    expect(inset.box.height).toBeLessThanOrEqual(0.28);
    // Placing: mainland points on the map, the islands inside the inset box (Lerwick north of Kirkwall).
    const g = placePoint(layout, glasgow.latitude, glasgow.longitude);
    expect(g.inset).toBe(false);
    const l = placePoint(layout, lerwick.latitude, lerwick.longitude);
    const k = placePoint(layout, kirkwall.latitude, kirkwall.longitude);
    for (const p of [l, k]) {
      expect(p.inset).toBe(true);
      expect(p.left).toBeGreaterThanOrEqual(inset.box.left);
      expect(p.left).toBeLessThanOrEqual(inset.box.left + inset.box.width);
      expect(p.top).toBeGreaterThanOrEqual(inset.box.top);
      expect(p.top).toBeLessThanOrEqual(inset.box.top + inset.box.height);
    }
    expect(l.top).toBeLessThan(k.top);
    // The card anchors on the drawn dot (in the inset for Lerwick).
    const t = targetPosition(
      layout,
      { branchIds: ["b-lerwick"], point: { latitude: 0, longitude: 0 } },
      [lerwick],
    );
    expect(t).toMatchObject({ left: l.left, top: l.top, inset: true });
  });
  it("the inset sits over sea (no mainland town under it)", () => {
    const layout = mapLayout(UK_BOUNDS, [{ id: "x", latitude: 60.155, longitude: -1.145 }]);
    const box = layout.inset!.box;
    for (const [lat, lon] of [
      [57.1497, -2.0943], // Aberdeen
      [57.5052, -1.7981], // Peterhead
      [58.4391, -3.0941], // Wick
      [56.462, -2.9707], // Dundee
    ] as const) {
      const p = framePosition(layout.frame, lat, lon);
      const under =
        p.left >= box.left &&
        p.left <= box.left + box.width &&
        p.top >= box.top &&
        p.top <= box.top + box.height;
      expect(under).toBe(false);
    }
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
